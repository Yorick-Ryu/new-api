package oauth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestGitHubCallbackURLUsesBrowserOrigin(t *testing.T) {
	tests := []struct {
		name     string
		host     string
		expected string
	}{
		{
			name:     "apex domain",
			host:     "beiapi.cn",
			expected: "https://beiapi.cn/oauth/github",
		},
		{
			name:     "www domain",
			host:     "www.beiapi.cn",
			expected: "https://www.beiapi.cn/oauth/github",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "http://"+test.host+"/api/oauth/github", nil)
			request.Header.Set("X-Forwarded-Proto", "https")
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			context.Request = request

			assert.Equal(t, test.expected, githubCallbackURL(context))
		})
	}
}
