from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.ratelimit import RateLimitMiddleware, TokenBuckets, client_address


class Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def test_a_client_can_burst_then_is_refused_then_recovers():
    clock = Clock()
    buckets = TokenBuckets(limit_per_minute=60, clock=clock)  # 1 request/second, burst of 6

    assert buckets.capacity == 6
    assert [buckets.take("a")[0] for _ in range(6)] == [True] * 6
    allowed, wait = buckets.take("a")
    assert allowed is False
    assert 0 < wait <= 1  # one second until the next token

    clock.t += 1  # a second later: exactly one more request
    assert buckets.take("a")[0] is True
    assert buckets.take("a")[0] is False

    clock.t += 3600  # long idle: the bucket refills, but never beyond the burst size
    assert [buckets.take("a")[0] for _ in range(6)] == [True] * 6
    assert buckets.take("a")[0] is False


def test_each_client_has_its_own_bucket():
    buckets = TokenBuckets(limit_per_minute=60, clock=Clock())
    for _ in range(6):
        buckets.take("noisy")
    assert buckets.take("noisy")[0] is False
    assert buckets.take("quiet")[0] is True


def test_the_burst_has_a_minimum_for_very_low_limits():
    assert TokenBuckets(limit_per_minute=10, clock=Clock()).capacity == 5


def test_idle_clients_are_forgotten_when_the_table_grows(monkeypatch):
    import app.ratelimit as module

    monkeypatch.setattr(module, "_PRUNE_ABOVE", 50)
    clock = Clock()
    buckets = TokenBuckets(limit_per_minute=60, clock=clock)
    for n in range(50):
        buckets.take(f"old-{n}")
    clock.t += 3600  # they have all been idle for an hour
    buckets.take("new-1")
    buckets.take("new-2")
    assert len(buckets._buckets) <= 3


def test_client_address_trusts_only_the_last_forwarded_entry():
    def scope(header=None, client=("10.0.0.9", 1234)):
        headers = [(b"x-forwarded-for", header.encode())] if header else []
        return {"headers": headers, "client": client}

    assert client_address(scope("203.0.113.7")) == "203.0.113.7"
    # a client can prepend anything it likes; Caddy appends the address it really saw
    assert client_address(scope("1.1.1.1, 2.2.2.2, 203.0.113.7")) == "203.0.113.7"
    assert client_address(scope()) == "10.0.0.9"
    assert client_address({"headers": []}) == "unknown"


def make_app(limit):
    app = FastAPI()
    app.add_middleware(RateLimitMiddleware, limit_per_minute=limit, clock=Clock())

    @app.get("/api/thing")
    def thing():
        return {"ok": True}

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    return TestClient(app)


def test_over_the_limit_the_api_answers_429_with_retry_after():
    client = make_app(limit=60)  # burst of 6, frozen clock: no refill
    assert [client.get("/api/thing").status_code for _ in range(6)] == [200] * 6

    response = client.get("/api/thing")

    assert response.status_code == 429
    assert response.json() == {"detail": "Too many requests"}
    assert int(response.headers["retry-after"]) >= 1


def test_the_health_check_is_never_limited():
    client = make_app(limit=60)
    for _ in range(20):
        client.get("/api/thing")
    assert all(client.get("/api/health").status_code == 200 for _ in range(50))


def test_zero_disables_the_limit():
    client = make_app(limit=0)
    assert all(client.get("/api/thing").status_code == 200 for _ in range(200))


def test_different_forwarded_addresses_do_not_share_a_bucket():
    client = make_app(limit=60)
    for _ in range(6):
        client.get("/api/thing", headers={"x-forwarded-for": "198.51.100.1"})
    assert client.get("/api/thing", headers={"x-forwarded-for": "198.51.100.1"}).status_code == 429
    assert client.get("/api/thing", headers={"x-forwarded-for": "198.51.100.2"}).status_code == 200
