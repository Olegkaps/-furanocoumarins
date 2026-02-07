package main

import (
	"net/http"

	_ "github.com/lib/pq"
	"github.com/sirupsen/logrus"

	"github.com/ansrivas/fiberprometheus/v2"
	jwtware "github.com/gofiber/contrib/jwt"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"admin/routes/auth"
	"admin/routes/bibtex"
	"admin/routes/create"
	"admin/routes/search"
	"admin/routes/tables"
	"admin/settings"
	"admin/utils/dbs"
	http_lib "admin/utils/http"
	"admin/utils/logging"
)

func SetUp() *fiber.App {
	logrus.SetFormatter(&logrus.JSONFormatter{})

	app := fiber.New(fiber.Config{
		EnableTrustedProxyCheck: true,
		BodyLimit:               10 * 1024 * 1024,
	})

	prometheus := fiberprometheus.New("fuco-backend")
	prometheus.RegisterAt(app, "/metrics")
	// prometheus.SetSkipPaths([]string{"/ping"})
	// prometheus.SetIgnoreStatusCodes([]int{401, 403, 404})
	app.Use(prometheus.Middleware)

	app.Use(cors.New(settings.CORS_SETTINGS))

	app.Get("/metadata", search.Get_current_metadata)
	app.Get("/autocomplete/:column", search.Autocomletion)
	app.Get("/search", search.Search_main_app)
	app.Get("/article/:id", bibtex.Get_article)

	app.Get("/ping", http_lib.Resp200)
	app.Post("/login", auth.Login)
	app.Post("/login-mail", auth.Login_mail)
	app.Post("/confirm-login-mail", auth.Confirm_login_mail)

	app.Post("/change-password", auth.Change_password)
	app.Post("/confirm-password-change", auth.Confirm_password_change)

	// secure api
	app.Use(jwtware.New(jwtware.Config{
		SigningKey: jwtware.SigningKey{Key: settings.SECRET_KEY},
	}))

	app.Post("/renew-token", auth.Renew_token)

	app.Post("/create-table", create.Create_table)
	app.Post("/get-tables-list", tables.Get_tables_list)
	app.Post("/make-table-active/:timestamp", tables.Activate_table)
	app.Delete("/table/:timestamp", tables.Delete_table)
	app.Delete("/tables", tables.Delete_all_bad_tables)

	app.Put("/bibtex", bibtex.Update_file)

	return app
}

func main() {
	defer dbs.DB.Close()
	defer dbs.Redis.Close()

	http.Handle("/metrics", promhttp.Handler())
	go http.ListenAndServe(":5000", nil)

	app := SetUp()

	logging.Fatal("%s", app.Listen(":80").Error())
}
