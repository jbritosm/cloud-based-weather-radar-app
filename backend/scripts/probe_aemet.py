"""One-off probe: what exactly does AEMET's radar API return?

Runs from the manual GitHub workflow "Probe AEMET" (which injects the AEMET_API_KEY secret), or
locally once you have a key:

    PowerShell:  $env:AEMET_API_KEY = "<key>"; python backend/scripts/probe_aemet.py
    bash:        AEMET_API_KEY=<key> python backend/scripts/probe_aemet.py

It never prints the key. Samples are saved to backend/samples/ (git-ignored). If `tifffile` and
`numpy` are installed (pip install tifffile numpy) it also describes GeoTIFF files in detail.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://opendata.aemet.es/opendata/api"
ENDPOINTS = ["/red/radar/raster/nacional", "/red/radar/nacional"]
OUT = Path(__file__).resolve().parent.parent / "samples"

# TIFF tags that carry the georeferencing
GEO_TAGS = {33550, 33922, 34264, 34735, 34736, 34737, 42112, 42113}


def fetch(url: str, key: str | None = None) -> tuple[bytes, dict[str, str]]:
    headers = {"Accept": "*/*", "User-Agent": "tfg-probe"}
    if key:
        headers["api_key"] = key
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read(), dict(response.headers)


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
        for tag in page.tags.values():
            if tag.code in GEO_TAGS:
                print(f"  tag {tag.code} {tag.name}: {str(tag.value)[:300]}")
        try:
            print("  geotiff metadata:", str(tif.geotiff_metadata)[:600])
        except Exception as exc:
            print("  geotiff metadata unavailable:", exc)
        colormap = page.tags.get("ColorMap")
        print("  has embedded colour palette:", colormap is not None)
        array = page.asarray()
        flat = array.reshape(-1, array.shape[-1]) if array.ndim == 3 else array.reshape(-1, 1)
        unique = np.unique(flat, axis=0)
        print("  distinct values/colours:", len(unique))
        print("  value range:", array.min(), "to", array.max())
        print("  first distinct values:", unique[:12].tolist())
        print("  share of pixels equal to 0:", round(float((flat == 0).all(axis=1).mean()), 3))


def main() -> int:
    key = os.environ.get("AEMET_API_KEY", "").strip()
    if not key:
        print("AEMET_API_KEY is not set (empty secret?).")
        return 1
    OUT.mkdir(exist_ok=True)

    for endpoint in ENDPOINTS:
        print(f"\n=== {endpoint}")
        try:
            body, _ = fetch(BASE + endpoint, key)
        except urllib.error.HTTPError as exc:
            print(f"HTTP {exc.code}: {exc.read()[:300]!r}")
            continue
        info = json.loads(body)
        print("first response:", json.dumps(info, indent=2)[:800])

        if info.get("metadatos"):
            meta, _ = fetch(info["metadatos"])
            print("metadatos:", meta.decode("utf-8", "replace")[:1500])

        if info.get("datos"):
            data, headers = fetch(info["datos"])
            kind = describe_bytes(data)
            sample = OUT / f"{endpoint.strip('/').replace('/', '_')}.{kind.lower()}"
            sample.write_bytes(data)
            print("datos content-type:", headers.get("Content-Type"))
            print("datos content-disposition:", headers.get("Content-Disposition"))
            print("datos size:", len(data), "bytes | detected type:", kind)
            print("first 16 bytes:", data[:16].hex(" "))
            print("saved to:", sample)
            if kind == "TIFF":
                inspect_tiff(sample)
    return 0


if __name__ == "__main__":
    sys.exit(main())
