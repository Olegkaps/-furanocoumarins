package settings

import (
	"reflect"
	"testing"
	"time"
)

func TestCorsCredentialsRequireExplicitOrigin(t *testing.T) {
	tests := []struct {
		name        string
		origin      string
		credentials bool
	}{
		{name: "unset", origin: "", credentials: false},
		{name: "wildcard", origin: "*", credentials: false},
		{name: "explicit", origin: "http://127.0.0.1:15173", credentials: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := (Config{AllowOrigin: tt.origin}).Cors()
			if config.AllowCredentials != tt.credentials {
				t.Fatalf("AllowCredentials = %v, want %v", config.AllowCredentials, tt.credentials)
			}
			if config.AllowHeaders == "" {
				t.Fatal("AllowHeaders must include the browser auth headers")
			}
		})
	}
}

func TestSMTPTimeoutDefaultAndValidation(t *testing.T) {
	field, ok := reflect.TypeOf(Config{}).FieldByName("SmtpTimeout")
	if !ok || field.Tag.Get("env-default") != "5s" {
		t.Fatalf("SMTP_TIMEOUT default missing: %+v", field.Tag)
	}
	if err := (Config{SmtpTimeout: 5 * time.Second}).Validate(); err != nil {
		t.Fatal(err)
	}
	for _, timeout := range []time.Duration{0, -time.Second} {
		if err := (Config{SmtpTimeout: timeout}).Validate(); err == nil {
			t.Fatalf("expected timeout %s to fail", timeout)
		}
	}
}

func TestLocalDefaultsMatchBrowserOriginAndAllowCredentials(t *testing.T) {
	field, ok := reflect.TypeOf(Config{}).FieldByName("AllowOrigin")
	if !ok {
		t.Fatal("AllowOrigin setting is missing")
	}
	const localSPAOrigin = "http://localhost:5173"
	if got := field.Tag.Get("env-default"); got != localSPAOrigin {
		t.Fatalf("ALLOW_ORIGIN default = %q, want local SPA origin %q", got, localSPAOrigin)
	}
	config := (Config{AllowOrigin: localSPAOrigin}).Cors()
	if config.AllowOrigins != "http://localhost:5173" || !config.AllowCredentials {
		t.Fatalf("local CORS = origins %q credentials %v", config.AllowOrigins, config.AllowCredentials)
	}
}
