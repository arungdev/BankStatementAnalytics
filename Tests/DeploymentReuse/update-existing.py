"""Read saved deployment settings without executing .env or prompting."""
import os
from pathlib import Path
import subprocess
import tempfile

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    (root / 'deploy/common').mkdir(parents=True)
    (root / 'secrets').mkdir()
    (root / 'docker-compose.yml').write_text('# synthetic\n')
    (root / 'deploy/google-compose.yml').write_text('# synthetic\n')
    (root / 'secrets/db_password.txt').write_text('synthetic-db')
    (root / 'secrets/google_client_secret.txt').write_text('synthetic-secret')
    original = 'APP_DOMAIN=billing.example.com\nACME_EMAIL=admin@example.com\nGOOGLE_CLIENT_ID=synthetic.apps.googleusercontent.com\nUNTRUSTED=$(touch injected)\n'
    (root / '.env').write_text(original)
    (root / 'deploy/common/session-deploy.sh').write_text('set -eu\n[[ "$DEPLOY_REUSE_SETTINGS" == true ]]\nprintf "%s\\n" "$@"\n')
    script = '/work/deploy/common/update-existing.sh'
    result = subprocess.run(['bash', script, '4.0.0', '18080'], cwd=root, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert 'billing.example.com\nadmin@example.com\n4.0.0\n18080\nunified' in result.stdout
    assert (root / '.env').read_text() == original
    assert not (root / 'injected').exists()
    (root / '.env').write_text('APP_DOMAIN=invalid\nACME_EMAIL=admin@example.com\n')
    result = subprocess.run(['bash', script, '4.0.0', '18080'], cwd=root, capture_output=True, text=True)
    assert result.returncode != 0
print('PASS: saved settings reused, no prompts, .env unchanged and never executed, invalid saved settings rejected.')
