package main

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type settings struct{ host, dsn string }

// setting accepts Docker's mounted-secret convention without disclosing values
// or filenames in errors. Only terminal line endings are removed from files.
func setting(name string) (string, error) {
	value, direct := os.LookupEnv(name)
	path, file := os.LookupEnv(name + "_FILE")
	if direct && file {
		return "", fmt.Errorf("set only one of %s and %s_FILE", name, name)
	}
	if file {
		data, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("cannot read %s_FILE", name)
		}
		value = strings.TrimRight(string(data), "\r\n")
	}
	if (direct || file) && value == "" {
		return "", fmt.Errorf("%s must not be empty", name)
	}
	return value, nil
}

func required(name string) (string, error) {
	value, err := setting(name)
	if err == nil && value == "" {
		err = fmt.Errorf("%s or %s_FILE is required", name, name)
	}
	return value, err
}

func config() (settings, error) {
	var s settings
	var err error
	if s.host, err = required("FURANO_CASSANDRA_HOST"); err != nil {
		return s, err
	}
	if s.dsn, err = setting("FURANO_POSTGRES_DSN"); err != nil {
		return s, err
	}
	if s.dsn != "" {
		return s, nil
	}
	components := make(map[string]string)
	for _, name := range []string{"PG_HOST", "PG_USER", "PG_PASSWORD", "PG_DB"} {
		components[name], err = required(name)
		if err != nil {
			return s, err
		}
	}
	port, err := setting("PG_PORT")
	if err != nil {
		return s, err
	}
	if port == "" {
		port = "5432"
	}
	if number, parseErr := strconv.Atoi(port); parseErr != nil || number < 1 || number > 65535 {
		return s, fmt.Errorf("PG_PORT must be between 1 and 65535")
	}
	sslmode, err := setting("PG_SSLMODE")
	if err != nil {
		return s, err
	}
	if sslmode == "" {
		sslmode = "require"
	}
	switch sslmode {
	case "disable", "require", "verify-ca", "verify-full":
	default:
		return s, fmt.Errorf("PG_SSLMODE must be disable, require, verify-ca or verify-full")
	}
	dsn := url.URL{Scheme: "postgres", User: url.UserPassword(components["PG_USER"], components["PG_PASSWORD"]), Host: net.JoinHostPort(components["PG_HOST"], port), Path: "/" + components["PG_DB"], RawQuery: url.Values{"sslmode": {sslmode}}.Encode()}
	s.dsn = dsn.String()
	return s, nil
}
