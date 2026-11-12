#!/usr/bin/env bash
#
# Give the programmer user access to the demo project. Run as the repository admin (viya_admin)
# after setup_repo.sh. Idempotent.
#
# What it does:
#   1. Makes the user a member of the organization and of the project context (needed to see
#      the project at all).
#   2. Creates the role "Programmer" in the project and adds the user to it.
#      The role gets every privilege the server offers (Enable/Manage Versioning, Permanently
#      Delete, Manage Locking, ...) unless SAS_PROGRAMMER_PRIVILEGES says otherwise.
#   3. Sets item permissions for the user on the project and every item in it:
#        read ALLOW, write ALLOW, delete ALLOW, admin UNSET
#      on containers in both the current and the default ACL, so items created later
#      (check-ins of new files, job outputs) get the same entry.
#      so the user can create, check out, check in and delete files anywhere in the project,
#      but cannot change permissions (admin).
#
# Variables (see lib.sh for server and authentication):
#   SAS_ORG_PATH, SAS_STUDY_NAME   As in setup_repo.sh   (default: /PositDemo, SAS-Demo)
#   SAS_PROGRAMMER_USER            User to set up        (default: demouser)
#   SAS_PROGRAMMER_PRIVILEGES      Comma-separated privilege ids to grant the role
#                                  (default: all; empty = none). Privileges are only added,
#                                  never removed.
#
# Usage:
#   ./scripts/setup_users.sh [--dry-run]

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
parse_common_flags "$@"; set -- "${REST_ARGS[@]+"${REST_ARGS[@]}"}"
case "${1:-}" in
  "")        ;;
  -h|--help) sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *)         die "unknown option: $1 (try --help)" ;;
esac

STUDY_PATH="${SAS_ORG_PATH:-/PositDemo}/${SAS_STUDY_NAME:-SAS-Demo}"
USER_ID="${SAS_PROGRAMMER_USER:-demouser}"
ROLE_NAME="Programmer"

PRINCIPAL=$(jq -cn --arg id "$USER_ID" '{version: 1, id: $id, typeId: "user"}')
MEMBERS_CT="application/json"
PERMS_CT="application/json"

study=$(item_by_path "$STUDY_PATH") || true
[[ -n "$study" ]] || die "project not found: $STUDY_PATH (run ./scripts/setup_repo.sh first)"
study_id=$(jq -r '.id' <<<"$study")
log "project: $STUDY_PATH ($study_id), user: $USER_ID"

# --- 1. membership: organization first, then project ------------------------------------------
# A project can only take members that already belong to its parent organization.
ensure_member() {  # ensure_member CONTEXT_ID LABEL
  if api_get "/memberships/${1}/members?limit=500" | items | jq -e --arg u "$USER_ID" 'select(.id == $u)' >/dev/null; then
    log "exists:  $USER_ID is a member of $2"
  else
    log "add:     $USER_ID as member of $2"
    api_send PATCH "/memberships/${1}/members?action=UPDATE_MEMBERS" "$MEMBERS_CT" \
      "$(jq -cn --argjson p "$PRINCIPAL" '{version: 1, addMembers: [$p]}')" \
      "$(api_etag "/memberships/${1}")" >/dev/null
  fi
}
org=$(item_by_path "$(dirname "$STUDY_PATH")") || true
[[ -n "$org" ]] || die "organization not found: $(dirname "$STUDY_PATH")"
ensure_member "$(jq -r '.id' <<<"$org")" "$(dirname "$STUDY_PATH")"
ensure_member "$study_id" "$STUDY_PATH"

# --- 2. role -----------------------------------------------------------------
role=$(role_by_name "$study_id" "$ROLE_NAME" || true)
if [[ -n "$role" ]]; then
  role_id=$(jq -r '.id' <<<"$role")
  log "exists:  role $ROLE_NAME ($role_id)"
else
  log "create:  role $ROLE_NAME"
  if [[ "$DRY_RUN" == 1 ]]; then
    api_send POST "/roles?contextId=${study_id}&name=${ROLE_NAME}&description=$(urlenc "Writes and runs SAS programs")"
    role_id="DRYRUN-role"
  else
    role_id=$(api_send POST "/roles?contextId=${study_id}&name=${ROLE_NAME}&description=$(urlenc "Writes and runs SAS programs")" \
              | jq -r '.id')
  fi
fi

if [[ "$role_id" != DRYRUN-* ]] \
   && api_get "/roles/${role_id}/members?limit=500" | items | jq -e --arg u "$USER_ID" 'select(.id == $u)' >/dev/null; then
  log "exists:  $USER_ID is in role $ROLE_NAME"
else
  log "add:     $USER_ID to role $ROLE_NAME"
  api_send PATCH "/roles/${role_id}/members?action=UPDATE_MEMBERS" "$MEMBERS_CT" \
    "$(jq -cn --argjson p "$PRINCIPAL" '{version: 1, addMembers: [$p]}')" \
    "$([[ "$role_id" == DRYRUN-* ]] || api_etag "/roles/${role_id}")" >/dev/null
fi

# Privileges the role should hold. Set SAS_PROGRAMMER_PRIVILEGES= (empty) to grant none.
# Re-adding a privilege the role already has returns HTTP 409, so only the missing ones are sent.
if [[ "${SAS_PROGRAMMER_PRIVILEGES-all}" == all ]]; then
  want=$(api_get "/roles/privileges?limit=500" | items | jq -s -c '[.[].id]')
else
  want=$(jq -cn --arg p "$SAS_PROGRAMMER_PRIVILEGES" '$p | split(",") | map(select(length > 0))')
fi
have=$([[ "$role_id" == DRYRUN-* ]] && echo '[]' || { api_get "/roles/${role_id}/privileges?limit=500" | items | jq -s '[.[].id]'; })
missing=$(jq -cn --argjson w "$want" --argjson h "$have" '$w - $h')
if [[ "$(jq 'length' <<<"$missing")" == 0 ]]; then
  log "exists:  role $ROLE_NAME privileges up to date ($(jq -r 'join(", ")' <<<"$have"))"
else
  log "grant:   role privileges $(jq -r 'join(", ")' <<<"$missing")"
  api_send PATCH "/roles/${role_id}/privileges" "application/json" \
    "$(jq -cn --argjson p "$missing" '{version: 1, addPrivileges: $p}')" \
    "$([[ "$role_id" == DRYRUN-* ]] || api_etag "/roles/${role_id}")" >/dev/null
fi

# --- 3. item permissions -----------------------------------------------------
# Containers (project, folders) have two ACLs: "current" (the container itself) and "default"
# (copied to every item created in it later: uploads, check-ins of new files, job outputs).
# GET/PATCH .../permissions is the current one, ...?current=false the default one. Files only
# have a current ACL. Without the default entry, files created after this script runs only get
# Owner and Members (read) and the user could not change or delete them.

# set_permission ITEM_ID READ WRITE DELETE ADMIN [QUERY]   QUERY: "" or "?current=false"
set_permission() {
  local id="$1" r="$2" w="$3" d="$4" a="$5" q="${6:-}" key entry acl
  entry=$(jq -cn --argjson p "$PRINCIPAL" --arg r "$r" --arg w "$w" --arg d "$d" --arg a "$a" \
    '{version: 1, principal: $p, readPermission: $r, writePermission: $w, deletePermission: $d, adminPermission: $a}')
  acl=$(api_get "/repository/items/${id}/permissions${q}" application/json)
  if jq -e --arg u "$USER_ID" --arg r "$r" --arg w "$w" --arg d "$d" --arg a "$a" \
       '.entries[]? | select(.principal.id == $u and .readPermission == $r and .writePermission == $w
                             and .deletePermission == $d and .adminPermission == $a)' <<<"$acl" >/dev/null; then
    echo same; return 0
  fi
  if jq -e --arg u "$USER_ID" '.entries[]? | select(.principal.id == $u)' <<<"$acl" >/dev/null; then
    key=updates
  else
    key=additions
  fi
  api_send PATCH "/repository/items/${id}/permissions${q}" "$PERMS_CT" \
    "$(jq -cn --arg k "$key" --argjson e "$entry" '{version: 1} + {($k): [$e]}')" >/dev/null \
    || die "permission update failed on item $id${q}"
  echo changed
}

apply() {  # apply ITEM_JSON READ WRITE DELETE ADMIN  -> current ACL, plus the default ACL for containers
  local id path result q label
  id=$(jq -r '.id' <<<"$1"); path=$(jq -r '.path' <<<"$1")
  for q in "" "?current=false"; do
    if [[ -n "$q" ]] && [[ "$(jq -r '.primaryType' <<<"$1")" == FILE ]]; then continue; fi
    label=$([[ -n "$q" ]] && echo "$path (default)" || echo "$path")
    result=$(set_permission "$id" "$2" "$3" "$4" "$5" "$q")
    if [[ "$result" == changed ]]; then log "perm:    $label  r=$2 w=$3 d=$4 a=$5"; else log "ok:      $label"; fi
  done
}

# Same rights on the project and everything in it.
apply "$study" ALLOW ALLOW ALLOW UNSET
while read -r item; do
  apply "$item" ALLOW ALLOW ALLOW UNSET
done < <(api_get "/repository/items?limit=500&filter=$(urlenc "startsWith(path,'${STUDY_PATH}/')")" | items)

log "done. Next: ./scripts/verify_setup.sh"
