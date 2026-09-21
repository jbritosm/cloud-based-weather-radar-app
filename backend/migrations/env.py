"""Alembic environment.

Two ways in:
* the application calls `app.db.migrate(engine)`, which hands over an open connection through
  `config.attributes["connection"]`;
* the CLI (`alembic upgrade head`, `alembic revision --autogenerate -m "..."`) builds its own
  engine from DATABASE_URL.
"""

from alembic import context
from sqlalchemy import create_engine

from app.config import settings
from app.db import Base

target_metadata = Base.metadata
config = context.config


def run_migrations_offline() -> None:
    """Emit the SQL instead of running it (`alembic upgrade head --sql`)."""
    context.configure(
        url=settings.database_url, target_metadata=target_metadata, literal_binds=True
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is None:
        engine = create_engine(settings.database_url)
        with engine.connect() as new_connection:
            _run(new_connection)
        return
    _run(connection)


def _run(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
