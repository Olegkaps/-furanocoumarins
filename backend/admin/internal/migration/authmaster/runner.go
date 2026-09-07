package authmaster

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
)

const maxSecretFileBytes = 64 << 10

type Settings struct {
	SourceDatabaseURL string
	TargetDatabaseURL string
	SelectedSuperuser string
}

func validateEnvironmentValue(name, value string) (string, error) {
	if value == "" {
		return "", fmt.Errorf("%s is empty", name)
	}
	if len(value) > maxSecretFileBytes {
		return "", fmt.Errorf("%s exceeds %d bytes", name, maxSecretFileBytes)
	}
	if strings.IndexByte(value, 0) >= 0 {
		return "", fmt.Errorf("%s contains a NUL byte", name)
	}
	return value, nil
}

func envOrFile(name string) (string, error) {
	direct, directSet := os.LookupEnv(name)
	fileName := name + "_FILE"
	path, fileSet := os.LookupEnv(fileName)
	if directSet && fileSet {
		return "", fmt.Errorf("%s and %s cannot both be set", name, fileName)
	}
	if directSet {
		return validateEnvironmentValue(name, direct)
	}
	if !fileSet {
		return "", nil
	}
	if strings.TrimSpace(path) == "" {
		return "", fmt.Errorf("%s must name a readable file", fileName)
	}
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("read %s failed", fileName)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxSecretFileBytes+1))
	if err != nil {
		return "", fmt.Errorf("read %s failed", fileName)
	}
	if len(data) > maxSecretFileBytes {
		return "", fmt.Errorf("%s exceeds %d bytes", fileName, maxSecretFileBytes)
	}
	value := strings.TrimRight(string(data), "\r\n")
	return validateEnvironmentValue(fileName, value)
}

func LoadSettingsFromEnvironment() (Settings, error) {
	var settings Settings
	for _, item := range []struct {
		name  string
		value *string
	}{
		{name: "FURANO_SOURCE_DATABASE_URL", value: &settings.SourceDatabaseURL},
		{name: "DATABASE_URL", value: &settings.TargetDatabaseURL},
		{name: "FURANO_SUPERUSER", value: &settings.SelectedSuperuser},
	} {
		value, err := envOrFile(item.name)
		if err != nil {
			return Settings{}, err
		}
		*item.value = value
	}
	if strings.TrimSpace(settings.SourceDatabaseURL) == "" || strings.TrimSpace(settings.TargetDatabaseURL) == "" || strings.TrimSpace(settings.SelectedSuperuser) == "" {
		return Settings{}, errors.New("FURANO_SOURCE_DATABASE_URL, DATABASE_URL, and FURANO_SUPERUSER are required directly or through matching _FILE variables")
	}
	return settings, nil
}

func openDatabase(ctx context.Context, dsn, kind string) (*sql.DB, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open %s database failed", kind)
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("connect %s database failed", kind)
	}
	return db, nil
}

func legacySourceDatabaseURL(configured string) (string, error) {
	parsed, err := url.Parse(configured)
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") || parsed.Host == "" || parsed.User == nil || parsed.Fragment != "" {
		return "", errors.New("legacy source database URL is malformed")
	}
	password, ok := parsed.User.Password()
	if !ok {
		return "", errors.New("legacy source database URL has no password")
	}
	parsed.User = url.UserPassword("postgres", password)
	parsed.Host = "legacy-postgres:5432"
	parsed.Path = "/mydb"
	parsed.RawPath = ""
	return parsed.String(), nil
}

func Run(ctx context.Context, settings Settings, output io.Writer) error {
	_, _ = fmt.Fprintln(output, "auth-master import: connecting to legacy source database")
	sourceURL, err := legacySourceDatabaseURL(settings.SourceDatabaseURL)
	if err != nil {
		return err
	}
	source, err := openDatabase(ctx, sourceURL, "source")
	if err != nil {
		return err
	}
	defer source.Close()
	_, _ = fmt.Fprintln(output, "auth-master import: connected to legacy source database")
	_, _ = fmt.Fprintln(output, "auth-master import: connecting to auth-master target database")
	target, err := openDatabase(ctx, settings.TargetDatabaseURL, "target")
	if err != nil {
		return err
	}
	defer target.Close()
	_, _ = fmt.Fprintln(output, "auth-master import: connected to auth-master target database")
	_, _ = fmt.Fprintln(output, "auth-master import: reading legacy users")
	users, err := ReadSourceUsers(ctx, source)
	if err != nil {
		return err
	}
	_, _ = fmt.Fprintf(output, "auth-master import: read %d legacy users; importing in one transaction\n", len(users))
	if err := ImportUsers(ctx, target, users, settings.SelectedSuperuser); err != nil {
		return err
	}
	_, _ = fmt.Fprintf(output, "auth-master import completed: %d users\n", len(users))
	return nil
}
