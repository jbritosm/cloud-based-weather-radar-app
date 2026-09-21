import threading
import time

from app.config import settings
from app.ingest import worker
from app.providers.base import ProductRef, Provider


class CountingProvider(Provider):
    name = "counting"
    implemented = True

    def __init__(self, block: threading.Event | None = None, fail: bool = False):
        self.calls = 0
        self._block = block
        self._fail = fail

    def list_latest(self) -> list[ProductRef]:
        self.calls += 1
        if self._fail:
            raise RuntimeError("provider is broken")
        if self._block is not None:
            self._block.wait(timeout=10)  # a slow source, like a queued Copernicus request
        return []

    def download(self, ref, dest_dir):  # pragma: no cover - never reached: nothing to download
        raise NotImplementedError


def wait_for(condition, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.01)
    return False


def test_a_slow_provider_does_not_delay_the_others(monkeypatch):
    monkeypatch.setattr(settings, "ingest_interval_seconds", 0.01)
    release = threading.Event()
    slow = CountingProvider(block=release)
    fast = CountingProvider()
    stop = threading.Event()

    threads = worker.start_workers([slow, fast], stop)
    try:
        # the fast provider keeps being checked while the slow one is still stuck in its first call
        assert wait_for(lambda: fast.calls >= 3)
        assert slow.calls == 1
    finally:
        stop.set()
        release.set()
        for thread in threads:
            thread.join(timeout=5)
    assert not any(t.is_alive() for t in threads)


def test_each_provider_uses_its_own_interval(monkeypatch):
    monkeypatch.setattr(settings, "ingest_interval_seconds", 3600)  # the default: very slow
    quick = CountingProvider()
    quick.poll_seconds = 0.01  # type: ignore[assignment]  # this source asks to be checked often
    default = CountingProvider()
    stop = threading.Event()

    threads = worker.start_workers([quick, default], stop)
    try:
        assert wait_for(lambda: quick.calls >= 3)
        assert default.calls == 1  # still waiting for its one-hour interval
    finally:
        stop.set()
        for thread in threads:
            thread.join(timeout=5)


def test_a_failing_provider_keeps_being_retried_and_does_not_kill_its_thread(monkeypatch):
    monkeypatch.setattr(settings, "ingest_interval_seconds", 0.01)
    broken = CountingProvider(fail=True)
    stop = threading.Event()

    threads = worker.start_workers([broken], stop)
    try:
        assert wait_for(lambda: broken.calls >= 3)
        assert threads[0].is_alive()
    finally:
        stop.set()
        for thread in threads:
            thread.join(timeout=5)


def test_stopping_interrupts_the_wait_between_checks(monkeypatch):
    monkeypatch.setattr(settings, "ingest_interval_seconds", 3600)
    provider = CountingProvider()
    stop = threading.Event()
    threads = worker.start_workers([provider], stop)
    assert wait_for(lambda: provider.calls == 1)

    started = time.monotonic()
    stop.set()
    threads[0].join(timeout=5)

    assert not threads[0].is_alive()
    assert time.monotonic() - started < 2  # it did not sit out the hour
