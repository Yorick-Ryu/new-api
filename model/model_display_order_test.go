package model

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestModelDisplayOrderValidation(t *testing.T) {
	for _, raw := range []string{`null`, `{}`, `["a","a"]`, `[""]`, `[" a"]`, `["a\nb"]`, `[2]`, `["` + strings.Repeat("a", 257) + `"]`} {
		t.Run(raw, func(t *testing.T) { _, err := ParseModelDisplayOrder(raw); require.Error(t, err) })
	}
	names, err := ParseModelDisplayOrder(`["z","a"]`)
	require.NoError(t, err)
	assert.Equal(t, []string{"z", "a"}, names)
	names, err = ParseModelDisplayOrder(`[]`)
	require.NoError(t, err)
	assert.Empty(t, names)
}

func TestModelDisplayOrderPricingRanksPreserveVisibilityAndCache(t *testing.T) {
	input := []Pricing{{ModelName: "a"}, {ModelName: "new"}, {ModelName: "z"}}
	result := WithModelDisplayOrder(input, []string{"z", "hidden", "a"})
	assert.Equal(t, []Pricing{{ModelName: "a", DisplayOrder: 3}, {ModelName: "new"}, {ModelName: "z", DisplayOrder: 1}}, result)
	assert.Zero(t, input[0].DisplayOrder)
	assert.Len(t, result, len(input))
	assert.Empty(t, WithModelDisplayOrder(nil, []string{"hidden"}))
}
