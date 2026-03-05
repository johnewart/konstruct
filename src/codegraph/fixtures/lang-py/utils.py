"""
Utility functions for lang-py fixture.
"""

from .constants import DEFAULT_TIMEOUT_MS


def format_date(iso_string: str) -> str:
    from datetime import datetime
    return datetime.fromisoformat(iso_string.replace("Z", "+00:00")).strftime("%Y-%m-%d")


def delay(ms: int = DEFAULT_TIMEOUT_MS) -> None:
    import time
    time.sleep(ms / 1000.0)


def clamp(value: float, min_val: float, max_val: float) -> float:
    return max(min_val, min(max_val, value))
