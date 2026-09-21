import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import boto3
from botocore import UNSIGNED
from botocore.config import Config

from app.config import settings
from app.providers.base import ProductRef, Provider

# e.g. KTLX20240101_000158_V06  (the *_MDM metadata files do not match)
_KEY_RE = re.compile(r"(?P<site>[A-Z0-9]{4})(?P<ts>\d{8}_\d{6})_V\d+(?:\.gz)?$")


def parse_key(key: str) -> tuple[str, datetime] | None:
    """Return (site, observation time) for a NEXRAD Level II volume key, or None."""
    match = _KEY_RE.search(key)
    if not match:
        return None
    observed_at = datetime.strptime(match["ts"], "%Y%m%d_%H%M%S").replace(tzinfo=UTC)
    return match["site"], observed_at


class NoaaNexradProvider(Provider):
    """NEXRAD Level II radar volumes from NOAA's public bucket on AWS Open Data.

    Layout: s3://<bucket>/YYYY/MM/DD/<SITE>/<SITE>YYYYMMDD_HHMMSS_V06
    """

    name = "noaa_nexrad"
    implemented = True

    def __init__(self) -> None:
        # The bucket is public: anonymous (unsigned) requests, no AWS credentials needed.
        self._s3 = boto3.client(
            "s3", region_name="us-east-1", config=Config(signature_version=UNSIGNED)
        )
        self._bucket = settings.nexrad_bucket

    def list_latest(self) -> list[ProductRef]:
        now = datetime.now(UTC)
        sites = [s.strip() for s in settings.nexrad_sites.split(",") if s.strip()]
        refs: list[ProductRef] = []
        for site in sites:
            keys: list[str] = []
            # yesterday too, in case it's just past 00:00 UTC
            for day in (now - timedelta(days=1), now):
                prefix = f"{day:%Y/%m/%d}/{site}/"
                response = self._s3.list_objects_v2(Bucket=self._bucket, Prefix=prefix)
                keys += [obj["Key"] for obj in response.get("Contents", [])]
            site_refs = []
            for key in keys:
                parsed = parse_key(key)
                if parsed:
                    site_refs.append(ProductRef(self.name, "level2", key, parsed[1]))
            site_refs.sort(key=lambda r: r.observed_at)
            refs += site_refs[-settings.nexrad_per_site :]
        return refs

    def download(self, ref: ProductRef, dest_dir: Path) -> Path:
        dest = dest_dir / Path(ref.source_key).name
        self._s3.download_file(self._bucket, ref.source_key, str(dest))
        return dest
