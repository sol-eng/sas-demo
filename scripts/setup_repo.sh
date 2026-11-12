#!/usr/bin/env bash
#
# Create the demo project in the SAS Clinical Acceleration Repository and load the data.
# Run as the repository admin (viya_admin). Idempotent: existing items are left alone.
#
# Creates (default names):
#   /PositDemo/SAS-Demo                  project context   (SAS_ORG_PATH / SAS_STUDY_NAME)
#   /PositDemo/SAS-Demo/data/sdtm        folder, receives large_study_data.sas7bdat (versioned, 1.0)
#   /PositDemo/SAS-Demo/programs         folder, receives the starter program (versioned, 1.0)
#   /PositDemo/SAS-Demo/outputs          folder, for results written by program runs
#
# Variables (see lib.sh for server and authentication):
#   SAS_ORG_PATH       Parent organization path          (default: /PositDemo)
#   SAS_STUDY_NAME     Name of the context to create     (default: SAS-Demo)
#   SAS_CONTEXT_TYPE   Type id of the context            (default: project; "study" is not
#                      allowed directly under an organization on this server)
#   SAS_DATA_FILE      Local sas7bdat to upload          (default: ./large_study_data.sas7bdat)
#   SAS_PROGRAM_FILE   Local starter program to upload   (default: ./sas/test.sas; skipped if absent)
#
# Usage:
#   ./scripts/setup_repo.sh [--dry-run]
#
# The data file is written on the SAS server by sas/create_data.sas; copy it here first, e.g.
#   scp <sas-host>:~/sas-demo/large_study_data.sas7bdat .

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
parse_common_flags "$@"; set -- "${REST_ARGS[@]+"${REST_ARGS[@]}"}"
case "${1:-}" in
  "")        ;;
  -h|--help) sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *)         die "unknown option: $1 (try --help)" ;;
esac

ORG_PATH="${SAS_ORG_PATH:-/PositDemo}"
STUDY="${SAS_STUDY_NAME:-SAS-Demo}"
CTX_TYPE="${SAS_CONTEXT_TYPE:-project}"
DATA_FILE="${SAS_DATA_FILE:-./large_study_data.sas7bdat}"
PROGRAM_FILE="${SAS_PROGRAM_FILE:-./sas/test.sas}"

[[ -f "$DATA_FILE" ]] || die "data file not found: $DATA_FILE (set SAS_DATA_FILE; see --help)"

# upload_if_missing FOLDER_ID LOCAL_FILE COMMENT
upload_if_missing() {
  local folder="$1" file="$2" comment="$3" name existing
  name=$(basename "$file")
  existing=$(child_by_name "$folder" "$name" || true)
  if [[ -n "$existing" ]]; then
    log "exists:  $name ($(jq -r '.fileVersion // "?"' <<<"$existing"))"
    return
  fi
  log "upload:  $name -> versioned 1.0"
  api_upload "/repository/items/${folder}/content?name=$(urlenc "$name")&fileVersion=MAJOR&comment=$(urlenc "$comment")" \
    "$file" "$name" >/dev/null
}

org=$(item_by_path "$ORG_PATH") || true
[[ -n "$org" ]] || die "organization not found: $ORG_PATH"
org_id=$(jq -r '.id' <<<"$org")
log "organization: $ORG_PATH ($org_id)"

study_id=$(ensure_container "$org_id" "$STUDY" CONTEXT "$CTX_TYPE" "Demo: SAS code with audit trail and lineage")
data_id=$(ensure_container "$study_id" data FOLDER)
sdtm_id=$(ensure_container "$data_id" sdtm FOLDER)
prog_id=$(ensure_container "$study_id" programs FOLDER)
ensure_container "$study_id" outputs FOLDER >/dev/null

upload_if_missing "$sdtm_id" "$DATA_FILE" "Initial load of simulated study data"
if [[ -f "$PROGRAM_FILE" ]]; then
  upload_if_missing "$prog_id" "$PROGRAM_FILE" "Starter program"
else
  log "skip:    starter program not found ($PROGRAM_FILE)"
fi

log "done. Next: ./scripts/setup_users.sh"
