// Command import-furanocoumarins performs the side project's one-time offline
// identity migration into an already-initialized auth-master database.
package main

import (
	"context"
	"fmt"
	"os"

	"admin/internal/migration/authmaster"
)

func main() {
	settings, err := authmaster.LoadSettingsFromEnvironment()
	if err == nil {
		err = authmaster.Run(context.Background(), settings, os.Stdout)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
