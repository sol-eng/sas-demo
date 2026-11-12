#!/usr/bin/env bash
#
# Show the state of the demo project and check it against what setup_repo.sh / setup_users.sh
# should have produced. Read-only.
#
# Prints: the item tree (type, version, check-out state), project members, the Programmer role
# and its members, the programmer user's Viya groups, and that user's permissions on every
# item. Exits non-zero if an expectation is not met.
#
# Group check: the programmer user must not be in an administrator group (any group whose id
# ends in "Administrators", e.g. SASAdministrators, ClinicalAdministrators,
# ClinicalJobAdministrators). Such groups grant rights outside the item permissions set here,
# which would make the restricted-programmer setup meaningless. Nested groups count.
#
# Expected for the programmer user: in the role Programmer, which holds every privilege, and
# read/write/delete ALLOW, admin UNSET on the project and every item in it. Run as viya_admin.
#
# Variables (see lib.sh for server and authentication):
#   SAS_ORG_PATH, SAS_STUDY_NAME, SAS_PROGRAMMER_USER   As in setup_users.sh
#
# Usage:
#   ./scripts/verify_setup.sh

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

case "${1:-}" in
  "")            ;;
  -h|--help)     sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *)             die "unknown option: $1 (try --help)" ;;
esac

STUDY_PATH="${SAS_ORG_PATH:-/PositDemo}/${SAS_STUDY_NAME:-SAS-Demo}"
USER_ID="${SAS_PROGRAMMER_USER:-demouser}"
FAIL=0
check() {  # check DESCRIPTION CONDITION_EXIT_CODE
  if [[ "$2" == 0 ]]; then echo "  PASS  $1"; else echo "  FAIL  $1"; FAIL=1; fi
}

study=$(item_by_path "$STUDY_PATH") || true
[[ -n "$study" ]] || die "project not found: $STUDY_PATH (or no read access)"
study_id=$(jq -r '.id' <<<"$study")
echo "Project: $STUDY_PATH ($study_id, type $(jq -r '.typeId' <<<"$study"))"

echo; echo "== Items"
children=$(api_get "/repository/items?limit=500&sortBy=path&filter=$(urlenc "startsWith(path,'${STUDY_PATH}/')")" | items)
jq -r '[.path, .typeId, (.fileVersion // "-"), (if .checkedOut then "checked out by \(.checkedOutBy)" else "" end)] | @tsv' <<<"$children" \
  | column -t -s $'\t'

echo; echo "== Project members"
api_get "/memberships/${study_id}/members?limit=500" | items | jq -r '"  \(.typeId)\t\(.id)"' | column -t -s $'\t'

echo; echo "== Roles"
role=$(role_by_name "$study_id" Programmer || true)
if [[ -n "$role" ]]; then
  role_id=$(jq -r '.id' <<<"$role")
  echo "  Programmer ($role_id), members:"
  api_get "/roles/${role_id}/members?limit=500" | items | jq -r '"    \(.typeId)\t\(.id)"' | column -t -s $'\t'
  all_privs=$(api_get "/roles/privileges?limit=500" | items | jq -s -c '[.[].id] | sort')
  have_privs=$(api_get "/roles/${role_id}/privileges?limit=500" | items | jq -s -c '[.[].id] | sort')
  missing=$(jq -rn --argjson a "$all_privs" --argjson h "$have_privs" '$a - $h | join(", ")')
  check "Programmer holds all $(jq length <<<"$all_privs") privileges${missing:+ (missing: ${missing})}" \
    "$([[ -z "$missing" ]] && echo 0 || echo 1)"
else
  check "Programmer role exists" 1
fi

echo; echo "== Viya groups of ${USER_ID} (incl. nested)"
if groups=$(viya_get "/identities/users/$(urlenc "$USER_ID")/memberships?limit=500&depth=-1" 2>/dev/null \
            | items | jq -r '.id'); then
  if [[ -n "$groups" ]]; then sed 's/^/  /' <<<"$groups"; else echo "  (none)"; fi
  admin_groups=$(grep -E 'Administrators$' <<<"$groups" | paste -sd, - || true)
  rc=0; [[ -z "$admin_groups" ]] || rc=1
  check "${USER_ID} is in no administrator group${admin_groups:+ (found: ${admin_groups})}" "$rc"
else
  echo "  WARN  could not read group memberships of ${USER_ID} (no permission?); not checked"
fi

echo; echo "== Permissions of ${USER_ID}   (r/w/d/a)"
perm_line() {  # perm_line ITEM_ID [QUERY] -> "R W D A" for USER_ID, or "-" when no entry
  api_get "/repository/items/$1/permissions${2:-}" application/json 2>/dev/null \
    | jq -r --arg u "$USER_ID" '[.entries[]? | select(.principal.id == $u)][0]
        | if . then "\(.readPermission) \(.writePermission) \(.deletePermission) \(.adminPermission)" else "-" end' || echo "?"
}
rows=$( { jq -c '{path, id, primaryType}' <<<"$study"; jq -c '{path, id, primaryType}' <<<"$children"; } )
while read -r row; do
  path=$(jq -r '.path' <<<"$row"); id=$(jq -r '.id' <<<"$row")
  got=$(perm_line "$id")
  want="ALLOW ALLOW ALLOW UNSET"
  rc=0; [[ "$got" == "$want" ]] || rc=1
  check "$(printf '%-52s %s' "$path" "$got")" "$rc"
  # containers: the default ACL is what items created later inherit
  if [[ "$(jq -r '.primaryType' <<<"$row")" != FILE ]]; then
    got=$(perm_line "$id" "?current=false")
    rc=0; [[ "$got" == "$want" ]] || rc=1
    check "$(printf '%-52s %s' "$path (default)" "$got")" "$rc"
  fi
done <<<"$rows"

echo; echo "== Versioning"
files=$(jq -c 'select(.primaryType == "FILE")' <<<"$children")
if [[ -n "$files" ]]; then
  while read -r f; do
    rc=0; [[ "$(jq -r '.versioned' <<<"$f")" == true ]] || rc=1
    check "$(jq -r '"\(.path) is versioned (\(.fileVersion))"' <<<"$f")" "$rc"
  done <<<"$files"
else
  echo "  (no files)"
fi

echo
if [[ "$FAIL" == 0 ]]; then echo "All checks passed."; else echo "Some checks FAILED."; exit 1; fi
