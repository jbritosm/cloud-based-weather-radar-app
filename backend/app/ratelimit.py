"""Per-client rate limit for the API (a token bucket per client address).

Why it exists: the API is public and runs on a small server, so one client hammering it (a bug, a
scraper, a flood) must not be able to starve everyone else. It is a guard against a single abusive
client, not a defence against a distributed attack: that needs a service in front (a CDN or a WAF).

Why in the application and not in Caddy: Caddy's rate limiting is a third-party plugin, which would
mean building and publishing a custom Caddy image. This is a small, tested ASGI middleware.

Behaviour: each client address may make `limit_per_minute` requests per minute on average, with a
burst of a tenth of that. Above it the API answers 429 with a `Retry-After` header. `/api/health`
is never limited (Docker and the monitoring call it). 0 disables the limit.
"""

import json
import math
import time
from collections.abc import Callable

EXEMPT_PATHS = frozenset({"/api/health"})
_PRUNE_ABOVE = 10_000  # forget idle clients when the table grows past this


class TokenBuckets:
    """One bucket per key. Time comes from `clock`, so tests do not have to sleep."""

    def __init__(self, limit_per_minute: int, clock: Callable[[], float] = time.monotonic):
        self.capacity = max(5.0, limit_per_minute / 10)  # the burst
        self.refill_per_second = limit_per_minute / 60
        self._clock = clock
        self._buckets: dict[str, tuple[float, float]] = {}  # key -> (tokens, last update)

    def take(self, key: str) -> tuple[bool, float]:
        """Try to spend one token. Returns (allowed, seconds until one is available)."""
        now = self._clock()
        tokens, last = self._buckets.get(key, (self.capacity, now))
        tokens = min(self.capacity, tokens + (now - last) * self.refill_per_second)
        if tokens >= 1:
            self._store(key, tokens - 1, now)
            return True, 0.0
        self._store(key, tokens, now)
        return False, (1 - tokens) / self.refill_per_second

    def _store(self, key: str, tokens: float, now: float) -> None:
        self._buckets[key] = (tokens, now)
        if len(self._buckets) > _PRUNE_ABOVE:
            full_after = self.capacity / self.refill_per_second
            self._buckets = {k: v for k, v in self._buckets.items() if now - v[1] < full_after}


def client_address(scope: dict) -> str:
    """The caller's address. Behind Caddy that is the last entry of X-Forwarded-For: the address
    Caddy itself saw. Earlier entries are supplied by the client and cannot be trusted."""
    for name, value in scope.get("headers", []):
        if name == b"x-forwarded-for":
            parts = [p.strip() for p in value.decode("latin-1").split(",") if p.strip()]
            if parts:
                return parts[-1]
    client = scope.get("client")
    return client[0] if client else "unknown"


class RateLimitMiddleware:
    """ASGI middleware. Only HTTP requests are limited."""

    def __init__(self, app, limit_per_minute: int, clock: Callable[[], float] = time.monotonic):
        self.app = app
        self.buckets = TokenBuckets(limit_per_minute, clock) if limit_per_minute > 0 else None

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or self.buckets is None or scope["path"] in EXEMPT_PATHS:
            await self.app(scope, receive, send)
            return

        allowed, wait = self.buckets.take(client_address(scope))
        if allowed:
            await self.app(scope, receive, send)
            return

        body = json.dumps({"detail": "Too many requests"}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 429,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"retry-after", str(max(1, math.ceil(wait))).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
