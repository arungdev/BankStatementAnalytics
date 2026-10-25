# Local Docker development with Google login

This runs the cloud authentication flow on your own Windows PC. The cloud server and the normal Windows installation are separate. Your local Docker database has its own persistent volumes; cloud accounts/data are not copied here.

## First run

1. Start Docker Desktop in Linux containers mode. Install the .NET 10 SDK for the localhost HTTPS development certificate.
2. Open Google Cloud Console → Google Auth Platform → Clients. Use a Web application OAuth client, preferably a separate development client.
3. Add this exact Authorized redirect URI: `https://localhost:8443/signin-google`. Keep any existing cloud redirect URI. If the OAuth app is in Testing, add your Google account as a test user.
4. Run `Local-Docker.bat` from the project root. Enter the Client ID and matching secret when prompted. Example ID: `your-client-id.apps.googleusercontent.com`. These are application credentials, not your Google account password.
5. Accept the Windows development certificate trust dialog if shown. The launcher exports a password-protected certificate, builds the current source locally, starts PostgreSQL and the application, then opens `https://localhost:8443`.
6. Sign in or create a workspace with Google.

No server domain, SSH access, certificate email, Docker Hub upload or version change is required. Google login requires internet; first builds may also download dependencies and base images.

## Daily use

```bat
Local-Docker.bat
```

Rebuilds changed source using Docker's cache and restarts the local application. Database and workspace volumes remain. It does not build the Windows installer or export a large image TAR.

```bat
Local-Docker.bat -NoBuild
Local-Docker.bat -Reconfigure
Local-Docker.bat -Stop
```

`-NoBuild` starts the existing local image; `-Reconfigure` asks for new Google credentials; `-Stop` stops local containers and keeps data. Do not use `docker compose down -v` on the local project unless you intend to delete its database.

## Configuration and troubleshooting

Settings, database secrets and the HTTPS certificate are kept in `.local-docker/`, excluded from Git and Docker image build context. Keep the directory private. Secrets are visible while entering as requested; avoid screenshots of them.

The Compose project is `bankstatementanalytics-local-google`, application image `bankstatementanalytics:local-google`, and HTTPS binds only to `127.0.0.1:8443`. Use `localhost`, not the computer's LAN IP. Docker Compose 2.24.4 or newer is required for override support (current Docker Desktop includes it).

```bat
docker compose -p bankstatementanalytics-local-google --env-file .local-docker/local.env -f docker-compose.yml -f deploy/google-compose.yml -f .local-docker/compose.yml ps
docker compose -p bankstatementanalytics-local-google --env-file .local-docker/local.env -f docker-compose.yml -f deploy/google-compose.yml -f .local-docker/compose.yml logs --tail 100 bankstatementanalytics
```

For `redirect_uri_mismatch`, check the exact HTTPS URI above in the same OAuth client whose credentials you entered. For a browser certificate warning, rerun the launcher and complete the development certificate trust prompt. If port 8443 is busy, stop the application using that port before retrying.

The offline cloud ZIP is optional for local development. Keep it only if you want to transfer a build to a VPS without publishing the application image.
