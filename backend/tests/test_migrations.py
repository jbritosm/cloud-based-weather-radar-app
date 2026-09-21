from pathlib import Path

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app import db
from app.db import BACKEND_DIR, Base, migrate


def sqlite_engine(tmp_path: Path):
    return create_engine(f"sqlite:///{tmp_path / 'm.db'}")


def head_revision() -> str:
    from alembic.config import Config

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    return ScriptDirectory.from_config(config).get_current_head()


def current_revision(engine) -> str | None:
    with engine.connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def test_a_new_database_is_built_by_the_migrations(tmp_path):
    engine = sqlite_engine(tmp_path)

    migrate(engine)

    tables = inspect(engine).get_table_names()
    assert "products" in tables and "alembic_version" in tables
    assert current_revision(engine) == head_revision()


def test_migrating_twice_changes_nothing(tmp_path):
    engine = sqlite_engine(tmp_path)
    migrate(engine)
    migrate(engine)
    assert current_revision(engine) == head_revision()


def test_a_database_made_by_the_old_create_all_is_adopted_with_its_data(tmp_path):
    # The production database was created by Base.metadata.create_all(): tables, no alembic_version
    engine = sqlite_engine(tmp_path)
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO products (provider, product_type, source_key, observed_at, created_at)"
                " VALUES ('noaa_nexrad', 'level2', 'noaa_nexrad:k', '2026-01-01', '2026-01-01')"
            )
        )

    migrate(engine)  # must not fail with "table products already exists"

    assert current_revision(engine) == head_revision()
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM products")).scalar() == 1


def test_the_migrations_produce_exactly_the_schema_of_the_models(tmp_path):
    """Fails when someone changes a model and forgets the migration (the classic mistake)."""
    engine = sqlite_engine(tmp_path)
    migrate(engine)
    with engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"compare_type": False})
        differences = compare_metadata(context, Base.metadata)
    assert differences == [], f"models and migrations disagree: {differences}"


def test_the_first_migration_can_be_undone(tmp_path):
    from alembic import command
    from alembic.config import Config

    engine = sqlite_engine(tmp_path)
    migrate(engine)
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "base")
    assert "products" not in inspect(engine).get_table_names()


def test_the_application_startup_runs_the_migrations_on_its_own_engine(monkeypatch):
    seen = []
    monkeypatch.setattr(db, "migrate", seen.append)

    db.init_db()

    assert seen == [db.engine]
