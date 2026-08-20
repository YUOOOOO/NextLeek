from __future__ import annotations

import os
import time
from typing import Any

import pandas as pd
import requests


class TushareClient:
    """统一访问直连 Tushare Pro 与 Promax 聚合接口。"""

    def __init__(self) -> None:
        self.provider = os.getenv("TUSHARE_PROVIDER", "auto").strip().lower()
        self.pro_url = os.getenv("TUSHARE_PRO_URL", "https://api.tushare.pro").rstrip("/")
        self.pro_token = (
            os.getenv("TUSHARE_TOKEN")
            or os.getenv("TUSHARE_PRO_TOKEN")
            or ""
        ).strip()
        self.promax_url = os.getenv(
            "TUSHARE_PROMAX_URL",
            "https://pcd.mobcvb.cn/tushare/pro",
        ).rstrip("/")
        self.promax_key = (
            os.getenv("TUSHARE_PROMAX_KEY")
            or os.getenv("TUSHARE_API_KEY")
            or ""
        ).strip()
        self.timeout = float(os.getenv("TUSHARE_TIMEOUT", "30"))
        self.retries = max(1, int(os.getenv("TUSHARE_RETRIES", "3")))
        self.promax_verify_ssl = os.getenv("TUSHARE_PROMAX_VERIFY_SSL", "0") == "1"
        self.session = requests.Session()
        self.session.trust_env = False

        if self.provider not in {"auto", "pro", "promax"}:
            raise ValueError("TUSHARE_PROVIDER must be auto, pro, or promax")
        if self.provider == "pro" and not self.pro_token:
            raise ValueError("TUSHARE_TOKEN is required when TUSHARE_PROVIDER=pro")
        if self.provider == "promax" and not self.promax_key:
            raise ValueError("TUSHARE_PROMAX_KEY is required when TUSHARE_PROVIDER=promax")
        if self.provider == "auto" and not self.pro_token and not self.promax_key:
            raise ValueError(
                "Configure TUSHARE_TOKEN or TUSHARE_PROMAX_KEY before updating market data"
            )

    def _providers(self) -> list[str]:
        if self.provider == "pro":
            return ["pro"]
        if self.provider == "promax":
            return ["promax"]
        providers: list[str] = []
        if self.pro_token:
            providers.append("pro")
        if self.promax_key:
            providers.append("promax")
        return providers

    def _request_pro(self, api_name: str, params: dict[str, Any]) -> dict[str, Any]:
        response = self.session.post(
            self.pro_url,
            json={
                "api_name": api_name,
                "token": self.pro_token,
                "params": params,
                "fields": "",
            },
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()

    def _request_promax(self, api_name: str, params: dict[str, Any]) -> dict[str, Any]:
        response = self.session.get(
            f"{self.promax_url}/{api_name}",
            params=params,
            headers={"X-API-Key": self.promax_key},
            verify=self.promax_verify_ssl,
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()

    @staticmethod
    def _to_frame(payload: dict[str, Any], api_name: str) -> pd.DataFrame:
        if not isinstance(payload, dict):
            raise ValueError(f"Tushare {api_name} returned a non-object response")
        code = payload.get("code")
        if code not in (None, 0):
            message = payload.get("msg") or payload.get("detail") or "unknown error"
            raise RuntimeError(f"Tushare {api_name} failed ({code}): {message}")
        data = payload.get("data") or {}
        fields = data.get("fields") or []
        items = data.get("items") or []
        if not fields:
            return pd.DataFrame()
        return pd.DataFrame(items, columns=fields)

    def query(self, api_name: str, **params: Any) -> pd.DataFrame:
        errors: list[str] = []
        for provider in self._providers():
            for attempt in range(self.retries):
                try:
                    payload = (
                        self._request_pro(api_name, params)
                        if provider == "pro"
                        else self._request_promax(api_name, params)
                    )
                    return self._to_frame(payload, api_name)
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{provider} attempt {attempt + 1}: {exc}")
                    if attempt + 1 < self.retries:
                        time.sleep(0.8 * (attempt + 1))
        detail = "; ".join(errors[-4:])
        raise RuntimeError(f"Tushare {api_name} request failed: {detail}")

    def fund_daily(self, code: str, start: str, end: str) -> pd.DataFrame:
        return self.query(
            os.getenv("TUSHARE_FUND_DAILY_API", "fund_daily"),
            ts_code=code,
            start_date=start.replace("-", ""),
            end_date=end.replace("-", ""),
        )

    def stock_daily(self, code: str, start: str, end: str) -> pd.DataFrame:
        return self.query(
            os.getenv("TUSHARE_STOCK_DAILY_API", "daily"),
            ts_code=code,
            start_date=start.replace("-", ""),
            end_date=end.replace("-", ""),
        )

    def fund_share(self, code: str, start: str, end: str) -> pd.DataFrame:
        return self.query(
            os.getenv("TUSHARE_FUND_SHARE_API", "fund_share"),
            ts_code=code,
            start_date=start.replace("-", ""),
            end_date=end.replace("-", ""),
        )

    def margin_detail(self, code: str, start: str, end: str) -> pd.DataFrame:
        return self.query(
            os.getenv("TUSHARE_MARGIN_DETAIL_API", "margin_detail"),
            ts_code=code,
            start_date=start.replace("-", ""),
            end_date=end.replace("-", ""),
        )

