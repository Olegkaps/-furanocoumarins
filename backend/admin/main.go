package main

import (
	"log"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New(fiber.Config{
		Prefork:       false,
		ServerHeader:  "GO",
		CaseSensitive: true,
		StrictRouting: true,
	})

	app.Get("/", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"Hello": "World!"})
	})

	log.Fatal(app.Listen(":8080"))
}
