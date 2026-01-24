package bibtex

import (
	"admin/utils/common"
	"bufio"
	"fmt"
	"mime/multipart"
	"regexp"
	"strings"
)

func ParseBibtexFile(file multipart.File) (map[string]string, error) {
	defer file.Close()

	identifiers := make(map[string]string, 0)
	scanner := bufio.NewScanner(file)

	re := regexp.MustCompile(`^@.*\{([^,]+),`)

	lines_stack := []string{}
	prev_identifier := ""
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		matches := re.FindStringSubmatch(line)
		if len(matches) > 1 {
			if prev_identifier != "" {
				identifiers[prev_identifier] = strings.Join(lines_stack, "\n")
				lines_stack = []string{matches[0]}
			}

			if _, exists := identifiers[matches[1]]; exists {
				common.WriteLog("duplicate key in .bib file: ", matches[1])
			}
			prev_identifier = matches[1]
		} else {
			lines_stack = append(lines_stack, line)
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return identifiers, nil
}

func Check_artickle_ids(corr_ids map[string]string, ids_to_check []string) []string {
	errors_map := make(map[string]struct{}, 0)

	for _, id := range ids_to_check {
		if _, exists := corr_ids[id]; !exists {
			errors_map[fmt.Sprintf("missing article id '%s'", id)] = struct{}{}
		}
	}

	errors_slice := []string{}
	for err := range errors_map {
		errors_slice = append(errors_slice, err)
	}
	return errors_slice
}
