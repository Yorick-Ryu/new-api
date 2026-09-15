package auto_ban

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestAutoBanOneNamedRuleAcceptsAlternativeErrors(t *testing.T) {
	var s Settings
	require.NoError(t, common.UnmarshalJsonStr(`{"version":"v1","mode":"ban","rules":[{"id":"safety","name":"Upstream safety","reason":"Safety rejection","enabled":true,"match_groups":[{"id":"message","conditions":[{"field":"message","operator":"contains","value":"rejected by the safety system"},{"field":"violations","operator":"includes","value":"sexual"}]},{"id":"code","conditions":[{"field":"code","operator":"equals","value":"cyber_policy"}]}]}]}`, &s))
	require.NoError(t, Validate(s))
	for _, evidence := range []Evidence{
		{HTTPStatus: 400, Message: "Your request was rejected by the safety system", Violations: []string{"sexual"}},
		{HTTPStatus: 200, Code: "CYBER_POLICY"},
	} {
		matches := Match(s, evidence, 22, "chat")
		require.Len(t, matches, 1)
		assert.Equal(t, "safety", matches[0].ID)
	}
	assert.Empty(t, Match(s, Evidence{HTTPStatus: 400, Message: "Your request was rejected by the safety system", Violations: []string{"violence"}}, 22, "chat"))
	s.Rules[0].Channels = []int{22}
	s.Rules[0].Models = []string{"chat"}
	assert.Empty(t, Match(s, Evidence{Code: "cyber_policy"}, 13, "chat"))
	assert.Empty(t, Match(s, Evidence{Code: "cyber_policy"}, 22, "image"))
	s.Rules[0].Enabled = false
	assert.Empty(t, Match(s, Evidence{Code: "cyber_policy"}, 22, "chat"))
}

func TestAutoBanGroupRequiresAllMatches(t *testing.T) {
	s := Settings{Version: "v1", Mode: "ban", Rules: []Rule{{ID: "rule", Name: "Rule", Reason: "Reason", Enabled: true, MatchGroups: []MatchGroup{{ID: "all", Conditions: []Condition{{Field: "message", Operator: "contains", Value: "blocked"}, {Field: "http_status", Operator: "equals", Value: "400"}}}}}}}
	require.NoError(t, Validate(s))
	assert.Len(t, Match(s, Evidence{HTTPStatus: 400, Message: "blocked"}, 0, ""), 1)
	assert.Empty(t, Match(s, Evidence{HTTPStatus: 500, Message: "blocked"}, 0, ""))
}

func TestAutoBanValidationRejectsBroadAlternative(t *testing.T) {
	var s Settings
	require.NoError(t, common.UnmarshalJsonStr(`{"version":"v1","mode":"ban","rules":[{"id":"safety","name":"Safety","reason":"Safety","enabled":true,"match_groups":[{"id":"valid","conditions":[{"field":"code","operator":"equals","value":"cyber_policy"}]},{"id":"broad","conditions":[{"field":"http_status","operator":"equals","value":"400"}]}]}]}`, &s))
	require.Error(t, Validate(s))
}

func TestAutoBanValidationRejectsBroadOrInvalidRules(t *testing.T) {
	for _, conditions := range [][]Condition{
		{{Field: "http_status", Operator: "equals", Value: "400"}},
		{{Field: "message", Operator: "contains", Value: " "}},
		{{Field: "message", Operator: "regex", Value: ".*"}},
		{{Field: "violations", Operator: "contains", Value: "sexual"}},
		{{Field: "prompt", Operator: "contains", Value: "sexual"}},
	} {
		s := Settings{Mode: "ban", Rules: []Rule{{ID: "rule", Name: "Rule", Reason: "Reason", MatchGroups: []MatchGroup{{ID: "all", Conditions: conditions}}}}}
		assert.Error(t, Validate(s))
	}
}
