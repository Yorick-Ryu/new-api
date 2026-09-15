package model

import (
	"fmt"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/auto_ban"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"sync"
	"testing"
)

func TestAutoBanSettingsAreAtomicAndRejectStaleEdits(t *testing.T) {
	previous := auto_ban.CurrentSnapshot()
	t.Cleanup(func() { auto_ban.PublishSnapshot(previous) })
	require.NoError(t, DB.AutoMigrate(&Option{}))
	require.NoError(t, DB.Where(&Option{Key: auto_ban.OptionKey}).Delete(&Option{}).Error)
	t.Cleanup(func() { DB.Where(&Option{Key: auto_ban.OptionKey}).Delete(&Option{}) })
	initial, err := GetAutoBanSettings()
	require.NoError(t, err)
	assert.Equal(t, "off", initial.Mode)
	edited := initial
	edited.Mode = "ban"
	saved, err := SaveAutoBanSettings(edited)
	require.NoError(t, err)
	assert.NotEqual(t, initial.Version, saved.Version)
	cached := auto_ban.CurrentSnapshot()
	assert.Equal(t, saved.Version, cached.Version())
	assert.Equal(t, "ban", cached.Mode())
	_, err = SaveAutoBanSettings(initial)
	assert.ErrorIs(t, err, ErrAutoBanSettingsConflict)
	bad := saved
	bad.Rules = nil
	bad.Mode = "invalid"
	_, err = SaveAutoBanSettings(bad)
	require.Error(t, err)
	live, err := GetAutoBanSettings()
	require.NoError(t, err)
	assert.Equal(t, saved, live)
	assert.Same(t, cached, auto_ban.CurrentSnapshot(), "failed edits must keep the last committed snapshot")
	// Neither the returned settings nor the caller's draft may mutate live rules.
	saved.Rules[2].MatchGroups[1].Conditions[0].Value = "edited_without_saving"
	matches := cached.Match(auto_ban.Evidence{Code: "cyber_policy"}, 0, "")
	require.Len(t, matches, 1)
	assert.Equal(t, "cybersecurity", matches[0].ID)
}

func TestAutoBanDisablesOnceAndFencesStaleCache(t *testing.T) {
	truncateTables(t)
	useUserCacheMiniRedis(t)
	require.NoError(t, DB.AutoMigrate(&AutoBanEvent{}))
	require.NoError(t, DB.Exec("DELETE FROM auto_ban_events").Error)
	t.Cleanup(func() { DB.Exec("DELETE FROM auto_ban_events") })
	user := User{Username: "auto-ban-cache", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, Quota: 1234}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, populateUserCache(user))
	stale := user
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			e := AutoBanEvent{EventKey: fmt.Sprintf("event-%d", i), UserID: user.Id, Mode: "ban"}
			errs <- ApplyAutoBanEvent(&e)
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, common.UserStatusDisabled, user.Status)
	assert.EqualValues(t, 2, user.AuthVersion)
	assert.Equal(t, 1234, user.Quota)
	_ = populateUserCache(stale)
	cache, err := GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Equal(t, common.UserStatusDisabled, cache.Status)
	var count int64
	require.NoError(t, DB.Model(&AutoBanEvent{}).Where("action = ?", "banned").Count(&count).Error)
	assert.EqualValues(t, 1, count)
	// A replay after manual enable must not ban the user again.
	user.Status = common.UserStatusEnabled
	require.NoError(t, user.Update(false))
	e := AutoBanEvent{EventKey: "event-0", UserID: user.Id, Mode: "ban"}
	require.NoError(t, ApplyAutoBanEvent(&e))
	cache, err = GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Equal(t, common.UserStatusEnabled, cache.Status)
}

func TestAutoBanObserveAndAdministratorProtection(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&AutoBanEvent{}))
	require.NoError(t, DB.Exec("DELETE FROM auto_ban_events").Error)
	t.Cleanup(func() { DB.Exec("DELETE FROM auto_ban_events") })
	for _, tt := range []struct {
		role         int
		mode, action string
	}{{common.RoleCommonUser, "observe", "recorded"}, {common.RoleAdminUser, "ban", "protected"}, {common.RoleRootUser, "ban", "protected"}} {
		user := User{Username: fmt.Sprintf("auto-ban-protect-%d", tt.role), AffCode: fmt.Sprintf("ab%d", tt.role), Role: tt.role, Status: common.UserStatusEnabled, AuthVersion: 1}
		require.NoError(t, DB.Create(&user).Error)
		event := AutoBanEvent{EventKey: user.Username, UserID: user.Id, Mode: tt.mode}
		require.NoError(t, ApplyAutoBanEvent(&event))
		assert.Equal(t, tt.action, event.Action)
		require.NoError(t, DB.First(&user, user.Id).Error)
		assert.Equal(t, common.UserStatusEnabled, user.Status)
	}
}
