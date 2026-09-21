import io
import json
import tarfile
from datetime import UTC, datetime

from app.config import settings
from app.providers import aemet_radar
from app.providers.aemet_radar import AemetRadarProvider, RateLimited, parse_observed_at


def make_archive(names: list[str]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for name in names:
            payload = f"data of {name}".encode()
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
    return buffer.getvalue()


class FakeAemet:
    """Stands in for the network: records the calls and serves canned answers."""

    def __init__(self, archive: bytes):
        self.archive = archive
        self.calls: list[str] = []
        self.rate_limited = False

    def __call__(self, url: str, key: str | None = None) -> bytes:
        self.calls.append(url)
        if url.endswith("/red/radar/raster/nacional"):
            assert key == "test-key"
            return json.dumps({"estado": 200, "datos": "https://aemet.test/sh/abc"}).encode()
        if self.rate_limited:
            raise RateLimited(url)
        return self.archive


def make_provider(monkeypatch, fake: FakeAemet):
    monkeypatch.setattr(settings, "aemet_api_key", "test-key")
    monkeypatch.setattr(aemet_radar, "_get", fake)
    clock = {"t": 1000.0}
    provider = AemetRadarProvider()
    provider._now = lambda: clock["t"]  # type: ignore[method-assign]
    return provider, clock


def test_parse_observed_at_from_file_name_or_fallback():
    fallback = datetime(2000, 1, 1, tzinfo=UTC)
    assert parse_observed_at("radar_nacional_202609212130.tif", fallback) == datetime(
        2026, 9, 21, 21, 30, tzinfo=UTC
    )
    assert parse_observed_at("nacional-20260921T2130.tif", fallback) == datetime(
        2026, 9, 21, 21, 30, tzinfo=UTC
    )
    assert parse_observed_at("no_timestamp_here.tif", fallback) == fallback
    assert parse_observed_at("bad_202613452599.tif", fallback) == fallback  # month 13


def test_is_configured_depends_on_the_key(monkeypatch):
    monkeypatch.setattr(settings, "aemet_api_key", "")
    assert AemetRadarProvider.is_configured() is False
    monkeypatch.setattr(settings, "aemet_api_key", "k")
    assert AemetRadarProvider.is_configured() is True


def test_lists_only_geotiffs_and_downloads_them(monkeypatch, tmp_path):
    fake = FakeAemet(
        make_archive(["dir/comp_202609212100.tif", "dir/comp_202609212130.TIF", "dir/readme.txt"])
    )
    provider, _ = make_provider(monkeypatch, fake)

    refs = provider.list_latest()

    keys = [r.source_key for r in refs]
    assert keys == ["dir_comp_202609212100.tif", "dir_comp_202609212130.TIF"]
    assert refs[0].observed_at == datetime(2026, 9, 21, 21, 0, tzinfo=UTC)
    assert refs[0].product_type == "raster_nacional"
    downloaded = provider.download(refs[1], tmp_path)
    assert downloaded.read_bytes() == b"data of dir/comp_202609212130.TIF"


def test_waits_a_poll_interval_after_success(monkeypatch):
    fake = FakeAemet(make_archive(["a_202609212100.tif"]))
    provider, clock = make_provider(monkeypatch, fake)
    provider.list_latest()
    assert len(fake.calls) == 2  # one API call + one download

    clock["t"] += 60
    assert provider.list_latest() == []  # too soon: AEMET is not contacted
    assert len(fake.calls) == 2

    clock["t"] += aemet_radar.POLL_SECONDS
    assert len(provider.list_latest()) == 1
    assert len(fake.calls) == 4


def test_backs_off_exponentially_when_rate_limited(monkeypatch):
    fake = FakeAemet(make_archive(["a_202609212100.tif"]))
    fake.rate_limited = True
    provider, clock = make_provider(monkeypatch, fake)

    assert provider.list_latest() == []  # refused: back off 30 min
    calls = len(fake.calls)
    clock["t"] += aemet_radar.FIRST_BACKOFF_SECONDS - 1
    assert provider.list_latest() == []
    assert len(fake.calls) == calls  # still waiting

    clock["t"] += 2
    assert provider.list_latest() == []  # tries again, refused again: back off 60 min
    assert len(fake.calls) == calls + 2
    clock["t"] += aemet_radar.FIRST_BACKOFF_SECONDS + 1
    assert provider.list_latest() == []
    assert len(fake.calls) == calls + 2  # 30 minutes is no longer enough

    fake.rate_limited = False  # AEMET lifts the limit
    clock["t"] += aemet_radar.FIRST_BACKOFF_SECONDS
    assert len(provider.list_latest()) == 1
    assert provider._backoff == aemet_radar.FIRST_BACKOFF_SECONDS  # penalty forgotten
