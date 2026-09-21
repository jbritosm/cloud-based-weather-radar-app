# Load testing

Measures how the deployed platform behaves under concurrent users.

## Technology

| Technology | Role | Why this one |
|---|---|---|
| **k6** | Load generator | Tests are plain JavaScript, it runs as a Docker image (nothing to install), and it has built-in **thresholds** (pass/fail criteria) and per-tag percentile reports. Chosen over JMeter (GUI/XML heavy) and Locust (needs a Python environment and more setup). |

## What the test does (`smoke.js`)

Each virtual user behaves like a real visitor:

1. Opens the home page (`GET /`).
2. Reads the platform's data in parallel: `GET /api/providers` and `GET /api/products?limit=20`.
3. Checks `GET /api/health` (which also queries the database).
4. Waits 1-2 s (people look at the map), and repeats.
5. **One visit in five is a first-time visitor** that also downloads the JavaScript/CSS bundle (repeat visitors have it in their browser cache).

The satellite and radar tiles come straight from EUMETSAT and RainViewer, not from our server, so they are **not** part of this test: it measures what our infrastructure is responsible for.

Every request is tagged by endpoint, so each one has its own threshold and a slow endpoint cannot hide behind fast ones:

| Endpoint | Threshold (95th percentile) |
|---|---|
| page (`/`) | < 800 ms |
| `/api/health` | < 500 ms |
| `/api/providers` | < 500 ms |
| `/api/products` | < 800 ms |
| bundle files | < 2000 ms |
| all requests | < 1 % failed; > 99 % of checks pass (status 200, JSON is a list, database is up) |

## Profiles

| `PROFILE` | Load | Question it answers |
|---|---|---|
| `smoke` | 1 user, 20 s | Does it work at all? |
| `load` (default) | ramps to 20 users, holds 1 min | Does it cope with the expected university-level traffic? |
| `stress` | ramps to 100 users, holds 1 min | Where does it start to hurt? |

## Run it

```powershell
# Against your local stack (docker compose up)
docker run --rm -v "${PWD}/loadtest:/scripts" -e BASE_URL=http://host.docker.internal:8080 -e PROFILE=load grafana/k6 run /scripts/smoke.js

# Against AWS
docker run --rm -v "${PWD}/loadtest:/scripts" -e BASE_URL=https://weatherradarapp.duckdns.org -e PROFILE=load grafana/k6 run /scripts/smoke.js

# Keep the numbers for the thesis: add a mount and --summary-export
#   -v "${PWD}/loadtest/results:/out" ... run --summary-export=/out/aws-load.json /scripts/smoke.js
```

## Results

Measured on **22 September 2026** with the `load` profile (20 concurrent users, 1 min 47 s), from a home connection in Spain against the deployment in AWS `eu-west-1` (one `t3.micro`, 1 GB RAM, everything in Docker Compose behind Caddy). The local column is the same stack on a laptop with the `smoke` profile (1 user), to show the cost of the network.

| Endpoint | AWS median | AWS p95 | AWS max | Local median |
|---|---|---|---|---|
| page (`/`) | 35 ms | 37 ms | 52 ms | 2 ms |
| `/api/health` | 37 ms | 41 ms | 164 ms | 3 ms |
| `/api/providers` | 37 ms | 40 ms | 110 ms | 4 ms |
| `/api/products` | 40 ms | 45 ms | 112 ms | 5 ms |
| bundle files | 237 ms | 254 ms | 318 ms | 21 ms |
| **all requests** | **38 ms** | **236 ms** | **318 ms** | 4 ms |

Totals: **4,427 requests (41/s), 0 failed, 7,223 of 7,223 checks passed, all thresholds met**; 212 MB downloaded (mostly the bundle for the first-time visitors).

### How to read it

- The API and page latency is about **35-45 ms even with 20 users at once**, and hardly differs from a single user. About 33 ms of that is the network round trip between Spain and Ireland (the fastest request in the whole test took 33 ms); the server itself adds only a few milliseconds, as the local run shows. There is **no sign of degradation** up to 20 users, so the instance has headroom at this load.
- The overall p95 (236 ms) is not the API being slow: it is the bundle downloads, which are about 1 MB and are limited by the connection's bandwidth, not by the server. That is why the per-endpoint numbers matter.
- The thresholds were chosen for a university-level application, not for a commercial one.

### What this does NOT show

- **The breaking point.** 20 users is below where a `t3.micro` should struggle, so the `stress` profile (100 users) is the test that would find the limit. It was not run against production, because it would slow the live site down, use up the instance's CPU credits, and transfer about 1 GB. Run it deliberately, when you are ready to record the result.
- **A long test.** `t3.micro` instances are *burstable*: they are fast while they have CPU credits and are throttled to about 10 % of a CPU when the credits run out. A 2-minute test cannot show that; a sustained one (for example 30 minutes at 20 users) can, and it is worth including in the thesis.
- **The data path.** The worker (ingesting radar files) was running during the test, but the test does not stress it.
- **Other client locations.** One client, one network.

## Next steps

- Run `stress` and a long `load` for the thesis, keeping the JSON summaries in `loadtest/results/` (git-ignored) and comparing instance sizes (`t3.micro` vs `t3.small`).
- Add scenarios for radar tile endpoints once the platform serves its own tiles (the expensive path).
- Keep tests short and off-peak: they consume the instance's CPU credits and AWS data transfer.
