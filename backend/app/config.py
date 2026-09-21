from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://tfg:tfg@localhost:5432/tfg"

    # Our own storage bucket. In local dev s3_endpoint_url points to MinIO.
    s3_bucket: str = "tfg-data"
    s3_endpoint_url: str | None = None
    aws_region: str = "eu-west-1"

    # Ingestion worker
    ingest_interval_seconds: int = 300
    nexrad_bucket: str = "unidata-nexrad-level2"  # public NOAA bucket, anonymous access
    nexrad_sites: str = "KTLX,KOKX"  # comma-separated radar site ids
    nexrad_per_site: int = 3  # newest volumes to consider per site on every run


settings = Settings()
