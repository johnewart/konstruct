"""Sub-module that imports from the package root via relative import.

`from . import api` targets the mypackage directory itself, which should
resolve to mypackage/__init__.py.
"""

from . import api


def run():
    print(api("world"))
