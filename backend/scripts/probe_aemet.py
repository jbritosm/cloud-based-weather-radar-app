"""One-off probe: what exactly does AEMET's radar API return?

Runs from the manual GitHub workflow "Probe AEMET" (which injects the AEMET_API_KEY secret), or
locally once you have a key:

    PowerShell:  $env:AEMET_API_KEY = "<key>"; python backend/scripts/probe_aemet.py
    bash:        AEMET_API_KEY=<key> python backend/scripts/probe_aemet.py

It never prints the key. Samples are saved to backend/samples/ (git-ignored). If `tifffile` and
`numpy` are installed (pip install tifffile numpy) it also describes GeoTIFF files in detail.

Known so far (from AEMET's own metadata): the API answers in two steps (JSON with a `datos` URL,
then the file), the file is a tar.gz of GeoTIFFs in EPSG:4326 with RGBA colours, and the
`ESCALA` field maps colours to values.
"""

import io
import json
import os
import sys
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://opendata.aemet.es/opendata/api"
# /red/radar/nacional (plain image) answered 404 "Error al obtener los datos": not needed anyway
ENDPOINTS = ["/red/radar/raster/nacional"]
OUT = Path(__file__).resolve().parent.parent / "samples"

# AEMET limits requests per minute and reports it as "HTTP 500 ... 429 Too Many Requests ...
# vuelva a intentarlo el próximo minuto": wait for the next minute before retrying.
RATE_LIMIT_WAIT_SECONDS = 65

# TIFF tags that are big binary tables, not useful to print
SKIP_TAGS = {273, 279, 324, 325, 320}


def fetch(url: str, key: str | None = None, attempts: int = 4) -> tuple[bytes, dict[str, str]]:
    """GET with retries on server errors and on AEMET's rate limit."""
    last: urllib.error.HTTPError | None = None
    for attempt in range(1, attempts + 1):
        headers = {"Accept": "*/*", "User-Agent": "tfg-probe"}
        if key:
            headers["api_key"] = key
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read(), dict(response.headers)
        except urllib.error.HTTPError as exc:
            body = exc.read()
            limited = exc.code == 429 or b"429" in body or b"Too Many Requests" in body
            print(f"  attempt {attempt}/{attempts}: HTTP {exc.code}"
                  f"{' (rate limited)' if limited else ''} body={body[:200]!r}")
            if exc.code < 500 and exc.code != 429:
                raise
            last = exc
            if attempt < attempts:
                wait = RATE_LIMIT_WAIT_SECONDS if limited else 5 * attempt
                print(f"  waiting {wait}s before retrying")
                time.sleep(wait)
    assert last is not None
    raise last


def describe_bytes(data: bytes) -> str:
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return "TIFF"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "PNG"
    if data[:3] == b"GIF":
        return "GIF"
    if data[:2] == b"PK":
        return "ZIP"
    if data[:2] == b"\x1f\x8b":
        return "GZIP"
    return "unknown"


def inspect_tiff(path: Path) -> None:
    try:
        import numpy as np
        import tifffile
    except ImportError:
        print("  (install tifffile and numpy to inspect the TIFF in detail)")
        return
    with tifffile.TiffFile(path) as tif:
        print("  pages:", len(tif.pages))
        page = tif.pages[0]
        print("  shape:", page.shape, "dtype:", page.dtype)
        print("  photometric:", page.photometric.name, "| compression:", page.compression.name)
        # Every tag except the big offset tables: georeferencing and the ESCALA scale live here
        for tag in page.tags.values():
            if tag.code in SKIP_TAGS:
                continue
            limit = 3000 if tag.code == 42112 else 400  # 42112 = GDAL metadata (XML)
            print(f"  tag {tag.code} {tag.name}: {str(tag.value)[:limit]}")
        try:
            print("  geotiff metadata:", str(tif.geotiff_metadata)[:800])
        except Exception as exc:
            print("  geotiff metadata unavailable:", exc)
        array = page.asarray()
        flat = array.reshape(-1, array.shape[-1]) if array.ndim == 3 else array.reshape(-1, 1)
        unique = np.unique(flat, axis=0)
        print("  distinct values/colours:", len(unique))
        print("  value range:", array.min(), "to", array.max())
        print("  first distinct values:", unique[:12].tolist())
        print("  share of pixels equal to 0:", round(float((flat == 0).all(axis=1).mean()), 3))
        if array.ndim == 3 and array.shape[-1] == 4:
            print("  share of fully transparent pixels:", round(float((flat[:, 3] == 0).mean()), 3))


def handle_payload(label: str, data: bytes, headers: dict[str, str]) -> None:
    kind = describe_bytes(data)
    print("datos content-type:", headers.get("Content-Type"))
    print("datos content-disposition:", headers.get("Content-Disposition"))
    print("datos size:", len(data), "bytes | detected type:", kind)
    print("first 16 bytes:", data[:16].hex(" "))
    raw = OUT / f"{label}.{kind.lower()}"
    raw.write_bytes(data)
    print("saved to:", raw)

    if kind == "TIFF":
        inspect_tiff(raw)
        return
    if kind in ("GIF", "PNG"):
        return  # a plain image: nothing more to unpack
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as tar:
            members = [m for m in tar.getmembers() if m.isfile()]
            print(f"tar archive with {len(members)} files:")
            for member in members[:60]:
                print(f"  {member.name} ({member.size} bytes)")
            dest = OUT / label
            dest.mkdir(exist_ok=True)
            tifs = [m for m in members if m.name.lower().endswith((".tif", ".tiff"))]
            for member in tifs[:2]:
                target = dest / Path(member.name).name  # basename only
                extracted = tar.extractfile(member)
                if extracted is None:
                    continue
                target.write_bytes(extracted.read())
                print(f"--- inspecting {member.name}")
                inspect_tiff(target)
    except tarfile.TarError as exc:
        print("not a tar archive:", exc)


def probe(endpoint: str, key: str, attempts: int) -> None:
    """Two requests in total (API call + file download) to stay well inside AEMET's limits."""
    print(f"\n=== {endpoint}")
    try:
        body, _ = fetch(BASE + endpoint, key, attempts=1)
    except urllib.error.HTTPError as exc:
        print(f"API call failed: HTTP {exc.code}")
        return
    info = json.loads(body)
    print("first response:", json.dumps(info, indent=2)[:800])
    if not info.get("datos"):
        print("no `datos` URL in the response")
        return
    try:
        data, headers = fetch(info["datos"], attempts=attempts)
    except urllib.error.HTTPError as exc:
        print(f"download failed: HTTP {exc.code}")
        return
    handle_payload(endpoint.strip("/").replace("/", "_"), data, headers)


def main() -> int:
    """Endpoints to try can be passed as arguments; PROBE_ATTEMPTS sets download attempts."""
    key = os.environ.get("AEMET_API_KEY", "").strip()
    if not key:
        print("AEMET_API_KEY is not set (empty secret?).")
        return 1
    endpoints = sys.argv[1:] or ENDPOINTS
    attempts = int(os.environ.get("PROBE_ATTEMPTS", "4"))
    OUT.mkdir(exist_ok=True)
    for index, endpoint in enumerate(endpoints):
        if index:
            time.sleep(3)  # be polite between candidates
        try:
            probe(endpoint, key, attempts)
        except Exception as exc:  # keep going: one failing endpoint must not hide the others
            print(f"{endpoint}: unexpected {type(exc).__name__}: {exc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
