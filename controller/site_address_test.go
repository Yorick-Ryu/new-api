package controller

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestPasswordResetEmailUsesBusinessAddressAndSkipsUnboundUsername(t *testing.T) {
	oldDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	model.DB = db
	api, site := system_setting.ServerAddress, system_setting.SiteAddress
	smtpServer, smtpPort, smtpAccount, smtpFrom, smtpToken := common.SMTPServer, common.SMTPPort, common.SMTPAccount, common.SMTPFrom, common.SMTPToken
	smtpSSL, smtpStartTLS := common.SMTPSSLEnabled, common.SMTPStartTLSEnabled
	t.Cleanup(func() {
		model.DB = oldDB
		_ = sqlDB.Close()
		system_setting.ServerAddress, system_setting.SiteAddress = api, site
		common.SMTPServer, common.SMTPPort, common.SMTPAccount, common.SMTPFrom, common.SMTPToken = smtpServer, smtpPort, smtpAccount, smtpFrom, smtpToken
		common.SMTPSSLEnabled, common.SMTPStartTLSEnabled = smtpSSL, smtpStartTLS
	})
	system_setting.ServerAddress, system_setting.SiteAddress = "https://api.example.com", "https://example.com"
	common.SMTPAccount, common.SMTPFrom, common.SMTPToken = "", "verify@example.com", ""
	common.SMTPSSLEnabled, common.SMTPStartTLSEnabled = false, false
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()
	host, port, err := net.SplitHostPort(listener.Addr().String())
	require.NoError(t, err)
	common.SMTPServer = host
	common.SMTPPort, err = strconv.Atoi(port)
	require.NoError(t, err)
	message := make(chan string, 1)
	smtpDone := make(chan error, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			smtpDone <- err
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
		smtp := textproto.NewConn(conn)
		_ = smtp.PrintfLine("220 localhost ESMTP")
		for {
			line, err := smtp.ReadLine()
			if err != nil {
				smtpDone <- err
				return
			}
			switch {
			case strings.HasPrefix(line, "DATA"):
				_ = smtp.PrintfLine("354 end with a dot")
				content, err := io.ReadAll(smtp.DotReader())
				if err != nil {
					smtpDone <- err
					return
				}
				message <- string(content)
				_ = smtp.PrintfLine("250 accepted")
			case strings.HasPrefix(line, "QUIT"):
				_ = smtp.PrintfLine("221 bye")
				smtpDone <- nil
				return
			default:
				_ = smtp.PrintfLine("250 OK")
			}
		}
	}()
	require.NoError(t, db.Create(&model.User{Username: "reset-user", Email: "bound@example.com", AffCode: "bound"}).Error)
	require.NoError(t, db.Create(&model.User{Username: "unbound@example.com", AffCode: "unbound"}).Error)
	for _, email := range []string{"unbound@example.com", "bound@example.com"} {
		w := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(w)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/reset_password?email="+email, nil)
		SendPasswordResetEmail(ctx)
		assert.JSONEq(t, `{"success":true,"message":""}`, w.Body.String())
	}
	require.NoError(t, <-smtpDone)
	content := <-message
	assert.Contains(t, content, "https://example.com/user/reset?email=bound@example.com&token=")
	assert.NotContains(t, content, "https://api.example.com")
	assert.NotContains(t, content, "unbound@example.com")
	// Parsing the captured mail also verifies the SMTP message is complete.
	_, err = textproto.NewReader(bufio.NewReader(strings.NewReader(content))).ReadMIMEHeader()
	require.NoError(t, err)
}

func TestAddressOptionsPersistIndependentlyAndPublishCompatibleStatus(t *testing.T) {
	oldDB, oldMap := model.DB, common.OptionMap
	oldLogDB, oldRedis := model.LOG_DB, common.RedisEnabled
	api, site, allowed := system_setting.ServerAddress, system_setting.SiteAddress, system_setting.SiteAllowedOrigins
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.User{}, &model.Log{}, &model.AuditLog{}, &model.PasskeyCredential{}))
	sqlDB, err := db.DB()
	require.NoError(t, err)
	model.DB = db
	common.OptionMap = map[string]string{}
	model.LOG_DB = db
	common.RedisEnabled = false
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "settings-admin", Role: common.RoleRootUser}).Error)
	t.Cleanup(func() {
		model.DB, common.OptionMap = oldDB, oldMap
		model.LOG_DB, common.RedisEnabled = oldLogDB, oldRedis
		system_setting.ServerAddress, system_setting.SiteAddress, system_setting.SiteAllowedOrigins = api, site, allowed
		_ = sqlDB.Close()
	})
	for _, option := range []struct {
		key, value string
		success    bool
	}{
		{"ServerAddress", "https://api.example.com", true},
		{"SiteAllowedOrigins", "https://www.example.com", true},
		{"SiteAddress", "https://example.com/", true},
		{"SiteAddress", "https://attacker.example/path", false},
		{"SiteAllowedOrigins", "https://*.example.com", false},
	} {
		w := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(w)
		payload, err := common.Marshal(map[string]string{"key": option.key, "value": option.value})
		require.NoError(t, err)
		ctx.Request = httptest.NewRequest(http.MethodPut, "/api/option/", strings.NewReader(string(payload)))
		ctx.Set("id", 1)
		ctx.Set("role", common.RoleRootUser)
		UpdateOption(ctx)
		var response struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
		assert.Equal(t, option.success, response.Success, option.key)
	}
	var saved model.Option
	require.NoError(t, db.Where("key = ?", "SiteAddress").First(&saved).Error)
	assert.Equal(t, "https://example.com", saved.Value)
	assert.Equal(t, "https://api.example.com", system_setting.GetAPIAddress())
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
	GetStatus(ctx)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			API        string   `json:"api_address"`
			Legacy     string   `json:"server_address"`
			Site       string   `json:"site_address"`
			Configured bool     `json:"site_address_configured"`
			Origins    []string `json:"site_allowed_origins"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
	assert.True(t, response.Success)
	assert.Equal(t, "https://api.example.com", response.Data.API)
	assert.Equal(t, response.Data.API, response.Data.Legacy)
	assert.Equal(t, "https://example.com", response.Data.Site)
	assert.True(t, response.Data.Configured)
	assert.ElementsMatch(t, []string{"https://example.com", "https://www.example.com"}, response.Data.Origins)
}
