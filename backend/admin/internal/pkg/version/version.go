package version

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
	var major, minor, patch int
	arr := strings.Split(v[1:], ".")
	major, _ = strconv.Atoi(arr[0])
	if len(arr) > 1 {
		minor, _ = strconv.Atoi(arr[1])
	}
	if len(arr) > 2 {
		patch, _ = strconv.Atoi(arr[2])
	}
	return Version{Major: major, Minor: minor, Patch: patch}
}

func IsVersionGreater(curr, need string) bool {
	vCurr := ParseVersion(curr)
	vNeed := ParseVersion(need)

	if vCurr.Major > vNeed.Major {
		return true
	} else if vCurr.Major < vNeed.Major {
		return false
	}

	if vCurr.Minor > vNeed.Minor {
		return true
	} else if vCurr.Minor < vNeed.Minor {
		return false
	}

	return vCurr.Patch >= vNeed.Patch
}
