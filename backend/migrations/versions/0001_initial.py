"""Initial schema: the products table.

Revision ID: 0001
Revises:
Create Date: 2026-09-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "products",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("product_type", sa.String(length=32), nullable=False),
        # "<provider>:<key at the source>", used to avoid ingesting the same file twice
        sa.Column("source_key", sa.String(length=512), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("storage_key", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("source_key"),
    )
    op.create_index("ix_products_provider", "products", ["provider"])
    op.create_index("ix_products_observed_at", "products", ["observed_at"])


def downgrade() -> None:
    op.drop_index("ix_products_observed_at", table_name="products")
    op.drop_index("ix_products_provider", table_name="products")
    op.drop_table("products")
