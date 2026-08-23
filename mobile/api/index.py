# The ONLY file under api/ that defines an app object. Vercel's Python
# builder turns every top-level api/*.py file that exports an app/handler
# into its own separate Function — real code lives in backend/ (outside
# api/) specifically so it's never at risk of being mistaken for one.
from backend.main import app  # noqa: F401
