package common

import (
	"strconv"
	"strings"
)

type Version struct {
	Major int
	Minor int
	Patch int
}

func ParseVersion(v string) Version {
	// e.g: v3.14.1
	var Major, Minor, Patch int
	Minor = 0
	Patch = 0

	arr := strings.Split(v[1:], ".")

	Major, _ = strconv.Atoi(arr[0])
	if len(arr) > 1 {
		Minor, _ = strconv.Atoi(arr[1])
	}
	if len(arr) > 2 {
		Patch, _ = strconv.Atoi(arr[2])
	}

	return Version{Major, Minor, Patch}
}

// greater or equal
func IsVersionGreater(curr, need string) bool {
	v_curr := ParseVersion(curr)
	v_need := ParseVersion(need)

	if v_curr.Major > v_need.Major {
		return true
	} else if v_curr.Major < v_need.Major {
		return false
	}

	if v_curr.Minor > v_need.Minor {
		return true
	} else if v_curr.Minor < v_need.Minor {
		return false
	}

	if v_curr.Patch >= v_need.Patch {
		return true
	}
	return true
}
