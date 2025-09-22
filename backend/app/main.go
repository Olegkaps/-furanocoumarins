package main

import (
	"log"
	"os"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"
)

func main() {
	args := os.Args

	cassandra_host := args[1]
	cluster := gocql.NewCluster(cassandra_host)

	log.Println("Creating session with Cassandra on host: ", cassandra_host)
	session, err := cluster.CreateSession()
	if err != nil {
		panic(err)
	}
	log.Println("Session successfully passed")
	defer session.Close()

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
