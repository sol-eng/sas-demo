#!/usr/bin/env bash
#
# List roles and privileges from the SAS Clinical Acceleration Repository REST API.
#
# Read-only: only issues GET requests.
#
# Configuration and authentication: see lib.sh. Extra variable:
#   SAS_CONTEXT_ID     Only list roles of this context id (default: every CONTEXT item).
#
# Usage:
#   ./scripts/list_roles.sh              # human-readable: role -> privileges
#   ./scripts/list_roles.sh --json       # raw JSON for all roles and privileges
#   ./scripts/list_roles.sh --privileges # only the list of all available privileges
#
# Requires: curl, jq

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

MODE="table"
case "${1:-}" in
  --json)       MODE="json" ;;
  --privileges) MODE="privileges" ;;
  "")           ;;
  -h|--help)    sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *)            echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
esac

# Contexts (organizations, studies, ...) whose roles to list.
# Override with SAS_CONTEXT_ID (a single id); otherwise all CONTEXT items are used.
# Output: one "id<TAB>path" per line.
contexts() {
  if [[ -n "${SAS_CONTEXT_ID:-}" ]]; then
    printf '%s\t%s\n' "$SAS_CONTEXT_ID" "(SAS_CONTEXT_ID)"
    return
  fi
  api_get "/repository/items?limit=200&filter=eq(primaryType,'CONTEXT')" \
    | items | jq -r '[.id, .path] | @tsv'
}

# All privileges that can be assigned to a role, as a JSON array.
all_privileges() { api_get "/roles/privileges?limit=500" | items | jq -s .; }

# Privileges of one role as a JSON array. Some servers answer 500 here; return [] then.
role_privileges() {
  local out
  if out=$(api_get "/roles/$1/privileges?limit=500" 2>/dev/null); then
    items <<<"$out" | jq -s .
  else
    echo "warning: GET /roles/$1/privileges failed (server error); privileges unknown" >&2
    echo '[]'
  fi
}

# Roles assigned in one context, as JSON lines.
context_roles() { api_get "/roles?contextId=$1&limit=500" | items; }

case "$MODE" in
  privileges)
    all_privileges | jq .
    ;;

  json)
    out=$(jq -n --argjson privileges "$(all_privileges)" '{privileges: $privileges, contexts: []}')
    while IFS=$'\t' read -r cid cpath; do
      roles='[]'
      while read -r role; do
        id=$(jq -r '.id' <<<"$role")
        roles=$(jq --argjson r "$role" --argjson p "$(role_privileges "$id")" \
                   '. + [$r + {privileges: $p}]' <<<"$roles")
      done < <(context_roles "$cid")
      out=$(jq --arg id "$cid" --arg path "$cpath" --argjson roles "$roles" \
               '.contexts += [{id: $id, path: $path, roles: $roles}]' <<<"$out")
    done < <(contexts)
    jq . <<<"$out"
    ;;

  table)
    echo "== All available privileges =="
    all_privileges | jq -r '.[] | "\(.id)\t\(.name // "")"'
    while IFS=$'\t' read -r cid cpath; do
      echo
      echo "== Roles in context ${cpath} (${cid}) =="
      while read -r role; do
        id=$(jq -r '.id' <<<"$role")
        name=$(jq -r '.name // .id' <<<"$role")
        echo "-- ${name} (${id})"
        role_privileges "$id" | jq -r '.[] | "   " + (.name // .id)'
      done < <(context_roles "$cid")
    done < <(contexts)
    ;;
esac
