# Shared helpers for the Clinical Acceleration scripts. Source this file; do not execute it.
#
#   source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
#
# Configuration (environment variables):
#   SAS_BASE_URL       Server URL, e.g. https://myviya.example.com          (required)
#   SAS_API_PREFIX     Path prefix of the repository API (default: /clinicalRepository).
#   DRY_RUN=1          Write operations are only printed, never sent. Reads still run.
#   SAS_CLINICAL_AUTHORIZATION
#                      "admin" sends the header "X-SAS-Clinical-Authorization: admin", which is
#                      what the repository admin UI sends to act as a repository administrator
#                      (audited with mode ADMIN). Without it even viya_admin only has the rights
#                      of an ordinary user, e.g. no write access on /PositLabs. Only
#                      setup_org.sh uses it (use_admin_mode): the server refuses to create
#                      content inside an organization in admin mode.
#
# Authentication - the first of these that applies is used:
#   1. SAS_TOKEN                       An existing access token.
#   2. SAS_CLIENT_ID [+ SAS_CLIENT_SECRET] + SAS_USER + SAS_PASSWORD
#                                      OAuth password grant against /SASLogon/oauth/token.
#                                      Unset SAS_USER / SAS_PASSWORD are prompted for.
#                                      SAS_CLIENT_ID=sas.cli with an empty secret works on many sites.
#   3. ~/.sas/credentials.json         Token written by `sas-viya auth login`.
#
# Requires: curl, jq

set -euo pipefail

for _cmd in curl jq; do
  command -v "$_cmd" >/dev/null || { echo "Missing dependency: $_cmd" >&2; exit 1; }
done

: "${SAS_BASE_URL:?Set SAS_BASE_URL, e.g. https://myviya.example.com}"
BASE="${SAS_BASE_URL%/}"
API="${BASE}${SAS_API_PREFIX-/clinicalRepository}"
DRY_RUN="${DRY_RUN:-0}"

# Extra curl arguments, built once SAS_CLINICAL_AUTHORIZATION is known (see use_admin_mode).
ADMIN_ARGS=()
set_admin_args() {
  ADMIN_ARGS=()
  if [[ -n "${SAS_CLINICAL_AUTHORIZATION:-}" ]]; then
    ADMIN_ARGS=(-H "X-SAS-Clinical-Authorization: ${SAS_CLINICAL_AUTHORIZATION}")
  fi
}
# use_admin_mode: call from scripts that must act as administrator (unless the caller already chose).
use_admin_mode() {
  SAS_CLINICAL_AUTHORIZATION="${SAS_CLINICAL_AUTHORIZATION-admin}"
  set_admin_args
}
set_admin_args

log()  { echo "$*" >&2; }
die()  { echo "error: $*" >&2; exit 1; }

# Parse the flags shared by every script. Call as: parse_common_flags "$@"; set -- "${REST_ARGS[@]}"
REST_ARGS=()
parse_common_flags() {
  REST_ARGS=()
  local a
  for a in "$@"; do
    case "$a" in
      --dry-run) DRY_RUN=1 ;;
      *)         REST_ARGS+=("$a") ;;
    esac
  done
}

# --- authentication ---------------------------------------------------------

get_token() {
  if [[ -n "${SAS_TOKEN:-}" ]]; then
    printf '%s' "$SAS_TOKEN"
    return
  fi

  if [[ -n "${SAS_CLIENT_ID:-}" ]]; then
    local user="${SAS_USER:-}" pass="${SAS_PASSWORD:-}" secret="${SAS_CLIENT_SECRET:-}"
    if [[ -z "$user" ]]; then read -r -p "SAS user: " user; fi
    if [[ -z "$pass" ]]; then read -r -s -p "SAS password for ${user}: " pass; echo >&2; fi

    # Credentials go to curl via stdin (-K -) so they don't show up in `ps`.
    local resp
    resp=$(
      jq -rn --arg id "$SAS_CLIENT_ID" --arg secret "$secret" \
             --arg u "$user" --arg p "$pass" --arg url "$BASE/SASLogon/oauth/token" '
        "url = \($url | @json)",
        "user = \("\($id):\($secret)" | @json)",
        "data-urlencode = \("grant_type=password" | @json)",
        "data-urlencode = \("username=\($u)" | @json)",
        "data-urlencode = \("password=\($p)" | @json)",
        "header = \("Accept: application/json" | @json)"
      ' | curl -sS --fail-with-body -X POST -K -
    )
    jq -er '.access_token' <<<"$resp" \
      || die "token request did not return an access_token"
    return
  fi

  local creds="$HOME/.sas/credentials.json"
  if [[ -f "$creds" ]]; then
    jq -er '[.. | objects | select(has("access-token")) | .["access-token"]][0]' "$creds" \
      && return
  fi

  die "no credentials found. Set SAS_TOKEN, or SAS_CLIENT_ID (+SAS_USER/SAS_PASSWORD), or run 'sas-viya auth login'."
}

TOKEN=""
ensure_token() { [[ -n "$TOKEN" ]] || TOKEN="$(get_token)"; }

# --- HTTP -------------------------------------------------------------------

# The server needs the collection media type: with "Accept: application/json",
# GET /roles/privileges is routed to GET /roles/{roleId} ("Role does not exist").
COLLECTION_ACCEPT="application/vnd.sas.collection+json"

# api_get PATH [ACCEPT]  -> response body on stdout; non-zero exit on HTTP errors.
api_get() {
  ensure_token
  curl -sS --fail-with-body \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: ${2:-$COLLECTION_ACCEPT}" \
    ${ADMIN_ARGS[@]+"${ADMIN_ARGS[@]}"} \
    "${API}$1"
}

# viya_get PATH [ACCEPT]  -> like api_get, but PATH is relative to the server root, for other
# Viya services such as /identities. Never sends the admin-mode header.
viya_get() {
  ensure_token
  curl -sS --fail-with-body \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: ${2:-application/json}" \
    "${BASE}$1"
}

# api_etag PATH  -> the ETag header of a GET on PATH (needed for If-Match on PATCH).
api_etag() {
  ensure_token
  curl -sS --fail-with-body -o /dev/null -D - \
    -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/json" \
    ${ADMIN_ARGS[@]+"${ADMIN_ARGS[@]}"} \
    "${API}$1" | awk 'tolower($1) == "etag:" { sub(/^[^:]*: */, ""); sub(/\r$/, ""); print; exit }'
}

# api_send METHOD PATH [CONTENT_TYPE [BODY [IF_MATCH]]]  -> response body on stdout.
# Write operations are skipped (and printed) when DRY_RUN=1.
api_send() {
  local method="$1" url_path="$2" ctype="${3:-}" body="${4:-}" ifmatch="${5:-}"
  if [[ "$DRY_RUN" == 1 ]]; then
    log "[dry-run] $method $url_path${ctype:+  ($ctype)}"
    [[ -n "$body" ]] && log "          $body"
    return 0
  fi
  ensure_token
  local args=(-sS --fail-with-body -X "$method"
              -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/json")
  [[ -n "$ctype"   ]] && args+=(-H "Content-Type: ${ctype}")
  [[ -n "$ifmatch" ]] && args+=(-H "If-Match: ${ifmatch}")
  [[ -n "$body"    ]] && args+=(--data-binary "$body")
  curl "${args[@]}" ${ADMIN_ARGS[@]+"${ADMIN_ARGS[@]}"} "${API}${url_path}"
}

# api_upload PATH FILE NAME  -> multipart upload (PUT) of FILE as NAME. PATH carries the query string.
api_upload() {
  local url_path="$1" file="$2" name="$3"
  if [[ "$DRY_RUN" == 1 ]]; then
    log "[dry-run] PUT $url_path  (multipart: $file as $name)"
    return 0
  fi
  ensure_token
  curl -sS --fail-with-body -X PUT \
    -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/json" \
    -F "filename=${name}" -F "file=@${file}" \
    ${ADMIN_ARGS[@]+"${ADMIN_ARGS[@]}"} \
    "${API}${url_path}"
}

# Collection responses are expected as {"items": [...]}; fall back to a bare array.
items() { jq -c '(.items // .) | if type == "array" then .[] else empty end'; }

urlenc() { jq -rn --arg s "$1" '$s | @uri'; }

# --- repository helpers ------------------------------------------------------

# item_by_path /PositLabs/Study/folder  -> item JSON (empty output if it does not exist)
item_by_path() {
  api_get "/repository/items?limit=1&filter=$(urlenc "eq(path,'$1')")" | items | head -n1
}

# child_by_name PARENT_ID NAME  -> item JSON (empty output if it does not exist)
child_by_name() {
  [[ "$1" == DRYRUN-* ]] && return 0   # parent was only planned in a dry run
  api_get "/repository/items/$1/children?limit=1&filter=$(urlenc "eq(name,'$2')")" | items | head -n1
}

# ensure_container PARENT_ID NAME TYPE [TYPE_ID] [DESCRIPTION]  -> prints the item id.
#   TYPE is FOLDER or CONTEXT (TYPE_ID is then required, e.g. study). Creates it if missing.
ensure_container() {
  local parent="$1" name="$2" type="$3" typeid="${4:-}" desc="${5:-}" existing id q
  existing=$(child_by_name "$parent" "$name" || true)
  if [[ -n "$existing" ]]; then
    id=$(jq -r '.id' <<<"$existing")
    log "exists:  $name ($id)"
    printf '%s' "$id"
    return
  fi
  q="name=$(urlenc "$name")&type=${type}"
  [[ -n "$typeid" ]] && q+="&typeId=$(urlenc "$typeid")"
  [[ -n "$desc"   ]] && q+="&description=$(urlenc "$desc")"
  log "create:  $name ($type${typeid:+/$typeid})"
  if [[ "$DRY_RUN" == 1 ]]; then
    api_send POST "/repository/items/${parent}/children?${q}"
    printf 'DRYRUN-%s' "$name"
    return
  fi
  api_send POST "/repository/items/${parent}/children?${q}" | jq -r '.id'
}

# role_by_name CONTEXT_ID NAME  -> role JSON (empty output if it does not exist)
role_by_name() {
  api_get "/roles?contextId=$1&limit=500" | items | jq -c --arg n "$2" 'select(.name == $n)' | head -n1
}
