from datetime import date

import polars as pl

from app.services.selection_pipeline import SelectionPipeline


class _Repo:
    def __init__(self, latest: date) -> None:
        self.latest = latest
        self.requested_asset_type: str | None = None

    def latest_enriched_date(self, asset_type: str = "stock") -> date:
        self.requested_asset_type = asset_type
        return self.latest


def test_selection_pipeline_uses_repository_latest_enriched_date() -> None:
    repo = _Repo(date(2026, 9, 24))

    assert SelectionPipeline(repo)._latest_date() == date(2026, 9, 24)
    assert repo.requested_asset_type == "stock"


def test_selection_pipeline_applies_engine_default_basic_filter() -> None:
    frame = pl.DataFrame(
        {
            "symbol": ["000001.SZ", "000002.SZ", "000003.SZ"],
            "name": ["正常股票", "ST 股票", "低成交股票"],
            "close": [10.0, 10.0, 10.0],
            "amount": [30_000_000.0, 30_000_000.0, 10_000_000.0],
            "total_shares": [200_000_000.0, 200_000_000.0, 200_000_000.0],
        }
    )

    filtered = SelectionPipeline(_Repo(date(2026, 9, 24)))._basic_filter(frame)

    assert filtered.get_column("symbol").to_list() == ["000001.SZ"]
