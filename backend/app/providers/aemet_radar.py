"""AEMET (Spanish weather service) georeferenced radar through AEMET OpenData.

API base: https://opendata.aemet.es/opendata/api, key sent in the `api_key` header. Every call
returns JSON with a `datos` URL (the file) and a `metadatos` URL; the file is downloaded from
`datos` without the key. This provider uses /red/radar/raster/nacional: a tar.gz of RGBA GeoTIFFs
in EPSG:4326 (colour scale in the `ESCALA` field), refreshed every 30 minutes, with the 3 latest
images kept.

Findings from backend/scripts/probe_aemet.py (September 2026):

* The file download of the raster products was refused every time with "429 Too Many Requests"
  wrapped in an HTTP 500 page, from GitHub runners and from a home connection alike, for more
  than a day. AEMET also answers a real 429 to bursts of about 7 requests in a few seconds.
  That is why this provider is deliberately patient: one API call and one download per attempt,
  and a long exponential back-off after a refusal.
* AEMET's FAQ (v1.4, July 2025) defines its 429 as "limite de peticiones o caudal por minuto
  excedido para este usuario": a limit on requests OR on data flow per minute. If the raster
  archive is larger than the per-minute flow quota it will be refused on every attempt and waiting
  will not help (a hypothesis, not confirmed by AEMET: the small GIFs below do download).
* /red/radar/regional/{radar} does work (one GIF per radar, every 10 minutes) but the pictures
  are not georeferenced (borders, logo and legend are burnt in), so they are not used here.
* The exact layout of the tar.gz (file names) has not been seen yet. Files are taken as they come
  (only .tif / .tiff members) and the observation time is read from the file name when it holds
  a YYYYMMDDHHMM stamp, otherwise it is the time of the download.
"""

import io
import json
import logging
import re
import tarfile
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from app.config import settings
from app.providers.base import ProductRef, Provider

log = logging.getLogger("aemet")

API_BASE = "https://opendata.aemet.es/opendata/api"
ENDPOINT = "/red/radar/raster/nacional"

POLL_SECONDS = 30 * 60  # AEMET refreshes every 30 minutes
FIRST_BACKOFF_SECONDS = 30 * 60  # after a refusal; doubles on every further one
MAX_BACKOFF_SECONDS = 6 * 60 * 60
MAX_FILES = 20  # newest files considered per download (protects storage if the archive is large)
MAX_MEMBER_BYTES = 30 * 1024 * 1024

_STAMP = re.compile(r"(?<!\d)(20\d{2})(\d{2})(\d{2})[T_-]?(\d{2})(\d{2})(?!\d)")


class RateLimited(Exception):
    """AEMET refused the request because of its usage limits."""


def parse_observed_at(name: str, fallback: datetime) -> datetime:
    """Time from a YYYYMMDDHHMM stamp in the file name (UTC); `fallback` if there is none."""
    match = _STAMP.search(name)
    if match:
        try:
            return datetime(*(int(g) for g in match.groups()), tzinfo=UTC)
        except ValueError:
            pass
    return fallback


def _get(url: str, key: str | None = None) -> bytes:
    headers = {"Accept": "*/*", "User-Agent": "tfg-weather-radar"}
    if key:
        headers["api_key"] = key
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as r:
            return r.read()
    except urllib.error.HTTPError as exc:
        body = exc.read()
        # The download service reports its 429 as an HTTP 500 page that mentions it
        if exc.code == 429 or b"429" in body or b"Too Many Requests" in body:
            raise RateLimited(url) from exc
        raise


class AemetRadarProvider(Provider):
    name = "aemet_radar"
    implemented = True

    def __init__(self) -> None:
        self._retry_at = 0.0  # monotonic time before which AEMET is not contacted again
        self._backoff = FIRST_BACKOFF_SECONDS
        self._files: dict[str, bytes] = {}  # flattened archive member name -> GeoTIFF bytes

    @classmethod
    def is_configured(cls) -> bool:
        return bool(settings.aemet_api_key)

    def _now(self) -> float:
        return time.monotonic()

    def _schedule_retry(self, reason: str) -> None:
        self._retry_at = self._now() + self._backoff
        log.warning("AEMET %s; next attempt in %d minutes", reason, self._backoff // 60)
        self._backoff = min(self._backoff * 2, MAX_BACKOFF_SECONDS)

    def list_latest(self) -> list[ProductRef]:
        if self._now() < self._retry_at:
            return []
        try:
            refs = self._fetch_archive()
        except RateLimited:
            self._schedule_retry("is rate limiting the download")
            return []
        except (OSError, ValueError, tarfile.TarError) as exc:
            self._schedule_retry(f"request failed ({type(exc).__name__}: {exc})")
            return []
        # Success: back to the normal cadence, and forget the penalty
        self._backoff = FIRST_BACKOFF_SECONDS
        self._retry_at = self._now() + POLL_SECONDS
        return refs

    def _fetch_archive(self) -> list[ProductRef]:
        info = json.loads(_get(API_BASE + ENDPOINT, settings.aemet_api_key))
        if info.get("estado") == 429:
            raise RateLimited(ENDPOINT)
        if info.get("estado") != 200 or not info.get("datos"):
            raise ValueError(f"unexpected API answer: {info}")

        archive = _get(info["datos"])
        fetched_at = datetime.now(UTC)
        files: dict[str, bytes] = {}
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:*") as tar:
            members = [m for m in tar.getmembers() if m.isfile()]
            tifs = [m for m in members if m.name.lower().endswith((".tif", ".tiff"))]
            if not tifs:
                names = [m.name for m in members][:20]
                log.warning("AEMET archive without GeoTIFFs; members: %s", names)
            for member in tifs:
                extracted = tar.extractfile(member)
                if extracted is not None and member.size <= MAX_MEMBER_BYTES:
                    files[member.name.replace("/", "_")] = extracted.read()

        refs = [
            ProductRef(self.name, "raster_nacional", name, parse_observed_at(name, fetched_at))
            for name in files
        ]
        refs.sort(key=lambda r: r.observed_at)
        refs = refs[-MAX_FILES:]
        self._files = {r.source_key: files[r.source_key] for r in refs}
        log.info("AEMET archive: %d GeoTIFF files (%d kept)", len(files), len(refs))
        return refs

    def download(self, ref: ProductRef, dest_dir: Path) -> Path:
        dest = dest_dir / ref.source_key
        dest.write_bytes(self._files[ref.source_key])
        return dest
