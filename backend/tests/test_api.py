from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.api.main import app
from app.db import Product, SessionLocal


def test_health_and_providers():
    with TestClient(app) as client:  # `with` runs the lifespan (creates tables)
        assert client.get("/api/health").json() == {"status": "ok"}
        providers = {p["name"]: p for p in client.get("/api/providers").json()}
        assert {"noaa_nexrad", "aemet_radar", "eumetsat", "copernicus"} <= providers.keys()
        assert providers["noaa_nexrad"]["enabled"] is True
        assert providers["aemet_radar"]["implemented"] is True
        assert providers["aemet_radar"]["enabled"] is False  # no AEMET_API_KEY in the tests


def test_products_listing_filters_by_provider():
    with TestClient(app) as client:
        with SessionLocal() as session:
            session.add(
                Product(
                    provider="noaa_nexrad",
                    product_type="level2",
                    source_key="noaa_nexrad:test-key",
                    observed_at=datetime(2024, 1, 1, tzinfo=UTC),
                    storage_key="raw/x",
                )
            )
            session.commit()
        rows = client.get("/api/products", params={"provider": "noaa_nexrad"}).json()
        assert any(r["storage_key"] == "raw/x" for r in rows)
        assert client.get("/api/products", params={"provider": "nope"}).json() == []
