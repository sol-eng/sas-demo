#!/usr/bin/env bash
#
# Show audit trail entries and job/lineage items for the demo project. Read-only.
#
# Lists the audit entries for everything under the project path (newest first), then the
# clinicalJob and clinicalJobManifest items in the project. On this server a job (type
# clinicalJob) is the repository object that is "run" (audit action "ran") and whose
# associations tie a program to its inputs and outputs; each run leaves a manifest
# (clinicalJobManifest).
#
# Variables (see lib.sh for server and authentication):
#   SAS_ORG_PATH, SAS_STUDY_NAME   As in setup_repo.sh   (default: /PositDemo, SAS-Demo)
#
# Usage:
#   ./scripts/show_audit.sh [--user NAME] [--action ACTION] [--limit N] [--json]
#     --user NAME     only entries by this user id (e.g. demouser)
#     --action ACTION only this audit action (e.g. checkedIn, checkedOut, ran)
#     --limit N       number of entries to show (default 50, max 500)
#     --json          raw JSON entries instead of a table
#
# Valid actions: GET /audit/actions (e.g. created, downloaded, checkedOut, checkedIn,
# undoCheckedOut, ran, associated, aclUpdated, locked, unlocked, signed).

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

USER_FILTER="" ACTION_FILTER="" LIMIT=50 JSON=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)    USER_FILTER="${2:?--user needs a value}"; shift 2 ;;
    --action)  ACTION_FILTER="${2:?--action needs a value}"; shift 2 ;;
    --limit)   LIMIT="${2:?--limit needs a value}"; shift 2 ;;
    --json)    JSON=1; shift ;;
    -h|--help) sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)         die "unknown option: $1 (try --help)" ;;
  esac
done

STUDY_PATH="${SAS_ORG_PATH:-/PositDemo}/${SAS_STUDY_NAME:-SAS-Demo}"

filter="startsWith(sourceLocation,'${STUDY_PATH}')"
[[ -n "$USER_FILTER"   ]] && filter="and(${filter},eq(userId,'${USER_FILTER}'))"
[[ -n "$ACTION_FILTER" ]] && filter="and(${filter},eq(action,'${ACTION_FILTER}'))"

entries=$(api_get "/audit/entries?limit=${LIMIT}&filter=$(urlenc "$filter")" | items)

if [[ "$JSON" == 1 ]]; then
  jq -s . <<<"${entries:-}"
  exit 0
fi

echo "== Audit entries under $STUDY_PATH (newest first)"
if [[ -n "$entries" ]]; then
  jq -r '[.timestamp, .userId, .action, "\(.sourceLocation)/\(.sourceName)"] | @tsv' <<<"$entries" | column -t -s $'\t'
else
  echo "  (none)"
fi

echo
echo "== Jobs and manifests (lineage)"
jobs=$(api_get "/repository/items?limit=500&filter=$(urlenc "and(startsWith(path,'${STUDY_PATH}/'),in(typeId,'clinicalJob','clinicalJobManifest'))")" | items || true)
if [[ -n "$jobs" ]]; then
  jq -r '[.path, .typeId, (.fileVersion // "-"), .modifiedBy, .modifiedTimeStamp] | @tsv' <<<"$jobs" | column -t -s $'\t'
else
  echo "  (none yet - jobs are created and run from the repository UI / computing environment)"
fi
