"""Copernicus Climate Data Store: ERA5 reanalysis (2 m temperature and 10 m wind over Europe).

ERA5 is a *reanalysis*: a consistent reconstruction of the atmosphere, not a live feed. The
preliminary release (ERA5T) is published about 5 days behind real time, so this provider asks for
the last few days that are available, one file per day (4 times a day), and never for "now". It
suits wind and temperature overlays and history, not rain radar.

Requests go through the CDS job queue and can wait minutes or longer; that is why each provider
has its own thread (see app/ingest/worker.py) and why the result is only requested once per day.

Needs a free account and a personal access token (CDS profile page), and the licence of the
dataset accepted once in the CDS website. The client is `cdsapi`.

Not verified against the live service: it needs a token. The request follows the parameters
documented for `reanalysis-era5-single-levels` in the current CDS API (`data_format`,
`download_format`); the client's own signature was checked against the installed package.
"""

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from app.config import settings
from app.providers.base import ProductRef, Provider

log = logging.getLogger("copernicus")

DATASET = "reanalysis-era5-single-levels"
VARIABLES = ["2m_temperature", "10m_u_component_of_wind", "10m_v_component_of_wind"]
TIMES = ["00:00", "06:00", "12:00", "18:00"]
LATENCY_DAYS = 6  # ERA5T lands about 5 days after the fact; one more day of margin
DAYS_KEPT = 3  # this many days up to the newest available are kept (small backfill)


def parse_area(text: str) -> list[float]:
    """'60,-15,30,30' -> [60.0, -15.0, 30.0, 30.0] (north, west, south, east)."""
    parts = [float(p) for p in text.split(",")]
    if len(parts) != 4:
        raise ValueError(f"ERA5_AREA needs 4 numbers (north,west,south,east), got: {text!r}")
    return parts


def build_request(day: datetime, area: list[float]) -> dict[str, Any]:
    return {
        "product_type": ["reanalysis"],
        "variable": VARIABLES,
        "year": [f"{day:%Y}"],
        "month": [f"{day:%m}"],
        "day": [f"{day:%d}"],
        "time": TIMES,
        "data_format": "grib",
        "download_format": "unarchived",
        "area": area,
    }


def _default_client() -> Any:
    import cdsapi  # imported here: only needed when the provider actually runs

    return cdsapi.Client(
        url=settings.cds_api_url,
        key=settings.cds_api_key,
        quiet=True,
        progress=False,
        timeout=60,
        retry_max=10,
        sleep_max=60,
    )


class CopernicusProvider(Provider):
    name = "copernicus"
    implemented = True
    poll_seconds = 60 * 60  # the data changes once a day

    def __init__(self, client_factory: Callable[[], Any] = _default_client) -> None:
        self._client_factory = client_factory

    @classmethod
    def is_configured(cls) -> bool:
        return bool(settings.cds_api_key)

    def list_latest(self) -> list[ProductRef]:
        newest = (datetime.now(UTC) - timedelta(days=LATENCY_DAYS)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        days = [newest - timedelta(days=n) for n in range(DAYS_KEPT)]
        return [
            ProductRef(self.name, "era5_single_levels", f"era5-single-levels-{d:%Y%m%d}", d)
            for d in sorted(days)
        ]

    def download(self, ref: ProductRef, dest_dir: Path) -> Path:
        target = dest_dir / f"era5_single_levels_{ref.observed_at:%Y%m%d}.grib"
        request = build_request(ref.observed_at, parse_area(settings.era5_area))
        day = f"{ref.observed_at:%Y-%m-%d}"
        log.info("requesting ERA5 for %s (this waits in the CDS queue)", day)
        self._client_factory().retrieve(DATASET, request, str(target))
        return target
