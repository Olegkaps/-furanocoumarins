package http

import (
	"net/http"

	"github.com/ansrivas/fiberprometheus/v2"
	"github.com/gofiber/contrib/swagger"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	promclient "github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/sirupsen/logrus"

	"admin/internal/app"
	authmasterhandler "admin/internal/presentation/http/authmaster"
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

	// One app-local registry exposes HTTP and runtime metrics together and keeps
	// independent application instances isolated (including in tests).
	registry := promclient.NewRegistry()
	registry.MustRegister(collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	prometheus := fiberprometheus.NewWithRegistry(registry, "fuco-backend", "http", "", nil)
	prometheus.RegisterAt(app, "/metrics")
	app.Use(prometheus.Middleware)
	// Recover inside instrumentation so a panic contributes a 500 observation.
	app.Use(recover.New())
	app.Use(cors.New(settings.C.Cors()))
	if container.EnvType != "TEST" && container.EnvType != "AUTOTEST" {
		app.Use(swagger.New(swagger.Config{
			BasePath: "/",
			FilePath: "./docs/swagger.json",
			Path:     "docs",
			Title:    "Furocoumarins Admin API",
		}))
	}

	externalAuth := authmasterhandler.New(container)
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
	// Fixed compatibility surface: authd itself is private and arbitrary proxy
	// paths are deliberately impossible.
	app.Post("/auth/login", externalAuth.JSON("/v1/auth/login", authmasterhandler.LoginBody))
	app.Post("/auth/login-verify-otp", externalAuth.JSON("/v1/auth/login/verify-otp", authmasterhandler.OTPVerifyBody))
	app.Post("/auth/login-mail", externalAuth.JSON("/v1/auth/login/magic-link", authmasterhandler.MagicStartBody))
	app.Post("/auth/confirm-login-mail", externalAuth.JSON("/v1/auth/login/magic-link/verify", authmasterhandler.MagicVerifyBody))
	app.Post("/auth/register", externalAuth.Forward(fiber.MethodPost, "/v1/auth/register"))
	app.Get("/auth/registration-invite", externalAuth.ForwardQuery(fiber.MethodGet, "/v1/auth/registration-invite", "token"))
	app.Post("/auth/password-reset/start", externalAuth.Forward(fiber.MethodPost, "/v1/auth/password/reset/start"))
	app.Post("/auth/password-reset/complete", externalAuth.Forward(fiber.MethodPost, "/v1/auth/password/reset/complete"))
	app.Post("/auth/refresh", externalAuth.Forward(fiber.MethodPost, "/v1/auth/refresh"))
	app.Post("/auth/logout", externalAuth.Forward(fiber.MethodPost, "/v1/auth/logout"))
	app.Get("/auth/me", externalAuth.Forward(fiber.MethodGet, "/v1/me"))
	app.Post("/auth/password/2fa", externalAuth.Forward(fiber.MethodPost, "/v1/auth/password/2fa"))
	app.Post("/auth/password", externalAuth.Forward(fiber.MethodPost, "/v1/auth/password"))
	app.Get("/auth/sessions", externalAuth.Forward(fiber.MethodGet, "/v1/sessions"))
	app.Delete("/auth/sessions/:sessionID", externalAuth.ForwardPath(fiber.MethodDelete, func(c *fiber.Ctx) string { return "/v1/sessions/" + c.Params("sessionID") }))
	app.Post("/auth/sessions/revoke-otp", externalAuth.Forward(fiber.MethodPost, "/v1/sessions/revoke-otp"))
	app.Post("/auth/sessions/:sessionID/revoke", externalAuth.ForwardPath(fiber.MethodPost, func(c *fiber.Ctx) string { return "/v1/sessions/" + c.Params("sessionID") + "/revoke" }))

	super := app.Group("/auth/admin")
	superuser := authmasterhandler.RequireSuperuser(container)
	super.Post("/invitations", superuser, externalAuth.Forward(fiber.MethodPost, "/v1/admin/registration-invites"))
	super.Get("/users", superuser, externalAuth.ForwardQuery(fiber.MethodGet, "/v1/admin/users", "q", "cursor", "page_size"))
	super.Post("/users/:userID/ban", superuser, externalAuth.ForwardPath(fiber.MethodPost, func(c *fiber.Ctx) string { return "/v1/admin/users/" + c.Params("userID") + "/ban" }))
	super.Delete("/users/:userID/ban", superuser, externalAuth.ForwardPath(fiber.MethodDelete, func(c *fiber.Ctx) string { return "/v1/admin/users/" + c.Params("userID") + "/ban" }))
	super.Post("/signing-keys/rotate", superuser, externalAuth.Forward(fiber.MethodPost, "/v1/admin/signing-keys/rotate"))
	super.Get("/roles", superuser, externalAuth.ForwardRoles(fiber.MethodGet, "/v1/roles", "q", "cursor", "page_size"))
	super.Post("/roles/:roleID/members", superuser, externalAuth.ForwardPath(fiber.MethodPost, func(c *fiber.Ctx) string { return "/v1/roles/" + c.Params("roleID") + "/members" }))
	super.Delete("/roles/:roleID/members/:userID", superuser, externalAuth.ForwardPath(fiber.MethodDelete, func(c *fiber.Ctx) string { return "/v1/roles/" + c.Params("roleID") + "/members/" + c.Params("userID") }))

	app.Post("/get-tables-list", authmasterhandler.RequireUser(container), tables.GetTablesList)
	admin := authmasterhandler.RequireAdmin(container)
	app.Post("/create-table", admin, create.CreateTable)
	app.Get("/table-imports/:importID", admin, create.ImportStatus)
	app.Post("/make-table-active/:timestamp", admin, tables.ActivateTable)
	app.Delete("/table/:timestamp", admin, tables.DeleteTable)
	app.Delete("/tables", admin, tables.DeleteAllBadTables)
	app.Put("/bibtex", admin, bibtex.UpdateFile)
	app.Put("/pages/:name", admin, pages.PutPage)

	return app
}

func StartMetricsServer() {
	go func() {
		if err := http.ListenAndServe(":5000", nil); err != nil {
			panic(err)
		}
	}()
}
