"""PTY test for real hidden-input prompts; synthetic credentials only."""
import errno
import os
from pathlib import Path
import pty
import select
import subprocess
import tempfile
import time

workspace = Path('/work')
home = Path(tempfile.mkdtemp(prefix='google-cloud-setup-'))
root = home / 'synthetic'
(root / 'deploy').mkdir(parents=True)
(root / 'deploy' / 'google-compose.yml').write_text('# synthetic override\n')
(root / '.env').write_text('APP_VERSION=synthetic\nKEEP_THIS=yes\nGOOGLE_OWNER_EMAIL=legacy-owner@example.invalid\n')
script = (workspace / 'deploy/common/configure-google.sh').read_text()

def run(answers, reveal=False):
    master, slave = pty.openpty()
    proc = subprocess.Popen(['bash', '-c', script, '--', 'synthetic', 'app', '8080', 'https', str(home), 'prepare'], stdin=slave, stdout=slave, stderr=slave)
    os.close(slave)
    output = b''
    deadline = time.monotonic() + 25
    step = 0
    try:
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                try: chunk = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO: break
                    raise
                if not chunk: break
                output += chunk
                if step < len(answers) and answers[step][0].encode() in output:
                    os.write(master, (answers[step][1] + '\n').encode())
                    step += 1
            elif proc.poll() is not None: break
        if proc.poll() is None: proc.wait(timeout=3)
        assert proc.returncode == 0, output.decode(errors='replace')
        assert step == len(answers), 'A setup prompt was skipped'
        if reveal:
            assert b'synthetic-secret-do-not-echo' in output, 'Explicit view did not reveal saved secret'
        else:
            assert b'synthetic-secret-do-not-echo' not in output, 'Secret was echoed without choosing view'
    finally:
        if proc.poll() is None: proc.kill(); proc.wait()
        os.close(master)

run([('Google Client ID (sample:', 'synthetic.apps.googleusercontent.com'),
     ('Show Google Client Secret while entering?', 'n'),
     ('Google Client Secret (sample format:', 'synthetic-secret-do-not-echo')])
secret = root / 'secrets/google_client_secret.txt'
assert secret.read_text() == 'synthetic-secret-do-not-echo'
assert secret.stat().st_mode & 0o777 == 0o444
assert 'KEEP_THIS=yes' in (root / '.env').read_text()
assert 'GOOGLE_OWNER_EMAIL=' not in (root / '.env').read_text()
run([('Reuse saved Google Client ID and Secret?', 'y')])
run([('Reuse saved Google Client ID and Secret?', 'v'),
     ('Private credentials: visible', 'y')], reveal=True)
run([('Reuse saved Google Client ID and Secret?', 'n'),
     ('Google Client ID (sample:', 'synthetic.apps.googleusercontent.com'),
     ('Show Google Client Secret while entering?', ''),
     ('Google Client Secret (sample format:', 'synthetic-secret-do-not-echo')], reveal=True)
assert secret.read_text() == 'synthetic-secret-do-not-echo'
assert 'GOOGLE_OWNER_EMAIL=' not in (root / '.env').read_text()
assert 'Owner Google email (sample:' not in script
print('PASS: generic sample prompts hide secrets, require no owner email, remove legacy owner settings and preserve reused credentials.')
