#!/usr/bin/env bash

is_valid_image_repository() {
  local repository="$1"
  local component='[a-z0-9]+(([._]|__|-+)[a-z0-9]+)*'

  [[ "${repository}" =~ ^${component}(:[0-9]+)?(/${component})*$ ]]
}

is_pinned_image_reference() {
  local reference="$1"
  local repository remainder tag

  if [[ "${reference}" == *@* ]]; then
    repository="${reference%@*}"
    remainder="${reference##*@}"
    is_valid_image_repository "${repository}" &&
      [[ "${remainder}" =~ ^sha256:[0-9a-fA-F]{64}$ ]]
    return
  fi

  remainder="${reference##*/}"
  [[ "${remainder}" == *:* ]] || return 1
  tag="${remainder##*:}"
  repository="${reference%:*}"
  is_valid_image_repository "${repository}" &&
    [[ "${tag}" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] &&
    [[ ! "${tag}" =~ ^[Ll][Aa][Tt][Ee][Ss][Tt]$ ]]
}

require_pinned_image_reference() {
  local variable="$1"
  local value="${!variable:-}"

  if [[ -z "${value}" ]]; then
    echo "${variable} must be set to a pinned digest or explicit non-latest version tag" >&2
    return 1
  fi
  if ! is_pinned_image_reference "${value}"; then
    echo "${variable} must use a pinned digest or explicit non-latest version tag; floating latest and malformed references are rejected" >&2
    return 1
  fi
}
