from pathlib import Path

from app.providers.base import ProductRef, Provider


class EumetsatProvider(Provider):
    """TODO: EUMETSAT Data Store (MSG / MTG satellite products).

    Needs a free account at https://data.eumetsat.int and API credentials.
    The `eumdac` client and `satpy` are the natural tools to fetch and read the data.
    """

    name = "eumetsat"
    implemented = False

    def list_latest(self) -> list[ProductRef]:
        raise NotImplementedError

    def download(self, ref: ProductRef, dest_dir: Path) -> Path:
        raise NotImplementedError
