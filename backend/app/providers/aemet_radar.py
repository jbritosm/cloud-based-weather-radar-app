from pathlib import Path

from app.config import settings
from app.providers.base import ProductRef, Provider


class AemetRadarProvider(Provider):
    """TODO: AEMET (Spanish weather service) radar through AEMET OpenData.

    API base: https://opendata.aemet.es/opendata/api, key sent in the `api_key` header.
    Every call returns JSON with a `datos` URL (the file) and a `metadatos` URL.
    Endpoints of interest:
      /red/radar/raster/nacional    georeferenced national radar composite
      /red/radar/raster/regional    georeferenced regional radars
      /red/radar/nacional           plain composite image (not georeferenced)
    According to the AEMET catalogue the raster products are GeoTIFF in EPSG:4326, updated every
    30 minutes, with the three latest images kept. The exact payload (dBZ values or colours, how
    to get each timestamp) must be confirmed with backend/scripts/probe_aemet.py before writing
    the implementation.
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
