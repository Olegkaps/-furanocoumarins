#!/usr/bin/env bash

# validate_callback_url accepts one exact external HTTPS BrowserRouter route.
# Deliberately reject userinfo, query strings, fragments, and empty/malformed
# authorities; auth-master appends its token query parameter itself.
validate_callback_url() {
  local value="$1"
  local expected_path="$2"
  local authority_pattern='[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?'
  [[ "${value}" =~ ^https://${authority_pattern}${expected_path}$ ]] || return 1
  local authority="${value#https://}"
  authority="${authority%${expected_path}}"
  local host="${authority}"
  host="${host%%:*}"
  host="$(printf '%s' "${host}" | tr '[:upper:]' '[:lower:]')"
  [[ "${host}" != "localhost" && "${host}" != "::1" && ! "${host}" =~ ^127\. ]]
}

callback_origin() {
  local value="$1"
  local expected_path="$2"
  validate_callback_url "${value}" "${expected_path}" || return 1
  printf '%s' "${value%${expected_path}}"
}

validate_spa_origin_contract() {
  local allow_origin="$1"
  local magic_url="$2"
  local invite_url="$3"
  local magic_origin invite_origin
  magic_origin="$(callback_origin "${magic_url}" /admit)" || return 1
  invite_origin="$(callback_origin "${invite_url}" /register)" || return 1
  [[ "${allow_origin}" == "${magic_origin}" && "${allow_origin}" == "${invite_origin}" ]]
}
