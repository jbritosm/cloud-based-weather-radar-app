from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import DateTime, Engine, String, create_engine, inspect
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Product(Base):
    """A meteorological product (radar volume, satellite image...) we have ingested."""

    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(32), index=True)
    product_type: Mapped[str] = mapped_column(String(32))
    # "<provider>:<key at the source>", used to avoid ingesting the same file twice
    source_key: Mapped[str] = mapped_column(String(512), unique=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    # Where we stored the raw file in our own bucket
    storage_key: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


BACKEND_DIR = Path(__file__).resolve().parent.parent  # holds alembic.ini and migrations/
BASELINE = "0001"  # the schema that create_all() used to build, before migrations existed


def migrate(target: Engine) -> None:
    """Bring the database up to the newest schema (`alembic upgrade head`).

    A database created by an older version of the app (tables but no alembic_version) already has
    the baseline schema: it is adopted (stamped) instead of failing on "table already exists".
    """
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    with target.begin() as connection:
        config.attributes["connection"] = connection
        tables = inspect(connection).get_table_names()
        if "products" in tables and "alembic_version" not in tables:
            command.stamp(config, BASELINE)
        command.upgrade(config, "head")


def init_db() -> None:
    migrate(engine)


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
