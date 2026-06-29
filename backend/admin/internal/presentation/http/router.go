package http

import (
	"net/http"

	"github.com/ansrivas/fiberprometheus/v2"
	jwtware "github.com/gofiber/contrib/jwt"
	"github.com/gofiber/contrib/swagger"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/sirupsen/logrus"

	"admin/internal/app"
	authhandler "admin/internal/presentation/http/auth"
	bibtexhandler "admin/internal/presentation/http/bibtex"
	createhandler "admin/internal/presentation/http/create"
	pageshandler "admin/internal/presentation/http/pages"
	"admin/internal/presentation/http/response"
	searchhandler "admin/internal/presentation/http/search"
	tableshandler "admin/internal/presentation/http/tables"
	"admin/settings"
)

func NewApp(container *app.Container) *fiber.App {
	logrus.SetFormatter(&logrus.JSONFormatter{})

	app := fiber.New(fiber.Config{
		EnableTrustedProxyCheck: true,
		BodyLimit:               10 * 1024 * 1024,
	})

	prometheus := fiberprometheus.New("fuco-backend")
	prometheus.RegisterAt(app, "/metrics")
	app.Use(prometheus.Middleware)
	app.Use(cors.New(settings.CORS_SETTINGS))
	if settings.ENV_TYPE != "TEST" && settings.ENV_TYPE != "AUTOTEST" {
		app.Use(swagger.New(swagger.Config{
			BasePath: "/",
			FilePath: "./docs/swagger.json",
			Path:     "docs",
			Title:    "Furocoumarins Admin API",
		}))
	}

	auth := authhandler.NewHandler(container)
	search := searchhandler.NewHandler(container)
	tables := tableshandler.NewHandler(container)
	bibtex := bibtexhandler.NewHandler(container)
	pages := pageshandler.NewHandler(container)
	create := createhandler.NewHandler(container)

	app.Get("/metadata", search.Get_current_metadata)
	app.Get("/autocomplete/:column", search.Autocomletion)
	app.Get("/search", search.Search_main_app)
	app.Get("/article/:id", bibtex.Get_article)
	app.Get("/pages/:name", pages.Get_page)

	app.Get("/ping", response.Resp200)
	app.Post("/auth/login", auth.Login)
	app.Post("/auth/login-mail", auth.Login_mail)
	app.Post("/auth/confirm-login-mail", auth.Confirm_login_mail)
	app.Post("/auth/change-password", auth.Change_password)
	app.Post("/auth/confirm-password-change", auth.Confirm_password_change)

	app.Use(jwtware.New(jwtware.Config{
		SigningKey: jwtware.SigningKey{Key: settings.SECRET_KEY},
	}))
	app.Post("/auth/renew-token", auth.Renew_token)

	app.Post("/create-table", create.Create_table)
	app.Post("/get-tables-list", tables.Get_tables_list)
	app.Post("/make-table-active/:timestamp", tables.Activate_table)
	app.Delete("/table/:timestamp", tables.Delete_table)
	app.Delete("/tables", tables.Delete_all_bad_tables)

	app.Put("/bibtex", bibtex.Update_file)
	app.Put("/pages/:name", pages.Put_page)

	return app
}

func StartMetricsServer() {
	go func() {
		if err := http.ListenAndServe(":5000", nil); err != nil {
			panic(err)
		}
	}()
}
