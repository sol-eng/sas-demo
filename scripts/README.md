# Clinical Acceleration demo scripts

Bash scripts that set up a demo organization and project in the SAS Clinical Acceleration Repository
(REST API) and inspect it afterwards. `viya_admin` builds the project; `demouser` writes and runs the SAS code.

## Setup

```bash
cp scripts/env.example.sh scripts/env.sh   # git-ignored; fill in server and credentials
source scripts/env.sh                      # as viya_admin
scp <sas-host>:~/sas-demo/large_study_data.sas7bdat .   # written by sas/create_data.sas
```

Requires `curl` and `jq`. Every script supports `--help`; the setup scripts also support
`--dry-run` (reads run, writes are only printed).

| Script | Run as | Purpose |
|---|---|---|
| `setup_org.sh` | viya_admin | Create the top-level organization `/PositDemo` (admin mode) with a `Manager` role holding all privileges, and make viya_admin a Manager |
| `setup_repo.sh` | viya_admin | Create project `/PositDemo/SAS-Demo` with `data/sdtm`, `programs`, `outputs`; upload the data and a starter program as versioned files |
| `setup_users.sh` | viya_admin | Add `demouser` to the project, create the `Programmer` role with all privileges, give demouser read/write/delete on every item |
| `verify_setup.sh` | viya_admin | Print tree, members, roles, demouser's Viya groups, permissions and check them |
| `show_audit.sh` | viya_admin | Audit entries for the project plus jobs and manifests |
| `teardown_repo.sh` | viya_admin | Permanently delete the project (`--yes` required; projects cannot go to the trash) |
| `list_roles.sh` | viya_admin | List privileges, and roles per context |
| `lib.sh` | - | Shared helpers (auth, HTTP, repository lookups) |

Order: `setup_org.sh` -> `setup_repo.sh` -> `setup_users.sh` -> `verify_setup.sh`. All are idempotent.

## What the setup gives demouser

viya_admin owns the organization, the project and every item in it (the server makes the context
owner the owner of new items, even of files demouser creates). demouser gets:

- Read, write and delete ALLOW (admin UNSET, so no permission changes) on the project and every
  item in it: create, check out, check in and delete files anywhere, including `data/`. On
  containers the entry goes into both the current and the default ACL, so files created later
  (check-ins, job outputs) inherit it.
- The `Programmer` role with every privilege the server offers (Enable/Manage Versioning, Manage
  State, Manage Membership, Restore, Permanently Delete, Manage Locking, Manage Roles, Sign Files,
  Propagate Permissions). Enable Versioning is the one check-in strictly needs. Restrict with
  `SAS_PROGRAMMER_PRIVILEGES=PRIVILEGE_A,PRIVILEGE_B` (privileges are only added, never removed).
- No Viya administrator groups. Group membership is managed in Viya identities, not by these
  scripts; `verify_setup.sh` fails if demouser is in any group ending in `Administrators`
  (`SASAdministrators`, `ClinicalAdministrators`, `ClinicalJobAdministrators`,
  `ClinicalWorkflowAdministrators`), because those grant rights beyond the item permissions above.
  demouser was removed from the three Clinical*Administrators groups on 2026-11-11.

## Runbook for demouser (manual: not exposed in the REST API)

The REST API has no check-out, check-in or run operation; do these in the repository UI and SAS
Studio / the computing environment as `demouser`.

1. Open `/PositDemo/SAS-Demo/programs`, check out the starter program, edit it, check it in with a
   version comment. Each step appears in the audit trail (`checkedOut`, `downloaded`, `checkedIn`).
2. **Reading repository data from SAS code (verified):** the repository is not mounted, but your
   workspace is, at `/clinical/workspaces`, mirroring the repository path. Copy the dataset to
   the workspace first (repository tree: Copy to workspace, Latest version), then:

   ```sas
   %let repo_path = "/clinical/workspaces/PositDemo/SAS-Demo/data/sdtm/";
   libname demo &repo_path;
   ```

   `_SASWS_` does not help in SAS Studio: Studio sets it to the WORK folder in its generated
   preamble. Programs run from the workspace, not from the repository.
3. Run it through a **clinical job** in SAS Clinical Job Management (Applications menu, "Manage
   Clinical Jobs"; admin guide, chapter 16; verified on this server 2026-11-11). Ad hoc Studio runs
   are not tracked. The job declares its programs, inputs (file/folder parameters or Publish Setup)
   and the check-in folders (`outputs/`); code runs inside PROC SCAPROC, which records inputs and
   outputs in the `.cmnf` manifest. "Test" runs write only log, listing and manifest and create no
   audit records; a run from the repository writes the audit action `ran`, keeps a run history and
   checks outputs in. Do not hardcode `/clinical/workspaces` in job programs (the guide says to
   use `_SASWS_` there, which maps to the job's workspace); do not call PROC SCAPROC yourself.
   Checking in outputs needs Write on the output folders and, for versioned output, Enable
   Versioning (granted to the Programmer role).

   **Declare the dataset as input, or a run from the repository cannot find it.** Such a run
   gets a fresh transient workspace (`_SASWS_` points there) and only the job's declared inputs
   are synchronized into it: Publish Setup files/folders, file/folder parameters, and the
   Internal tab. Without it the log shows `NOTE: Library DEMO does not exist.` and
   `ERROR: File DEMO.LARGE_STUDY_DATA.DATA does not exist.` Fix (verified): open the job,
   Publish Setup -> Files -> Add file -> `PositDemo/SAS-Demo/data/sdtm/large_study_data.sas7bdat`,
   Save (optionally pin a version; default is the latest at run time). The alternative
   "Run and populate" fills Publish Setup from what SCAPROC saw, but replaces the existing entries
   and removes all Check-in Options, so `outputs/` has to be added back by hand.
4. As `viya_admin`: `./scripts/show_audit.sh --user demouser` shows the activity, and the
   "Jobs and manifests" section lists the job and manifest items.

## Known quirks of this server

- **Current and default ACLs:** containers have a current ACL (`GET/PATCH .../permissions`) and a
  default ACL (`.../permissions?current=false`); a new item copies the default ACL of its folder
  (admin guide, "Current and Default Access Permissions"). Changing a folder's current ACL does
  not touch existing children, also not with `propagate=true`.
- `/clinicalRepository/authorizations/{id}/permissions` returns the caller's effective rights
  (e.g. `["READ","WRITE",...]`); it ignores user parameters, so only the user can see their own.
- **Admin mode:** the header `X-SAS-Clinical-Authorization: admin` (what the admin UI sends for a
  member of SASAdministrators) is needed to create top-level organizations (parent = tenant root,
  item id `1`) and to manage roles. In admin mode the server refuses to create content ("cannot
  perform this action as an administrator"), so only `setup_org.sh` uses it.
- Even `viya_admin` has only ordinary user rights otherwise: no write on `/PositLabs` (owned by
  samiul). Privileges such as Enable Versioning, needed for versioned uploads, come from roles.
- PATCH requests (members, privileges, permissions) take `Content-Type: application/json` and an
  `If-Match` ETag; the `application/vnd.sas.clinical.*.update` types from the spec give HTTP 415.
- A project can only take members who already belong to its parent organization.
- `/roles/{id}/privileges` returned HTTP 500 for the `Manager` role in `/PositLabs`; it works for
  roles created by these scripts.

- Send `Accept: application/vnd.sas.collection+json`; with `application/json`,
  `/roles/privileges` is treated as a role id and returns 404.
- `limit` maximum is 500; `/roles` needs `?contextId=`.
- A `study` context cannot be created directly under an organization; `project` can.
- **Allowed file types:** the repository only accepts the extensions in `allowedFileExtensions`
  (config `sas.clinical.repository`, edited in SAS Environment Manager). The default list here is
  `sas, sas7bdat, sas7bcat, xpt, pdf, txt, zip, docx, xlsx, rtf, xml, log, lst, cjob, cmnf, py,
  csv, xls, <NONE>`: no `png`, so checking in a PNG fails with "file extension is not allowed".
  `sas/test.sas` therefore writes its plot as PDF (ODS PDF) to `outputs/`.
