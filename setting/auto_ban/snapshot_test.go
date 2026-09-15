package auto_ban

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAutoBanSnapshotKeepsRulesAndVersionAcrossUpdates(t *testing.T) {
	previous := CurrentSnapshot()
	t.Cleanup(func() { PublishSnapshot(previous) })
	settings := Defaults()
	settings.Mode, settings.Version = "ban", "first"
	settings.Rules = settings.Rules[2:]
	settings.Rules[0].Channels = []int{7}
	settings.Rules[0].Models = []string{"chat"}
	data, err := common.Marshal(settings)
	require.NoError(t, err)
	first, err := ParseSnapshot(string(data))
	require.NoError(t, err)
	PublishSnapshot(first)
	inFlight := CurrentSnapshot()
	evidence := Evidence{Code: "cyber_policy"}
	matches := inFlight.Match(evidence, 7, "chat")
	require.Len(t, matches, 1)
	matches[0].Name = "changed"
	matches[0].Channels[0] = 8
	matches[0].Models[0] = "other"
	matches[0].MatchGroups[1].Conditions[0].Value = "other_policy"
	matches[0].MatchGroups[0] = MatchGroup{}
	assert.Equal(t, settings.Rules, inFlight.Match(evidence, 7, "chat"), "matching results must not expose mutable cached rules")

	settings.Mode, settings.Version = "off", "second"
	data, err = common.Marshal(settings)
	require.NoError(t, err)
	next, err := ParseSnapshot(string(data))
	require.NoError(t, err)
	PublishSnapshot(next)
	assert.Equal(t, "off", CurrentSnapshot().Mode())
	assert.Equal(t, "second", CurrentSnapshot().Version())
	assert.Equal(t, "ban", inFlight.Mode())
	assert.Equal(t, "first", inFlight.Version())
	assert.Equal(t, settings.Rules, inFlight.Match(evidence, 7, "chat"))
}
