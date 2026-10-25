# Ubuntu Docker deployment

This repository is **BankStatementAnalytics**, including bills and shared bills,
not a separately named Billing Application. It targets .NET 10 and React/Vite;
NHibernate uses PostgreSQL. Windows development and the embedded Windows database
remain supported. Linux deployment uses an external PostgreSQL 16 container.
SQLite's native Windows dependency is not used in this deployment.

## Analysis and priorities

1. Preserve functionality: replace Windows-only report fonts and GPay path defaults;
   skip Windows PostgreSQL bundle copying on Linux. Keep the vendored framework DLL.
2. Build reproducibly: separate Node 24 frontend, .NET 10 SDK and Ubuntu runtime
   stages; retain ICU/globalization for Indian currency and dates. Install DejaVu
   fonts and PostgreSQL 16 tools for PDF reports and the existing backup API.
3. Persist database, Data (cookie keys/config), Uploads (including statement password
   keys), and Logs separately. Read the DB password from a mounted secret file.
4. Add bounded logs, non-root app execution, health probes, resource limits,
   shutdown grace time and restart policies. Use one application instance per DB.
5. Offer Caddy HTTPS, trust its explicit IP for forwarded scheme/client IP,
   and provide consistent offline snapshots and database-aware rollback.

## Fresh server

### Windows SSH launcher

End users can double-click `deploy-ssh.bat` on Windows, enter `user@server`, the
domain, and certificate email. Keep the BAT file, `docker-compose.yml`, and the
`deploy/` directory together. Windows OpenSSH Client must be installed; the Ubuntu
account needs sudo access. SSH handles passwords or keys normally; the launcher
does not store them or disable host-key verification.

The launcher installs Docker on Ubuntu when absent, pulls
`arungs125/bankstatementanalytics:3.1.0-linux-1da6c7b`, generates a database secret
on the server, and starts the private application. It then shows the SSH tunnel
command for first-admin setup. Type ENABLE only after creating the administrator
to start Caddy HTTPS. DNS must already point to the server, and the provider
firewall must allow TCP 80/443. The launcher does not change firewall rules.

For a custom SSH port or release tag, run from PowerShell:

```powershell
.\deploy-ssh.bat -Server ubuntu@203.0.113.10 -Port 2222 -Domain billing.example.com -Email admin@example.com -Version 3.1.0-linux-1da6c7b
```

The remote folder is `~/bankstatementanalytics`. Rerunning the launcher on a running
installation takes a full application backup before updating and preserves
`.env.previous` and `docker-compose.previous.yml`. See rollback instructions below;
the launcher does not automatically restore a database after a failed update.
Only AMD64 Ubuntu servers are supported by this published image. Installing a new
Ubuntu server remotely was not tested during development; syntax validation was
performed, and the underlying Compose stack was tested separately.

Use Ubuntu 24.04 LTS with a suggested starting size of 2 GB RAM, 2 vCPUs and
20 GB free disk (allow additional storage for uploads and backups). Building
Node/.NET needs more memory than running; build elsewhere if the VPS runs out.
The default runtime limits total roughly 1.3 GB; adjust Compose limits after
measuring real imports. Large Takeout imports may require a higher app limit.

Install Docker Engine and Compose from Docker's official Ubuntu repository:
[installation instructions](https://docs.docker.com/engine/install/ubuntu/).
No .NET, Node, or PostgreSQL installation is needed on the server itself.

```bash
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
```

Run the following as a deployment account authorized to use Docker (Docker group
membership grants root-equivalent access). Clone the repository and enter it.
Keep the checkout directory and Compose project name stable to reuse the volumes.

```bash
cp .env.example .env
mkdir -p secrets
umask 077
openssl rand -hex 32 > secrets/db_password.txt
# Compose file secrets must be readable by app UID 1654 and PostgreSQL's UID.
# Parent directory stays private to the deployment account; mounted file is read-only.
chmod 700 secrets
chmod 444 secrets/db_password.txt
docker compose config --quiet
docker compose build --pull
docker compose up -d --wait --wait-timeout 180
docker compose exec -T bankstatementanalytics curl -fsS http://127.0.0.1:8080/health
```

Initially only host loopback port 8080 is published. Use an SSH tunnel from your
computer, `ssh -L 8080:127.0.0.1:8080 user@SERVER`, visit http://localhost:8080,
and **complete first-admin setup before exposing the public hostname**.
The password file, .env and backups are git-excluded and build-context-excluded.
Changing the file alone does not rotate an existing PostgreSQL user's password:
change it in PostgreSQL too, then recreate the app. Never delete the DB volume
to change credentials. Never put passwords on command lines or in source control.

## HTTPS and firewall

Set APP_DOMAIN to a real hostname and ACME_EMAIL in `.env`. Point its DNS A record
(and AAAA only if IPv6 works) at the server. Allow inbound TCP 22 (or your SSH port),
80 and 443 in the VPS/provider firewall. Do not expose 5432 or 8080 publicly.
Outbound DNS, HTTPS and certificate validation must work. Caddy obtains and renews
certificates automatically and persists them in caddy-data.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
docker compose --profile https up -d --wait --wait-timeout 180
curl -I https://billing.example.com
```

Docker published ports can bypass UFW rules, so keep the loopback binding and
provider firewall restrictions. Caddy preserves Host and supplies forwarded scheme
and client IP. ASP.NET trusts only Caddy's fixed 172.30.58.254 address. If that subnet
conflicts with existing networks, change Compose IPAM, Caddy IP and
Deployment__KnownProxy together. See [ASP.NET proxy guidance](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer?view=aspnetcore-10.0).
Deployment__PublicHosting explicitly bypasses the desktop LAN gate; cookie auth,
roles and same-origin checks remain active. Do not scale this application to
multiple replicas. If using a different proxy, configure its trusted IP explicitly.

## Storage and backups

Named volumes: bsa-db (PostgreSQL), bsa-data (Data), bsa-uploads (Uploads and
statement encryption keys), bsa-logs (rotated app logs), caddy-data/config (TLS).
Ordinary `up`, `stop`, `restart`, recreation and server reboot preserve these.
**Never run `docker compose down -v` on a live installation.** New named volumes
inherit the app directories' UID 1654 ownership. For bind mounts or migrated
volumes, arrange that ownership before startup; do not chmod everything 777.

```bash
bash deploy/backup.sh
# Copy the resulting backups/TIMESTAMP directory to private off-server storage.
# Verify gzip/tar and pg_restore --list, and regularly rehearse a full restore
# on an isolated instance before depending on the backup.
```

The script pauses the app while dumping PostgreSQL and archiving Data + Uploads,
then restarts it even on backup failure. Only directories with COMPLETE are usable.
It records image metadata but does not archive images: preserve/tag the previous
application image separately. Backups contain sensitive records and encryption keys;
encrypt off-site copies and restrict access. Logs and TLS state are excluded from
application snapshots. The existing Settings backup API also uses the installed
pg_dump/pg_restore tools; external snapshots are recommended before upgrades.

Restore **replaces all current application data**. Take a current backup first.
Use only a trusted, unmodified archive. Start db first on a new server with the same
secret setup, and select the image version matching the snapshot before restoring.

```bash
docker compose up -d --wait db
bash deploy/restore.sh /absolute/path/backups/TIMESTAMP --replace-current-data
docker compose exec -T bankstatementanalytics curl -fsS http://127.0.0.1:8080/health
```

The restore script leaves the app stopped if any step fails. On a fresh server
where no app container exists yet, create it first with
`docker compose create bankstatementanalytics` before running restore.
Keep the existing desktop database and Uploads keys together when migrating.
Use the application's whole-instance backup/restore for Windows-to-Docker migration,
verify it in an isolated deployment first, and retain the original installation.

## Update and rollback

### Publish an image and deploy it without building on the VPS

Publisher: create a Docker Hub repository, then run these commands from the project
root. Replace YOUR_USER and use a unique release tag for each published image.
The image contains program files only; credentials and application data stay outside.

```bash
docker login
docker build -t YOUR_USER/bankstatementanalytics:3.1.0-linux.1 .
docker push YOUR_USER/bankstatementanalytics:3.1.0-linux.1
```

For an AMD64 VPS, publish an AMD64 image. When the build computer has a different
architecture, use `docker buildx build --platform linux/amd64
-t YOUR_USER/bankstatementanalytics:3.1.0-linux.1 --push .` instead of build/push.
Reference: [Docker image publishing](https://docs.docker.com/get-started/introduction/build-and-push-first-image/).

End user: follow the fresh-server Docker installation, firewall and first-admin
setup above. Copy `docker-compose.yml`, `.env.example`, and the `deploy/` directory
to a deployment folder on the VPS. Source code and development tools are unnecessary.
Create the secret as above, copy `.env.example` to `.env`, and set:

```dotenv
APP_IMAGE=YOUR_USER/bankstatementanalytics
APP_VERSION=3.1.0-linux.1
APP_DOMAIN=billing.example.com
ACME_EMAIL=admin@example.com
```

```bash
# Private repositories require docker login on this server too.
docker compose pull db bankstatementanalytics
docker compose up -d --no-build --wait --wait-timeout 180
# Complete first-admin setup through the SSH tunnel before enabling public HTTPS.
docker compose --profile https pull caddy
docker compose --profile https up -d --no-build --wait --wait-timeout 180
```

The end user then visits `https://billing.example.com` and uses the application.
For later releases, take a backup, change APP_VERSION to the new immutable tag,
pull bankstatementanalytics, and recreate it with `--no-build`. Keep the old tag
and pre-update snapshot for rollback as described below. The images and domain
above are placeholders; they are not an already published release.

Use Git commit/release identifiers as APP_VERSION values; do not overwrite old
image tags. Before changing code, record the current Git revision and .env privately,
tag the running image (for example `docker tag bankstatementanalytics:local
bankstatementanalytics:before-upgrade`), and run the backup script.

```bash
# Check out the reviewed release, then set APP_VERSION to its unique identifier in .env.
docker compose build --pull bankstatementanalytics
docker compose --profile https up -d --no-deps --wait --wait-timeout 180 bankstatementanalytics
docker compose logs --tail=100 bankstatementanalytics
```

Verify login, accounts, imports, bill operations, PDF export and backup download.
Database schema migrations execute on startup. **An older image alone is not a safe
rollback after migration.** Stop the app, check out the prior code/Compose files,
set APP_VERSION to the preserved prior image tag, and restore the pre-upgrade
snapshot with restore.sh. Data created since that snapshot will be lost; export it
before rollback if needed. Do not use the Windows installer update buttons for Linux.
PostgreSQL major-version upgrades require a separate tested dump/restore migration;
do not switch the database major image tag on an existing volume.

## Operations and verification

```bash
docker compose ps
docker compose logs --tail=100 -f bankstatementanalytics db
docker compose --profile https logs --tail=100 caddy
docker compose restart bankstatementanalytics
docker compose exec -T db pg_isready -U bankstatements -d bankstatements
docker compose exec -T bankstatementanalytics id
docker compose exec -T bankstatementanalytics pg_dump --version
docker stats --no-stream
df -h
```

Health checks report readiness including `select 1`; Docker restart policies restart
exited containers, **not containers that merely become unhealthy**. Investigate an
unhealthy app's logs, DB status, free disk, memory and secret permissions. The
60-second stop grace allows hosted services to stop before Docker forces exit.
`unless-stopped` restarts containers after daemon/server reboot unless explicitly
stopped. Enable Docker at boot as above. An OOM-killed app may need a larger limit.

Watch folders refer to paths **inside** the container. Default GPay folder on Linux
is `/app/Uploads/Gpay`; Windows defaults are preserved. Optional environment
variables GPAY_IMPORT_DIRECTORY and GPAY_TAKEOUT_FILE override these paths. Add
explicit mounts for other statement watch folders and configure their container
paths in Settings. Host Windows paths saved in an existing DB need reconfiguration.

Before production sign-off, verify:

- Setup/login/logout and authenticated API requests through HTTPS; cookies are Secure.
- Existing accounts, bills, analytics, statement imports and PDF reports (including ₹).
- Upload and key persistence after `docker compose up -d --force-recreate bankstatementanalytics`.
- A backup and full restore in an isolated deployment; statement passwords still decrypt.
- VPS reboot and container crash recovery, certificate renewal and off-site backups.

## Local verification record

See [VERIFICATION.md](VERIFICATION.md) for commands actually run. Docker runtime,
PostgreSQL connectivity, Linux font rendering, HTTPS and persistence require a
running Linux Docker engine and must not be inferred from a Windows .NET build.
