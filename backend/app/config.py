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

    # AEMET OpenData (Spain). Free key from https://opendata.aemet.es. Empty = provider disabled.
    aemet_api_key: str = ""

    # EUMETSAT Data Store. Free consumer key + secret from https://api.eumetsat.int/api-key
    # (Searching is public; downloading needs the credentials. Empty = provider disabled.)
    eumetsat_consumer_key: str = ""
    eumetsat_consumer_secret: str = ""
    eumetsat_collection: str = "EO:EUM:DAT:MSG:CLM"  # MSG cloud mask: about 0.5 MB every 15 min

    # Copernicus Climate Data Store (ERA5). Free personal access token from your CDS profile.
    cds_api_key: str = ""
    cds_api_url: str = "https://cds.climate.copernicus.eu/api"
    era5_area: str = "60,-15,30,30"  # north,west,south,east of the area to request (Europe)

    # API protection: requests per minute allowed from one client address (0 = no limit)
    rate_limit_per_minute: int = 600


settings = Settings()
