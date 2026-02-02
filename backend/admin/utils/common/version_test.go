package common_test

import (
	"admin/settings"
	"admin/utils/common"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParseVersion(t *testing.T) {
	tests := []struct {
		version        string
		expectedParsed common.Version
		description    string
	}{
		{
			version:        "v1",
			expectedParsed: common.Version{1, 0, 0},
			description:    "v1",
		},
		{
			version:        "v1.2",
			expectedParsed: common.Version{1, 2, 0},
			description:    "v1.2",
		},
		{
			version:        "v1.2.3",
			expectedParsed: common.Version{1, 2, 3},
			description:    "v1.2.3",
		},
	}

	for _, test := range tests {
		v := common.ParseVersion(test.version)
		assert.Equalf(t, test.expectedParsed, v, test.description)
	}

	common.ParseVersion(settings.BACK_VERSION)
}

func TestIsVersionGreater(t *testing.T) {
	tests := []struct {
		version     string
		need        string
		expected    bool
		description string
	}{
		{
			version:     "v1",
			need:        "v0.13",
			expected:    true,
			description: "v1 ~ v0.13",
		},
		{
			version:     "v1",
			need:        "v1.13",
			expected:    false,
			description: "v1 ~ v1.13",
		},
		{
			version:     "v1.13.0",
			need:        "v1.13",
			expected:    true,
			description: "v1.13.0 ~ v1.13",
		},
		{
			version:     "v3.14.1",
			need:        "v4.10",
			expected:    false,
			description: "v3.14.1 ~ v4.10",
		},
		{
			version:     "v3.14.1",
			need:        "v3.14",
			expected:    true,
			description: "v3.14.1 ~ v3.14",
		},
		{
			version:     "v3.14.1",
			need:        "v3.14.1",
			expected:    true,
			description: "v3.14.1 ~ v3.14.1",
		},
	}

	for _, test := range tests {
		flag := common.IsVersionGreater(test.version, test.need)
		assert.Equalf(t, test.expected, flag, test.description)
	}

	common.ParseVersion(settings.BACK_VERSION)
}
