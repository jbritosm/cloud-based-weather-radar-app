"""Ingestion worker: `python -m app.ingest.worker`.

Every enabled provider runs in its own thread and is asked for its newest products on its own
schedule (`poll_seconds`, default INGEST_INTERVAL_SECONDS). New products are downloaded, the raw
file is stored in our bucket and a row is recorded in the DB. One thread per provider means a slow
source (a Copernicus request can wait minutes in a queue) never delays the others.
Later steps (decoding, tile rendering) plug in right after the upload.
"""

import logging
import signal
import tempfile
import threading
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


def provider_loop(provider: Provider, stop: threading.Event) -> None:
    interval = provider.poll_seconds or settings.ingest_interval_seconds
    while not stop.is_set():
        run_once([provider])
        stop.wait(interval)  # returns early when asked to stop


def start_workers(providers: list[Provider], stop: threading.Event) -> list[threading.Thread]:
    threads = [
        threading.Thread(target=provider_loop, args=(p, stop), name=f"ingest-{p.name}", daemon=True)
        for p in providers
    ]
    for thread in threads:
        thread.start()
    return threads


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(threadName)s %(levelname)s %(message)s"
    )
    ensure_bucket()
    providers = enabled_providers()
    log.info("worker started, providers: %s", [p.name for p in providers])

    stop = threading.Event()
    # `docker stop` sends SIGTERM: finish quietly instead of being killed mid-download
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    threads = start_workers(providers, stop)
    for thread in threads:
        thread.join()
    if not threads:
        stop.wait()  # nothing enabled: stay up (and healthy) until stopped


if __name__ == "__main__":
    main()
