"""EUMETSAT Data Store: Meteosat products, by default the MSG Cloud Mask.

Two things are different about this service, and both shaped the code:

* **Searching is public, downloading is not.** The search endpoint answers without credentials
  (verified against the live service); a product is only handed out to a request that carries an
  OAuth2 token, obtained with the free consumer key and secret from https://api.eumetsat.int/api-key.
  So `is_configured()` requires the credentials (the worker must not try to download without them),
  while `list_latest()` itself needs none.
* **Products are small for this collection**: a cloud mask is about 0.5 MB every 15 minutes
  (about 50 MB a day), which suits a small server. Full satellite images (High Rate SEVIRI) are
  hundreds of MB each and would not.

The downloaded file is a zip holding the product (GRIB for the cloud mask). It is stored as it
comes; decoding it (eccodes / satpy) belongs to the processing stage.

Not yet verified against the live service: the token request and the authenticated download,
which need credentials. The endpoints and the request format follow EUMETSAT's documentation
(`POST /token` with HTTP Basic auth and `grant_type=client_credentials`, then a Bearer token).
"""

import base64
import json
import logging
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.config import settings
from app.providers.base import ProductRef, Provider

log = logging.getLogger("eumetsat")

SEARCH_URL = "https://api.eumetsat.int/data/search-products/1.0.0/os"
TOKEN_URL = "https://api.eumetsat.int/token"

LOOKBACK = timedelta(hours=2)  # how far back each check looks (products arrive every 15 minutes)
AUTH_COOLDOWN_SECONDS = 60 * 60  # after the credentials are refused: do not hammer the service


def parse_search(payload: dict) -> list[tuple[ProductRef, str]]:
    """Products of a search answer as (reference, download URL), oldest first."""
    found: list[tuple[ProductRef, str]] = []
    for feature in payload.get("features", []):
        props = feature.get("properties", {})
        start = str(props.get("date", "")).split("/")[0]
        try:
            observed_at = datetime.fromisoformat(start.replace("Z", "+00:00"))
        except ValueError:
            continue
        links = props.get("links", {}).get("data", [])
        href = next((link["href"] for link in links if link.get("href")), None)
        if not href or "id" not in feature:
            continue
        product_type = props.get("productInformation", {}).get("productType") or "product"
        ref = ProductRef("eumetsat", product_type, feature["id"], observed_at)
        found.append((ref, href))
    found.sort(key=lambda item: item[0].observed_at)
    return found


def _read(request: urllib.request.Request) -> bytes:
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


class EumetsatProvider(Provider):
    name = "eumetsat"
    # TEMPORARILY DISABLED: the EUMETSAT key page failed with "Unable to get or create
    # subscriptions for user", so there are no credentials to download with. While False the worker
    # never runs it (even if keys are configured) and the UI shows it as "planned". The code and
    # its tests are complete: set this back to True once EUMETSAT_CONSUMER_KEY/SECRET exist.
    implemented = False

    def __init__(self) -> None:
        self._urls: dict[str, str] = {}  # product id -> download URL, from the last search
        self._token = ""
        self._token_expires = 0.0
        self._retry_at = 0.0

    @classmethod
    def is_configured(cls) -> bool:
        return bool(settings.eumetsat_consumer_key and settings.eumetsat_consumer_secret)

    def _now(self) -> float:
        return time.monotonic()

    def list_latest(self) -> list[ProductRef]:
        if self._now() < self._retry_at:
            return []
        end = datetime.now(UTC)
        query = urllib.parse.urlencode(
            {
                "pi": settings.eumetsat_collection,
                "dtstart": (end - LOOKBACK).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "dtend": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "format": "json",
            }
        )
        try:
            payload = json.loads(_read(urllib.request.Request(f"{SEARCH_URL}?{query}")))
        except (OSError, ValueError) as exc:  # network trouble or an unreadable answer
            log.warning("EUMETSAT search failed (%s: %s)", type(exc).__name__, exc)
            return []
        found = parse_search(payload)
        self._urls = {ref.source_key: href for ref, href in found}
        return [ref for ref, _ in found]

    def _access_token(self) -> str:
        if self._token and self._now() < self._token_expires:
            return self._token
        credentials = f"{settings.eumetsat_consumer_key}:{settings.eumetsat_consumer_secret}"
        request = urllib.request.Request(
            TOKEN_URL,
            data=b"grant_type=client_credentials",
            headers={
                "Authorization": "Basic " + base64.b64encode(credentials.encode()).decode(),
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        answer = json.loads(_read(request))
        self._token = answer["access_token"]
        # renew a little early so a download never starts with a token about to expire
        self._token_expires = self._now() + max(60, int(answer.get("expires_in", 3600)) - 120)
        return self._token

    def download(self, ref: ProductRef, dest_dir: Path) -> Path:
        url = self._urls[ref.source_key]
        dest = dest_dir / f"{ref.source_key}.zip"
        try:
            request = urllib.request.Request(
                url, headers={"Authorization": f"Bearer {self._access_token()}"}
            )
            with urllib.request.urlopen(request, timeout=120) as response, dest.open("wb") as out:
                shutil.copyfileobj(response, out)
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                self._retry_at = self._now() + AUTH_COOLDOWN_SECONDS
                self._token = ""
                log.warning(
                    "EUMETSAT refused the credentials (HTTP %s); not trying again for %d minutes",
                    exc.code,
                    AUTH_COOLDOWN_SECONDS // 60,
                )
            raise
        return dest
