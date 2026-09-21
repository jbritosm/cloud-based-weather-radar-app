from app.providers.aemet_radar import AemetRadarProvider
from app.providers.base import ProductRef, Provider
from app.providers.copernicus import CopernicusProvider
from app.providers.eumetsat import EumetsatProvider
from app.providers.noaa_nexrad import NoaaNexradProvider

# Every data source of the platform. Add new providers here.
REGISTRY: dict[str, type[Provider]] = {
    NoaaNexradProvider.name: NoaaNexradProvider,
    AemetRadarProvider.name: AemetRadarProvider,
    EumetsatProvider.name: EumetsatProvider,
    CopernicusProvider.name: CopernicusProvider,
}


def is_enabled(cls: type[Provider]) -> bool:
    """Implemented and with everything it needs (e.g. an API key) configured."""
    return cls.implemented and cls.is_configured()


def enabled_providers() -> list[Provider]:
    return [cls() for cls in REGISTRY.values() if is_enabled(cls)]


__all__ = ["REGISTRY", "ProductRef", "Provider", "enabled_providers", "is_enabled"]
