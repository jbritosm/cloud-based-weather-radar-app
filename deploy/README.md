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

## Release flow (`deploy.sh`)

Runs **on the EC2 instance**, started by the deploy workflow through SSM. Arguments: image tag (the git commit SHA), GHCR owner, site address.

1. Load `/opt/tfg/config.env` (bucket, region, SSM parameter name; written at first boot by Pulumi's user-data).
2. `aws s3 sync` the latest compose files and Caddyfile from `s3://<bucket>/bundle/`.
3. Read the database password (and, if present, the AEMET API key) from SSM Parameter Store (`--with-decryption`) and write `/opt/tfg/.env` (mode 600).
4. `docker compose -f docker-compose.yml -f docker-compose.prod.yml pull` then `up -d --remove-orphans`.
5. Prune old images and print `docker compose ps`.

Because images are tagged with the commit SHA, every deployed version is traceable and rolling back is re-running the deploy for an older SHA.

## Interacts with

- **CI/CD**: the workflow builds the images, uploads this folder's files to S3 and triggers `deploy.sh`.
- **Infra (Pulumi)**: creates the instance, its role, the bucket and the SSM parameter that `deploy.sh` depends on.
- **Backend / frontend**: their Dockerfiles define the images that Compose runs.

## Known limitations

- Deploys replace containers in place, so there is a few seconds of downtime per release (no blue/green).
- Postgres data lives in a Docker volume on the VM disk; there is no automated backup yet.
