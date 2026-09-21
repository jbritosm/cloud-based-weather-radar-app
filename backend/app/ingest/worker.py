"""Ingestion worker: `python -m app.ingest.worker`.

Every INGEST_INTERVAL_SECONDS it asks each enabled provider for its newest products,
downloads the ones we have not seen, stores the raw file in our bucket and records it in the DB.
Later steps (decoding, tile rendering) plug in right after the upload.
"""

import logging
import tempfile
import time
from pathlib import Path

from sqlalchemy import select

from app.config import settings
from app.db import Product, SessionLocal
from app.providers import Provider, enabled_providers
from app.storage import ensure_bucket, upload_file

log = logging.getLogger("ingest")


def ingest_provider(provider: Provider) -> int:
    refs = provider.list_latest()
    if not refs:
        return 0
    keys = {f"{r.provider}:{r.source_key}": r for r in refs}
    ingested = 0
    with SessionLocal() as session:
        known = set(session.scalars(select(Product.source_key).where(Product.source_key.in_(keys))))
        for source_key, ref in keys.items():
            if source_key in known:
                continue
            with tempfile.TemporaryDirectory() as tmp:
                local = provider.download(ref, Path(tmp))
                storage_key = f"raw/{ref.provider}/{ref.product_type}/{local.name}"
                upload_file(local, storage_key)
            session.add(
                Product(
                    provider=ref.provider,
                    product_type=ref.product_type,
                    source_key=source_key,
                    observed_at=ref.observed_at,
                    storage_key=storage_key,
                )
            )
            session.commit()
            ingested += 1
            log.info("ingested %s", source_key)
    return ingested


def run_once(providers: list[Provider]) -> None:
    for provider in providers:
        try:
            count = ingest_provider(provider)
            log.info("%s: %d new products", provider.name, count)
        except Exception:
            # One failing provider must not stop the others (or the loop).
            log.exception("%s: ingestion failed", provider.name)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    ensure_bucket()
    providers = enabled_providers()
    log.info("worker started, providers: %s", [p.name for p in providers])
    while True:
        run_once(providers)
        time.sleep(settings.ingest_interval_seconds)


if __name__ == "__main__":
    main()
