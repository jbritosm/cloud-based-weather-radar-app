# Backend

Python service that does two jobs from **one codebase and one Docker image**:

| Entrypoint | Command | Job |
|---|---|---|
| **API** | `uvicorn app.api.main:app` | Serves the REST API the frontend consumes. Runs the database migrations at startup. |
| **Ingestion worker** | `python -m app.ingest.worker` | Fetches new meteorological products from the data providers, one thread per provider, and stores them. |

## Technologies

| Technology | Role | Why this one |
|---|---|---|
| **Python 3.12** | Language | The scientific/meteorological ecosystem (Py-ART for radar, xarray/cfgrib for model data, satpy for EUMETSAT satellite data) is Python-first. Using another language would mean re-implementing or wrapping those libraries. |
| **FastAPI + Uvicorn** | Web framework / ASGI server | Async, type-hint driven request validation, and automatic OpenAPI docs (`/api/docs`), which double as living documentation for the thesis. Lighter than Django (no need for its admin/ORM/templates) and more structured than Flask. |
| **SQLAlchemy 2 + psycopg 3** | ORM / PostgreSQL driver | Standard, well-documented data layer. The same model code runs against PostgreSQL in production and SQLite in the unit tests. |
| **Alembic** | Database migrations | The schema is now versioned code. Chosen because it is SQLAlchemy's own migration tool: it can compare the models with the database and generate the migration. |
| **pydantic / pydantic-settings** | Response schemas and configuration | Validates and serializes API responses, and reads configuration from environment variables so the same image runs locally and in AWS with no code change (12-factor style). |
| **boto3** | AWS SDK | Reads NOAA's public S3 bucket (anonymous access) and writes to our own bucket. Locally it points at MinIO through `S3_ENDPOINT_URL`. |
| **urllib (standard library)** | HTTP client for AEMET and EUMETSAT | Both are simple REST APIs: two or three calls each. A dependency such as `requests` would add nothing, and the standard library is one less thing to keep updated. |
| **cdsapi** | Copernicus Climate Data Store client | The official client: it handles the CDS job queue (submit, poll, download), which is not worth re-implementing. |
| **pytest + httpx (TestClient)** | Tests | Fast API tests without a running server. |
| **Ruff** | Linter | One fast tool for lint + import sorting; runs in CI. |

## Structure

```
app/
  config.py            settings from environment variables
  db.py                engine, session, Product model, migrate() / init_db()
  ratelimit.py         per-client rate limit (token bucket) as an ASGI middleware
  storage.py           S3 helpers (upload, ensure bucket locally)
  api/main.py          FastAPI app and endpoints
  ingest/worker.py     one polling thread per provider
  providers/           one adapter per data source
    base.py            Provider interface + ProductRef
    noaa_nexrad.py     US radar (public bucket, no credentials)
    eumetsat.py        MSG cloud mask from the EUMETSAT Data Store
    copernicus.py      ERA5 wind and temperature from the Copernicus CDS
    aemet_radar.py     Spanish radar (waiting for AEMET, see below)
migrations/            Alembic: env.py and versions/0001_initial.py
alembic.ini
scripts/probe_aemet.py one-off AEMET exploration tool
tests/                 API, migrations, rate limit, every provider, the worker
  fixtures/            a real EUMETSAT search answer, used by the tests
```

## How it works

**API endpoints** (all under `/api` so the reverse proxy can route by prefix):

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{"status":"ok"}` after running `SELECT 1`; `503` if the DB is down. Used by Docker's healthcheck and the monitoring. Never rate limited. |
| `GET /api/providers` | Every registered data source, whether it is `implemented` (code exists) and `enabled` (implemented and configured, e.g. its API key is set: the worker only runs enabled providers). |
| `GET /api/products?provider=&limit=` | Latest ingested products, newest first (limit capped at 200). |

**Ingestion flow** (`ingest/worker.py`). Each enabled provider runs in **its own thread**, on its own schedule (`poll_seconds`, default `INGEST_INTERVAL_SECONDS`):

1. Ask `list_latest()` for the newest products at the source.
2. Look up which ones are already in the `products` table (by `source_key`, unique) and skip them.
3. `download()` each new one to a temporary directory.
4. Upload the raw file to our bucket under `raw/<provider>/<type>/<file>`.
5. Insert a `Product` row (provider, type, observation time, storage key).

A failing provider is logged and retried on its next turn; it never stops the others. **One thread per provider** matters: a Copernicus request can wait minutes in CDS's queue, and it must not delay the NOAA and EUMETSAT checks. The worker also stops cleanly on `SIGTERM` (`docker stop`) instead of being killed mid-download.

### The providers

| Provider | Data | Needs | Checked every | Status |
|---|---|---|---|---|
| `noaa_nexrad` | US radar volumes (NEXRAD Level II) from NOAA's public bucket | nothing | 5 min | **Working**, in production |
| `eumetsat` | Meteosat MSG **Cloud Mask** (about 0.5 MB every 15 min, 50 MB a day). Configurable with `EUMETSAT_COLLECTION` | `EUMETSAT_CONSUMER_KEY` and `EUMETSAT_CONSUMER_SECRET` | 5 min | **Temporarily switched off** (`implemented = False` in `providers/eumetsat.py`; the UI shows it as "planned") because EUMETSAT's key page failed with "Unable to get or create subscriptions for user", so no keys could be obtained. Listing was verified against the live service; the authenticated download never was. To re-enable: get the keys, set the flag back to `True` |
| `copernicus` | **ERA5** reanalysis: 2 m temperature and 10 m wind over Europe, 4 times a day, the newest 3 days available | `CDS_API_KEY` | 1 hour | Written and tested with fakes; **not verified against the live service** (needs a token and the dataset licence accepted once in the CDS website) |
| `aemet_radar` | Spanish georeferenced radar (GeoTIFF) | `AEMET_API_KEY` | 5 min, with its own back-off | Written; AEMET has refused the download so far (see below) |

Things worth knowing about each:

- **EUMETSAT: searching is public, downloading is not.** The search answers without credentials, so `list_latest()` needs none, while `is_configured()` requires the keys (the worker must not try to download without them). The product is a small zip (GRIB); it is stored as it comes. The whole High Rate SEVIRI image (hundreds of MB every 15 minutes) was deliberately *not* chosen: it would not fit the server or the free-tier budget. If the credentials are refused (HTTP 401/403), the provider pauses for an hour instead of retrying every 5 minutes.
- **Copernicus: ERA5 is a reanalysis, not a live feed.** The preliminary release is published about 5 days late, so it asks for the last days that exist (never "today") and requests each day only once. It suits wind and temperature overlays and history, not rain radar.
- **AEMET:** the georeferenced GeoTIFF download has been refused with a rate-limit error since it was first probed. AEMET's FAQ defines that error as exceeding a limit of requests *or of data flow per minute*, so the archive may simply be larger than the per-minute quota of a standard key (a hypothesis; AEMET has been asked). The provider is therefore deliberately patient: one API call plus one download per attempt, every 30 minutes when it works, and an exponential back-off (30 min doubling up to 6 h) after a refusal. It stores the GeoTIFFs as they come; the archive's file layout has not been seen yet, so the observation time is read from a `YYYYMMDDHHMM` stamp in the file name, or is the download time. Details in `providers/aemet_radar.py`.

**The provider interface** is the main extension point. A provider implements `list_latest()` and `download()`, may override `is_configured()` and `poll_seconds`, and is added to `REGISTRY` in `providers/__init__.py`.

### Database migrations (Alembic)

The schema is versioned: `migrations/versions/0001_initial.py` is the baseline, and the API applies pending migrations at startup (`db.migrate()`).

- **A database created before migrations existed is adopted, not rebuilt.** If the tables exist but there is no `alembic_version`, the baseline is *stamped* and nothing is recreated: this is what happens to the production database on the first deploy with this version. Verified on a real PostgreSQL, with data in the tables.
- **Changing the schema:** edit the model in `app/db.py`, then generate the migration and review it:
  ```bash
  docker compose run --rm api alembic revision --autogenerate -m "add something"
  ```
- **A test fails if you forget the migration:** `test_the_migrations_produce_exactly_the_schema_of_the_models` compares what the migrations build with the models.
- Downgrades exist for the baseline (`alembic downgrade base`). A migration runs inside one transaction on PostgreSQL, so a failed one leaves the database as it was.

### Rate limiting

`ratelimit.py` is a token bucket per client address, as a small ASGI middleware. Each address may make `RATE_LIMIT_PER_MINUTE` requests per minute on average (default 600), with a burst of a tenth of that; beyond it the API answers `429` with `Retry-After`. `/api/health` is exempt and `0` disables it.

- **What it is for:** stopping one abusive or buggy client from starving everyone else on a small server. It is *not* a defence against a distributed attack; that needs a service in front (a CDN or a WAF).
- **Why not in Caddy:** Caddy's rate limiting is a third-party plugin, which would mean building and publishing a custom Caddy image. The middleware is small and tested.
- **Behind Caddy the client address is the *last* entry of `X-Forwarded-For`** (the one Caddy itself saw); earlier entries are supplied by the client and are ignored, so the limit cannot be dodged by forging the header.
- **Load testing the server needs it off:** set the GitHub variable `RATE_LIMIT_PER_MINUTE` to `0` and deploy (see the load-test README).

### Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | local PostgreSQL | Database |
| `S3_BUCKET`, `AWS_REGION`, `S3_ENDPOINT_URL` | – | Our bucket (`S3_ENDPOINT_URL` only for local MinIO) |
| `INGEST_INTERVAL_SECONDS` | 300 | Default check interval of a provider |
| `NEXRAD_SITES`, `NEXRAD_BUCKET`, `NEXRAD_PER_SITE` | KTLX,KOKX … | Which US radars |
| `AEMET_API_KEY` | empty | Empty disables the provider |
| `EUMETSAT_CONSUMER_KEY`, `EUMETSAT_CONSUMER_SECRET`, `EUMETSAT_COLLECTION` | empty, empty, `EO:EUM:DAT:MSG:CLM` | Free keys from api.eumetsat.int/api-key |
| `CDS_API_KEY`, `CDS_API_URL`, `ERA5_AREA` | empty, CDS URL, `60,-15,30,30` | Personal token from the CDS profile; area as north,west,south,east |
| `RATE_LIMIT_PER_MINUTE` | 600 | Per client address; 0 = unlimited |

**Secrets** (the four keys above) live in GitHub secrets, are copied by the deploy workflow into AWS SSM Parameter Store (`/tfg/secrets/<name>`, encrypted) and turned into environment variables by `deploy.sh`. They are never in the repository, the images or the logs. Adding a provider key needs one line in the workflow's list.

**`scripts/probe_aemet.py`** is a one-off tool (run by the manual "Probe AEMET" workflow) that shows what AEMET's radar endpoints return.

## Interacts with

- **Frontend**: the browser calls `/api/*` through Caddy; the API never talks to the browser directly.
- **PostgreSQL**: the API reads and the worker writes the `products` table. The API migrates the schema at startup and the worker waits for it (`depends_on: api healthy`) to avoid a race.
- **S3 / MinIO**: only the worker writes to it, using the EC2 instance role in AWS (no keys in the image).
- **Data providers**: the worker pulls from NOAA, EUMETSAT, Copernicus and AEMET over the internet.
- **CI/CD**: `ruff` and `pytest` run on every push and before every deploy; the image is built from `backend/Dockerfile`.

## Design decisions

- **API and worker share one image.** One build, one dependency set, shared models. The cost is that the API image also carries ingestion dependencies; acceptable at this scale.
- **The worker is a set of threads, not Celery/Airflow.** Ingestion is a few periodic jobs, so a queue and broker would be extra moving parts with no benefit yet. Threads are enough because the work is waiting on the network. It can be replaced later without touching the API.
- **Providers never crash the loop.** They return `[]` and log a warning when a service is unreachable, and they back off when a service refuses them, so a bad day at one source is invisible to the others.
- **The container runs as a non-root user** (`appuser`).

## Known limitations / next steps

- The worker only stores raw files. Next: decode them (NEXRAD with Py-ART, GRIB with eccodes), render map tiles, and serve them.
- No authentication: the API is read-only and public by design for now.
- The rate limiter keeps its counters in memory, per process: fine for one API process, not for several.
- Copernicus and the EUMETSAT download are unverified until real keys are configured; AEMET is waiting for the service.

## Run the tests

```bash
pip install -r requirements-dev.txt
ruff check .
pytest        # 46 tests: API, migrations, rate limit, every provider, worker threads
```
