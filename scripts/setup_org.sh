#!/usr/bin/env bash
#
# Create the top-level organization for the demo (default /PositDemo). Run as viya_admin.
# Idempotent. This is the only script that runs in admin mode: top-level organizations hang off
# the tenant root (repository item "1") and can only be created with the header
# "X-SAS-Clinical-Authorization: admin"; the creator becomes the owner. Content inside the
# organization (projects, folders, files) must then be created in normal user mode, which the
# other scripts do.
#
# It also creates the role "Manager" in the organization with every privilege and makes the
# administrator a member. Without it the administrator, although owner, would lack privileges
# such as Enable Versioning, which versioned uploads need. (Role changes are administrative, so
# they work in admin mode.)
#
# Variables (see lib.sh for server and authentication):
#   SAS_ORG_NAME     Name of the organization to create    (default: PositDemo)
#   SAS_ADMIN_USER   User to make Manager                  (default: viya_admin)
#
# Usage:
#   ./scripts/setup_org.sh [--dry-run]

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
use_admin_mode
parse_common_flags "$@"; set -- "${REST_ARGS[@]+"${REST_ARGS[@]}"}"
case "${1:-}" in
  "")        ;;
  -h|--help) sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *)         die "unknown option: $1 (try --help)" ;;
esac

ORG="${SAS_ORG_NAME:-PositDemo}"
TENANT_ID=1

ADMIN_USER="${SAS_ADMIN_USER:-viya_admin}"
JSON="application/json"

id=$(ensure_container "$TENANT_ID" "$ORG" CONTEXT organization "Demo organization")
log "organization /$ORG ($id)"

# --- role "Manager" with all privileges -------------------------------------------------------
role=$(role_by_name "$id" Manager || true)
if [[ -n "$role" ]]; then
  role_id=$(jq -r '.id' <<<"$role")
  log "exists:  role Manager ($role_id)"
else
  log "create:  role Manager"
  if [[ "$DRY_RUN" == 1 ]]; then
    api_send POST "/roles?contextId=${id}&name=Manager"
    role_id="DRYRUN-role"
  else
    role_id=$(api_send POST "/roles?contextId=${id}&name=Manager&description=$(urlenc "Full access for the demo administrator")" | jq -r '.id')
  fi
fi

all_privs=$(api_get "/roles/privileges?limit=500" | items | jq -s '[.[].id]')
have=$([[ "$role_id" == DRYRUN-* ]] && echo '[]' || { api_get "/roles/${role_id}/privileges?limit=500" | items | jq -s '[.[].id]'; })
missing=$(jq -cn --argjson a "$all_privs" --argjson h "$have" '$a - $h')
if [[ "$(jq 'length' <<<"$missing")" == 0 ]]; then
  log "exists:  Manager already has all $(jq 'length' <<<"$all_privs") privileges"
else
  log "grant:   $(jq 'length' <<<"$missing") privileges to Manager"
  api_send PATCH "/roles/${role_id}/privileges" "$JSON" \
    "$(jq -cn --argjson p "$missing" '{version: 1, addPrivileges: $p}')" \
    "$([[ "$role_id" == DRYRUN-* ]] || api_etag "/roles/${role_id}")" >/dev/null
fi

if [[ "$role_id" != DRYRUN-* ]] \
   && api_get "/roles/${role_id}/members?limit=500" | items | jq -e --arg u "$ADMIN_USER" 'select(.id == $u)' >/dev/null; then
  log "exists:  $ADMIN_USER is a Manager"
else
  log "add:     $ADMIN_USER to Manager"
  api_send PATCH "/roles/${role_id}/members?action=UPDATE_MEMBERS" "$JSON" \
    "$(jq -cn --arg u "$ADMIN_USER" '{version: 1, addMembers: [{version: 1, id: $u, typeId: "user"}]}')" \
    "$([[ "$role_id" == DRYRUN-* ]] || api_etag "/roles/${role_id}")" >/dev/null
fi

log "done. Next: SAS_ORG_PATH=/$ORG ./scripts/setup_repo.sh"
