from datetime import UTC, datetime

from app.providers.noaa_nexrad import parse_key


def test_parse_key_volume_file():
    assert parse_key("2024/01/01/KTLX/KTLX20240101_000158_V06") == (
        "KTLX",
        datetime(2024, 1, 1, 0, 1, 58, tzinfo=UTC),
    )


def test_parse_key_ignores_metadata_files():
    assert parse_key("2024/01/01/KTLX/KTLX20240101_000158_V06_MDM") is None
    assert parse_key("2024/01/01/KTLX/README") is None
