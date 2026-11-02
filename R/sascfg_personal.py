"""saspy connection profiles for the SAS demo.

viya: SAS Viya over HTTP. In Posit Workbench the access token comes from the
      Workbench OAuth integration whose token URL is <VIYA_URL>/SASLogon/oauth/token,
      so nobody types a password. Sign in to that integration once from the
      Workbench home page (Managed Credentials).
ssh:  SAS on a remote Linux host over SSH.

Environment variables:
  VIYA_URL              SAS Viya base URL
  VIYA_COMPUTE_CONTEXT  compute context to start sessions in
  SAS_VIYA_TOKEN        use this access token instead of asking Workbench
"""

import os
import sys

SAS_config_names = ['viya', 'ssh']

_VIYA_URL = os.environ.get('VIYA_URL', 'https://viya.pcluster.soleng.posit.it').rstrip('/')


def _workbench_viya_token():
    token = os.environ.get('SAS_VIYA_TOKEN')
    if token:
        return token

    from posit.workbench import Client

    client = Client()
    token_url = _VIYA_URL + '/SASLogon/oauth/token'
    integration = next(
        (i for i in client.oauth.integrations.find()
         if (i.get('token_url') or '').rstrip('/') == token_url),
        None,
    )
    if integration is None:
        raise RuntimeError(
            f"No Posit Workbench OAuth integration has the token URL {token_url}. "
            "Ask the Workbench administrator to add one."
        )
    credentials = client.oauth.get_credentials(audience=integration['guid'])
    if not credentials or not credentials.get('access_token'):
        raise RuntimeError(
            f"Not signed in to '{integration.get('display_name') or integration['name']}'. "
            "Sign in from the Posit Workbench home page (Managed Credentials), then reconnect."
        )
    return credentials['access_token']


class _ViyaConfig(dict):
    # saspy reads the token with cfg.get('authtoken'). Fetching it here gives
    # every new SAS session a fresh token.
    def get(self, key, default=None):
        if key == 'authtoken':
            # saspy reads the config before it applies SASsession() keyword
            # arguments, so skip the lookup when the caller passed a token.
            caller_kwargs = sys._getframe(1).f_locals.get('kwargs') or {}
            if caller_kwargs.get('authtoken'):
                return None
            return _workbench_viya_token()
        return super().get(key, default)


viya = _ViyaConfig(
    url=_VIYA_URL,
    context=os.environ.get('VIYA_COMPUTE_CONTEXT', 'SAS Job Execution compute context'),
)

ssh = {'saspath': '/opt/sas/viya/home/SASFoundation/bin/sas_en',
       'ssh': '/usr/bin/ssh',
       'host': 'sas-ssh.pcluster.soleng.posit.it',
       'options': ["-fullstimer"]
       }
