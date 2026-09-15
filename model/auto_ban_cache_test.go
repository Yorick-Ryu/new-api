package model

import (
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/auto_ban"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func setupAutoBanSettingsCacheTest(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB, previousSnapshot, previousMap := DB, auto_ban.CurrentSnapshot(), common.OptionMap
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	DB, common.OptionMap = db, map[string]string{}
	auto_ban.PublishSnapshot(nil)
	t.Cleanup(func() {
		DB, common.OptionMap = previousDB, previousMap
		auto_ban.PublishSnapshot(previousSnapshot)
		_ = sqlDB.Close()
	})
	require.NoError(t, db.AutoMigrate(&Option{}))
	return db
}

func TestAutoBanSettingsSyncLoadsChangesAndKeepsLastValidSnapshot(t *testing.T) {
	db := setupAutoBanSettingsCacheTest(t)
	loadOptionsFromDatabase()
	assert.Equal(t, "off", auto_ban.CurrentSnapshot().Mode())

	// Write directly to represent a settings save by another instance.
	settings := auto_ban.Defaults()
	settings.Mode, settings.Version = "ban", "remote-first"
	data, err := common.Marshal(settings)
	require.NoError(t, err)
	require.NoError(t, db.Create(&Option{Key: auto_ban.OptionKey, Value: string(data)}).Error)
	assert.Equal(t, "off", auto_ban.CurrentSnapshot().Mode())
	loadOptionsFromDatabase()
	first := auto_ban.CurrentSnapshot()
	assert.Equal(t, settings.Version, first.Version())
	assert.Equal(t, "ban", first.Mode())
	loadOptionsFromDatabase()
	assert.Same(t, first, auto_ban.CurrentSnapshot(), "unchanged rules should reuse the parsed snapshot")

	for _, value := range []string{"", "{invalid", `{"version":"bad","mode":"invalid","rules":[]}`} {
		require.NoError(t, db.Model(&Option{}).Where(&Option{Key: auto_ban.OptionKey}).Update("value", value).Error)
		loadOptionsFromDatabase()
		assert.Same(t, first, auto_ban.CurrentSnapshot(), "invalid configuration must keep the previous valid rules")
	}

	settings.Mode, settings.Version = "observe", "remote-second"
	settings.Rules[2].MatchGroups[1].Conditions[0].Value = "new_policy"
	data, err = common.Marshal(settings)
	require.NoError(t, err)
	require.NoError(t, db.Model(&Option{}).Where(&Option{Key: auto_ban.OptionKey}).Update("value", string(data)).Error)
	loadOptionsFromDatabase()
	second := auto_ban.CurrentSnapshot()
	assert.Equal(t, "observe", second.Mode())
	assert.Equal(t, settings.Version, second.Version())
	assert.Empty(t, second.Match(auto_ban.Evidence{Code: "cyber_policy"}, 0, ""))
	assert.Len(t, second.Match(auto_ban.Evidence{Code: "new_policy"}, 0, ""), 1)
	assert.Len(t, first.Match(auto_ban.Evidence{Code: "cyber_policy"}, 0, ""), 1)

	require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:auto_ban_sync_failure", func(tx *gorm.DB) {
		tx.AddError(errors.New("database unavailable"))
	}))
	loadOptionsFromDatabase()
	assert.Same(t, second, auto_ban.CurrentSnapshot(), "failed refresh must keep the last valid rules")
	require.NoError(t, db.Callback().Query().Remove("test:auto_ban_sync_failure"))
	require.NoError(t, db.Where(&Option{Key: auto_ban.OptionKey}).Delete(&Option{}).Error)
	loadOptionsFromDatabase()
	assert.Equal(t, "off", auto_ban.CurrentSnapshot().Mode(), "missing configuration restores defaults")
}

func TestAutoBanSettingsFailedTransactionDoesNotPublish(t *testing.T) {
	db := setupAutoBanSettingsCacheTest(t)
	settings := auto_ban.Defaults()
	settings.Mode = "observe"
	saved, err := SaveAutoBanSettings(settings)
	require.NoError(t, err)
	previous := auto_ban.CurrentSnapshot()
	require.NoError(t, db.Callback().Update().After("gorm:update").Register("test:auto_ban_save_failure", func(tx *gorm.DB) {
		tx.AddError(errors.New("write failed"))
	}))
	saved.Mode = "ban"
	_, err = SaveAutoBanSettings(saved)
	require.Error(t, err)
	assert.Same(t, previous, auto_ban.CurrentSnapshot())
	stored, err := GetAutoBanSettings()
	require.NoError(t, err)
	assert.Equal(t, "observe", stored.Mode)
	assert.Equal(t, previous.Version(), stored.Version)
}

func TestAutoBanSettingsReadersContinueDuringSaveAndSync(t *testing.T) {
	db := setupAutoBanSettingsCacheTest(t)
	settings := auto_ban.Defaults()
	settings.Mode = "observe"
	saved, err := SaveAutoBanSettings(settings)
	require.NoError(t, err)
	previous := auto_ban.CurrentSnapshot()
	written, commit := make(chan struct{}), make(chan struct{})
	require.NoError(t, db.Callback().Update().After("gorm:update").Register("test:pause_settings_commit", func(tx *gorm.DB) {
		close(written)
		<-commit
	}))
	type saveResult struct {
		settings auto_ban.Settings
		err      error
	}
	result := make(chan saveResult, 1)
	saved.Mode = "ban"
	go func() {
		next, err := SaveAutoBanSettings(saved)
		result <- saveResult{next, err}
	}()
	<-written
	// A slow settings transaction must not block matching or expose its draft.
	assert.Same(t, previous, auto_ban.CurrentSnapshot())
	assert.Len(t, auto_ban.CurrentSnapshot().Match(auto_ban.Evidence{Code: "cyber_policy"}, 0, ""), 1)
	started, synced := make(chan struct{}), make(chan struct{})
	go func() {
		close(started)
		loadOptionsFromDatabase()
		close(synced)
	}()
	<-started
	close(commit)
	completed := <-result
	<-synced
	require.NoError(t, completed.err)
	assert.Equal(t, "ban", auto_ban.CurrentSnapshot().Mode())
	assert.Equal(t, completed.settings.Version, auto_ban.CurrentSnapshot().Version())
	assert.Equal(t, "observe", previous.Mode())
}
