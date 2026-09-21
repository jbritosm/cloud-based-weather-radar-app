from pathlib import Path

from app.config import settings
from app.providers.base import ProductRef, Provider


class AemetRadarProvider(Provider):
    """TODO: AEMET (Spanish weather service) radar through AEMET OpenData.

    API base: https://opendata.aemet.es/opendata/api, key sent in the `api_key` header.
    Every call returns JSON with a `datos` URL (the file) and a `metadatos` URL; the file itself is
    downloaded from `datos` without the key.

    Findings from backend/scripts/probe_aemet.py (September 2026):

    * /red/radar/regional/{radar}: WORKS. One GIF per regional radar (480x530, a PPI scan of about
      240 km radius), refreshed every 10 minutes. Radar codes: am, sa, ba, ss, cc, co, pa, ca, ma,
      ml, mu, vd, se, va, za. It is NOT georeferenced: region borders, the AEMET logo, a dBZ legend
      and a timestamp label are burnt into the picture, so before it can be drawn on a map the
      radar position and scale must be calibrated and the echo pixels separated from the rest.
    * /red/radar/raster/nacional and /red/radar/raster/regional: the georeferenced product (tar.gz
      of RGBA GeoTIFFs in EPSG:4326, colour scale in the `ESCALA` field, 3 latest images). The API
      call succeeds but the file download is refused every time with "429 Too Many Requests"
      wrapped in an HTTP 500 page, from GitHub runners and from a home connection alike, for more
      than a day. AEMET also answers a real 429 to bursts of about 7 requests in a few seconds.
    * /red/radar/nacional: 404 "Error al obtener los datos".

    Not implemented yet. Options: calibrate and ingest the regional GIFs, or retry the GeoTIFF
    download from the server with a long back-off once AEMET lifts the limit.
    """

    name = "aemet_radar"
    implemented = False

    @classmethod
    def is_configured(cls) -> bool:
        return bool(settings.aemet_api_key)

    def list_latest(self) -> list[ProductRef]:
        raise NotImplementedError

    def download(self, ref: ProductRef, dest_dir: Path) -> Path:
        raise NotImplementedError
