// @title           Furocoumarins Admin API
// @version         1.0
// @description     API for Furocoumarins admin backend
// @BasePath        /
// @SecurityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
package main

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"admin/internal/app"
	"admin/internal/infrastructure/logging"
	presentation "admin/internal/presentation/http"
)

func main() {
	container, err := app.New(app.DefaultOptions())
	if err != nil {
		logging.Fatal("%s", err)
	}
	defer func() {
		if err := container.Closer(); err != nil {
			logging.Fatal("%s", err)
		}
	}()

	http.Handle("/metrics", promhttp.Handler())
	presentation.StartMetricsServer()

	fiberApp := presentation.NewApp(container)
	logging.Fatal("%s", fiberApp.Listen(":80").Error())
}
