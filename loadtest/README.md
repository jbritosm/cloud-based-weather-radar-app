# Load testing

Measures how the deployed platform behaves under concurrent users.

## Technology

| Technology | Role | Why this one |
|---|---|---|
| **k6** | Load generator | Tests are plain JavaScript, it runs as a single binary or Docker image (no install), and it has built-in thresholds (pass/fail criteria) and clear percentile reports. Chosen over JMeter (GUI/XML heavy) and Locust (needs a Python environment and more setup). |

## What `smoke.js` does

Ramps to 20 virtual users over 30 s, holds for 1 min, ramps down in 15 s. Each user repeatedly requests, in parallel:
`/` (frontend), `/api/health` and `/api/products?limit=20`, then waits 1 s.

Pass/fail thresholds: fewer than 1 % failed requests and a 95th-percentile latency under 500 ms.

## Run it

```powershell
# Against your local stack
docker run --rm -i -e BASE_URL=http://host.docker.internal:8080 grafana/k6 run - < loadtest/smoke.js

# Against AWS
docker run --rm -i -e BASE_URL=https://weatherradarapp.duckdns.org grafana/k6 run - < loadtest/smoke.js
```

## What it tells you

- A `t3.micro` (1 GB RAM, burstable CPU) has limited CPU credits: a long test can exhaust them and show a latency cliff. That is a real finding worth recording in the thesis, together with the effect of a larger instance type.
- It exercises the full path (Caddy → nginx / FastAPI → PostgreSQL), so the results include proxy and database overhead.

## Next steps

- Add scenarios for radar tile endpoints once they exist (the expensive path).
- Save results (`--out json`) and compare configurations (instance sizes, caching) for the thesis evaluation chapter.
- Do not test against the domain heavily from a home connection for long periods: keep tests short to stay within AWS data-transfer and CPU-credit limits.
