package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/require"
)

func resetChannelTransportSelectionTables(t *testing.T, memoryCacheEnabled bool) {
	t.Helper()
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = memoryCacheEnabled
	require.NoError(t, DB.AutoMigrate(&Channel{}, &Ability{}))
	require.NoError(t, DB.Exec("DELETE FROM abilities").Error)
	require.NoError(t, DB.Exec("DELETE FROM channels").Error)
	InitChannelCache()
	t.Cleanup(func() {
		require.NoError(t, DB.Exec("DELETE FROM abilities").Error)
		require.NoError(t, DB.Exec("DELETE FROM channels").Error)
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		InitChannelCache()
	})
}

func insertChannelTransportSelectionChannel(t *testing.T, channel *Channel, settings dto.ChannelOtherSettings) {
	t.Helper()
	if channel.ChannelInfo.IsMultiKey {
		channel.Key = fmt.Sprintf("key-%d-a\nkey-%d-b", channel.Id, channel.Id)
	} else {
		channel.Key = fmt.Sprintf("key-%d", channel.Id)
	}
	channel.Status = common.ChannelStatusEnabled
	channel.Group = "default"
	channel.SetOtherSettings(settings)
	require.NoError(t, DB.Create(channel).Error)
	require.NoError(t, channel.AddAbilities(nil))
}

func TestResponsesTransportSelectionUsesChannelCapabilityThenRegularPriority(t *testing.T) {
	for _, memoryCacheEnabled := range []bool{false, true} {
		name := "database"
		if memoryCacheEnabled {
			name = "memory-cache"
		}
		t.Run(name, func(t *testing.T) {
			resetChannelTransportSelectionTables(t, memoryCacheEnabled)

			insertChannelTransportSelectionChannel(t, &Channel{
				Id:       4,
				Name:     "CPA",
				Models:   "gpt-5.6-sol,gpt-image-2",
				Priority: common.GetPointer[int64](80),
				Weight:   common.GetPointer[uint](100),
			}, dto.ChannelOtherSettings{})
			insertChannelTransportSelectionChannel(t, &Channel{
				Id:       13,
				Name:     "Krill HTTP",
				Models:   "gpt-5.6-sol",
				Priority: common.GetPointer[int64](100),
				Weight:   common.GetPointer[uint](100),
				ChannelInfo: ChannelInfo{
					IsMultiKey:   true,
					MultiKeySize: 2,
					MultiKeyMode: constant.MultiKeyModePolling,
				},
			}, dto.ChannelOtherSettings{
				ResponsesWebSocketEnabled: common.GetPointer(false),
			})
			insertChannelTransportSelectionChannel(t, &Channel{
				Id:       14,
				Name:     "Krill WS",
				Models:   "gpt-5.6-sol",
				Priority: common.GetPointer[int64](100),
				Weight:   common.GetPointer[uint](100),
				ChannelInfo: ChannelInfo{
					IsMultiKey:   true,
					MultiKeySize: 2,
					MultiKeyMode: constant.MultiKeyModePolling,
				},
			}, dto.ChannelOtherSettings{
				ResponsesHTTPEnabled: common.GetPointer(false),
			})
			InitChannelCache()

			httpText, err := GetRandomSatisfiedChannel("default", "gpt-5.6-sol", 0, "/v1/responses", constant.ResponsesTransportHTTP)
			require.NoError(t, err)
			require.NotNil(t, httpText)
			require.Equal(t, 13, httpText.Id)

			wsText, err := GetRandomSatisfiedChannel("default", "gpt-5.6-sol", 0, "/v1/responses", constant.ResponsesTransportWebSocket)
			require.NoError(t, err)
			require.NotNil(t, wsText)
			require.Equal(t, 14, wsText.Id)

			httpImage, err := GetRandomSatisfiedChannel("default", "gpt-image-2", 0, "/v1/responses", constant.ResponsesTransportHTTP)
			require.NoError(t, err)
			require.NotNil(t, httpImage)
			require.Equal(t, 4, httpImage.Id)

			httpFallback, err := GetRandomSatisfiedChannel("default", "gpt-5.6-sol", 1, "/v1/responses", constant.ResponsesTransportHTTP)
			require.NoError(t, err)
			require.NotNil(t, httpFallback)
			require.Equal(t, 4, httpFallback.Id)

			wsFallback, err := GetRandomSatisfiedChannel("default", "gpt-5.6-sol", 1, "/v1/responses", constant.ResponsesTransportWebSocket)
			require.NoError(t, err)
			require.NotNil(t, wsFallback)
			require.Equal(t, 4, wsFallback.Id)

			legacy, err := GetRandomSatisfiedChannel("default", "gpt-5.6-sol", 0, "/v1/responses", constant.ResponsesTransportNone)
			require.NoError(t, err)
			require.NotNil(t, legacy)
			require.Contains(t, []int{13, 14}, legacy.Id)

			if memoryCacheEnabled {
				updatedHTTP, err := GetChannelById(13, true)
				require.NoError(t, err)
				updatedHTTP.SetOtherSettings(dto.ChannelOtherSettings{
					ResponsesHTTPEnabled: common.GetPointer(false),
				})
				CacheUpdateChannel(updatedHTTP)

				hotReloaded, err := GetRandomSatisfiedChannel("default", "gpt-5.6-sol", 0, "/v1/responses", constant.ResponsesTransportHTTP)
				require.NoError(t, err)
				require.NotNil(t, hotReloaded)
				require.Equal(t, 4, hotReloaded.Id)
			}
		})
	}
}
