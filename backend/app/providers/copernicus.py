from pathlib import Path

from app.providers.base import ProductRef, Provider


class CopernicusProvider(Provider):
    """TODO: Copernicus data (CDS / ADS: ERA5, CAMS...), model and reanalysis data.

    Needs a free account and API key. Use the `cdsapi` client and `xarray` / `cfgrib`.
    """

    name = "copernicus"
    implemented = False

    def list_latest(self) -> list[ProductRef]:
        raise NotImplementedError

    def download(self, ref: ProductRef, dest_dir: Path) -> Path:
        raise NotImplementedError
