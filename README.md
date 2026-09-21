# Cloud-Based Weather Radar Visualization Platform

Web platform that retrieves, processes and visualizes weather radar / satellite / model data from
NOAA, EUMETSAT and Copernicus. TFG, Software Engineering, University of Oviedo.

## Architecture

```
                 ┌────────────────────── EC2 (Docker Compose) ──────────────────────┐
 browser ─HTTPS─▶ Caddy ─┬─ /api/*  ─▶ api (FastAPI) ──▶ PostgreSQL/PostGIS          │
                         └─ /       ─▶ web (React, nginx)                            │
                         worker (ingestion) ─▶ providers ─▶ S3 (raw + processed)     │
                 └───────────────────────────────────────────────────────────────────┘
 GitHub Actions ──OIDC──▶ AWS: build images → GHCR → SSM Run Command → deploy.sh on the VM
 Pulumi (infra/): EC2, Elastic IP, S3, SSM parameter, IAM roles, GitHub OIDC provider
```

## Documentation of each part

Every part has its own README with the technologies used, **why** they were chosen, how the part interacts with the rest, and its known limitations.

| Part | What it is | Documentation |
|---|---|---|
| Backend | Python / FastAPI API and ingestion worker (one image, two entrypoints) | [backend/README.md](backend/README.md) |
| Frontend | React + TypeScript + Vite + MapLibre single-page app | [frontend/README.md](frontend/README.md) |
| Containers and deployment | Docker Compose stack, Caddy proxy, `deploy.sh` | [deploy/README.md](deploy/README.md) |
| Infrastructure | Pulumi (Python) program for AWS | [infra/README.md](infra/README.md) |
| CI/CD | GitHub Actions workflows | [.github/workflows/README.md](.github/workflows/README.md) |
| Load testing | k6 script | [loadtest/README.md](loadtest/README.md) |

## How the parts interact

**1. A user opens the site.** The browser connects over HTTPS to **Caddy**, the only publicly exposed container. Caddy serves the React app from the **web** container for `/`, and forwards `/api/*` to the **API**. The React app calls the API using relative URLs, so everything is one origin. The API queries **PostgreSQL** and returns JSON, and MapLibre draws the map using OpenStreetMap tiles.

**2. Data is ingested (in the background).** The **worker** wakes up every few minutes and asks each **provider** (today NOAA NEXRAD, later EUMETSAT / Copernicus) what is new. It downloads the new files, uploads the raw files to **S3**, and records each one in **PostgreSQL**. The API then exposes those records to the frontend.

**3. A new version is released.** A push to `main` triggers **GitHub Actions**: tests, then Docker images are built and pushed to **GHCR**. The workflow authenticates to AWS with OIDC (no stored keys), uploads the compose files to S3 and, through **SSM**, tells the VM to run `deploy.sh`, which pulls the new images and restarts the containers.

**4. The environment itself changes.** Edits to `infra/` are applied with **Pulumi**, which creates or modifies the AWS resources (VM, bucket, roles, secrets). The VM, the pipeline and the application are therefore each defined in code and versioned in the same repository.

| Interaction | Mechanism | Why |
|---|---|---|
| Browser → app | HTTPS to Caddy, path-based routing | One entry point; automatic certificates; no CORS |
| Frontend → backend | JSON over HTTP (`/api`) | Simple, typed, cacheable |
| Backend → database | SQLAlchemy / PostgreSQL | Relational metadata with spatial support |
| Worker → S3 | boto3 with the EC2 instance role | No credentials in code or images |
| Worker → data providers | Public APIs / open data buckets | Source of the meteorological data |
| GitHub → AWS | OIDC short-lived credentials | No long-lived secrets in GitHub |
| GitHub → VM | SSM Run Command | No SSH access needed |
| Pulumi → AWS | AWS API, state in S3 | Reproducible, reviewable infrastructure |

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
| | Vitest | Frontend unit tests (time logic, shareable links, translations). |
| | Playwright | Browser tests in real Chromium (desktop, phone, offline app), with every external service mocked; run in CI before every deploy. |
| | k6 | Load testing (`loadtest/smoke.js`, profiles smoke/load/stress); results in the load-test README. |
| **Frontend features** | PWA (manifest + service worker) | The site is installable on phones and desktops and its shell opens offline. |
| | Light/dark theme, Spanish/English, shareable links | Usability: system-aware dark mode, a language switch, and links that restore the view. |
| **Data sources** | NOAA NEXRAD (AWS Open Data) | US weather radar volumes; the first working provider, used to build and validate the pipeline. |
| | EUMETSAT EUMETView WMS | Meteosat (MSG/MTG) satellite imagery over Spain drawn directly in the map, with a time animation; no API key. |
| | RainViewer tile API | Rain radar composite over Spain drawn directly in the map with the time slider; third-party, attribution required. |
| | AEMET OpenData *(implemented, waiting for AEMET)* | Spanish national weather service radar (georeferenced GeoTIFF). The worker retries patiently because AEMET currently refuses the download with a rate-limit error; see the backend README. |
| | EUMETSAT Data Store *(implemented, temporarily disabled)* | Downloads the MSG Cloud Mask (small files, every 15 min). Searching is public and verified live; downloading needs a free key pair, which could not be obtained yet, so the provider is switched off. |
| | Copernicus CDS | The worker requests ERA5 wind and temperature over Europe (one file per day). Needs a free personal access token; not yet verified against the live service. |
| **Operations** | Alembic | Versioned database migrations; the production database created before migrations existed is adopted, not rebuilt. |
| | systemd timers + `pg_dump` + S3 | Nightly database backup (checked before upload, kept 30 days) and a 5-minute health metric; a documented, tested restore. |
| | CloudWatch alarms + SNS + AWS Budgets | Email alerts when the instance fails, the application is unhealthy, a backup fails, CPU credits run out, or the monthly budget is at risk. |
| | Rate limiting (ASGI middleware) | One abusive client cannot starve the others; verified on the real stack. |
| | Content Security Policy + security headers (Caddy) | The browser refuses scripts and connections that are not on an allow-list; HSTS, clickjacking and MIME-sniffing protection; connection timeouts against slow-connection attacks. |
| | axe-core (accessibility tests) | Automated WCAG 2.x AA checks in CI; they found and fixed two real defects. |
| | Dependabot | Weekly pull requests for outdated dependencies, actions and images, each run through the full CI. |
| **Planned** | Py-ART, xarray, satpy, eccodes | Decode radar / satellite / GRIB formats and render map tiles (the processing stage). |
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
   - **Optional, recommended**: variables `ALERT_EMAIL` (where alarms and the budget alert go: AWS
     sends a confirmation link first) and `MONTHLY_BUDGET_USD`; secrets `AEMET_API_KEY`,
     `EUMETSAT_CONSUMER_KEY` + `EUMETSAT_CONSUMER_SECRET`, `CDS_API_KEY` to enable those providers.
     The full list is in [.github/workflows/README.md](.github/workflows/README.md).
8. After the first deploy, make the two GHCR packages **public** (GitHub profile → Packages →
   `tfg-backend` / `tfg-web` → Package settings → Change visibility), so the VM can pull them
   without credentials.
9. Push to `main`. `deploy.yml` tests, builds and pushes the images, uploads the compose files to
   S3 and runs `deploy.sh` on the instance through SSM. The URL is in `pulumi stack output url`.

Wait 2-3 minutes after the first `pulumi up` so the instance finishes installing Docker before the
first deploy.

## Cost notes

- Check the current AWS Free Tier terms; for accounts created recently it is credit-based and time-limited.
- The infrastructure creates an **AWS Budgets** alert (set `ALERT_EMAIL`; default 10 USD a month).
- Public IPv4 addresses (the Elastic IP) are billed hourly on AWS, even on the free tier in some cases.
- Raw S3 objects under `raw/` expire after 7 days (`tfg:rawRetentionDays`); database backups after 30.
- The new CloudWatch metrics and alarms stay inside the free tier (custom metrics: 2 of the first 10; alarms: 4 of the first 10).

## Operating it

- **Deploy**: push to `main`. CI (backend, frontend unit + browser tests, infra, compose) must pass first.
- **Backups and restore**: nightly, kept 30 days; restore with `deploy/restore.sh`. See [deploy/README.md](deploy/README.md).
- **Alerts**: CloudWatch alarms and the budget email `ALERT_EMAIL`. See [infra/README.md](infra/README.md).
- **Pause to save money**: stop the EC2 instance. Stopping it does not trigger alarms.

## Known simplifications / next steps

- The worker only stores raw files. Next: decode them (NEXRAD with Py-ART, GRIB with eccodes), render tiles, serve them to MapLibre: the platform's own *processing* stage.
- EUMETSAT's download and Copernicus are implemented but unverified until you add their keys; AEMET is waiting for the service.
- Postgres runs in a container on the instance (backed up nightly to S3); RDS would add point-in-time recovery at extra cost.
- Mobile app (React Native / Expo) would live in `mobile/` and reuse the same `/api`; the site is already an installable PWA.
