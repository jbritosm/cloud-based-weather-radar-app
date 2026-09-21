from app.providers.base import ProductRef, Provider
from app.providers.copernicus import CopernicusProvider
from app.providers.eumetsat import EumetsatProvider
from app.providers.noaa_nexrad import NoaaNexradProvider

# Every data source of the platform. Add new providers here.
REGISTRY: dict[str, type[Provider]] = {
    NoaaNexradProvider.name: NoaaNexradProvider,
    EumetsatProvider.name: EumetsatProvider,
    CopernicusProvider.name: CopernicusProvider,
}


def enabled_providers() -> list[Provider]:
    return [cls() for cls in REGISTRY.values() if cls.implemented]


__all__ = ["REGISTRY", "ProductRef", "Provider", "enabled_providers"]
