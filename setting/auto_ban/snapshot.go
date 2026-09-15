package auto_ban

import (
	"slices"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
)

// Snapshot owns its rules and exposes no mutable configuration. An error uses
// one snapshot for matching, enforcement and the version recorded in its log.
type Snapshot struct {
	settings Settings
	source   string
}

var currentSnapshot atomic.Pointer[Snapshot]
var defaultSnapshot = &Snapshot{settings: Defaults()}

func CurrentSnapshot() *Snapshot {
	if snapshot := currentSnapshot.Load(); snapshot != nil {
		return snapshot
	}
	return defaultSnapshot
}

// PublishSnapshot is called after a successful settings commit or refresh.
// Passing nil restores the defaults when no configuration has been saved.
func PublishSnapshot(snapshot *Snapshot) {
	currentSnapshot.Store(snapshot)
}

func ParseSnapshot(value string) (*Snapshot, error) {
	var settings Settings
	if err := common.UnmarshalJsonStr(value, &settings); err != nil {
		return nil, err
	}
	if err := Validate(settings); err != nil {
		return nil, err
	}
	return &Snapshot{settings: settings, source: value}, nil
}

func (s *Snapshot) MatchesJSON(value string) bool {
	return s.source != "" && s.source == value
}

func (s *Snapshot) Mode() string {
	return s.settings.Mode
}

func (s *Snapshot) Version() string {
	return s.settings.Version
}

func (s *Snapshot) Match(e Evidence, channelID int, model string) []Rule {
	rules := Match(s.settings, e, channelID, model)
	// Only matches need copies for event consumers; unmatched errors allocate no
	// rule copies. Never let a caller mutate slices belonging to the snapshot.
	for i := range rules {
		rules[i].Channels = slices.Clone(rules[i].Channels)
		rules[i].Models = slices.Clone(rules[i].Models)
		rules[i].MatchGroups = slices.Clone(rules[i].MatchGroups)
		for j := range rules[i].MatchGroups {
			rules[i].MatchGroups[j].Conditions = slices.Clone(rules[i].MatchGroups[j].Conditions)
		}
	}
	return rules
}
