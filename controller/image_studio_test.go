package controller

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestImageStudioDatabaseMatrix(t *testing.T) {
	require.NoError(t, i18n.Init())
	for _, dialect := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.kind, func(t *testing.T) {
			dsn := os.Getenv(dialect.env)
			if dialect.env != "" && dsn == "" {
				t.Skip("database not configured")
			}
			for _, baseline := range []string{"fresh", "released"} {
				t.Run(baseline, func(t *testing.T) {
					db := modelManagementDB(t, dialect.kind, dsn)
					// This isolated fixture upgrades the released user schema, including
					// its original indexes, rather than only exercising a fresh DB.
					if baseline == "released" {
						require.NoError(t, db.Migrator().DropTable(&model.User{}))
						require.NoError(t, db.AutoMigrate(&imageStudioReleasedUser{}))
						// Upgrade the existing single-reference tables with retained data.
						require.NoError(t, db.AutoMigrate(&model.ImageStudioJob{}, &model.ImageStudioAsset{}))
						require.NoError(t, db.Create(&model.ImageStudioAsset{ID: "legacy-reference", UserID: 781, Kind: "reference", ObjectKey: "references/legacy", ExpiresAt: time.Now().Add(time.Hour).Unix()}).Error)
						require.NoError(t, db.Create(&model.ImageStudioJob{ID: "legacy-single-job", UserID: 781, RequestKey: uuid.NewString(), ReferenceID: "legacy-reference", Request: `{"model":"gpt-image-1","prompt":"legacy","n":1,"reference_id":"legacy-reference"}`, Status: "failed", CreatedAt: time.Now().Unix()}).Error)
					}
					// Representative pre-feature data must survive both the upgrade and rerun.
					owner := model.User{Id: 781, Username: "image-owner", Status: common.UserStatusEnabled, Role: common.RoleCommonUser, Group: "default", Quota: 1000000}
					require.NoError(t, db.Create(&owner).Error)
					for range 2 {
						require.NoError(t, db.AutoMigrate(&model.ImageStudioJob{}, &model.ImageStudioAsset{}, &model.ImageStudioJobReference{}, &model.ImageStudioToken{}, &model.Token{}))
					}
					var preserved model.User
					require.NoError(t, db.First(&preserved, owner.Id).Error)
					assert.Equal(t, owner.Quota, preserved.Quota)
					if baseline == "released" {
						var legacy model.ImageStudioJob
						require.NoError(t, db.First(&legacy, "id = ?", "legacy-single-job").Error)
						assert.Equal(t, "legacy-reference", legacy.ReferenceID)
						assert.Contains(t, legacy.Request, `"reference_id":"legacy-reference"`)
					}

					store, restoreStorage := imageStudioTestStore(t)
					worker := imageStudioWorker{store: store, directory: t.TempDir(), owner: "test-node"}
					now := time.Now().Unix()
					job := &model.ImageStudioJob{ID: uuid.NewString(), UserID: owner.Id, RequestKey: uuid.NewString(), RequestHash: "first", Request: `{"model":"gpt-image-1","prompt":"a small house","n":1}`, Status: "queued", CreatedAt: now, UpdatedAt: now}
					saved, err := model.CreateImageStudioJob(job, nil)
					require.NoError(t, err)
					retry := *job
					retry.ID = uuid.NewString()
					repeated, err := model.CreateImageStudioJob(&retry, nil)
					require.NoError(t, err)
					assert.Equal(t, saved.ID, repeated.ID)
					retry.RequestHash = "different"
					_, err = model.CreateImageStudioJob(&retry, nil)
					assert.ErrorIs(t, err, model.ErrImageStudioConflict)
					// The DB uniqueness constraint protects callers outside the submit helper too.
					retry.RequestHash = "first"
					assert.Error(t, db.Create(&retry).Error)
					claimed, err := model.ClaimImageStudioJob(worker.owner, now)
					require.NoError(t, err)
					require.NotNil(t, claimed)
					second, err := model.ClaimImageStudioJob("another-node", now)
					require.NoError(t, err)
					assert.Nil(t, second)
					assert.Equal(t, "running", claimed.Status)
					// An expired execution lease is quarantined, not resubmitted upstream.
					require.NoError(t, db.Model(job).Update("lease_until", now-1).Error)
					worker.cleanup()
					require.NoError(t, db.First(job, "id = ?", job.ID).Error)
					assert.Equal(t, "unknown", job.Status)

					job.Status = "saving"
					job.Owner = worker.owner
					job.ExpiresAt = now + 86400
					job.LeaseUntil = 0
					require.NoError(t, db.Save(job).Error)
					raw := imageStudioTestResponse(t)
					path := filepath.Join(worker.directory, job.ID+".json")
					require.NoError(t, os.WriteFile(path, raw, 0600))
					// The first PUT fails; the saved response survives and a storage-only retry succeeds.
					worker.execute(job)
					require.NoError(t, db.First(job, "id = ?", job.ID).Error)
					assert.Equal(t, "saving", job.Status)
					_, err = os.Stat(path)
					require.NoError(t, err)
					restoreStorage()
					worker.execute(job)
					require.NoError(t, db.First(job, "id = ?", job.ID).Error)
					assert.Equal(t, "success", job.Status)
					var assets []model.ImageStudioAsset
					require.NoError(t, db.Where("job_id = ?", job.ID).Find(&assets).Error)
					require.Len(t, assets, 2)
					assert.Equal(t, job.ExpiresAt, assets[0].ExpiresAt)
					_, err = os.Stat(path)
					assert.True(t, os.IsNotExist(err))
					for _, userID := range []int{owner.Id, owner.Id + 1} {
						recorder := httptest.NewRecorder()
						c, _ := gin.CreateTestContext(recorder)
						c.Set("id", userID)
						c.Params = gin.Params{{Key: "id", Value: assets[0].ID}}
						c.Request = httptest.NewRequest("GET", "/", nil)
						c.Request = httptest.NewRequest("GET", "/?download=1", nil)
						ImageStudioAssetContent(c)
						if userID == owner.Id {
							assert.Equal(t, 200, recorder.Code)
							assert.Equal(t, assets[0].Mime, recorder.Header().Get("Content-Type"))
							assert.Equal(t, "private, no-store", recorder.Header().Get("Cache-Control"))
							assert.Contains(t, recorder.Header().Get("Content-Disposition"), "attachment")
							assert.NotEmpty(t, recorder.Body.Bytes())
						} else {
							assert.Equal(t, 404, c.Writer.Status())
						}
					}
					require.NoError(t, db.Model(&model.ImageStudioAsset{}).Where("job_id = ?", job.ID).Update("expires_at", now-1).Error)
					require.NoError(t, db.Model(job).Update("expires_at", now-1).Error)
					recorder := httptest.NewRecorder()
					c, _ := gin.CreateTestContext(recorder)
					c.Set("id", owner.Id)
					c.Params = gin.Params{{Key: "id", Value: assets[0].ID}}
					c.Request = httptest.NewRequest("GET", "/", nil)
					ImageStudioAssetContent(c)
					assert.Equal(t, 404, c.Writer.Status())
					worker.cleanup()
					var count int64
					require.NoError(t, db.Model(&model.ImageStudioAsset{}).Where("job_id = ?", job.ID).Count(&count).Error)
					assert.Zero(t, count)
					// Re-running migration preserves both history and request-key uniqueness.
					require.NoError(t, db.AutoMigrate(&model.ImageStudioJob{}, &model.ImageStudioAsset{}, &model.ImageStudioJobReference{}, &model.ImageStudioToken{}, &model.Token{}))
					require.NoError(t, db.First(job, "id = ?", job.ID).Error)
					assert.Equal(t, "expired", job.Status)
					reference := model.ImageStudioAsset{ID: uuid.NewString(), UserID: owner.Id, Kind: "reference", ObjectKey: "references/protected", ExpiresAt: now + 60}
					require.NoError(t, model.CreateImageStudioReference(&reference))
					protected := &model.ImageStudioJob{ID: uuid.NewString(), UserID: owner.Id, RequestKey: uuid.NewString(), RequestHash: "protected", Status: "queued", CreatedAt: now}
					_, err = model.CreateImageStudioJob(protected, []string{reference.ID})
					require.NoError(t, err)
					require.NoError(t, db.Model(&reference).Update("expires_at", now-1).Error)
					worker.cleanup()
					require.NoError(t, db.First(&reference, "id = ?", reference.ID).Error, "queued jobs protect their input image from cleanup")
					require.NoError(t, db.Model(protected).Update("status", "failed").Error)
					worker.cleanup()
					assert.ErrorIs(t, db.First(&model.ImageStudioAsset{}, "id = ?", reference.ID).Error, gorm.ErrRecordNotFound)
					imageStudioReferenceLifecycle(t, db, &worker, &owner)
					imageStudioRelayContract(t, db, &worker, &owner)
				})
			}
		})
	}
}

func imageStudioReferenceLifecycle(t *testing.T, db *gorm.DB, worker *imageStudioWorker, owner *model.User) {
	t.Helper()
	now := time.Now().Unix()
	ids := make([]string, 0, model.ImageStudioMaxReferences)
	for range model.ImageStudioMaxReferences {
		id := uuid.NewString()
		asset := model.ImageStudioAsset{ID: id, UserID: owner.Id, Kind: "reference", ObjectKey: "references/" + id, ExpiresAt: now + 60}
		require.NoError(t, model.CreateImageStudioReference(&asset))
		ids = append(ids, id)
	}
	for _, bad := range []model.ImageStudioAsset{
		{ID: uuid.NewString(), UserID: owner.Id + 1, Kind: "reference", ExpiresAt: now + 60},
		{ID: uuid.NewString(), UserID: owner.Id, Kind: "reference", ExpiresAt: now - 1},
		{ID: uuid.NewString(), UserID: owner.Id, Kind: "original", ExpiresAt: now + 60},
	} {
		require.NoError(t, db.Create(&bad).Error)
		job := &model.ImageStudioJob{ID: uuid.NewString(), UserID: owner.Id, RequestKey: uuid.NewString(), Status: "queued", CreatedAt: now}
		_, err := model.CreateImageStudioJob(job, []string{ids[0], ids[1], ids[2], bad.ID})
		assert.ErrorIs(t, err, gorm.ErrRecordNotFound, "every reference must be owned, live and a reference upload")
		var count int64
		require.NoError(t, db.Model(&model.ImageStudioJob{}).Where("id = ?", job.ID).Count(&count).Error)
		assert.Zero(t, count, "invalid fourth references cannot leave a partial job")
		require.NoError(t, db.Where("id = ?", bad.ID).Delete(&model.ImageStudioAsset{}).Error)
	}
	for _, invalid := range [][]string{{ids[0], ids[0]}, {ids[0], ids[1], ids[2], ids[3], "fifth"}} {
		_, err := model.CreateImageStudioJob(&model.ImageStudioJob{UserID: owner.Id}, invalid)
		assert.ErrorIs(t, err, model.ErrImageStudioReferences)
	}
	job := &model.ImageStudioJob{ID: uuid.NewString(), UserID: owner.Id, RequestKey: uuid.NewString(), Status: "queued", CreatedAt: now}
	_, err := model.CreateImageStudioJob(job, ids)
	require.NoError(t, err)
	var links []model.ImageStudioJobReference
	require.NoError(t, db.Where("job_id = ?", job.ID).Find(&links).Error)
	require.Len(t, links, 4)
	assert.Error(t, db.Create(&model.ImageStudioJobReference{JobID: job.ID, AssetID: ids[0]}).Error, "the composite primary key rejects duplicate associations")
	require.NoError(t, db.AutoMigrate(&model.ImageStudioJob{}, &model.ImageStudioAsset{}, &model.ImageStudioJobReference{}, &model.ImageStudioToken{}, &model.Token{}))
	var preserved int64
	require.NoError(t, db.Model(&model.ImageStudioJobReference{}).Where("job_id = ?", job.ID).Count(&preserved).Error)
	assert.EqualValues(t, 4, preserved, "repeat migrations preserve all associations")
	require.NoError(t, db.Model(&model.ImageStudioAsset{}).Where("id IN ?", ids).Update("expires_at", now-1).Error)
	worker.cleanup()
	var retained []model.ImageStudioAsset
	require.NoError(t, db.Where("id IN ?", ids).Find(&retained).Error)
	assert.Len(t, retained, 4, "active jobs protect every reference, including the fourth")
	job.Status, job.Owner, job.ExpiresAt = "saving", worker.owner, now+86400
	require.NoError(t, db.Save(job).Error)
	require.NoError(t, model.SaveImageStudioAssets(job, nil))
	require.NoError(t, db.Where("id IN ?", ids).Find(&retained).Error)
	for _, asset := range retained {
		assert.Equal(t, job.ExpiresAt, asset.ExpiresAt, "all reference expiries follow the successful job")
	}
	shared := &model.ImageStudioJob{ID: uuid.NewString(), UserID: owner.Id, RequestKey: uuid.NewString(), Status: "queued", CreatedAt: now}
	_, err = model.CreateImageStudioJob(shared, ids[3:])
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", owner.Id)
	c.Params = gin.Params{{Key: "id", Value: job.ID}}
	c.Request = httptest.NewRequest(http.MethodDelete, "/", nil)
	DeleteImageStudioJob(c)
	require.Equal(t, http.StatusOK, recorder.Code)
	require.NoError(t, db.Model(&model.ImageStudioJobReference{}).Where("job_id = ?", job.ID).Count(&preserved).Error)
	assert.Zero(t, preserved, "manual deletion removes that job's associations")
	require.NoError(t, db.Model(&model.ImageStudioAsset{}).Where("id IN ?", ids).Update("expires_at", now-1).Error)
	worker.cleanup()
	retained = nil
	require.NoError(t, db.Where("id IN ?", ids).Find(&retained).Error)
	require.Len(t, retained, 1, "other queued jobs still protect a shared reference")
	assert.Equal(t, ids[3], retained[0].ID)
	require.NoError(t, db.Model(shared).Updates(map[string]any{"status": "failed", "created_at": now - 25*3600}).Error)
	worker.cleanup()
	assert.ErrorIs(t, db.First(&model.ImageStudioAsset{}, "id = ?", ids[3]).Error, gorm.ErrRecordNotFound)
	require.NoError(t, db.Model(&model.ImageStudioJobReference{}).Where("job_id = ?", shared.ID).Count(&preserved).Error)
	assert.Zero(t, preserved, "expiry removes reference associations")
	assert.ErrorIs(t, db.First(&model.ImageStudioJob{}, "id = ?", shared.ID).Error, gorm.ErrRecordNotFound)
	completed := model.ImageStudioJob{ID: uuid.NewString(), UserID: owner.Id, RequestKey: uuid.NewString(), Request: `{"prompt":"retained only until delivery expires"}`, Status: "success", CreatedAt: now - 25*3600, ExpiresAt: now + 3600}
	require.NoError(t, db.Create(&completed).Error)
	worker.cleanup()
	require.NoError(t, db.First(&completed, "id = ?", completed.ID).Error, "24-hour retention begins when generation completes")
	require.NoError(t, db.Model(&completed).Update("expires_at", now-1).Error)
	worker.cleanup()
	assert.ErrorIs(t, db.First(&model.ImageStudioJob{}, "id = ?", completed.ID).Error, gorm.ErrRecordNotFound, "expired server prompts are removed after delivery retention")
	// A legacy job without association rows retains the original single-image protection.
	legacyAsset := model.ImageStudioAsset{ID: uuid.NewString(), UserID: owner.Id, Kind: "reference", ObjectKey: "references/legacy", ExpiresAt: now - 1}
	legacyJob := model.ImageStudioJob{ID: uuid.NewString(), UserID: owner.Id, RequestKey: uuid.NewString(), ReferenceID: legacyAsset.ID, Status: "queued", CreatedAt: now}
	require.NoError(t, db.Create(&legacyAsset).Error)
	require.NoError(t, db.Create(&legacyJob).Error)
	worker.cleanup()
	require.NoError(t, db.First(&legacyAsset, "id = ?", legacyAsset.ID).Error)
	require.NoError(t, db.Model(&legacyJob).Update("status", "failed").Error)
	worker.cleanup()
	assert.ErrorIs(t, db.First(&model.ImageStudioAsset{}, "id = ?", legacyAsset.ID).Error, gorm.ErrRecordNotFound)
}

func imageStudioTestStore(t *testing.T) (*service.ImageStudioStore, func()) {
	t.Helper()
	directory := t.TempDir()
	t.Setenv("IMAGE_STUDIO_STORAGE_DIR", directory)
	// A file occupying the delivery directory deterministically simulates a
	// storage failure without depending on permissions or an external bucket.
	blocked := filepath.Join(directory, "generated")
	require.NoError(t, os.WriteFile(blocked, []byte("blocked"), 0600))
	store, err := service.NewImageStudioStore()
	require.NoError(t, err)
	return store, func() { require.NoError(t, os.Remove(blocked)) }
}

func imageStudioTestResponse(t *testing.T) []byte {
	t.Helper()
	var pngData bytes.Buffer
	require.NoError(t, png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 3, 2))))
	data, err := common.Marshal(map[string]any{"data": []map[string]string{{"b64_json": base64.StdEncoding.EncodeToString(pngData.Bytes())}}})
	require.NoError(t, err)
	return data
}

func imageStudioTokenContract(t *testing.T, db *gorm.DB, owner *model.User) *model.Token {
	t.Helper()
	var wait sync.WaitGroup
	type result struct {
		token *model.Token
		err   error
	}
	results := make(chan result, 4)
	for range 4 {
		wait.Go(func() {
			token, err := model.GetOrCreateImageStudioToken(owner.Id, []string{"gpt-image-1", "gpt-image-2"})
			results <- result{token, err}
		})
	}
	wait.Wait()
	close(results)
	var token *model.Token
	for result := range results {
		require.NoError(t, result.err)
		if token == nil {
			token = result.token
		}
		assert.Equal(t, token.Id, result.token.Id, "concurrent submissions reuse one key")
	}
	require.NotNil(t, token)
	assert.Equal(t, "default", token.Group)
	assert.True(t, token.ModelLimitsEnabled)
	assert.True(t, token.UnlimitedQuota, "wallet billing remains the initial quota limit")
	assert.False(t, token.GetModelLimitsMap()["gpt-4o"])
	var count int64
	require.NoError(t, db.Model(&model.ImageStudioToken{}).Where("user_id = ?", owner.Id).Count(&count).Error)
	assert.Equal(t, int64(1), count)
	assert.Error(t, db.Create(&model.ImageStudioToken{UserID: owner.Id, TokenID: token.Id + 100}).Error)
	token.Name = "Renamed by owner"
	token.UnlimitedQuota = false
	token.RemainQuota = 1000000
	require.NoError(t, token.Update())
	reused, err := model.GetOrCreateImageStudioToken(owner.Id, []string{"gpt-image-1"})
	require.NoError(t, err)
	assert.Equal(t, token.Id, reused.Id, "names are not credential identity")
	originalMax := operation_setting.GetTokenSetting().MaxUserTokens
	t.Cleanup(func() { operation_setting.GetTokenSetting().MaxUserTokens = originalMax })
	operation_setting.GetTokenSetting().MaxUserTokens = 0
	_, err = model.GetOrCreateImageStudioToken(owner.Id, []string{"gpt-image-1"})
	require.NoError(t, err, "reusing an existing key does not consume another slot")
	other := model.User{Id: owner.Id + 10, Username: "image-token-limit", AffCode: "token-limit", Status: common.UserStatusEnabled, Role: common.RoleCommonUser, Group: "default"}
	require.NoError(t, db.Create(&other).Error)
	_, err = model.GetOrCreateImageStudioToken(other.Id, []string{"gpt-image-1"})
	operation_setting.GetTokenSetting().MaxUserTokens = originalMax
	assert.ErrorIs(t, err, model.ErrImageStudioTokenLimit)
	require.NoError(t, db.AutoMigrate(&model.ImageStudioToken{}))
	reused, err = model.GetOrCreateImageStudioToken(owner.Id, []string{"gpt-image-1"})
	require.NoError(t, err)
	assert.Equal(t, token.Id, reused.Id, "migration retains the purpose association")
	var audits []model.AuditLog
	require.NoError(t, db.Where("user_id = ? AND action = ?", owner.Id, "image_studio.token.create").Find(&audits).Error)
	require.Len(t, audits, 1)
	assert.NotContains(t, audits[0].Content, token.Key)
	// Submission holds no browser credential and retries the same request only once.
	requestKey := uuid.NewString()
	var submitted struct {
		Success bool `json:"success"`
		Data    struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	for range 2 {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("id", owner.Id)
		c.Request = httptest.NewRequest("POST", "/api/image-studio/jobs", strings.NewReader(`{"model":"gpt-image-1","prompt":"test automatic key","n":1}`))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Request.Header.Set("Idempotency-Key", requestKey)
		CreateImageStudioJob(c)
		require.Equal(t, 200, recorder.Code, recorder.Body.String())
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &submitted))
		require.True(t, submitted.Success)
		assert.NotContains(t, recorder.Body.String(), token.Key)
	}
	var submittedJobs []model.ImageStudioJob
	require.NoError(t, db.Where("user_id = ? AND request_key = ?", owner.Id, requestKey).Find(&submittedJobs).Error)
	require.Len(t, submittedJobs, 1)
	assert.Equal(t, token.Id, submittedJobs[0].TokenID)
	assert.Equal(t, "192.0.2.1", submittedJobs[0].ClientIP)
	foreign := model.ImageStudioJob{ID: uuid.NewString(), UserID: owner.Id + 10, RequestKey: uuid.NewString(), Request: `{"prompt":"private"}`, Status: "failed", CreatedAt: time.Now().Unix()}
	require.NoError(t, db.Create(&foreign).Error)
	for _, query := range []string{"ids=" + submittedJobs[0].ID + "," + foreign.ID, "request_keys=" + requestKey + "," + foreign.RequestKey} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("id", owner.Id)
		c.Request = httptest.NewRequest("GET", "/api/image-studio/jobs?"+query, nil)
		ListImageStudioJobs(c)
		require.Equal(t, 200, recorder.Code)
		var response struct {
			Data []imageStudioJobView `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		require.Len(t, response.Data, 1)
		assert.Equal(t, requestKey, response.Data[0].RequestKey)
		assert.Equal(t, submittedJobs[0].CreatedAt+86400, response.Data[0].ExpiresAt)
		assert.NotContains(t, recorder.Body.String(), "private")
	}
	for _, query := range []string{"ids=", "ids=invalid", "ids=" + strings.TrimSuffix(strings.Repeat(uuid.NewString()+",", 101), ",")} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("id", owner.Id)
		c.Request = httptest.NewRequest("GET", "/api/image-studio/jobs?"+query, nil)
		ListImageStudioJobs(c)
		assert.Equal(t, 400, recorder.Code)
	}
	require.NoError(t, db.Where("id IN ?", []string{submittedJobs[0].ID, foreign.ID}).Delete(&model.ImageStudioJob{}).Error)
	return token
}

func imageStudioRelayContract(t *testing.T, db *gorm.DB, worker *imageStudioWorker, owner *model.User) {
	t.Helper()
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.Token{}, &model.UserSubscription{}, &model.SubscriptionPlan{}, &model.SubscriptionPreConsumeRecord{}))
	var requests atomic.Int32
	response := imageStudioTestResponse(t)
	var reject atomic.Bool
	var expectedEditFiles atomic.Int32
	expectedEditFiles.Store(1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if reject.Load() {
			w.WriteHeader(503)
			_, _ = w.Write([]byte(`{"error":{"message":"test failure","type":"upstream"}}`))
			return
		}
		if r.URL.Path == "/v1/images/edits" {
			require.NoError(t, r.ParseMultipartForm(1<<20))
			defer r.MultipartForm.RemoveAll()
			assert.Equal(t, "gpt-image-1", r.FormValue("model"))
			assert.Equal(t, "1", r.FormValue("n"))
			assert.Equal(t, "auto", r.FormValue("quality"))
			assert.Equal(t, "auto", r.FormValue("size"))
			assert.Empty(t, r.FormValue("response_format"), "GPT Image does not accept response_format")
			field := "image"
			if expectedEditFiles.Load() > 1 {
				field = "image[]"
				assert.Empty(t, r.MultipartForm.File["image"])
			}
			files := r.MultipartForm.File[field]
			require.Len(t, files, int(expectedEditFiles.Load()))
			for i, header := range files {
				assert.Equal(t, fmt.Sprintf("reference-%d.png", i+1), header.Filename)
				file, err := header.Open()
				require.NoError(t, err)
				data, err := io.ReadAll(file)
				require.NoError(t, err)
				require.NoError(t, file.Close())
				assert.NotEmpty(t, data, "every reference image reaches the existing relay")
			}
		} else {
			assert.Equal(t, "/v1/images/generations", r.URL.Path)
			var input map[string]any
			require.NoError(t, common.DecodeJson(r.Body, &input))
			assert.Equal(t, "auto", input["size"])
			assert.NotContains(t, input, "response_format", "GPT Image does not accept response_format")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(response)
	}))
	defer upstream.Close()
	channel := model.Channel{Id: 883, Type: constant.ChannelTypeOpenAI, Name: "studio-fixture", Key: "fixture", Status: common.ChannelStatusEnabled, Models: "gpt-image-1,gpt-image-2,gpt-image-2-2026-10-01,dall-e-3", Group: "default", BaseURL: &upstream.URL}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, channel.AddAbilities(db))
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"gpt-image-1":0.01}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1}`))
	service.InitHttpClient()
	model.InvalidatePricingCache()
	model.GetPricing()
	capabilities, err := imageStudioCapabilities(owner.Id)
	require.NoError(t, err)
	require.Len(t, capabilities, 4)
	for _, capability := range capabilities {
		if strings.HasPrefix(capability.Model, "gpt-image-2") {
			assert.True(t, capability.CustomSize, capability.Model)
			assert.Equal(t, []string{"", "1024x1024", "1536x864", "864x1536"}, capability.Sizes)
		} else {
			assert.False(t, capability.CustomSize, capability.Model)
		}
	}
	token := imageStudioTokenContract(t, db, owner)
	job := &model.ImageStudioJob{ID: uuid.NewString(), UserID: owner.Id, TokenID: token.Id, ClientIP: "127.0.0.1", RequestKey: uuid.NewString(), RequestHash: "relay", Request: `{"model":"gpt-image-1","prompt":"a small house","n":1}`, Status: "running", Owner: worker.owner, CreatedAt: time.Now().Unix(), LeaseUntil: time.Now().Add(20 * time.Minute).Unix()}
	require.NoError(t, db.Create(job).Error)
	worker.execute(job)
	require.NoError(t, db.First(job, "id = ?", job.ID).Error)
	assert.Equal(t, "success", job.Status, job.Error)
	assert.Equal(t, int32(1), requests.Load())
	var current model.User
	require.NoError(t, db.First(&current, owner.Id).Error)
	assert.Less(t, current.Quota, owner.Quota, "workbench charges the wallet through existing relay billing")
	var logs []model.Log
	require.NoError(t, db.Where("request_id = ? AND type = ?", job.ID, model.LogTypeConsume).Find(&logs).Error)
	assert.Len(t, logs, 1, "one task creates exactly one consumption record")
	require.NoError(t, db.First(token, token.Id).Error)
	assert.Greater(t, token.UsedQuota, 0, "the dedicated token participates in normal relay billing")
	assert.Equal(t, owner.Quota-current.Quota, token.UsedQuota)
	assert.Equal(t, token.Id, logs[0].TokenId)
	referenceID := uuid.NewString()
	reference := model.ImageStudioAsset{ID: referenceID, UserID: owner.Id, Kind: "reference", ObjectKey: "references/" + referenceID, Mime: "image/png", CreatedAt: time.Now().Unix(), ExpiresAt: time.Now().Add(time.Hour).Unix()}
	require.NoError(t, model.CreateImageStudioReference(&reference))
	payloads, err := decodeImageStudioResponse(response)
	require.NoError(t, err)
	imageBytes, err := base64.StdEncoding.DecodeString(payloads[0].Base64)
	require.NoError(t, err)
	require.NoError(t, worker.store.Put(context.Background(), reference.ObjectKey, imageBytes, "image/png"))
	edit := &model.ImageStudioJob{ID: uuid.NewString(), UserID: owner.Id, TokenID: token.Id, ClientIP: "127.0.0.1", ReferenceID: referenceID, RequestKey: uuid.NewString(), RequestHash: "edit", Request: `{"model":"gpt-image-1","prompt":"make it blue","n":1,"reference_id":"` + referenceID + `"}`, Status: "running", Owner: worker.owner, CreatedAt: time.Now().Unix()}
	require.NoError(t, db.Create(edit).Error)
	worker.execute(edit)
	require.NoError(t, db.First(edit, "id = ?", edit.ID).Error)
	assert.Equal(t, "success", edit.Status, edit.Error)
	assert.Equal(t, int32(2), requests.Load())
	require.NoError(t, db.First(&reference, "id = ?", reference.ID).Error)
	assert.Equal(t, edit.ExpiresAt, reference.ExpiresAt)
	// The same relay handles all four references, preserving their input order.
	referenceIDs := []string{referenceID}
	for range 3 {
		id := uuid.NewString()
		asset := model.ImageStudioAsset{ID: id, UserID: owner.Id, Kind: "reference", ObjectKey: "references/" + id, Mime: "image/png", CreatedAt: time.Now().Unix(), ExpiresAt: time.Now().Add(time.Hour).Unix()}
		require.NoError(t, model.CreateImageStudioReference(&asset))
		require.NoError(t, worker.store.Put(context.Background(), asset.ObjectKey, imageBytes, asset.Mime))
		referenceIDs = append(referenceIDs, id)
	}
	multiInput, err := common.Marshal(imageStudioInput{Model: "gpt-image-1", Prompt: "combine these references", N: 1, ReferenceIDs: referenceIDs})
	require.NoError(t, err)
	multiEdit := &model.ImageStudioJob{ID: uuid.NewString(), UserID: owner.Id, TokenID: token.Id, ClientIP: "127.0.0.1", RequestKey: uuid.NewString(), RequestHash: "four-references", Request: string(multiInput), Status: "running", Owner: worker.owner, CreatedAt: time.Now().Unix()}
	_, err = model.CreateImageStudioJob(multiEdit, referenceIDs)
	require.NoError(t, err)
	expectedEditFiles.Store(4)
	worker.execute(multiEdit)
	require.NoError(t, db.First(multiEdit, "id = ?", multiEdit.ID).Error)
	assert.Equal(t, "success", multiEdit.Status, multiEdit.Error)
	assert.Equal(t, int32(3), requests.Load())
	var references []model.ImageStudioAsset
	require.NoError(t, db.Where("id IN ?", referenceIDs).Find(&references).Error)
	require.Len(t, references, 4)
	for _, asset := range references {
		assert.GreaterOrEqual(t, asset.ExpiresAt, multiEdit.ExpiresAt)
	}
	// Retryable upstream errors must NOT trigger a second generation.
	reject.Store(true)
	var beforeFailure model.User
	require.NoError(t, db.First(&beforeFailure, owner.Id).Error)
	failure := &model.ImageStudioJob{ID: uuid.NewString(), UserID: owner.Id, TokenID: token.Id, ClientIP: "127.0.0.1", RequestKey: uuid.NewString(), RequestHash: "failure", Request: job.Request, Status: "running", Owner: worker.owner, CreatedAt: time.Now().Unix()}
	require.NoError(t, db.Create(failure).Error)
	worker.execute(failure)
	require.NoError(t, db.First(failure, "id = ?", failure.ID).Error)
	assert.Equal(t, "unknown", failure.Status)
	assert.Equal(t, int32(4), requests.Load(), "upstream errors cannot resubmit paid work")
	require.Eventually(t, func() bool {
		var refunded model.User
		return db.First(&refunded, owner.Id).Error == nil && refunded.Quota == beforeFailure.Quota
	}, 3*time.Second, 10*time.Millisecond, "ordinary rejected requests use the asynchronous relay refund path")

	// Credential changes made after submission are enforced again by the worker.
	require.NoError(t, db.First(token, token.Id).Error)
	baselineToken := *token
	for _, tc := range []struct {
		name   string
		change func(*model.Token)
	}{
		{"disabled", func(value *model.Token) { value.Status = common.TokenStatusDisabled }},
		{"expired", func(value *model.Token) { value.ExpiredTime = time.Now().Unix() - 1 }},
		{"exhausted", func(value *model.Token) { value.RemainQuota = 0 }},
		{"model_limit", func(value *model.Token) { value.ModelLimits = "gpt-image-2" }},
		{"ip_limit", func(value *model.Token) { allowed := "192.0.2.7"; value.AllowIps = &allowed }},
		{"group_changed", func(value *model.Token) { value.Group = "auto" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			changed := baselineToken
			tc.change(&changed)
			require.NoError(t, changed.Update())
			reused, err := model.GetOrCreateImageStudioToken(owner.Id, []string{"gpt-image-1"})
			require.NoError(t, err)
			assert.Equal(t, token.Id, reused.Id, "credential controls cannot trigger a replacement key")
			blocked := &model.ImageStudioJob{ID: uuid.NewString(), UserID: owner.Id, TokenID: token.Id, ClientIP: "127.0.0.1", RequestKey: uuid.NewString(), Request: job.Request, Status: "running", Owner: worker.owner, CreatedAt: time.Now().Unix()}
			require.NoError(t, db.Create(blocked).Error)
			worker.execute(blocked)
			require.NoError(t, db.First(blocked, "id = ?", blocked.ID).Error)
			assert.Equal(t, "failed", blocked.Status)
			assert.Equal(t, int32(4), requests.Load(), "invalid credentials must never reach upstream")
			require.NoError(t, baselineToken.Update())
		})
	}
	var quotaAfterAuthFailures model.User
	require.NoError(t, db.First(&quotaAfterAuthFailures, owner.Id).Error)
	assert.Equal(t, beforeFailure.Quota, quotaAfterAuthFailures.Quota)
	require.NoError(t, db.Model(owner).Update("status", common.UserStatusDisabled).Error)
	_, err = imageStudioCapabilities(owner.Id)
	assert.Error(t, err)
	require.NoError(t, db.Model(owner).Update("status", common.UserStatusEnabled).Error)
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"other":1}`))
	_, err = imageStudioCapabilities(owner.Id)
	assert.Error(t, err, "default group must remain selectable; user group is never silently substituted")
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1}`))
	permissions := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup
	previousPermissions := permissions.ReadAll()
	t.Cleanup(func() { permissions.Clear(); permissions.AddAll(previousPermissions) })
	permissions.Set("private-image-test", map[string]string{"-:default": ""})
	require.NoError(t, db.Model(owner).Update("group", "private-image-test").Error)
	_, err = imageStudioCapabilities(owner.Id)
	assert.Error(t, err, "image studio cannot grant access to an unselectable default group")
	var unchangedUser model.User
	require.NoError(t, db.First(&unchangedUser, owner.Id).Error)
	assert.Equal(t, "private-image-test", unchangedUser.Group)
	require.NoError(t, db.Model(owner).Update("group", "default").Error)
}

func TestImageStudioValidationAndResponseShapes(t *testing.T) {
	capabilities := []imageStudioCapability{
		{Model: "image-model", Sizes: []string{""}, Qualities: []string{""}, MaxCount: 4},
		{Model: "gpt-image-2", Sizes: []string{"", "1024x1024", "1536x864", "864x1536"}, Qualities: []string{""}, MaxCount: 4, CustomSize: true, Editing: true},
		{Model: "gpt-image-1", Sizes: []string{"", "1024x1024", "1536x1024", "1024x1536"}, Qualities: []string{""}, MaxCount: 4},
		{Model: "dall-e-3", Sizes: []string{"", "1024x1024", "1792x1024", "1024x1792"}, Qualities: []string{""}, MaxCount: 1},
	}
	for _, tc := range []struct {
		name  string
		input imageStudioInput
		valid bool
	}{
		{"valid", imageStudioInput{Model: "image-model", Prompt: "hello", N: 1}, true},
		{"empty prompt", imageStudioInput{Model: "image-model", N: 1}, false},
		{"huge quantity", imageStudioInput{Model: "image-model", Prompt: "hello", N: 4294967295}, false},
		{"unknown model", imageStudioInput{Model: "other", Prompt: "hello", N: 1}, false},
		{"unsupported size", imageStudioInput{Model: "image-model", Prompt: "hello", N: 1, Size: "999999x999999"}, false},
		{"unsupported edit", imageStudioInput{Model: "image-model", Prompt: "hello", N: 1, ReferenceID: "reference"}, false},
		{"four references", imageStudioInput{Model: "gpt-image-2", Prompt: "hello", N: 1, ReferenceIDs: []string{"one", "two", "three", "four"}}, true},
		{"legacy reference", imageStudioInput{Model: "gpt-image-2", Prompt: "hello", N: 1, ReferenceID: "reference"}, true},
		{"too many references", imageStudioInput{Model: "gpt-image-2", Prompt: "hello", N: 1, ReferenceIDs: []string{"one", "two", "three", "four", "five"}}, false},
		{"duplicate references", imageStudioInput{Model: "gpt-image-2", Prompt: "hello", N: 1, ReferenceIDs: []string{"one", "one"}}, false},
		{"empty reference", imageStudioInput{Model: "gpt-image-2", Prompt: "hello", N: 1, ReferenceIDs: []string{""}}, false},
		{"conflicting references", imageStudioInput{Model: "gpt-image-2", Prompt: "hello", N: 1, ReferenceID: "one", ReferenceIDs: []string{"two"}}, false},
		{"unsupported multi-edit", imageStudioInput{Model: "image-model", Prompt: "hello", N: 1, ReferenceIDs: []string{"one", "two"}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateImageStudioInput(tc.input, capabilities)
			if tc.valid {
				assert.NoError(t, err)
			} else {
				assert.Error(t, err)
			}
		})
	}
	for _, tc := range []struct {
		name, model, size string
		valid             bool
	}{
		{"4K pixel limit", "gpt-image-2", "3840x2160", true},
		{"4K portrait", "gpt-image-2", "2160x3840", true},
		{"minimum total pixels", "gpt-image-2", "640x1024", true},
		{"below minimum pixels", "gpt-image-2", "624x1024", false},
		{"excessive edge", "gpt-image-2", "4096x1536", false},
		{"legacy landscape", "gpt-image-2", "1536x1024", true},
		{"maximum ratio", "gpt-image-2", "3072x1024", true},
		{"maximum portrait ratio", "gpt-image-2", "1024x3072", true},
		{"excessive pixels", "gpt-image-2", "3840x2176", false},
		{"not a multiple of 16", "gpt-image-2", "1536x865", false},
		{"excessive ratio", "gpt-image-2", "3088x1024", false},
		{"zero width", "gpt-image-2", "0x1024", false},
		{"negative width", "gpt-image-2", "-16x1024", false},
		{"decimal width", "gpt-image-2", "1024.0x1024", false},
		{"extra separator", "gpt-image-2", "1024x1024x16", false},
		{"product overflow", "gpt-image-2", "4294967296x4294967296", false},
		{"large uint64 width", "gpt-image-2", "18446744073709551600x16", false},
		{"uint64 overflow", "gpt-image-2", "18446744073709551616x16", false},
		{"fixed GPT Image size", "gpt-image-1", "1536x864", false},
		{"fixed DALL-E size", "dall-e-3", "1536x864", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateImageStudioInput(imageStudioInput{Model: tc.model, Prompt: "hello", N: 1, Size: tc.size}, capabilities)
			if tc.valid {
				assert.NoError(t, err)
			} else {
				assert.Error(t, err)
			}
		})
	}
	for _, tc := range []struct {
		body  string
		count int
	}{
		{`{"data":{"b64_json":"image"}}`, 1},
		{`{"data":[{"url":"https://example.com/image"},{"b64_json":"image"}]}`, 1},
		{`{"data":[{"revised_prompt":"text only"}]}`, 0},
		{`{"data":[{"b64_json":"one"},{"b64_json":"two"}]}`, 2},
	} {
		items, err := decodeImageStudioResponse([]byte(tc.body))
		if tc.count == 0 {
			assert.Error(t, err)
		} else {
			require.NoError(t, err)
			assert.Len(t, items, tc.count)
		}
	}
	store, restoreStorage := imageStudioTestStore(t)
	restoreStorage()
	for _, key := range []string{"../outside", "references/../../outside", "/tmp/outside", `references\outside`} {
		assert.Error(t, store.Put(context.Background(), key, []byte("bad"), "image/png"))
		_, err := store.Get(context.Background(), key)
		assert.Error(t, err)
	}
	outside := t.TempDir()
	require.NoError(t, os.Symlink(outside, filepath.Join(os.Getenv("IMAGE_STUDIO_STORAGE_DIR"), "references")))
	assert.Error(t, store.Put(context.Background(), "references/escape", []byte("bad"), "image/png"), "root confinement rejects symlink escapes")
	_, err := os.Stat(filepath.Join(outside, "escape"))
	assert.True(t, os.IsNotExist(err))
	// A sparse fixture checks recursive capacity without allocating gigabytes.
	require.NoError(t, os.MkdirAll(filepath.Join(os.Getenv("IMAGE_STUDIO_STORAGE_DIR"), "generated", "nested"), 0700))
	full, err := os.Create(filepath.Join(os.Getenv("IMAGE_STUDIO_STORAGE_DIR"), "generated", "nested", "capacity"))
	require.NoError(t, err)
	require.NoError(t, full.Truncate(service.ImageStudioMaxStorageBytes))
	require.NoError(t, full.Close())
	assert.Error(t, store.Put(context.Background(), "generated/test/original", []byte("x"), "image/png"))
	_, err = imageStudioMime([]byte(strings.Repeat("a", 20)))
	assert.Error(t, err)
	file, err := os.CreateTemp(t.TempDir(), "response-limit")
	require.NoError(t, err)
	defer file.Close()
	writer := imageStudioResponseWriter{file: file, size: imageStudioResponseLimit - 1}
	_, err = writer.Write([]byte("a"))
	require.NoError(t, err)
	_, err = writer.Write([]byte("b"))
	assert.Error(t, err, "bounded response spooling must reject the byte beyond the enlarged output limit")
	stored, err := os.ReadFile(file.Name())
	require.NoError(t, err)
	assert.Equal(t, "a", string(stored))
}

func TestImageStudioCachesAllDownloadsBeforeStorageRetry(t *testing.T) {
	db := modelManagementDB(t, "sqlite", "")
	require.NoError(t, db.AutoMigrate(&model.ImageStudioJob{}, &model.ImageStudioAsset{}, &model.ImageStudioJobReference{}, &model.ImageStudioToken{}, &model.Token{}))
	store, restoreStorage := imageStudioTestStore(t)
	allowPrivateTaskMediaTest(t)
	payload, err := decodeImageStudioResponse(imageStudioTestResponse(t))
	require.NoError(t, err)
	data, err := base64.StdEncoding.DecodeString(payload[0].Base64)
	require.NoError(t, err)
	var downloads atomic.Int32
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downloads.Add(1)
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(data)
	}))
	defer source.Close()
	raw, err := common.Marshal(map[string]any{"data": []map[string]string{{"url": source.URL + "/one"}, {"url": source.URL + "/two"}}})
	require.NoError(t, err)
	worker := imageStudioWorker{store: store, directory: t.TempDir(), owner: "download-node"}
	job := &model.ImageStudioJob{ID: uuid.NewString(), UserID: 71, RequestKey: uuid.NewString(), Status: "saving", Owner: worker.owner, ExpiresAt: time.Now().Add(24 * time.Hour).Unix(), CreatedAt: time.Now().Unix()}
	require.NoError(t, db.Create(job).Error)
	require.NoError(t, os.WriteFile(filepath.Join(worker.directory, job.ID+".json"), raw, 0600))
	worker.execute(job)
	assert.Equal(t, int32(2), downloads.Load(), "all upstream images are cached before publishing delivery files")
	require.NoError(t, db.First(job, "id = ?", job.ID).Error)
	require.Equal(t, "saving", job.Status)
	source.Close() // Upstream URLs are now unavailable; storage-only recovery still succeeds.
	restoreStorage()
	worker.execute(job)
	require.NoError(t, db.First(job, "id = ?", job.ID).Error)
	assert.Equal(t, "success", job.Status)
	files, err := os.ReadDir(worker.directory)
	require.NoError(t, err)
	assert.Empty(t, files, "successful saves remove local image bytes")
}

// User storage schema from released v1.0.0-rc.37; only the Go type name differs.
type imageStudioReleasedUser struct {
	Id                   int                        `json:"id"`
	Username             string                     `json:"username" gorm:"unique;index" validate:"max=20"`
	Password             string                     `json:"password" gorm:"not null;" validate:"min=8,max=128"`
	HasPassword          bool                       `json:"-" gorm:"-:all"`
	OriginalPassword     string                     `json:"original_password" gorm:"-:all"` // this field is only for Password change verification, don't save it to database!
	DisplayName          string                     `json:"display_name" gorm:"index" validate:"max=20"`
	Role                 int                        `json:"role" gorm:"type:int;default:1"`   // admin, common
	Status               int                        `json:"status" gorm:"type:int;default:1"` // enabled, disabled
	Email                string                     `json:"email" gorm:"index" validate:"max=50"`
	GitHubId             string                     `json:"github_id" gorm:"column:github_id;index"`
	DiscordId            string                     `json:"discord_id" gorm:"column:discord_id;index"`
	OidcId               string                     `json:"oidc_id" gorm:"column:oidc_id;index"`
	WeChatId             string                     `json:"wechat_id" gorm:"column:wechat_id;index"`
	TelegramId           string                     `json:"telegram_id" gorm:"column:telegram_id;index"`
	VerificationCode     string                     `json:"verification_code" gorm:"-:all"`                         // this field is only for Email verification, don't save it to database!
	AccessToken          *string                    `json:"-" gorm:"type:char(32);column:access_token;uniqueIndex"` // this token is for system management
	AccessTokenCreatedAt *int64                     `json:"-" gorm:"type:bigint;column:access_token_created_at"`
	Quota                int                        `json:"quota" gorm:"type:int;default:0"`
	UsedQuota            int                        `json:"used_quota" gorm:"type:int;default:0;column:used_quota"` // used quota
	RequestCount         int                        `json:"request_count" gorm:"type:int;default:0;"`               // request number
	Group                string                     `json:"group" gorm:"type:varchar(64);default:'default'"`
	AffCode              string                     `json:"aff_code" gorm:"type:varchar(32);column:aff_code;uniqueIndex"`
	AffCount             int                        `json:"aff_count" gorm:"type:int;default:0;column:aff_count"`
	AffQuota             int                        `json:"aff_quota" gorm:"type:int;default:0;column:aff_quota"`           // 邀请剩余额度
	AffHistoryQuota      int                        `json:"aff_history_quota" gorm:"type:int;default:0;column:aff_history"` // 邀请历史额度
	InviterId            int                        `json:"inviter_id" gorm:"type:int;column:inviter_id;index"`
	DeletedAt            gorm.DeletedAt             `gorm:"index"`
	LinuxDOId            string                     `json:"linux_do_id" gorm:"column:linux_do_id;index"`
	Setting              string                     `json:"setting" gorm:"type:text;column:setting"`
	Remark               string                     `json:"remark,omitempty" gorm:"type:varchar(255)" validate:"max=255"`
	StripeCustomer       string                     `json:"stripe_customer" gorm:"type:varchar(64);column:stripe_customer;index"`
	CreatedAt            int64                      `json:"created_at" gorm:"autoCreateTime;column:created_at"`
	LastLoginAt          int64                      `json:"last_login_at" gorm:"default:0;column:last_login_at"`
	AuthVersion          int64                      `json:"-" gorm:"type:bigint;not null;default:1;column:auth_version"`
	AdminPermissions     map[string]map[string]bool `json:"admin_permissions,omitempty" gorm:"-:all"`
}

func (imageStudioReleasedUser) TableName() string { return "users" }
