from pathlib import Path

import boto3
from botocore.exceptions import ClientError

from app.config import settings


def _client():
    # Locally: MinIO (endpoint + static credentials via env).
    # On AWS: no endpoint, credentials come from the EC2 instance role.
    return boto3.client(
        "s3", region_name=settings.aws_region, endpoint_url=settings.s3_endpoint_url or None
    )


def ensure_bucket() -> None:
    """Create the bucket if missing. Only needed locally; in AWS Pulumi creates it."""
    if not settings.s3_endpoint_url:
        return
    s3 = _client()
    try:
        s3.head_bucket(Bucket=settings.s3_bucket)
    except ClientError:
        s3.create_bucket(Bucket=settings.s3_bucket)


def upload_file(path: Path, key: str) -> None:
    _client().upload_file(str(path), settings.s3_bucket, key)
