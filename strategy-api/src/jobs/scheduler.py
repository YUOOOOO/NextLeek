from __future__ import annotations

import os
import threading
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .runner import list_jobs, submit_job

# 每个交易日 15:30（北京时间）跑 update-data → signal；A 股 15:00 收盘后再拉
TZ = ZoneInfo("Asia/Shanghai")
DAILY_HOUR = int(os.getenv("DAILY_SCHEDULE_HOUR", "15"))
DAILY_MINUTE = int(os.getenv("DAILY_SCHEDULE_MINUTE", "30"))
ENABLED = os.getenv("DAILY_SCHEDULE_ENABLED", "1") != "0"

_thread: threading.Thread | None = None
_stop = threading.Event()


def beijing_now() -> datetime:
    return datetime.now(TZ)


def next_run_at(now: datetime | None = None) -> datetime:
    """下一个交易日 15:30（周末顺延到周一）。"""
    now = now or beijing_now()
    target = now.replace(hour=DAILY_HOUR, minute=DAILY_MINUTE, second=0, microsecond=0)
    if now >= target:
        target += timedelta(days=1)
    while target.weekday() >= 5:
        target += timedelta(days=1)
    return target


def schedule_info() -> dict[str, Any]:
    nxt = next_run_at()
    return {
        "enabled": ENABLED,
        "timezone": "Asia/Shanghai",
        "weekdays_only": True,
        "hour": DAILY_HOUR,
        "minute": DAILY_MINUTE,
        "label": f"每个交易日 {DAILY_HOUR:02d}:{DAILY_MINUTE:02d}（北京时间）",
        "next_run": nxt.isoformat(timespec="minutes"),
        "next_run_text": nxt.strftime("%Y-%m-%d %H:%M"),
    }


def _job_day(job: dict[str, Any]) -> str:
    raw = str(job.get("updated_at") or job.get("created_at") or "")
    digits = "".join(ch for ch in raw if ch.isdigit())
    return digits[:8]


def _has_job_today(job_type: str, statuses: set[str]) -> bool:
    today = beijing_now().strftime("%Y%m%d")
    for job in list_jobs(80):
        if job.get("type") != job_type:
            continue
        if job.get("status") not in statuses:
            continue
        if _job_day(job) == today:
            return True
    return False


def run_daily_pipeline(*, reason: str) -> list[str]:
    """当天还没成功则排队 update-data 和 signal。"""
    submitted: list[str] = []
    if _has_job_today("update-data", {"queued", "running", "succeeded"}):
        pass
    else:
        submitted.append(submit_job("update-data", {"source": "scheduler", "reason": reason}))
    if _has_job_today("signal", {"queued", "running", "succeeded"}):
        pass
    else:
        submitted.append(submit_job("signal", {"source": "scheduler", "reason": reason}))
    return submitted


def _loop() -> None:
    now = beijing_now()
    today_fire = now.replace(hour=DAILY_HOUR, minute=DAILY_MINUTE, second=0, microsecond=0)
    # 服务在 15:30 之后才起来：补跑当天
    if now.weekday() < 5 and now >= today_fire:
        run_daily_pipeline(reason="startup-catchup")

    while not _stop.is_set():
        nxt = next_run_at()
        wait = max(1.0, (nxt - beijing_now()).total_seconds())
        if _stop.wait(min(wait, 30.0)):
            break
        now = beijing_now()
        if now.weekday() >= 5:
            continue
        if now.hour == DAILY_HOUR and now.minute == DAILY_MINUTE:
            run_daily_pipeline(reason="scheduled-1530")
            _stop.wait(61.0)


def start_scheduler() -> None:
    """进程内后台线程，strategy-api 活着就会每天 15:30 跑。"""
    global _thread
    if not ENABLED:
        return
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="daily-scheduler", daemon=True)
    _thread.start()
