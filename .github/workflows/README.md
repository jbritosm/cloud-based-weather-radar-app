# CI/CD (GitHub Actions)

Three workflows automate integration, delivery and infrastructure changes.

## Technologies

| Technology | Role | Why this one |
|---|---|---|
| **GitHub Actions** | Runs the pipelines | Lives next to the code, free for this usage, large action ecosystem. Required by the project scope. |
| **OIDC federation to AWS** (`aws-actions/configure-aws-credentials`) | Authenticates to AWS | GitHub issues a short-lived token per run and AWS exchanges it for temporary credentials. No AWS access keys are stored in GitHub, so there is nothing to leak or rotate. |
| **GitHub Container Registry (GHCR)** | Stores Docker images | Authenticated with the built-in `GITHUB_TOKEN`; no separate registry to pay for. |
| **Docker Buildx + GitHub cache** | Builds images | Layer caching makes repeat builds fast. |
| **AWS SSM Run Command** | Executes the release on the server | Removes the need for SSH keys or an open port 22. |
| **Pulumi GitHub Action** | Applies infrastructure changes | Runs `pulumi up` from CI with the S3 state backend. |

## Workflows

### `ci.yml`: continuous integration
**Trigger:** pull requests, and pushes to any branch except `main`.

| Job | Checks |
|---|---|
| `backend` | `ruff check`, `pytest` |
| `frontend` | `npm ci`, `npm run build` (type-checks the app **and** the tests, then bundles), `npm test` (Vitest unit tests) |
| `e2e` | Playwright browser tests (desktop, phone, installable app) against the production build, in real Chromium. All external services are mocked, so it cannot fail because of the internet. The report is attached to the run when it fails. |
| `infra` | `ruff`, Python compile check of the Pulumi program |
| `docker` | Compose files are valid, and all images build |

Purpose: catch problems before code reaches `main`. It uses no AWS access. It is also a **reusable workflow** (`workflow_call`), which is how `deploy.yml` runs it.

### `deploy.yml`: continuous delivery
**Trigger:** push to `main` (or manual run).

```
ci ──▶ build ──▶ deploy
```
1. **ci**: calls `ci.yml` (backend, frontend + unit tests, browser tests, infra, compose). Pushes to `main` do not trigger `ci.yml` on their own, so this is what makes sure `main` is never built or deployed unless every check passes.
2. **build**: build `tfg-backend` and `tfg-web` images, push to GHCR tagged with the commit SHA and `latest`.
3. **deploy**:
   - Assume the `tfg-gha-deploy` AWS role through OIDC.
   - Upload `docker-compose*.yml`, `Caddyfile` and `deploy.sh` to `s3://tfg-data-<account>-<region>/bundle/`.
   - Upload the whole `deploy/` folder (Caddyfile and the helper scripts) and the compose files to S3.
   - Copy each **provider key** that exists as a GitHub secret (`AEMET_API_KEY`, `EUMETSAT_CONSUMER_KEY`, `EUMETSAT_CONSUMER_SECRET`, `CDS_API_KEY`) into SSM Parameter Store as a SecureString under `/tfg/secrets/<name>`, so the instance can read them; the keys are never placed in the command text or logs. Unset secrets are skipped (an existing parameter is not deleted). Adding a key is one word in the loop of this step, plus the secret.
   - Find the running instance by its `Project=tfg` tag.
   - Send an SSM command that downloads and runs `deploy.sh <sha> <owner> <site>`, then wait for it and print its output. The job fails if the script fails.

`concurrency: deploy` ensures two deployments never run at once.

### `infra.yml`: infrastructure changes
**Trigger:** push to `main` that changes `infra/**` (or manual run).
Assumes the `tfg-gha-infra` role, runs **`pulumi preview --diff`** (so the log shows what will change) and then `pulumi up` against the S3 state backend. The alert email and budget come from the GitHub variables `ALERT_EMAIL` and `MONTHLY_BUDGET_USD`, so no personal address is stored in the repository. The very first apply was done locally, because it creates the roles this workflow assumes.

### `probe-aemet.yml`: one-off data probe
**Trigger:** manual only ("Run workflow" in the Actions tab; the file must be on `main`).
Runs `backend/scripts/probe_aemet.py` with the `AEMET_API_KEY` secret and prints what AEMET's radar endpoints return (format, georeferencing, timestamps, value ranges). The downloaded samples are attached to the run as an artifact for 7 days. It is used to design the AEMET provider against the real payload, and can be deleted afterwards.

## Configuration (Settings → Secrets and variables → Actions)

| Name | Type | Used for |
|---|---|---|
| `AWS_ACCOUNT_ID` | variable | Builds the role ARNs and bucket names |
| `AWS_REGION` | variable | AWS region |
| `SITE_ADDRESS` | variable | Domain for HTTPS (`weatherradarapp.duckdns.org`); empty means HTTP on the IP |
| `PULUMI_CONFIG_PASSPHRASE` | secret | Decrypts the Pulumi state |
| `AEMET_API_KEY` | secret | Free AEMET OpenData key (Spanish radar); optional, the AEMET provider stays disabled without it |
| `EUMETSAT_CONSUMER_KEY`, `EUMETSAT_CONSUMER_SECRET` | secrets | Free pair from api.eumetsat.int/api-key. **Currently unused: the EUMETSAT provider is switched off in the code** until keys can be obtained; setting them changes nothing yet |
| `CDS_API_KEY` | secret | Copernicus CDS personal access token (your CDS profile page); optional |
| `ALERT_EMAIL` | variable | Where CloudWatch alarms and the budget alert are emailed. Optional but recommended |
| `MONTHLY_BUDGET_USD` | variable | Monthly budget for the alert (default 10) |
| `RATE_LIMIT_PER_MINUTE` | variable | API requests per minute per client address (default 600). Set `0` before load-testing the server |

`GITHUB_TOKEN` is provided automatically.

## Security model

- Workflows request only the permissions they need (`contents: read`, `packages: write`, `id-token: write`).
- The AWS roles trust only workflows running on **`main` of this repository**, so a pull request from a fork cannot obtain AWS access.
- The deploy role is narrow (S3 bundle upload and SSM on instances tagged `Project=tfg`). The infra role is broad by necessity, protected by the same trust condition.

## Dependency updates (Dependabot)

`.github/dependabot.yml` opens a pull request weekly when a Python package (backend, infra), an npm package, a GitHub Action, a Docker base image or a Compose image has a new version. Minor and patch updates are grouped into one pull request per ecosystem to keep the noise low, and every pull request runs the whole CI, so an update that breaks something is visible before it is merged. Playwright is only updated deliberately, because the CI browsers must match its version.

## Known limitations

- There is no `pulumi preview` on pull requests yet.
- There are no automated post-deploy smoke tests; a failed release is visible in the SSM output and by checking `/api/health`.
- GHCR packages must be public for the VM to pull them without credentials.
