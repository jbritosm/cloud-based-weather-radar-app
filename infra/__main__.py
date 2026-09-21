"""AWS infrastructure for the platform.

One EC2 instance runs the whole Docker Compose stack; S3 stores the data; two IAM roles let
GitHub Actions (via OIDC, no long-lived keys) deploy the app and run this very program.
"""

import json

import pulumi
import pulumi_aws as aws
import pulumi_random as random

PROJECT = "tfg"

config = pulumi.Config()
github_repo = config.require("githubRepo")  # "owner/repo"
instance_type = config.get("instanceType") or "t3.micro"
volume_size_gb = config.get_int("volumeSizeGb") or 20
raw_retention_days = config.get_int("rawRetentionDays") or 7

region = pulumi.Config("aws").require("region")
account_id = aws.get_caller_identity().account_id
tags = {"Project": PROJECT}

# Predictable names so the GitHub workflows can derive them from AWS_ACCOUNT_ID / AWS_REGION.
bucket_name = f"{PROJECT}-data-{account_id}-{region}"
bucket_arn = f"arn:aws:s3:::{bucket_name}"
pg_param_name = f"/{PROJECT}/postgres_password"

# --------------------------------------------------------------------------- storage
bucket = aws.s3.Bucket("data", bucket=bucket_name, force_destroy=True, tags=tags)

aws.s3.BucketPublicAccessBlock(
    "data",
    bucket=bucket.id,
    block_public_acls=True,
    block_public_policy=True,
    ignore_public_acls=True,
    restrict_public_buckets=True,
)

# Raw radar files are re-downloadable and add up quickly: expire them to stay inside the free tier.
aws.s3.BucketLifecycleConfiguration(
    "data",
    bucket=bucket.id,
    rules=[
        aws.s3.BucketLifecycleConfigurationRuleArgs(
            id="expire-raw",
            status="Enabled",
            filter=aws.s3.BucketLifecycleConfigurationRuleFilterArgs(prefix="raw/"),
            expiration=aws.s3.BucketLifecycleConfigurationRuleExpirationArgs(
                days=raw_retention_days
            ),
        )
    ],
)

# --------------------------------------------------------------------------- secrets
pg_password = random.RandomPassword("postgres-password", length=24, special=False)
aws.ssm.Parameter(
    "postgres-password",
    name=pg_param_name,
    type="SecureString",
    value=pg_password.result,
    tags=tags,
)

# --------------------------------------------------------------------------- instance role
instance_role = aws.iam.Role(
    "instance",
    assume_role_policy=json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {"Service": "ec2.amazonaws.com"},
                    "Action": "sts:AssumeRole",
                }
            ],
        }
    ),
    tags=tags,
)

# Lets us run commands through SSM instead of opening SSH.
aws.iam.RolePolicyAttachment(
    "instance-ssm",
    role=instance_role.name,
    policy_arn="arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
)

aws.iam.RolePolicy(
    "instance-app",
    role=instance_role.id,
    policy=json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {"Effect": "Allow", "Action": "s3:ListBucket", "Resource": bucket_arn},
                {
                    "Effect": "Allow",
                    "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
                    "Resource": f"{bucket_arn}/*",
                },
                {
                    "Effect": "Allow",
                    "Action": "ssm:GetParameter",
                    "Resource": f"arn:aws:ssm:{region}:{account_id}:parameter{pg_param_name}",
                },
            ],
        }
    ),
)

instance_profile = aws.iam.InstanceProfile("instance", role=instance_role.name)

# --------------------------------------------------------------------------- network
default_vpc = aws.ec2.get_vpc(default=True)
default_subnets = aws.ec2.get_subnets(
    filters=[aws.ec2.GetSubnetsFilterArgs(name="vpc-id", values=[default_vpc.id])]
)

security_group = aws.ec2.SecurityGroup(
    "web",
    description="HTTP/HTTPS only. No SSH: administration goes through SSM.",
    vpc_id=default_vpc.id,
    ingress=[
        aws.ec2.SecurityGroupIngressArgs(
            protocol="tcp", from_port=port, to_port=port, cidr_blocks=["0.0.0.0/0"]
        )
        for port in (80, 443)
    ],
    egress=[
        aws.ec2.SecurityGroupEgressArgs(
            protocol="-1", from_port=0, to_port=0, cidr_blocks=["0.0.0.0/0"]
        )
    ],
    tags=tags,
)

# --------------------------------------------------------------------------- instance
ami_id = aws.ssm.get_parameter(
    name="/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
).value

# Runs once at first boot. The app itself is deployed later by deploy/deploy.sh.
user_data = f"""#!/bin/bash
set -euxo pipefail

dnf install -y docker
systemctl enable --now docker

# Docker Compose plugin (not packaged in Amazon Linux 2023)
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-$(uname -m)" \\
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# 1 GB of RAM is tight for Postgres + API + worker: add swap
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

mkdir -p /opt/tfg
cat > /opt/tfg/config.env <<'EOF'
BUCKET={bucket_name}
REGION={region}
PG_PARAM={pg_param_name}
EOF
"""

instance = aws.ec2.Instance(
    "host",
    ami=ami_id,
    instance_type=instance_type,
    subnet_id=default_subnets.ids[0],
    vpc_security_group_ids=[security_group.id],
    iam_instance_profile=instance_profile.name,
    user_data=user_data,
    root_block_device=aws.ec2.InstanceRootBlockDeviceArgs(
        volume_size=volume_size_gb, volume_type="gp3", encrypted=True
    ),
    metadata_options=aws.ec2.InstanceMetadataOptionsArgs(
        http_endpoint="enabled",
        http_tokens="required",
        # 2 hops so containers can reach the instance role credentials (IMDSv2)
        http_put_response_hop_limit=2,
    ),
    tags={**tags, "Name": f"{PROJECT}-host"},
    # A newer "latest" AMI or a tweaked bootstrap script must not recreate the VM (and its data).
    opts=pulumi.ResourceOptions(ignore_changes=["ami", "user_data"]),
)

elastic_ip = aws.ec2.Eip("host", instance=instance.id, domain="vpc", tags=tags)

# --------------------------------------------------------------------------- GitHub OIDC
github_oidc = aws.iam.OpenIdConnectProvider(
    "github",
    url="https://token.actions.githubusercontent.com",
    client_id_lists=["sts.amazonaws.com"],
    thumbprint_lists=["6938fd4d98bab03faadb97b34396831e3780aea1"],
)


def github_trust(subject: str):
    return github_oidc.arn.apply(
        lambda arn: json.dumps(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": {"Federated": arn},
                        "Action": "sts:AssumeRoleWithWebIdentity",
                        "Condition": {
                            "StringEquals": {
                                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
                            },
                            "StringLike": {"token.actions.githubusercontent.com:sub": subject},
                        },
                    }
                ],
            }
        )
    )


# Only workflows running on the main branch of your repository can assume these roles.
main_branch = f"repo:{github_repo}:ref:refs/heads/main"

deploy_role = aws.iam.Role(
    "gha-deploy",
    name=f"{PROJECT}-gha-deploy",
    assume_role_policy=github_trust(main_branch),
    tags=tags,
)
aws.iam.RolePolicy(
    "gha-deploy",
    role=deploy_role.id,
    policy=json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Action": "s3:PutObject",
                    "Resource": f"{bucket_arn}/bundle/*",
                },
                {
                    "Effect": "Allow",
                    "Action": "ssm:SendCommand",
                    "Resource": [
                        f"arn:aws:ssm:{region}::document/AWS-RunShellScript",
                        f"arn:aws:ec2:{region}:{account_id}:instance/*",
                    ],
                    "Condition": {
                        "StringEqualsIfExists": {"ssm:resourceTag/Project": PROJECT}
                    },
                },
                {
                    "Effect": "Allow",
                    "Action": ["ssm:GetCommandInvocation", "ec2:DescribeInstances"],
                    "Resource": "*",
                },
            ],
        }
    ),
)

# Used by .github/workflows/infra.yml to run `pulumi up`. It has to create IAM roles, so it is
# broad: this is why the trust policy is limited to the main branch.
infra_role = aws.iam.Role(
    "gha-infra",
    name=f"{PROJECT}-gha-infra",
    assume_role_policy=github_trust(main_branch),
    tags=tags,
)
aws.iam.RolePolicyAttachment(
    "gha-infra",
    role=infra_role.name,
    policy_arn="arn:aws:iam::aws:policy/AdministratorAccess",
)

# --------------------------------------------------------------------------- outputs
pulumi.export("public_ip", elastic_ip.public_ip)
pulumi.export("url", elastic_ip.public_ip.apply(lambda ip: f"http://{ip}"))
pulumi.export("instance_id", instance.id)
pulumi.export("bucket", bucket_name)
pulumi.export("gha_deploy_role_arn", deploy_role.arn)
pulumi.export("gha_infra_role_arn", infra_role.arn)
