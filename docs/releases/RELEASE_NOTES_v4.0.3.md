# Bank Statement Analytics 4.0.3

Corrects Google sign-in verification to read Google's current email_verified userinfo claim. The OAuth regression test now uses the current sub/email_verified response format.

Cloud deployment helpers recreate the application after replacing file-backed Google secrets. Google setup supports viewing saved credentials and visible secret entry (optional hidden mode). No cloud owner account is required.

Existing installations: extract the Cloud 4.0.3 ZIP and run Setup.bat to update with backup and preserved configuration. Google credentials do not need replacing solely for this application fix.
