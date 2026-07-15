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
	app.Use(cors.New(settings.C.Cors()))
	if container.EnvType != "TEST" && container.EnvType != "AUTOTEST" {
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

	app.Get("/metadata", search.GetCurrentMetadata)
	app.Get("/autocomplete/:column", search.Autocomplete)
	app.Get("/search", search.SearchMainApp)
	app.Get("/article/:id", bibtex.GetArticle)
	app.Get("/pages/:name", pages.GetPage)

	app.Get("/ping", response.Resp200)
	app.Post("/auth/login", auth.Login)
	app.Post("/auth/login-mail", auth.LoginMail)
	app.Post("/auth/confirm-login-mail", auth.ConfirmLoginMail)
	app.Post("/auth/change-password", auth.ChangePassword)
	app.Post("/auth/confirm-password-change", auth.ConfirmPasswordChange)

	app.Use(jwtware.New(jwtware.Config{
		SigningKey: jwtware.SigningKey{Key: settings.C.SecretKeyBytes()},
	}))
	app.Post("/auth/renew-token", auth.RenewToken)

	app.Post("/create-table", create.CreateTable)
	app.Post("/get-tables-list", tables.GetTablesList)
	app.Post("/make-table-active/:timestamp", tables.ActivateTable)
	app.Delete("/table/:timestamp", tables.DeleteTable)
	app.Delete("/tables", tables.DeleteAllBadTables)

	app.Put("/bibtex", bibtex.UpdateFile)
	app.Put("/pages/:name", pages.PutPage)

	return app
}

func StartMetricsServer() {
	go func() {
		if err := http.ListenAndServe(":5000", nil); err != nil {
			panic(err)
		}
	}()
}
