import os
import tempfile
from pathlib import Path

# Must be set before `app` is imported: the engine is created at import time.
# A fresh directory per run so data from previous runs can't leak in.
os.environ["DATABASE_URL"] = f"sqlite:///{Path(tempfile.mkdtemp()) / 'test.db'}"
