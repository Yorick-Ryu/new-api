// Package auto_ban defines administrator-configured rules for upstream failures.
package auto_ban

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
)

const OptionKey = "AutoBanSettings"

type Condition struct {
	ID       string `json:"id,omitempty"`
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    string `json:"value"`
}

type MatchGroup struct {
	ID         string      `json:"id"`
	Conditions []Condition `json:"conditions"`
}

type Rule struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Enabled     bool         `json:"enabled"`
	MatchGroups []MatchGroup `json:"match_groups,omitempty"`
	Channels    []int        `json:"channels"`
	Models      []string     `json:"models"`
	Reason      string       `json:"reason"`
}

type Settings struct {
	Version string `json:"version"`
	Mode    string `json:"mode"` // off, observe, ban
	Rules   []Rule `json:"rules"`
}

// Evidence contains only fields from an upstream failure, never request input
// or generated content. HTTPStatus is the original transport status.
type Evidence struct {
	HTTPStatus int      `json:"http_status"`
	Code       string   `json:"code"`
	Message    string   `json:"message"`
	Violations []string `json:"violations"`
}

func Defaults() Settings {
	return Settings{Version: "default", Mode: "off", Rules: []Rule{
		{ID: "sexual", Name: "Sexual safety rejection", Enabled: true, Reason: "Sexual safety rejection", MatchGroups: []MatchGroup{{ID: "match-1", Conditions: []Condition{{Field: "message", Operator: "contains", Value: "rejected by the safety system"}, {Field: "violations", Operator: "includes", Value: "sexual"}}}}},
		{ID: "content-safety", Name: "Content safety rejection", Enabled: true, Reason: "Content safety rejection", MatchGroups: []MatchGroup{{ID: "match-1", Conditions: []Condition{{Field: "message", Operator: "contains", Value: "Your request was blocked by the content safety policy"}}}}},
		{ID: "cybersecurity", Name: "Cybersecurity", Enabled: true, Reason: "Cybersecurity risk rejection", MatchGroups: []MatchGroup{
			{ID: "message", Conditions: []Condition{{Field: "message", Operator: "contains", Value: "flagged for possible cybersecurity risk"}}},
			{ID: "code", Conditions: []Condition{{Field: "code", Operator: "equals", Value: "cyber_policy"}}},
		}},
	}}
}

func Validate(s Settings) error {
	if !slices.Contains([]string{"off", "observe", "ban"}, s.Mode) {
		return fmt.Errorf("invalid automatic ban mode")
	}
	if len(s.Rules) > 64 || len(s.Version) > 64 {
		return fmt.Errorf("too many rules or invalid version")
	}
	ids := make(map[string]bool)
	for i, r := range s.Rules {
		if strings.TrimSpace(r.ID) == "" || len(r.ID) > 64 || ids[r.ID] {
			return fmt.Errorf("rule %d: invalid or duplicate ID", i+1)
		}
		ids[r.ID] = true
		if strings.TrimSpace(r.Name) == "" || len(r.Name) > 200 || strings.TrimSpace(r.Reason) == "" || len(r.Reason) > 500 {
			return fmt.Errorf("rule %d: name and reason are required and must be bounded", i+1)
		}
		if len(r.MatchGroups) == 0 || len(r.MatchGroups) > 16 || len(r.Channels) > 100 || len(r.Models) > 100 {
			return fmt.Errorf("rule %d: invalid condition or scope count", i+1)
		}
		for _, id := range r.Channels {
			if id <= 0 {
				return fmt.Errorf("rule %d: channel IDs must be positive", i+1)
			}
		}
		for _, m := range r.Models {
			if strings.TrimSpace(m) == "" || len(m) > 200 {
				return fmt.Errorf("rule %d: invalid model name", i+1)
			}
		}
		groupIDs := make(map[string]bool)
		for _, group := range r.MatchGroups {
			if strings.TrimSpace(group.ID) == "" || len(group.ID) > 64 || groupIDs[group.ID] || len(group.Conditions) == 0 || len(group.Conditions) > 8 {
				return fmt.Errorf("rule %d: invalid matching group", i+1)
			}
			groupIDs[group.ID] = true
			hasContentCondition := false
			for _, c := range group.Conditions {
				if len(c.ID) > 64 || strings.TrimSpace(c.Value) == "" || len(c.Value) > 1000 {
					return fmt.Errorf("rule %d: condition values must not be empty or exceed 1000 bytes", i+1)
				}
				switch c.Field {
				case "code", "message":
					if c.Operator != "equals" && c.Operator != "contains" {
						return fmt.Errorf("rule %d: invalid text operator", i+1)
					}
					hasContentCondition = true
				case "violations":
					if c.Operator != "includes" {
						return fmt.Errorf("rule %d: violations require includes", i+1)
					}
					hasContentCondition = true
				case "http_status":
					n, err := strconv.Atoi(c.Value)
					if err != nil || n < 100 || n > 599 || c.Operator != "equals" {
						return fmt.Errorf("rule %d: invalid HTTP status condition", i+1)
					}
				default:
					return fmt.Errorf("rule %d: unknown condition field", i+1)
				}
			}
			if !hasContentCondition {
				return fmt.Errorf("rule %d: HTTP status alone cannot trigger a ban", i+1)
			}
		}
	}
	return nil
}

// Match returns every enabled rule with a matching alternative in scope.
func Match(s Settings, e Evidence, channel int, model string) []Rule {
	matched := make([]Rule, 0)
	for _, r := range s.Rules {
		if !r.Enabled || (len(r.Channels) > 0 && !slices.Contains(r.Channels, channel)) || (len(r.Models) > 0 && !slices.Contains(r.Models, model)) {
			continue
		}
		for _, group := range r.MatchGroups {
			if MatchGroupConditions(group, e) {
				matched = append(matched, r)
				break
			}
		}
	}
	return matched
}

// Conditions within one alternative must all match, even when others use OR.
func MatchGroupConditions(group MatchGroup, e Evidence) bool {
	if len(group.Conditions) == 0 {
		return false
	}
	for _, c := range group.Conditions {
		if !MatchCondition(c, e) {
			return false
		}
	}
	return true
}

func MatchCondition(c Condition, e Evidence) bool {
	value := strings.ToLower(strings.TrimSpace(c.Value))
	if value == "" {
		return false
	}
	var actual string
	switch c.Field {
	case "code":
		actual = e.Code
	case "message":
		actual = e.Message
	case "http_status":
		actual = strconv.Itoa(e.HTTPStatus)
	case "violations":
		if c.Operator != "includes" {
			return false
		}
		for _, v := range e.Violations {
			if strings.EqualFold(strings.TrimSpace(v), value) {
				return true
			}
		}
		return false
	default:
		return false
	}
	actual = strings.ToLower(strings.TrimSpace(actual))
	switch c.Operator {
	case "equals":
		return actual == value
	case "contains":
		return strings.Contains(actual, value)
	default:
		return false
	}
}
