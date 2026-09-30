"""个股跟踪服务 — 管理入选后的持仓/观察池。

职责:
  跟踪入选股票的实时状态，管理止损/止盈，触发告警。

不知道: HTTP、前端、策略执行。
"""
from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field, asdict
from datetime import date, datetime
from enum import Enum
from pathlib import Path
from typing import Any

import polars as pl

logger = logging.getLogger(__name__)


class TrackStatus(str, Enum):
    WATCHING = "watching"       # 观察中
    HOLDING = "holding"         # 持仓中
    STOPPED = "stopped"         # 已止损
    SOLD = "sold"               # 已止盈/卖出
    EXPIRED = "expired"         # 过期（超过最大持有天数）


@dataclass
class TrackRecord:
    """跟踪记录"""
    symbol: str
    name: str
    entry_date: str              # ISO 日期
    entry_price: float           # 买入/观察起始价
    stop_loss: float             # 止损价
    take_profit: float | None    # 止盈价 (None = 不预设)
    max_hold_days: int           # 最大持有天数
    reason: str                  # 入选原因摘要
    strategy_id: str             # 来自哪个策略
    score: float                 # 入选时得分
    factor_summary: str          # 因子得分摘要
    sector: str | None           # 所属板块
    phase_at_entry: str          # 入选时的情绪阶段
    status: str = TrackStatus.WATCHING
    current_price: float | None = None
    high_water_mark: float | None = None   # 最高价（用于移动止盈）
    exit_date: str | None = None
    exit_price: float | None = None
    exit_reason: str | None = None
    pnl_pct: float | None = None
    alert_history: list[dict] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""

    def __post_init__(self) -> None:
        if not self.created_at:
            self.created_at = datetime.now().isoformat(timespec="seconds")
        if not self.updated_at:
            self.updated_at = self.created_at
        if self.high_water_mark is None:
            self.high_water_mark = self.entry_price

    def to_dict(self) -> dict:
        return asdict(self)

    @property
    def unrealized_pnl_pct(self) -> float | None:
        if self.current_price is None:
            return None
        return (self.current_price - self.entry_price) / self.entry_price * 100

    @property
    def distance_to_stop_pct(self) -> float | None:
        if self.current_price is None or self.stop_loss <= 0:
            return None
        return (self.current_price - self.stop_loss) / self.current_price * 100

    @property
    def hold_days(self) -> int:
        try:
            d = date.fromisoformat(self.entry_date)
            return (date.today() - d).days
        except (ValueError, TypeError):
            return 0


class StockTracker:
    """
    个股跟踪管理器

    用法:
        tracker = StockTracker(data_dir)
        record = tracker.add(symbol="002236", name="大华股份", entry_price=18.5, ...)
        tracker.update_price("002236", 19.2)
        tracker.check_all()  # 检查止损/止盈
    """

    _STOP_LOSS_TRAIL_PCT = 0.08     # 移动止盈: 从最高点回撤8%

    def __init__(self, data_dir: str | Path) -> None:
        self.data_dir = Path(data_dir)
        self._store_path = self.data_dir / "user_data" / "stock_tracks.jsonl"
        self._store_path.parent.mkdir(parents=True, exist_ok=True)
        self._cache: dict[str, TrackRecord] = {}  # symbol -> record
        self._lock = threading.RLock()
        self._load()

    def _load(self) -> None:
        """从文件加载跟踪记录"""
        if not self._store_path.exists():
            return
        try:
            with open(self._store_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    data = json.loads(line)
                    rec = TrackRecord(**data)
                    self._cache[rec.symbol] = rec
        except Exception as e:  # noqa: BLE001
            logger.warning("StockTracker load failed: %s", e)

    def _save(self, record: TrackRecord) -> None:
        """保存单条记录（追加/更新）"""
        with self._lock:
            # 重新读取文件，更新或追加
            lines: list[str] = []
            if self._store_path.exists():
                with open(self._store_path, "r", encoding="utf-8") as f:
                    lines = [l.strip() for l in f if l.strip()]

            # 替换已有记录或追加
            found = False
            new_line = json.dumps(record.to_dict(), ensure_ascii=False)
            for i, line in enumerate(lines):
                try:
                    d = json.loads(line)
                    if d.get("symbol") == record.symbol:
                        lines[i] = new_line
                        found = True
                        break
                except json.JSONDecodeError:
                    continue
            if not found:
                lines.append(new_line)

            # 原子写入
            tmp = self._store_path.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                f.write("\n".join(lines) + "\n")
            tmp.replace(self._store_path)

    # ──────────────────────────────────────────────
    # 公开 API
    # ──────────────────────────────────────────────

    def add(
        self,
        symbol: str,
        name: str,
        entry_price: float,
        stop_loss: float,
        take_profit: float | None = None,
        max_hold_days: int = 5,
        reason: str = "",
        strategy_id: str = "",
        score: float = 0.0,
        factor_summary: str = "",
        sector: str | None = None,
        phase_at_entry: str = "",
    ) -> TrackRecord:
        """添加跟踪记录"""
        record = TrackRecord(
            symbol=symbol,
            name=name,
            entry_date=date.today().isoformat(),
            entry_price=entry_price,
            stop_loss=stop_loss,
            take_profit=take_profit,
            max_hold_days=max_hold_days,
            reason=reason,
            strategy_id=strategy_id,
            score=score,
            factor_summary=factor_summary,
            sector=sector,
            phase_at_entry=phase_at_entry,
        )
        with self._lock:
            self._cache[symbol] = record
        self._save(record)
        logger.info("StockTracker: added %s @ %.2f stop=%.2f", symbol, entry_price, stop_loss)
        return record

    def remove(self, symbol: str) -> bool:
        """删除跟踪记录"""
        with self._lock:
            if symbol in self._cache:
                del self._cache[symbol]
                # 重写文件
                lines = []
                for rec in self._cache.values():
                    lines.append(json.dumps(rec.to_dict(), ensure_ascii=False))
                tmp = self._store_path.with_suffix(".tmp")
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write("\n".join(lines) + "\n")
                tmp.replace(self._store_path)
                return True
        return False

    def update_price(self, symbol: str, price: float) -> dict[str, Any] | None:
        """更新现价，返回触发的告警（如有）"""
        with self._lock:
            record = self._cache.get(symbol)
            if record is None or record.status not in (TrackStatus.WATCHING, TrackStatus.HOLDING):
                return None

            record.current_price = price
            record.updated_at = datetime.now().isoformat(timespec="seconds")

            # 更新最高价
            if record.high_water_mark is None or price > record.high_water_mark:
                record.high_water_mark = price

            # 检查止损
            if price <= record.stop_loss:
                alert = self._trigger_stop_loss(record)
                self._save(record)
                return alert

            # 检查移动止盈
            if record.high_water_mark and record.high_water_mark > record.entry_price:
                drawdown = (record.high_water_mark - price) / record.high_water_mark
                if drawdown >= self._STOP_LOSS_TRAIL_PCT:
                    alert = self._trigger_trail_stop(record)
                    self._save(record)
                    return alert

            # 检查固定止盈
            if record.take_profit and price >= record.take_profit:
                alert = self._trigger_take_profit(record)
                self._save(record)
                return alert

            # 检查持有天数
            if record.hold_days > record.max_hold_days:
                alert = self._trigger_expire(record)
                self._save(record)
                return alert

            self._save(record)
            return None

    def get(self, symbol: str) -> TrackRecord | None:
        """获取单条记录"""
        return self._cache.get(symbol)

    def list_all(self, status: str | None = None) -> list[TrackRecord]:
        """列出跟踪记录"""
        records = list(self._cache.values())
        if status:
            records = [r for r in records if r.status == status]
        return sorted(records, key=lambda r: r.score, reverse=True)

    def close(
        self,
        symbol: str,
        exit_price: float,
        reason: str,
    ) -> TrackRecord | None:
        """手动关闭跟踪"""
        with self._lock:
            record = self._cache.get(symbol)
            if record is None:
                return None
            record.status = TrackStatus.SOLD
            record.exit_price = exit_price
            record.exit_date = date.today().isoformat()
            record.exit_reason = reason
            record.pnl_pct = (exit_price - record.entry_price) / record.entry_price * 100
            record.updated_at = datetime.now().isoformat(timespec="seconds")
            self._save(record)
            return record

    def get_stats(self) -> dict[str, Any]:
        """统计"""
        records = list(self._cache.values())
        closed = [r for r in records if r.pnl_pct is not None]
        return {
            "total": len(records),
            "watching": sum(1 for r in records if r.status == TrackStatus.WATCHING),
            "holding": sum(1 for r in records if r.status == TrackStatus.HOLDING),
            "closed": len(closed),
            "win_rate": (
                sum(1 for r in closed if (r.pnl_pct or 0) > 0) / len(closed) * 100
                if closed else 0
            ),
            "avg_pnl": (
                sum(r.pnl_pct or 0 for r in closed) / len(closed)
                if closed else 0
            ),
        }

    # ──────────────────────────────────────────────
    # 内部: 触发告警
    # ──────────────────────────────────────────────

    def _trigger_stop_loss(self, record: TrackRecord) -> dict[str, Any]:
        record.status = TrackStatus.STOPPED
        record.exit_price = record.current_price
        record.exit_date = date.today().isoformat()
        record.exit_reason = "止损"
        record.pnl_pct = (record.stop_loss - record.entry_price) / record.entry_price * 100
        alert = {
            "type": "stop_loss",
            "symbol": record.symbol,
            "name": record.name,
            "price": record.current_price,
            "stop_loss": record.stop_loss,
            "pnl_pct": round(record.pnl_pct, 2),
            "message": f"{record.name}({record.symbol}) 触及止损价 {record.stop_loss:.2f}",
        }
        record.alert_history.append({**alert, "time": datetime.now().isoformat(timespec="seconds")})
        return alert

    def _trigger_trail_stop(self, record: TrackRecord) -> dict[str, Any]:
        record.status = TrackStatus.STOPPED
        record.exit_price = record.current_price
        record.exit_date = date.today().isoformat()
        record.exit_reason = "移动止盈"
        record.pnl_pct = (record.current_price - record.entry_price) / record.entry_price * 100
        alert = {
            "type": "trail_stop",
            "symbol": record.symbol,
            "name": record.name,
            "price": record.current_price,
            "high_water_mark": record.high_water_mark,
            "pnl_pct": round(record.pnl_pct, 2),
            "message": f"{record.name}({record.symbol}) 从高点回撤{self._STOP_LOSS_TRAIL_PCT*100:.0f}%，移动止盈",
        }
        record.alert_history.append({**alert, "time": datetime.now().isoformat(timespec="seconds")})
        return alert

    def _trigger_take_profit(self, record: TrackRecord) -> dict[str, Any]:
        record.status = TrackStatus.SOLD
        record.exit_price = record.current_price
        record.exit_date = date.today().isoformat()
        record.exit_reason = "止盈"
        record.pnl_pct = (record.current_price - record.entry_price) / record.entry_price * 100
        alert = {
            "type": "take_profit",
            "symbol": record.symbol,
            "name": record.name,
            "price": record.current_price,
            "take_profit": record.take_profit,
            "pnl_pct": round(record.pnl_pct, 2),
            "message": f"{record.name}({record.symbol}) 触及止盈价 {record.take_profit:.2f}",
        }
        record.alert_history.append({**alert, "time": datetime.now().isoformat(timespec="seconds")})
        return alert

    def _trigger_expire(self, record: TrackRecord) -> dict[str, Any]:
        record.status = TrackStatus.EXPIRED
        record.exit_price = record.current_price
        record.exit_date = date.today().isoformat()
        record.exit_reason = "持有到期"
        if record.current_price:
            record.pnl_pct = (record.current_price - record.entry_price) / record.entry_price * 100
        alert = {
            "type": "expired",
            "symbol": record.symbol,
            "name": record.name,
            "price": record.current_price,
            "hold_days": record.hold_days,
            "max_hold_days": record.max_hold_days,
            "pnl_pct": round(record.pnl_pct, 2) if record.pnl_pct else None,
            "message": f"{record.name}({record.symbol}) 持有{record.hold_days}天到期",
        }
        record.alert_history.append({**alert, "time": datetime.now().isoformat(timespec="seconds")})
        return alert
