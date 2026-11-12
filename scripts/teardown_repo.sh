#!/usr/bin/env bash
#
# Remove the demo project so the setup scripts can be run again from scratch.
# Run as the repository admin (viya_admin).
#
# PERMANENTLY deletes /PositDemo/SAS-Demo (or SAS_ORG_PATH/SAS_STUDY_NAME) with all files and
# versions (DELETE ?permanent=true). This server refuses to move contexts to the trash ("Context
# types cannot be logically deleted", HTTP 400), so there is no undo. Refuses to run without --yes,
# and refuses to touch anything that is not the project named by the variables above.
#
# Note: checked-out files in the project may block the delete; check them in or undo the
# check-out first.
#
# Usage:
#   ./scripts/teardown_repo.sh --yes [--dry-run]

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
parse_common_flags "$@"; set -- "${REST_ARGS[@]+"${REST_ARGS[@]}"}"
YES=0
case "${1:-}" in
  --yes)     YES=1 ;;
  "")        ;;
  -h|--help) sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *)         die "unknown option: $1 (try --help)" ;;
esac

STUDY_PATH="${SAS_ORG_PATH:-/PositDemo}/${SAS_STUDY_NAME:-SAS-Demo}"
item=$(item_by_path "$STUDY_PATH") || true
[[ -n "$item" ]] || { log "nothing to do: $STUDY_PATH does not exist"; exit 0; }

id=$(jq -r '.id' <<<"$item")
n=$(api_get "/repository/items?limit=1&filter=$(urlenc "startsWith(path,'${STUDY_PATH}/')")" | jq -r '.count // 0')
log "Target: $STUDY_PATH ($id), containing $n item(s)"
[[ "$YES" == 1 || "$DRY_RUN" == 1 ]] || die "refusing to delete without --yes"

api_send DELETE "/repository/items/${id}?permanent=true" >/dev/null
log "deleted permanently: $STUDY_PATH"
