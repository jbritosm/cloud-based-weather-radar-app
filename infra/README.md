# Infrastructure (Pulumi)

All AWS resources are declared as code in `__main__.py` (Python). Running `pulumi up` builds the whole environment; `pulumi destroy` removes it.

## Technologies

| Technology | Role | Why this one |
|---|---|---|
| **Pulumi (Python)** | Infrastructure as code | Real programming language (loops, functions, types) instead of a DSL, and the same language as the backend. Named explicitly in the project scope. Chosen over Terraform (HCL, separate language) and CloudFormation (verbose YAML, AWS-only). |
| **S3 as Pulumi state backend** | Stores what Pulumi has created | Free and inside our own account. Pulumi Cloud was dropped because the account required a paid plan to create access tokens. State bucket `tfg-pulumi-state-<account>-<region>` is created by hand, since Pulumi cannot create the bucket that holds its own state. |
| **Passphrase secrets provider** | Encrypts secret values in the state | Needed with the S3 backend. The passphrase is kept outside the repo and as the GitHub secret `PULUMI_CONFIG_PASSPHRASE`. |
| **CloudWatch + SNS + AWS Budgets** | Alarms, email alerts and a budget alert | Managed and inside the free tier; no monitoring server to run. Custom metrics come from two small timers on the instance. |
| **AWS EC2** | One VM runs the whole Docker Compose stack | Cheapest and simplest option for university-level traffic. Chosen over EKS (control plane costs money and is not free-tier), ECS/Fargate (not free), Lambda (heavy geospatial libraries and long-running workers fit poorly). |
| **Elastic IP** | Fixed public address | Survives stop/start, so the DuckDNS record and HTTPS certificate keep working. |
| **S3 (data bucket)** | Raw and processed radar files | Durable, cheap object storage in the same region as the VM. A lifecycle rule expires `raw/` objects after 7 days to stay in budget. |
| **SSM Parameter Store** | Holds the database password (SecureString) | Keeps the secret out of the repo, user-data and container images. |
| **SSM Run Command** | Runs the deploy script on the VM | No SSH port, no key pair to manage. |
| **IAM roles** | Least-privilege access | See below. |
| **GitHub OIDC provider** | Lets GitHub Actions assume AWS roles | Short-lived credentials instead of long-lived access keys stored in GitHub. |

## Resources created (22, or 24 with an alert email)

- **Network**: security group allowing only TCP 80 and 443 (no SSH), in the default VPC.
- **Compute**: EC2 `t3.micro` (Amazon Linux 2023), 20 GB encrypted gp3 disk, Elastic IP.
- **Storage**: S3 data bucket `tfg-data-<account>-<region>` (public access fully blocked). Two lifecycle rules: `raw/` expires after 7 days, `backups/` (database dumps) after 30.
- **Secrets**: random 24-character Postgres password (`pulumi-random`) stored in SSM as `/tfg/postgres_password`. The provider API keys are stored by the deploy workflow under `/tfg/secrets/`.
- **Monitoring**: an SNS topic `tfg-alerts` and four CloudWatch alarms (below); with an alert email, also the email subscription and a monthly budget.
- **IAM**:
  - *Instance role*: read/write on the data bucket, read the SSM parameters under `/tfg/` (the database password, and every provider key with `GetParametersByPath`), publish CloudWatch metrics in the `TFG` namespace only, SSM agent permissions.
  - *`tfg-gha-deploy`* (GitHub Actions): upload the deployment bundle to `bundle/*` in S3, write **only** the parameters under `/tfg/secrets/` (so it cannot touch the database password), `ssm:SendCommand` only to instances tagged `Project=tfg`, read command results.
  - *`tfg-gha-infra`* (GitHub Actions): AdministratorAccess, used by `infra.yml` to run `pulumi up`. It is broad because Pulumi creates IAM resources; the protection is the trust policy.
  - Both GitHub roles can only be assumed by workflows on the **`main` branch of this repository**.
- **Federation**: GitHub OIDC identity provider.

## How the pieces are wired

```
GitHub Actions ──OIDC token──▶ AWS STS ──▶ tfg-gha-deploy / tfg-gha-infra role
                                              │
                    S3 bundle + SSM SendCommand ▼
EC2 instance  ◀── runs /opt/tfg/deploy.sh ── pulls compose files from S3,
   │                                         reads DB password from SSM,
   │                                         pulls images from GHCR
   └── instance role ──▶ S3 data bucket (worker) 
```

At first boot, the instance's **user-data** installs Docker and the Compose plugin, creates a 2 GB swap file (1 GB RAM is tight for Postgres + API + worker), and writes `/opt/tfg/config.env` with the bucket, region and parameter name. The application itself is deployed later by `deploy/deploy.sh`, so infrastructure and application releases are independent.

## Monitoring and alerts

All alarms notify the SNS topic `tfg-alerts`, and also send a message when they recover. AWS emails a **confirmation link to the alert address first**: nothing is delivered until you click it.

| Alarm | Fires when | Why |
|---|---|---|
| `tfg-instance-status-check` | The EC2 status checks fail for 3 minutes in a row | The virtual machine itself is broken or unreachable. A stopped instance does **not** trigger it (missing data counts as fine), so pausing the project to save money is silent. |
| `tfg-api-unhealthy` | The API container is unhealthy for at least 10 minutes (2 of 3 five-minute periods) | The machine is up but the application is down. `deploy/healthcheck.sh` publishes 1 or 0 every 5 minutes from Docker's own healthcheck (which queries the database). |
| `tfg-backup-failed` | A nightly backup ran and failed | `deploy/backup.sh` publishes `BackupFailed` if anything goes wrong. |
| `tfg-cpu-credits-low` | The CPU credit balance stays below 20 for 15 minutes | Burstable instances (t2/t3/t4g) are throttled to a fraction of a CPU when their credits run out, and the site would silently become slow. This is the failure a long load test shows. Only created for burstable instance types. |

**Budget:** an email when 80 % of the monthly budget is spent and when the forecast says it will be exceeded (default 10 USD). Budgets email their subscribers directly. It only measures cost, so with free-tier credits it may show 0 until they run out.

The alert address is **not stored in the repository**: the infra workflow takes it from the GitHub variable `ALERT_EMAIL` (and the budget from `MONTHLY_BUDGET_USD`). Without it the alarms still exist (visible in the console), nobody is notified, and the deploy log says so.

**Change preview:** `infra.yml` now runs `pulumi preview --diff` *before* `pulumi up`, so the log of every run shows exactly what changed. (A preview on pull requests would need a separate read-only role, and since the project deploys from `main`, this was judged not worth the extra permissions.)

**How it was checked:** the program was run against mocked AWS with every configuration (with and without an email, burstable and non-burstable instance), and the resulting resources, alarm names, lifecycle rules and IAM statements were inspected. It was **not** applied to AWS from here: the first real validation is the CI run after you push.

## Notable decisions

- **IMDSv2 required, hop limit 2**: the instance metadata service needs tokens (protects against SSRF credential theft), and the hop limit of 2 lets containers reach the instance role credentials.
- **`ignore_changes` on `ami` and `user_data`**: AWS publishes a new "latest" AMI regularly; without this, Pulumi would replace the VM (and its database) on every change.
- **Predictable names** (`tfg-data-<account>-<region>`, `tfg-gha-deploy`): the workflows compute them from the `AWS_ACCOUNT_ID` and `AWS_REGION` variables, so no outputs need to be copied to GitHub.
- **GitHub subject format**: newer repositories send an OIDC subject with immutable ids (`repo:owner@id/repo@id:ref:...`). The trust policies accept both that and the classic `repo:owner/repo:ref:...` form.

## Configuration (`Pulumi.dev.yaml`)

| Key | Default | Meaning |
|---|---|---|
| `aws:region` | `eu-west-1` | Region |
| `tfg:githubRepo` | – | `owner/repo` allowed to assume the GitHub roles |
| `tfg:instanceType` | `t3.micro` | EC2 size |
| `tfg:volumeSizeGb` | `20` | Disk size |
| `tfg:rawRetentionDays` | `7` | S3 expiry for raw files |
| `tfg:backupRetentionDays` | `30` | S3 expiry for database backups |
| `tfg:alertEmail` or env `TFG_ALERT_EMAIL` | – | Who gets the alarms and budget emails (CI sets it from the GitHub variable `ALERT_EMAIL`) |
| `tfg:monthlyBudgetUsd` or env `TFG_MONTHLY_BUDGET_USD` | `10` | Monthly budget for the alert |

## Commands

```powershell
$env:PULUMI_CONFIG_PASSPHRASE = "<passphrase>"
pulumi login s3://tfg-pulumi-state-<ACCOUNT_ID>-<REGION>
pulumi preview      # see what would change
pulumi up           # apply
pulumi destroy      # remove everything (data is lost)
```

## Known limitations

- The single VM is a single point of failure and does not scale horizontally. Adequate for the project's load; the Compose images could move to ECS/EKS unchanged.
- Postgres runs in a container on the VM's disk. Nightly backups to S3 (kept 30 days) protect the data, but RDS would add point-in-time recovery at extra cost.
- There is no check of the site from *outside* AWS: the health alarm depends on the instance being able to publish its own metric. A free external uptime service (UptimeRobot, Better Stack) pointed at `/api/health` is a cheap complement.
- The Elastic IP and disk cost a few euros per month even when the instance is stopped.
