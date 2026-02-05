package dbs

import (
	"admin/utils/common"
	"strings"
	"time"
)

func FixCassandraTimestamp(s string) string {
	s = strings.ReplaceAll(s, "-", "_")
	s = strings.ReplaceAll(s, ":", "_")
	s = strings.ReplaceAll(s, ".", "_")

	return s
}

func String2Time(s string) (time.Time, error) {
	t, err := time.Parse("2006-01-02T15:04:05.000Z", s)
	if err != nil {
		t, err = time.Parse("2006-01-02T15:04:05.00Z", s)
		if err != nil {
			common.WriteLog(err.Error())
			return time.Time{}, err
		}
	}
	return t, nil
}
