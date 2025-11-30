package main

import (
	_ "github.com/lib/pq"

	jwtware "github.com/gofiber/contrib/jwt"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"

	"admin/routes/auth"
	"admin/routes/create"
	"admin/routes/search"
	"admin/routes/tables"
	"admin/settings"
	"admin/utils/common"
)

func main() {
	app := fiber.New()

	app.Use(cors.New(settings.CORS_SETTINGS))

	app.Post("/search", search.Search_main_app)

	app.Get("/ping", func(c *fiber.Ctx) error { return c.SendStatus(200) })
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
	app.Post("/make-table-active", tables.Activate_table)
	app.Post("/deactivate-table", tables.Deactivate_table)
	app.Post("/delete-table", tables.Delete_table)
	app.Post("/delete-tables", tables.Delete_all_bad_tables)

	common.WriteLogFatal(app.Listen(":80").Error())
}
