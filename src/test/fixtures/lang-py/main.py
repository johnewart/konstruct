"""
Entry point for lang-py fixture.
"""

from .constants import API_BASE, MAX_RETRIES
from .models import User, Result
from .utils import format_date, clamp


def run(user: User) -> str:
    return format_date(__import__("datetime").datetime.now().isoformat())


__all__ = ["run", "clamp", "API_BASE", "MAX_RETRIES", "User", "Result"]
