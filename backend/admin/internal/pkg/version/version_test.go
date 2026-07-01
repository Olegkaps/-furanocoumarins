package version_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"admin/internal/pkg/version"
	"admin/settings"
)

func TestParseVersion(t *testing.T) {
	tests := []struct {
		version        string
		expectedParsed version.Version
		description    string
	}{
		{"v1", version.Version{Major: 1}, "v1"},
		{"v1.2", version.Version{Major: 1, Minor: 2}, "v1.2"},
		{"v1.2.3", version.Version{Major: 1, Minor: 2, Patch: 3}, "v1.2.3"},
	}

	for _, test := range tests {
		v := version.ParseVersion(test.version)
		assert.Equalf(t, test.expectedParsed, v, test.description)
	}

	version.ParseVersion(settings.BACK_VERSION)
}

func TestIsVersionGreater(t *testing.T) {
	tests := []struct {
		version     string
		need        string
		expected    bool
		description string
	}{
		{"v1", "v0.13", true, "v1 ~ v0.13"},
		{"v1", "v1.13", false, "v1 ~ v1.13"},
		{"v1.13.0", "v1.13", true, "v1.13.0 ~ v1.13"},
		{"v3.14.1", "v4.10", false, "v3.14.1 ~ v4.10"},
		{"v3.14.1", "v3.14", true, "v3.14.1 ~ v3.14"},
		{"v3.14.1", "v3.14.1", true, "v3.14.1 ~ v3.14.1"},
	}

	for _, test := range tests {
		flag := version.IsVersionGreater(test.version, test.need)
		assert.Equalf(t, test.expected, flag, test.description)
	}
}
