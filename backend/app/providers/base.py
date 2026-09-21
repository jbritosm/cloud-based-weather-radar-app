from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


@dataclass(frozen=True)
class ProductRef:
    """Pointer to a product available at a provider, before downloading it."""

    provider: str
    product_type: str
    source_key: str  # unique id at the provider (e.g. S3 key or product id)
    observed_at: datetime  # timezone-aware, UTC


class Provider(ABC):
    """Common interface for every meteorological data source (NOAA, EUMETSAT, Copernicus...)."""

    name: str
    implemented: bool = False

    @abstractmethod
    def list_latest(self) -> list[ProductRef]:
        """Newest products available at the source."""

    @abstractmethod
    def download(self, ref: ProductRef, dest_dir: Path) -> Path:
        """Download the product into dest_dir and return the local file path."""
