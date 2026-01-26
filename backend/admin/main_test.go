package main_test

import (
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"

	main "admin"
)

func TestExistingRoutesAccess(t *testing.T) {
	tests := []struct {
		description   string
		method        string
		route         string
		expectedError bool
		expectedCode  int
		expectedBody  string
	}{
		{
			description:   "search route",
			method:        "POST", // CHANGE METHOD
			route:         "/search",
			expectedError: false,
			expectedCode:  400,
			expectedBody:  "{\"error\":\"search_request is required\"}",
		},
		{
			description:   "article route",
			method:        "GET",
			route:         "/article/art_20",
			expectedError: false,
		},
		{
			description:   "ping route",
			method:        "GET",
			route:         "/ping",
			expectedError: false,
			expectedCode:  200,
			expectedBody:  "OK",
		},
		{
			description:   "login route",
			method:        "POST",
			route:         "/login",
			expectedError: false,
		},
		{
			description:   "mail login route",
			method:        "POST",
			route:         "/login-mail",
			expectedError: false,
		},
		{
			description:   "mail login part 2 route",
			method:        "POST",
			route:         "/confirm-login-mail",
			expectedError: true,
		},
		{
			description:   "change password route",
			method:        "POST",
			route:         "/change-password",
			expectedError: false,
		},
		{
			description:   "change password part 2 route",
			method:        "GET",
			route:         "/confirm-password-change",
			expectedError: false,
			expectedCode:  400,
			expectedBody:  "missing or malformed JWT", // BAD
		},
		{
			description:   "secure renew token route",
			method:        "POST",
			route:         "/renew-token",
			expectedError: false,
			expectedCode:  400,
			expectedBody:  "missing or malformed JWT",
		},
		{
			description:   "secure create table route",
			method:        "POST",
			route:         "/create-table",
			expectedError: false,
			expectedCode:  400,
			expectedBody:  "missing or malformed JWT",
		},
		{
			description:   "secure get tables route",
			method:        "POST",
			route:         "/get-tables-list",
			expectedError: false,
			expectedCode:  400,
			expectedBody:  "missing or malformed JWT",
		},
		{
			description:   "secure activate table route",
			method:        "POST",
			route:         "/make-table-active",
			expectedError: false,
			expectedCode:  400,
			expectedBody:  "missing or malformed JWT",
		},
		{
			description:   "delete table route",
			method:        "POST", // CHANGE METHOD
			route:         "/delete-table",
			expectedError: false,
			expectedCode:  400,
			expectedBody:  "missing or malformed JWT",
		},
		{
			description:   "delete bad tables route",
			method:        "POST", // CHANGE METHOD
			route:         "/delete-tables",
			expectedError: false,
			expectedCode:  400,
			expectedBody:  "missing or malformed JWT",
		},
		{
			description:   "put bibtex route",
			method:        "PUT",
			route:         "/update-bibtex", // CHANGE NAME
			expectedError: false,
			expectedCode:  400,
			expectedBody:  "missing or malformed JWT",
		},
		{
			description:   "non existing route",
			method:        "GET",
			route:         "/i-dont-exist",
			expectedError: false,
			expectedCode:  400,
			expectedBody:  "missing or malformed JWT",
		},
	}

	app := main.SetUp()

	for _, test := range tests {
		req, _ := http.NewRequest(test.method, test.route, nil)
		res, err := app.Test(req, 10)
		assert.Equalf(t, test.expectedError, err != nil, test.description)
		if test.expectedError {
			continue
		}
		assert.Equalf(t, test.expectedCode, res.StatusCode, test.description)
		body, err := io.ReadAll(res.Body)
		assert.Nilf(t, err, test.description)
		assert.Equalf(t, test.expectedBody, string(body), test.description)
	}
}
