"""
Data models / types for lang-py fixture.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class User:
    id: str
    name: str


@dataclass
class Result:
    ok: bool
    value: Optional[object] = None
    error: Optional[str] = None
