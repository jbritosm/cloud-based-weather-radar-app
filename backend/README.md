# Backend

Python service that does two jobs from **one codebase and one Docker image**:

| Entrypoint | Command | Job |
|---|---|---|
| **API** | `uvicorn app.api.main:app` | Serves the REST API the frontend consumes. |
| **Ingestion worker** | `python -m app.ingest.worker` | Every few minutes fetches new meteorological products from the data providers and stores them. |

## Technologies

| Technology | Role | Why this one |
|---|---|---|
| **Python 3.12** | Language | The scientific/meteorological ecosystem (Py-ART for radar, xarray/cfgrib for model data, satpy for EUMETSAT satellite data) is Python-first. Using another language would mean re-implementing or wrapping those libraries. |
| **FastAPI + Uvicorn** | Web framework / ASGI server | Async, type-hint driven request validation, and automatic OpenAPI docs (`/api/docs`), which double as living documentation for the thesis. Lighter than Django (no need for its admin/ORM/templates) and more structured than Flask. |
| **SQLAlchemy 2 + psycopg 3** | ORM / PostgreSQL driver | Standard, well-documented data layer. The same model code runs against PostgreSQL in production and SQLite in the unit tests. |
| **pydantic / pydantic-settings** | Response schemas and configuration | Validates and serializes API responses, and reads configuration from environment variables so the same image runs locally and in AWS with no code change (12-factor style). |
| **boto3** | AWS SDK | Reads NOAA's public S3 bucket (anonymous access) and writes to our own bucket. Locally it points at MinIO through `S3_ENDPOINT_URL`. |
| **pytest + httpx (TestClient)** | Tests | Fast API tests without a running server. |
| **Ruff** | Linter | One fast tool for lint + import sorting; runs in CI. |

## Structure

```
app/
  config.py            settings from environment variables
  db.py                engine, session, Product model, init_db()
  storage.py           S3 helpers (upload, ensure bucket locally)
  api/main.py          FastAPI app and endpoints
  ingest/worker.py     polling loop
  providers/           one adapter per data source
    base.py            Provider interface + ProductRef
    noaa_nexrad.py     implemented (US radar)
    aemet_radar.py     stub (Spanish radar, GeoTIFF; needs AEMET_API_KEY)
    eumetsat.py        stub
    copernicus.py      stub
tests/                 API tests and NEXRAD key parsing tests
```

## How it works

**API endpoints** (all under `/api` so the reverse proxy can route by prefix):

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{"status":"ok"}` after running `SELECT 1`; `503` if the DB is down. Used by Docker's healthcheck. |
| `GET /api/providers` | Every registered data source, whether it is `implemented` (code exists) and `enabled` (implemented and configured, e.g. its API key is set: the worker only runs enabled providers). |
| `GET /api/products?provider=&limit=` | Latest ingested products, newest first (limit capped at 200). |

**Ingestion flow** (`ingest/worker.py`), repeated every `INGEST_INTERVAL_SECONDS`:

1. For each *implemented* provider, ask `list_latest()` for the newest products at the source.
2. Look up which ones are already in the `products` table (by `source_key`, unique) and skip them.
3. `download()` each new one to a temporary directory.
4. Upload the raw file to our bucket under `raw/<provider>/<type>/<file>`.
5. Insert a `Product` row (provider, type, observation time, storage key).

A failing provider is logged and skipped; it never stops the loop or the other providers.

**The provider interface** is the main extension point. A provider only has to implement two methods, `list_latest()` and `download()`, and be added to `REGISTRY` in `providers/__init__.py`. NEXRAD reads the public NOAA bucket (`s3://unidata-nexrad-level2/YYYY/MM/DD/<SITE>/`) with unsigned requests, so it needs no credentials. EUMETSAT and Copernicus will follow the same pattern.

**Configuration** (environment variables): `DATABASE_URL`, `S3_BUCKET`, `S3_ENDPOINT_URL` (local MinIO only), `AWS_REGION`, `INGEST_INTERVAL_SECONDS`, `NEXRAD_SITES`, `NEXRAD_BUCKET`, `NEXRAD_PER_SITE`, `AEMET_API_KEY` (empty disables the AEMET provider). Defaults are in `config.py`.

**Secrets:** `AEMET_API_KEY` lives in a GitHub secret, is copied by the deploy workflow into AWS SSM Parameter Store (`/tfg/aemet_api_key`, encrypted) and read by `deploy.sh` into the container environment; it is never in the repository, the images or the logs.

**`scripts/probe_aemet.py`** is a one-off tool (run by the manual "Probe AEMET" workflow) that shows what AEMET's radar endpoints return, so the provider can be written against the real payload.

## Interacts with

- **Frontend**: the browser calls `/api/*` through Caddy; the API never talks to the browser directly.
- **PostgreSQL**: the API reads and the worker writes the `products` table. The API creates the tables at startup and the worker waits for it (`depends_on: api healthy`) to avoid a race.
- **S3 / MinIO**: only the worker writes to it, using the EC2 instance role in AWS (no keys in the image).
- **Data providers (NOAA, later EUMETSAT/Copernicus)**: the worker pulls from them over the internet.
- **CI/CD**: `ruff` and `pytest` run on every push; the image is built from `backend/Dockerfile`.

## Design decisions

- **API and worker share one image.** One build, one dependency set, shared models. The cost is that the API image also carries ingestion dependencies; acceptable at this scale.
- **The worker is a plain loop, not Celery/Airflow.** Ingestion is one periodic job, so a queue and broker would be extra moving parts with no benefit yet. It can be replaced later without touching the API.
- **The container runs as a non-root user** (`appuser`).

## Known limitations / next steps

- Tables are created with `create_all`; introduce **Alembic** migrations before the schema changes.
- The worker only stores raw files. Next: decode NEXRAD Level II with Py-ART, render map tiles, and serve them.
- No authentication: the API is read-only and public by design for now.
- `eumetsat` and `copernicus` providers are stubs.
- **AEMET (`aemet_radar`)** is implemented but has never received data yet: AEMET refuses the georeferenced GeoTIFF download with a rate-limit error that had lasted for more than a day when it was probed (details in `providers/aemet_radar.py`). The provider is therefore deliberately patient: one API call plus one download per attempt, every 30 minutes when it works, and an exponential back-off (30 min doubling up to 6 h) after a refusal, so it starts working by itself if AEMET lifts the limit and never hammers the service meanwhile. It stores the GeoTIFFs as they come (raw, `raw/aemet_radar/raster_nacional/`); the archive's exact file layout has not been seen yet, so the observation time is read from a `YYYYMMDDHHMM` stamp in the file name, or is the download time. Rendering them on the map is the next step once real files exist. The provider only runs when `AEMET_API_KEY` is set.

## Run the tests

```bash
pip install -r requirements-dev.txt
ruff check .
pytest
```
