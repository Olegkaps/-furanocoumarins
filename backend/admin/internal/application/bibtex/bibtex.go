package bibtex

import (
	"bufio"
	"fmt"
	"mime/multipart"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"

	"admin/internal/infrastructure/logging"
)

func ParseBibtexFile(c *fiber.Ctx, file multipart.File) (map[string]string, error) {
	defer func(c *fiber.Ctx) {
		err := file.Close()
		if err != nil {
			logging.Error(c, "%s", err)
		}
	}(c)

	identifiers := make(map[string]string)
	scanner := bufio.NewScanner(file)
	re := regexp.MustCompile(`^@.*\{([^,]+),`)

	linesStack := []string{}
	prevIdentifier := ""
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		matches := re.FindStringSubmatch(line)
		if len(matches) > 1 {
			if prevIdentifier != "" {
				identifiers[prevIdentifier] = strings.Join(linesStack, "\n")
				linesStack = []string{matches[0]}
			}

			if _, exists := identifiers[matches[1]]; exists {
				logging.Warn(c, "duplicate key in .bib file: %s", matches[1])
			}
			prevIdentifier = matches[1]
		} else {
			linesStack = append(linesStack, line)
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	if prevIdentifier != "" {
		identifiers[prevIdentifier] = strings.Join(linesStack, "\n")
	}

	return identifiers, nil
}

func CheckArticleIDs(corrIDs map[string]string, idsToCheck []string) []string {
	errorsMap := make(map[string]struct{})
	for _, id := range idsToCheck {
		if _, exists := corrIDs[id]; !exists {
			errorsMap[fmt.Sprintf("missing article id '%s'", id)] = struct{}{}
		}
	}

	errorsSlice := make([]string, 0, len(errorsMap))
	for err := range errorsMap {
		errorsSlice = append(errorsSlice, err)
	}
	return errorsSlice
}
