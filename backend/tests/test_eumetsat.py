import base64
import io
import json
import urllib.error
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.config import settings
from app.providers import eumetsat
from app.providers.eumetsat import EumetsatProvider, parse_search

# A real answer of the EUMETSAT search service (5 MSG cloud-mask products), unmodified
FIXTURE_FILE = Path(__file__).parent / "fixtures" / "eumetsat_search.json"
FIXTURE = json.loads(FIXTURE_FILE.read_text("utf-8"))


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class FakeNetwork:
    """Replaces urllib's urlopen: records the requests and serves canned answers."""

    def __init__(self):
        self.requests = []
        self.token_answer = {"access_token": "tok-1", "expires_in": 3600}
        self.product_bytes = b"PK-zip-of-a-grib"
        self.search_payload = FIXTURE
        self.download_error = None

    def __call__(self, request, timeout=None):
        self.requests.append(request)
        url = request.full_url
        if url.startswith(eumetsat.TOKEN_URL):
            return FakeResponse(json.dumps(self.token_answer).encode())
        if url.startswith(eumetsat.SEARCH_URL):
            return FakeResponse(json.dumps(self.search_payload).encode())
        if self.download_error:
            raise self.download_error
        return FakeResponse(self.product_bytes)

    def of(self, prefix):
        return [r for r in self.requests if r.full_url.startswith(prefix)]


@pytest.fixture
def network(monkeypatch):
    fake = FakeNetwork()
    monkeypatch.setattr(eumetsat.urllib.request, "urlopen", fake)
    monkeypatch.setattr(settings, "eumetsat_consumer_key", "the-key")
    monkeypatch.setattr(settings, "eumetsat_consumer_secret", "the-secret")
    return fake


def test_parse_search_reads_the_real_answer_oldest_first():
    found = parse_search(FIXTURE)
    assert len(found) == 5
    refs = [ref for ref, _ in found]
    assert refs == sorted(refs, key=lambda r: r.observed_at)
    first_ref, first_url = found[0]
    assert first_ref.source_key == "MSG3-SEVI-MSGCLMK-0100-0100-20260921200000.000000000Z-NA"
    assert first_ref.observed_at == datetime(2026, 9, 21, 20, 0, tzinfo=UTC)
    assert first_ref.product_type == "MSGCLMK"
    assert first_ref.provider == "eumetsat"
    assert first_url.startswith("https://api.eumetsat.int/data/download/1.0.0/collections/")
    assert first_url.endswith(first_ref.source_key)


def test_parse_search_skips_products_it_cannot_use():
    good = FIXTURE["features"][0]
    no_link = json.loads(json.dumps(good))
    no_link["properties"]["links"] = {"data": []}
    bad_date = json.loads(json.dumps(good))
    bad_date["properties"]["date"] = "not-a-date"
    found = parse_search({"features": [no_link, bad_date, good]})
    assert [ref.source_key for ref, _ in found] == [good["id"]]
    assert parse_search({}) == []


def test_the_provider_is_switched_off_even_with_credentials(monkeypatch):
    """Temporary: no EUMETSAT keys could be obtained, so the worker must never run it."""
    from app.providers import enabled_providers, is_enabled

    monkeypatch.setattr(settings, "eumetsat_consumer_key", "k")
    monkeypatch.setattr(settings, "eumetsat_consumer_secret", "s")
    assert EumetsatProvider.is_configured() is True  # the keys alone are not enough
    assert is_enabled(EumetsatProvider) is False
    assert "eumetsat" not in [p.name for p in enabled_providers()]


def test_is_configured_needs_both_credentials(monkeypatch):
    monkeypatch.setattr(settings, "eumetsat_consumer_key", "k")
    monkeypatch.setattr(settings, "eumetsat_consumer_secret", "")
    assert EumetsatProvider.is_configured() is False
    monkeypatch.setattr(settings, "eumetsat_consumer_secret", "s")
    assert EumetsatProvider.is_configured() is True


def test_list_latest_searches_the_configured_collection_without_credentials(network, monkeypatch):
    monkeypatch.setattr(settings, "eumetsat_collection", "EO:EUM:DAT:MSG:CLM")
    refs = EumetsatProvider().list_latest()

    assert len(refs) == 5
    (search,) = network.of(eumetsat.SEARCH_URL)
    assert "pi=EO%3AEUM%3ADAT%3AMSG%3ACLM" in search.full_url
    assert "format=json" in search.full_url
    assert "dtstart=" in search.full_url and "dtend=" in search.full_url
    assert "Authorization" not in search.headers  # searching is public
    assert network.of(eumetsat.TOKEN_URL) == []  # no token is asked for just to look


def test_list_latest_survives_network_trouble(network):
    network.search_payload = None  # json.dumps(None) -> b"null": not a search answer

    def broken(request, timeout=None):
        raise urllib.error.URLError("no route to host")

    eumetsat.urllib.request.urlopen = broken
    try:
        assert EumetsatProvider().list_latest() == []
    finally:
        eumetsat.urllib.request.urlopen = network  # restored for other tests in this module


def test_download_gets_a_token_with_basic_auth_then_uses_it_as_bearer(network, tmp_path):
    provider = EumetsatProvider()
    ref = provider.list_latest()[0]

    path = provider.download(ref, tmp_path)

    assert path.name == f"{ref.source_key}.zip"
    assert path.read_bytes() == b"PK-zip-of-a-grib"
    (token_request,) = network.of(eumetsat.TOKEN_URL)
    expected = "Basic " + base64.b64encode(b"the-key:the-secret").decode()
    assert token_request.get_header("Authorization") == expected
    assert token_request.data == b"grant_type=client_credentials"
    product_request = network.requests[-1]
    assert product_request.get_header("Authorization") == "Bearer tok-1"


def test_the_token_is_reused_until_it_is_about_to_expire(network, tmp_path):
    provider = EumetsatProvider()
    clock = {"t": 1000.0}
    provider._now = lambda: clock["t"]  # type: ignore[method-assign]
    refs = provider.list_latest()

    provider.download(refs[0], tmp_path)
    provider.download(refs[1], tmp_path)
    assert len(network.of(eumetsat.TOKEN_URL)) == 1  # one token served both downloads

    clock["t"] += 3600  # expires_in is 3600 s and it is renewed 2 minutes early
    network.token_answer = {"access_token": "tok-2", "expires_in": 3600}
    provider.download(refs[2], tmp_path)
    assert len(network.of(eumetsat.TOKEN_URL)) == 2
    assert network.requests[-1].get_header("Authorization") == "Bearer tok-2"


def test_refused_credentials_pause_the_provider(network, tmp_path):
    provider = EumetsatProvider()
    clock = {"t": 1000.0}
    provider._now = lambda: clock["t"]  # type: ignore[method-assign]
    ref = provider.list_latest()[0]
    network.download_error = urllib.error.HTTPError(ref.source_key, 401, "Unauthorized", {}, None)  # type: ignore[arg-type]

    with pytest.raises(urllib.error.HTTPError):
        provider.download(ref, tmp_path)

    searches = len(network.of(eumetsat.SEARCH_URL))
    assert provider.list_latest() == []  # cooling down: the service is left alone
    assert len(network.of(eumetsat.SEARCH_URL)) == searches
    clock["t"] += eumetsat.AUTH_COOLDOWN_SECONDS + 1
    assert len(provider.list_latest()) == 5  # and it tries again afterwards
