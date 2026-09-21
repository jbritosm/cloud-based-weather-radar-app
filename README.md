# Cloud-Based Weather Radar Visualization Platform

Web platform that retrieves, processes and visualizes weather radar / satellite / model data from
NOAA, EUMETSAT and Copernicus. TFG, Software Engineering, University of Oviedo.

## Architecture

```
                 ┌────────────────────── EC2 (Docker Compose) ──────────────────────┐
 browser ──HTTP──▶ Caddy ─┬─ /api/*  ─▶ api (FastAPI) ──▶ PostgreSQL/PostGIS         │
                          └─ /       ─▶ web (React, nginx)                           │
                          worker (ingestion) ─▶ providers ─▶ S3 (raw + processed)    │
                 └───────────────────────────────────────────────────────────────────┘
 GitHub Actions ──OIDC──▶ AWS: build images → GHCR → SSM Run Command → deploy.sh on the VM
 Pulumi (infra/): EC2, Elastic IP, S3, SSM parameter, IAM roles, GitHub OIDC provider
```

| Folder | What |
|---|---|
| `backend/` | Python / FastAPI. One image, two entrypoints: `app.api.main` (API) and `app.ingest.worker` |
| `backend/app/providers/` | One class per data source (`noaa_nexrad` works; `eumetsat`, `copernicus` are stubs) |
| `frontend/` | React + TypeScript + Vite + MapLibre GL |
| `infra/` | Pulumi (Python) for AWS |
| `deploy/` | Caddyfile and `deploy.sh` (runs on the VM) |
| `loadtest/` | k6 script |
| `.github/workflows/` | `ci.yml` (PRs / branches), `deploy.yml` (main → AWS), `infra.yml` (Pulumi) |

## Technologies and their role

| Area | Technology | Role in the project |
|---|---|---|
| **Backend** | Python 3.12 | Main language: the meteorological ecosystem (Py-ART, xarray, satpy, cfgrib) is Python-first. |
| | FastAPI + Uvicorn | REST API consumed by the web (and later mobile) client; generates OpenAPI docs automatically. |
| | SQLAlchemy 2 + psycopg | ORM and PostgreSQL driver; stores metadata of every ingested product. |
| | pydantic-settings | Typed configuration read from environment variables (same code local and in AWS). |
| | boto3 | Talks to S3: reads NOAA's public bucket and writes our own bucket. |
| **Ingestion** | Provider classes (`backend/app/providers/`) | One adapter per data source behind a common interface, so adding EUMETSAT, Copernicus or AEMET does not touch the rest of the code. |
| | Worker process | Polls the providers on a schedule, downloads new products and records them. |
| **Frontend** | React 18 + TypeScript | Single-page UI with static typing. |
| | Vite | Dev server and production bundler. |
| | MapLibre GL JS | Interactive map; radar overlays will be rendered as layers on top of it. |
| | OpenStreetMap tiles | Basemap under the radar data. |
| | nginx | Serves the compiled frontend inside its container. |
| **Data storage** | PostgreSQL + PostGIS | Relational store for product metadata, with geospatial queries available when needed. |
| | Amazon S3 | Object storage for raw and processed radar/satellite files (7-day expiry on raw files). |
| | MinIO | S3-compatible server used only locally, so development needs no AWS account. |
| **Containers** | Docker | Every component is packaged as an image, identical locally and in AWS. |
| | Docker Compose | Defines the whole stack; the same files run on a laptop and on the EC2 instance. |
| | Caddy | Reverse proxy (`/api` → backend, `/` → frontend) and automatic HTTPS when a domain is set. |
| **Cloud (AWS)** | EC2 | Single VM that runs the Compose stack (enough for university-level traffic; no Kubernetes needed). |
| | Elastic IP | Stable public address for the VM. |
| | IAM | Instance role for S3 access, and roles that GitHub Actions assumes for deploying. |
| | SSM (Run Command + Parameter Store) | Runs the deploy script on the VM without SSH, and stores the database password securely. |
| **Infrastructure as code** | Pulumi (Python) | Declares all AWS resources in code, so the environment is reproducible and reviewable. |
| | S3 state backend | Stores the Pulumi state in our own AWS account (no Pulumi Cloud needed). |
| | DuckDNS | Free `weatherradarapp.duckdns.org` domain pointing at the Elastic IP, so Caddy can issue an HTTPS certificate. |
| **CI/CD** | GitHub + GitHub Actions | Source control and pipelines: lint and tests on every branch, build and deploy on `main`. |
| | GitHub Container Registry (GHCR) | Stores the built Docker images that the VM pulls. |
| | OIDC federation | GitHub authenticates to AWS with short-lived tokens; no AWS keys are stored in GitHub. |
| **Quality** | pytest | Backend unit and API tests. |
| | Ruff | Python linter, run in CI. |
| | k6 | Load testing (`loadtest/smoke.js`). |
| **Data sources** | NOAA NEXRAD (AWS Open Data) | US weather radar volumes; the first working provider, used to build and validate the pipeline. |
| | AEMET OpenData *(planned)* | Spanish national weather service: radar for Spain. |
| | EUMETSAT Data Store *(planned)* | European satellite products (MSG / MTG). |
| | Copernicus CDS *(planned)* | Reanalysis and model data (e.g. ERA5) for overlays. |
| **Planned** | Py-ART, xarray, satpy | Decode radar / satellite formats and render map tiles. |
| | Alembic | Database migrations once the schema evolves. |
| | React Native (Expo) | Optional mobile app reusing the same API. |

## Run locally

Requires Docker Desktop.

```bash
docker compose up --build
```

- App: http://localhost:8080
- API docs: http://localhost:8000/api/docs
- MinIO console (local S3): http://localhost:9001 (`minioadmin` / `minioadmin`)

The worker downloads the newest NEXRAD volumes for the sites in `NEXRAD_SITES` from NOAA's public
bucket, so you need internet access. Copy `.env.example` to `.env` to override defaults.

Without Docker:

```bash
cd backend  && pip install -r requirements-dev.txt && pytest && ruff check .
cd frontend && npm ci && npm run dev          # needs the API on :8000
```

Load test: `docker run --rm -i -e BASE_URL=http://host.docker.internal:8080 grafana/k6 run - < loadtest/smoke.js`

## Deploying to AWS (one-time setup)

1. **Push this repo to GitHub** (`main` branch).
2. Edit `infra/Pulumi.dev.yaml`: set `tfg:githubRepo` to `owner/repo` (and the region if you want).
3. Install the [Pulumi CLI](https://www.pulumi.com/docs/install/) and the AWS CLI, then run
   `aws configure` with the access key of an IAM user with `AdministratorAccess` (used only for this
   first run; delete the key afterwards). No Pulumi Cloud account is needed: Pulumi keeps its state
   in an S3 bucket of your own account.
4. Create the Pulumi state bucket (once, by hand: Pulumi cannot create the bucket that stores its own state):
   ```bash
   aws s3 mb s3://tfg-pulumi-state-<ACCOUNT_ID>-<REGION> --region <REGION>
   aws s3api put-bucket-versioning --bucket tfg-pulumi-state-<ACCOUNT_ID>-<REGION> \
     --versioning-configuration Status=Enabled
   ```
5. First apply, from your machine. The passphrase encrypts secret values in the Pulumi state; choose
   one and keep it (you will store it in GitHub too):
   ```powershell
   cd infra
   python -m venv venv; venv\Scripts\activate            # Linux/macOS: source venv/bin/activate
   pip install -r requirements.txt
   $env:PULUMI_CONFIG_PASSPHRASE = "your-passphrase"     # Linux/macOS: export PULUMI_CONFIG_PASSPHRASE=...
   pulumi login s3://tfg-pulumi-state-<ACCOUNT_ID>-<REGION>
   pulumi stack init dev
   pulumi up
   ```
   Commit the `encryptionsalt` line that `pulumi stack init` adds to `infra/Pulumi.dev.yaml`: CI needs it.
6. **DuckDNS** (free domain): create the subdomain `weatherradarapp` at [duckdns.org](https://www.duckdns.org)
   and set its IP to the `public_ip` printed by `pulumi up`. The Elastic IP never changes, so no
   updater is needed.
7. In GitHub → Settings → Secrets and variables → Actions:
   - **Variables**: `AWS_ACCOUNT_ID`, `AWS_REGION`, and `SITE_ADDRESS` = `weatherradarapp.duckdns.org`
     (Caddy then obtains an HTTPS certificate automatically). Leave `SITE_ADDRESS` unset to serve plain
     HTTP on the IP instead.
   - **Secret**: `PULUMI_CONFIG_PASSPHRASE` (the passphrase from step 5).
8. After the first deploy, make the two GHCR packages **public** (GitHub profile → Packages →
   `tfg-backend` / `tfg-web` → Package settings → Change visibility), so the VM can pull them
   without credentials.
9. Push to `main`. `deploy.yml` tests, builds and pushes the images, uploads the compose files to
   S3 and runs `deploy.sh` on the instance through SSM. The URL is in `pulumi stack output url`.

Wait 2-3 minutes after the first `pulumi up` so the instance finishes installing Docker before the
first deploy.

## Cost notes

- Check the current AWS Free Tier terms; for accounts created recently it is credit-based and time-limited.
- Set up an **AWS Budgets** alert.
- Public IPv4 addresses (the Elastic IP) are billed hourly on AWS, even on the free tier in some cases.
- Raw S3 objects under `raw/` expire after 7 days (`tfg:rawRetentionDays`).

## Known simplifications / next steps

- Tables are created with `create_all`; introduce Alembic when the schema evolves.
- The worker only stores raw files. Next: decode Level II (Py-ART), render tiles, serve them to MapLibre.
- `infra.yml` only applies changes; add a `pulumi preview` on pull requests if you want it.
- Mobile app (React Native / Expo) would live in `mobile/` and reuse the same `/api`.
