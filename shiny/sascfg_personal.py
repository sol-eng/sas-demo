SAS_config_names = ['ssh', 'viya']

ssh      = {'saspath' : '/opt/sas/viya/home/SASFoundation/bin/sas_en',
            'ssh'     : '/usr/bin/ssh',
            'host'    : 'sas-ssh.pcluster.soleng.posit.it',
            'options' : ["-fullstimer"]
           }

viya = {
    'url':     'https://viya.pcluster.soleng.posit.it',
    'context': 'SAS Job Execution compute context',
}