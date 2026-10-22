package console_setting_test

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/console_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAnnouncementCharacterLimits(t *testing.T) {
	tests := []struct {
		name    string
		content string
		extra   string
		wantErr string
	}{
		{name: "500 ASCII characters", content: strings.Repeat("a", 500)},
		{name: "500 Chinese characters", content: strings.Repeat("公", 500)},
		{name: "500 emoji", content: strings.Repeat("😀", 500)},
		{name: "Markdown and newlines count toward 500", content: "## 公告\n" + strings.Repeat("公", 494)},
		{name: "501 ASCII characters", content: strings.Repeat("a", 501), wantErr: "Announcement #1 content cannot exceed 500 characters"},
		{name: "501 Chinese characters", content: strings.Repeat("公", 501), wantErr: "Announcement #1 content cannot exceed 500 characters"},
		{name: "501 emoji", content: strings.Repeat("😀", 501), wantErr: "Announcement #1 content cannot exceed 500 characters"},
		{name: "empty content", wantErr: "Announcement #1 is missing the content field"},
		{name: "200 Chinese notes characters", content: "公告", extra: strings.Repeat("注", 200)},
		{name: "200 emoji notes", content: "公告", extra: strings.Repeat("😀", 200)},
		{name: "201 notes characters", content: "公告", extra: strings.Repeat("注", 201), wantErr: "Announcement #1 note cannot exceed 200 characters"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := common.Marshal([]map[string]string{{
				"content": tt.content, "extra": tt.extra,
				"publishDate": "2026-09-11T12:00:00+08:00", "type": "default",
			}})
			require.NoError(t, err)
			err = console_setting.ValidateConsoleSettings(string(data), "Announcements")
			if tt.wantErr != "" {
				assert.EqualError(t, err, tt.wantErr)
				return
			}
			assert.NoError(t, err)
		})
	}
}

func TestAnnouncementLengthErrorIdentifiesNinthItem(t *testing.T) {
	announcements := make([]map[string]string, 9)
	for i := range announcements {
		announcements[i] = map[string]string{
			"content": "公告", "publishDate": "2026-09-11T12:00:00+08:00",
		}
	}
	announcements[8]["content"] = strings.Repeat("公", 501)
	data, err := common.Marshal(announcements)
	require.NoError(t, err)
	assert.EqualError(t, console_setting.ValidateConsoleSettings(string(data), "Announcements"), "Announcement #9 content cannot exceed 500 characters")
}

func TestAnnouncementPopupOptionSurvivesSettingsRoundTrip(t *testing.T) {
	settings := console_setting.GetConsoleSetting()
	previous := settings.Announcements
	t.Cleanup(func() { settings.Announcements = previous })
	data, err := common.Marshal([]map[string]interface{}{
		{"id": 1, "content": "重要公告", "publishDate": "2026-09-11T12:00:00+08:00", "popup": true},
		{"id": 2, "content": "普通公告", "publishDate": "2026-09-10T12:00:00+08:00", "popup": false},
	})
	require.NoError(t, err)
	require.NoError(t, console_setting.ValidateConsoleSettings(string(data), "Announcements"))
	settings.Announcements = string(data)
	announcements := console_setting.GetAnnouncements()
	require.Len(t, announcements, 2)
	assert.Equal(t, true, announcements[0]["popup"])
	assert.Equal(t, false, announcements[1]["popup"])
}
