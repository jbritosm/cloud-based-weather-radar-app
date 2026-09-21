from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.db import Product, get_session, init_db
from app.providers import REGISTRY, is_enabled
from app.ratelimit import RateLimitMiddleware


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


# Everything lives under /api so the reverse proxy (Caddy) can route by prefix.
app = FastAPI(
    title="Weather Radar Platform API",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
app.add_middleware(RateLimitMiddleware, limit_per_minute=settings.rate_limit_per_minute)


class ProviderOut(BaseModel):
    name: str
    implemented: bool  # the code exists
    enabled: bool  # implemented and configured: the worker runs it


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    provider: str
    product_type: str
    observed_at: datetime
    storage_key: str | None


@app.get("/api/health")
def health(session: Session = Depends(get_session)) -> dict[str, str]:
    try:
        session.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    return {"status": "ok"}


@app.get("/api/providers", response_model=list[ProviderOut])
def providers() -> list[ProviderOut]:
    return [
        ProviderOut(name=n, implemented=cls.implemented, enabled=is_enabled(cls))
        for n, cls in REGISTRY.items()
    ]


@app.get("/api/products", response_model=list[ProductOut])
def products(
    provider: str | None = None,
    limit: int = 50,
    session: Session = Depends(get_session),
) -> list[Product]:
    query = select(Product).order_by(Product.observed_at.desc()).limit(min(limit, 200))
    if provider:
        query = query.where(Product.provider == provider)
    return list(session.scalars(query))
