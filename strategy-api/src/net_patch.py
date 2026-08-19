"""Disable broken local system proxies before AkShare/Eastmoney calls."""

from __future__ import annotations

import os
from typing import Any

os.environ.setdefault("NO_PROXY", "*")
os.environ.setdefault("no_proxy", "*")

import urllib.request

urllib.request.getproxies = lambda: {}  # type: ignore[assignment]

import requests

_orig_request = requests.Session.request


def _no_proxy_request(self: requests.Session, *args: Any, **kwargs: Any):
    kwargs.setdefault("proxies", {"http": None, "https": None})
    self.trust_env = False
    return _orig_request(self, *args, **kwargs)


requests.Session.request = _no_proxy_request  # type: ignore[method-assign]
