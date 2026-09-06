#!/usr/bin/env bash

# normalize_callback_secret_file copies one URL to output without its optional
# final LF or CRLF. Any embedded line ending, multiple line ending, NUL, or
# empty value is rejected before Docker sees the file.
normalize_callback_secret_file() {
  local input="$1"
  local output="$2"
  if [[ ! -r "${input}" || ! -s "${input}" ]]; then
    echo "Callback URL file must be readable and non-empty" >&2
    return 1
  fi

  local raw_hex hex normalized_hex bytes normalized_bytes
  raw_hex="$(od -An -tx1 -v "${input}")"
  hex="$(printf '%s' "${raw_hex}" | tr -d '[:space:]')"
  [[ -n "${hex}" ]] || { echo "Callback URL file is empty" >&2; return 1; }
  case " ${raw_hex} " in
    *" 00 "*) echo "Callback URL file contains a NUL byte" >&2; return 1 ;;
  esac
  bytes=$(( ${#hex} / 2 ))
  normalized_hex="${hex}"
  normalized_bytes="${bytes}"
  case "${normalized_hex}" in
    *0d0a)
      normalized_hex="${normalized_hex%0d0a}"
      normalized_bytes=$((normalized_bytes - 2))
      ;;
    *0a)
      normalized_hex="${normalized_hex%0a}"
      normalized_bytes=$((normalized_bytes - 1))
      ;;
    *0d)
      normalized_hex="${normalized_hex%0d}"
      normalized_bytes=$((normalized_bytes - 1))
      ;;
  esac
  [[ "${normalized_bytes}" -gt 0 ]] || { echo "Callback URL file is empty" >&2; return 1; }
  case "${normalized_hex}" in
    *0a*|*0d*) echo "Callback URL file must contain exactly one line" >&2; return 1 ;;
  esac

  dd if="${input}" of="${output}" bs=1 count="${normalized_bytes}" 2>/dev/null
}

create_normalized_callback_secret() {
  local name="$1"
  local file="$2"
  local expected_path="$3"
  local value
  value="$(<"${file}")"
  if ! validate_callback_url "${value}" "${expected_path}"; then
    echo "Callback secret '${name}' must contain exactly https://<frontend>${expected_path}" >&2
    return 1
  fi
  if docker secret inspect "${name}" >/dev/null 2>&1; then
    echo "Secret '${name}' already exists (remove manually to rotate)"
    return 0
  fi
  docker secret create --label "furanocoumarins.callback-url=${value}" "${name}" "${file}" >/dev/null
  echo "Created secret: ${name}"
}
