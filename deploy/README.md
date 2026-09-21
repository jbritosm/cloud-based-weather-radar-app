# Containers and deployment

This part defines how the application is packaged and run: the Docker Compose stack (root `docker-compose*.yml`), the reverse proxy configuration (`Caddyfile`) and the script that releases a new version on the server (`deploy.sh`).

## Technologies

| Technology | Role | Why this one |
|---|---|---|
| **Docker** | Packages each component as an image | The same image runs on a laptop and on EC2, removing "works on my machine". Kubernetes was considered and rejected: it adds cost and complexity that a university-scale app does not need. |
| **Docker Compose** | Defines and runs the multi-container stack | One file describes the whole system (5 services + local extras). Layered files keep environments separate without duplication. |
| **Caddy 2** | Reverse proxy + automatic HTTPS | Routes `/api/*` to the backend and everything else to the frontend. Obtains and renews Let's Encrypt certificates by itself when given a domain, with a 10-line config. Chosen over nginx (manual certbot setup), Traefik (more moving parts) and an AWS load balancer (extra hourly cost). |
| **PostgreSQL 16 + PostGIS** | Database container (`postgis/postgis`) | Relational metadata store; PostGIS enables geographic queries (footprints, bounding boxes) when radar coverage is modelled. |
| **MinIO** (local only) | S3-compatible storage | Lets the whole pipeline run locally with no AWS account. Uses `quay.io/minio/minio` (no longer published on Docker Hub). |
| **AWS SSM Run Command** | Executes `deploy.sh` on the VM | Deploys without SSH. |
| **GHCR** | Image registry | Free, integrated with GitHub Actions and the repo; packages are public so the VM pulls without credentials. |

## Compose files (layered)

| File | Used when | Adds |
|---|---|---|
| `docker-compose.yml` | Always | `db`, `api`, `worker`, `web`, `caddy`, healthchecks, restart policies, volumes |
| `docker-compose.override.yml` | Locally (loaded automatically by `docker compose up`) | MinIO, published ports (8080 app, 8000 API, 5432 DB), local S3 credentials |
| `docker-compose.prod.yml` | Production (`-f` explicit, so the override is **not** loaded) | Caddy on ports 80/443 only |

Design points:
- `api` and `worker` use **the same image**; only the command differs. `build:` is on `api` only.
- `worker` waits for `api` to be healthy, so the API creates the tables first. `api` waits for the database healthcheck.
- Only Caddy publishes ports in production: the API, database and web container are reachable only on the internal Docker network.
- Configuration comes from environment variables with local defaults (`${POSTGRES_PASSWORD:-tfg}`), so it works with no `.env` file locally, and `deploy.sh` writes a real `.env` in production.

## Caddy (`Caddyfile`)

```
{$SITE_ADDRESS::80} {
    handle /api/* { reverse_proxy api:8000 }
    handle        { reverse_proxy web:80 }
}
```
- `SITE_ADDRESS=:80` (default): plain HTTP, used locally.
- `SITE_ADDRESS=weatherradarapp.duckdns.org`: Caddy requests a certificate, serves HTTPS and redirects HTTP to HTTPS.
- Single entry point means the frontend and API share one origin: **no CORS setup needed**.

**Hardening in the Caddyfile** (all checked with the real Caddy binary and against the running stack):

| Setting | What it does |
|---|---|
| `servers { timeouts { read_header, read_body 10s, write 30s, idle 2m } }` | A client that opens a connection and sends nothing (a "slowloris" attack) can no longer hold a connection of the small server forever. |
| `Strict-Transport-Security` | Browsers use HTTPS only for the site, for a year (ignored over plain HTTP). |
| `X-Content-Type-Options: nosniff` | A file is never run as a type other than the one declared. |
| `X-Frame-Options: DENY` | The site cannot be shown inside another site's frame (clickjacking). |
| `Referrer-Policy: strict-origin-when-cross-origin` | Other sites get the origin only, never the full address (which contains the map position). |
| `Permissions-Policy` | Only geolocation is allowed (the "my location" button); camera, microphone, payment and USB are off. |
| `Cross-Origin-Opener-Policy: same-origin`, `-Server` | Isolates the page from other windows; hides the server software. |
| `request_body { max_size 1MB }` | The platform is read-only, so nothing legitimate sends a large body. (Configured and validated, but not exercised: no endpoint reads a body.) |

The **Content Security Policy** (which scripts, images and connections the page may use) is not here: it travels inside `index.html` so that the browser tests and production run under the same policy (see `frontend/csp.ts`).

## Release flow (`deploy.sh`)

Runs **on the EC2 instance**, started by the deploy workflow through SSM. Arguments: image tag (the git commit SHA), GHCR owner, site address, requests-per-minute limit.

1. Load `/opt/tfg/config.env` (bucket, region, SSM parameter name; written at first boot by Pulumi's user-data).
2. `aws s3 sync` the latest compose files, Caddyfile and helper scripts from `s3://<bucket>/bundle/`.
3. Read the database password from SSM Parameter Store (`--with-decryption`) and write `/opt/tfg/.env` (mode 600).
4. **Read every parameter under `/tfg/secrets/`** and add it to `.env` as an environment variable (`/tfg/secrets/aemet_api_key` becomes `AEMET_API_KEY`). `$` is doubled so Compose does not expand it. If the parameters cannot be read (for example the infrastructure update is not applied yet) it prints a **warning** and continues: the app works, but the providers that need a key stay disabled, and it is never silent.
5. Install the systemd timers (below), which is idempotent.
6. `docker compose -f docker-compose.yml -f docker-compose.prod.yml pull` then `up -d --remove-orphans`.
7. Prune old images and print `docker compose ps`.

Because images are tagged with the commit SHA, every deployed version is traceable and rolling back is re-running the deploy for an older SHA.

Verified by running it in a clean Linux container with fake `aws`, `docker` and `systemctl`: the `.env` it writes (names, `$` escaping, mode 600, rate limit), the units it installs, and the warning path.

## Backups, restore and monitoring

Two systemd timers run on the instance (installed by `install-timers.sh`):

| Timer | When | Script | What |
|---|---|---|---|
| `tfg-backup` | every night at 03:30 UTC (`Persistent`: a run missed while the instance was stopped happens at the next boot) | `backup.sh` | Dumps PostgreSQL with `pg_dump` into a temporary file, **checks it** (valid gzip, more than 500 bytes, contains the end-of-dump marker), and only then uploads it to `s3://<bucket>/backups/postgres/`. A failed dump is never uploaded as if it were a backup. An S3 lifecycle rule deletes backups after 30 days. |
| `tfg-healthcheck` | every 5 minutes | `healthcheck.sh` | Publishes a CloudWatch metric, 1 if Docker reports the API container healthy (which includes a database query) and 0 otherwise. |

Both publish metrics to the `TFG` namespace, and CloudWatch alarms (see `infra/README.md`) email you when something is wrong: `BackupFailed`, `ApiHealthy` below 1, and the instance status checks.

**Restore** (on the instance, through SSM Session Manager or Run Command):

```bash
sudo /opt/tfg/deploy/restore.sh list                 # what is available
sudo /opt/tfg/deploy/restore.sh latest               # shows what it would restore and stops
sudo /opt/tfg/deploy/restore.sh latest --yes         # replaces the database with the newest backup
sudo /opt/tfg/deploy/restore.sh tfg-20260922T033000Z.sql.gz --yes   # a specific one
sudo systemctl start tfg-backup                      # take a backup right now
journalctl -u tfg-backup -n 50                       # what the last backup did
```

The restore stops the API and worker, replays the dump (`--clean --if-exists`, so it replaces the tables) and starts them again. Without `--yes` it changes nothing.

**Tested end to end** on the real PostgreSQL with MinIO standing in for S3: a backup was taken; every row was deleted; the restore refused to run without `--yes` and, with it, brought back all rows, restarted the API healthy and kept the schema version. Also tested: with the database down the script exits with an error, uploads nothing, and publishes exactly `BackupFailed`; when it works it publishes exactly `BackupSucceeded`.

**A backup you have not restored is not a backup:** rehearse a restore now and then, ideally into a scratch instance.

## Interacts with

- **CI/CD**: the workflow builds the images, uploads this folder's files to S3 and triggers `deploy.sh`.
- **Infra (Pulumi)**: creates the instance, its role, the bucket and the SSM parameter that `deploy.sh` depends on.
- **Backend / frontend**: their Dockerfiles define the images that Compose runs.

## Known limitations

- Deploys replace containers in place, so there is a few seconds of downtime per release (no blue/green).
- Postgres runs in a container on the VM's disk. Backups now exist (nightly, kept 30 days, in S3) but a restore means minutes of downtime and losing what happened since the last backup (up to a day). RDS would give point-in-time recovery at extra cost.
- The systemd timers themselves could only be tested up to the units they generate (no systemd in the test containers); their first real run is on the instance.
- Backups live in the same AWS account and region as the data. A copy in another account or region would protect against a much worse day.
