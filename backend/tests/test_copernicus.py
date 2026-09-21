from datetime import UTC, datetime, timedelta

import pytest

from app.config import settings
from app.providers import copernicus
from app.providers.copernicus import CopernicusProvider, build_request, parse_area


class FakeCds:
    """Stands in for cdsapi.Client: records the request and writes a file like a download."""

    def __init__(self):
        self.calls = []

    def retrieve(self, name, request, target):
        self.calls.append((name, request, target))
        with open(target, "wb") as out:
            out.write(b"GRIB-data")


def test_parse_area_reads_four_numbers():
    assert parse_area("60,-15,30,30") == [60.0, -15.0, 30.0, 30.0]
    assert parse_area(" 45.5 , -10 , 35 , 5 ") == [45.5, -10.0, 35.0, 5.0]


@pytest.mark.parametrize("bad", ["60,-15,30", "a,b,c,d", "", "1,2,3,4,5"])
def test_parse_area_rejects_anything_else(bad):
    with pytest.raises(ValueError):
        parse_area(bad)


def test_build_request_asks_for_one_day_of_the_documented_parameters():
    request = build_request(datetime(2026, 9, 5, tzinfo=UTC), [60, -15, 30, 30])
    assert request["year"] == ["2026"] and request["month"] == ["09"] and request["day"] == ["05"]
    assert request["variable"] == [
        "2m_temperature",
        "10m_u_component_of_wind",
        "10m_v_component_of_wind",
    ]
    assert request["time"] == ["00:00", "06:00", "12:00", "18:00"]
    assert request["data_format"] == "grib"
    assert request["download_format"] == "unarchived"
    assert request["area"] == [60, -15, 30, 30]


def test_is_configured_depends_on_the_token(monkeypatch):
    monkeypatch.setattr(settings, "cds_api_key", "")
    assert CopernicusProvider.is_configured() is False
    monkeypatch.setattr(settings, "cds_api_key", "token")
    assert CopernicusProvider.is_configured() is True


def test_lists_the_last_available_days_never_today():
    refs = CopernicusProvider().list_latest()

    assert len(refs) == copernicus.DAYS_KEPT
    days = [r.observed_at.date() for r in refs]
    assert days == sorted(days)  # oldest first, consecutive
    assert days[-1] == (datetime.now(UTC) - timedelta(days=copernicus.LATENCY_DAYS)).date()
    assert all((b - a) == timedelta(days=1) for a, b in zip(days, days[1:], strict=False))
    assert all(r.observed_at.hour == 0 for r in refs)
    # one stable id per day, so the worker never asks CDS twice for the same day
    assert refs[-1].source_key == f"era5-single-levels-{days[-1]:%Y%m%d}"


def test_download_sends_the_request_to_cds_and_returns_the_file(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "era5_area", "50,-10,35,5")
    cds = FakeCds()
    provider = CopernicusProvider(client_factory=lambda: cds)
    ref = provider.list_latest()[-1]

    path = provider.download(ref, tmp_path)

    (name, request, target) = cds.calls[0]
    assert name == "reanalysis-era5-single-levels"
    assert request["year"] == [f"{ref.observed_at:%Y}"]
    assert request["day"] == [f"{ref.observed_at:%d}"]
    assert request["area"] == [50.0, -10.0, 35.0, 5.0]  # from the settings
    assert path == tmp_path / f"era5_single_levels_{ref.observed_at:%Y%m%d}.grib"
    assert target == str(path)
    assert path.read_bytes() == b"GRIB-data"


def test_the_default_client_is_built_from_the_settings(monkeypatch):
    seen = {}

    class FakeClient:
        def __init__(self, **kwargs):
            seen.update(kwargs)

    import cdsapi

    monkeypatch.setattr(cdsapi, "Client", FakeClient)
    monkeypatch.setattr(settings, "cds_api_key", "my-token")
    monkeypatch.setattr(settings, "cds_api_url", "https://cds.example/api")

    copernicus._default_client()

    assert seen["url"] == "https://cds.example/api"
    assert seen["key"] == "my-token"
    assert seen["quiet"] is True and seen["progress"] is False  # no progress bars in the logs
    assert seen["retry_max"] == 10  # bounded: the default is 500 attempts
