# Copy to scripts/env.sh (which is git-ignored), fill in, then: source scripts/env.sh
# Use viya_admin for setup_*.sh / teardown_repo.sh; switch SAS_USER to demouser to test as that user.
export SAS_BASE_URL="https://your-viya-host"
export SAS_CLIENT_ID="sas.cli"        # built-in client; the secret is usually empty
# export SAS_CLIENT_SECRET=""
export SAS_USER="viya_admin"
export SAS_PASSWORD="change-me"       # or leave unset to be prompted
