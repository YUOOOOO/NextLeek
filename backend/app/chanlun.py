"""缠论结构：包含、分型、笔、特征序列线段、中枢、走势、背驰、买卖点。

与 frontend/src/lib/chanlun.ts 对齐，供个股监控服务端评估。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

MIN_VERTEX_GAP = 4
Dir = Literal[1, -1]
FenxingKind = Literal["top", "bottom"]
ZouShiKind = Literal["pan", "up", "down"]
SignalKind = Literal["b1", "s1", "b2", "s2", "b3", "s3"]
ZhongshuLevel = Literal["bi", "xd"]

SIGNAL_LABELS: dict[str, str] = {
    "b1": "买1",
    "s1": "卖1",
    "b2": "买2",
    "s2": "卖2",
    "b3": "买3",
    "s3": "卖3",
}


def _num(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _stamp(value: object) -> str:
    if value is None:
        return ""
    text = str(value)
    return text.replace("T", " ")[:19]


@dataclass(frozen=True)
class ChanlunBar:
    start: int
    end: int
    high: float
    low: float
    high_index: int
    low_index: int


@dataclass(frozen=True)
class Fenxing:
    kind: FenxingKind
    bar_index: int
    x: int
    price: float
    date: str


@dataclass(frozen=True)
class Bi:
    frm: Fenxing
    to: Fenxing
    confirmed: bool


@dataclass(frozen=True)
class Xianduan:
    frm: Fenxing
    to: Fenxing
    start_bi: int
    end_bi: int
    confirmed: bool


@dataclass(frozen=True)
class Zhongshu:
    level: ZhongshuLevel
    start_bi: int
    end_bi: int
    zg: float
    zd: float
    start_x: int
    end_x: int
    start_date: str
    end_date: str
    confirmed: bool


@dataclass(frozen=True)
class ZouShi:
    kind: ZouShiKind
    start_xd: int
    end_xd: int
    zhongshu: tuple[Zhongshu, ...]
    frm: Fenxing
    to: Fenxing
    confirmed: bool


@dataclass(frozen=True)
class Beichi:
    dir: Dir
    frm: Fenxing
    to: Fenxing
    ratio: float
    confirmed: bool


@dataclass(frozen=True)
class ChanlunSignal:
    kind: SignalKind
    at: Fenxing


@dataclass
class ChanlunResult:
    bars: list[ChanlunBar]
    fenxing: list[Fenxing]
    bi: list[Bi]
    xianduan: list[Xianduan]
    zhongshu: list[Zhongshu]
    xd_zhongshu: list[Zhongshu]
    zoushi: list[ZouShi]
    beichi: list[Beichi]
    signals: list[ChanlunSignal]


@dataclass(frozen=True)
class _Feat:
    high: float
    low: float
    bi_index: int


@dataclass(frozen=True)
class _Range:
    high: float
    low: float
    start_x: int
    end_x: int


def _raw_bar(rows: list[dict], index: int) -> ChanlunBar | None:
    high = _num(rows[index].get("high") if index < len(rows) else None)
    low = _num(rows[index].get("low") if index < len(rows) else None)
    if high is None or low is None or high < low:
        return None
    return ChanlunBar(index, index, high, low, index, index)


def _contains(a: ChanlunBar, b: ChanlunBar) -> bool:
    return (a.high >= b.high and a.low <= b.low) or (b.high >= a.high and b.low <= a.low)


def _merge(a: ChanlunBar, b: ChanlunBar, direction: Dir) -> ChanlunBar:
    if direction == 1:
        high_first = a.high >= b.high
        low_first = a.low >= b.low
    else:
        high_first = a.high <= b.high
        low_first = a.low <= b.low
    return ChanlunBar(
        a.start,
        b.end,
        a.high if high_first else b.high,
        a.low if low_first else b.low,
        a.high_index if high_first else b.high_index,
        a.low_index if low_first else b.low_index,
    )


def _direction_of(prev: ChanlunBar, nxt: ChanlunBar) -> int:
    if nxt.high > prev.high and nxt.low > prev.low:
        return 1
    if nxt.high < prev.high and nxt.low < prev.low:
        return -1
    return 0


def include_bars(rows: list[dict]) -> list[ChanlunBar]:
    bars: list[ChanlunBar] = []
    direction = 0
    for i in range(len(rows)):
        cur = _raw_bar(rows, i)
        if cur is None:
            continue
        if not bars:
            bars.append(cur)
            continue
        last = bars[-1]
        if _contains(last, cur):
            use: Dir = 1 if direction == 0 else direction  # type: ignore[assignment]
            if direction == 0 and len(bars) >= 2:
                inferred = _direction_of(bars[-2], last)
                if inferred != 0:
                    use = inferred  # type: ignore[assignment]
            direction = use
            bars[-1] = _merge(last, cur, use)
            continue
        next_dir = _direction_of(last, cur)
        if next_dir != 0:
            direction = next_dir
        bars.append(cur)
    return bars


def find_fenxing(bars: list[ChanlunBar], rows: list[dict]) -> list[Fenxing]:
    out: list[Fenxing] = []
    for i in range(1, len(bars) - 1):
        prev, cur, nxt = bars[i - 1], bars[i], bars[i + 1]
        is_top = cur.high > prev.high and cur.high > nxt.high
        is_bottom = cur.low < prev.low and cur.low < nxt.low
        if is_top == is_bottom:
            continue
        kind: FenxingKind = "top" if is_top else "bottom"
        x = cur.high_index if is_top else cur.low_index
        price = cur.high if is_top else cur.low
        date = _stamp(rows[x].get("date") if 0 <= x < len(rows) else None)
        out.append(Fenxing(kind, i, x, price, date))
    return out


def _valid_stroke(a: Fenxing, b: Fenxing) -> bool:
    if a.kind == b.kind:
        return False
    if b.bar_index - a.bar_index < MIN_VERTEX_GAP:
        return False
    if a.kind == "bottom" and b.kind == "top":
        return b.price > a.price
    if a.kind == "top" and b.kind == "bottom":
        return b.price < a.price
    return False


def _more_extreme(cur: Fenxing, nxt: Fenxing) -> Fenxing:
    if cur.kind != nxt.kind:
        return cur
    if cur.kind == "top":
        return nxt if nxt.price >= cur.price else cur
    return nxt if nxt.price <= cur.price else cur


def build_bi(fenxing: list[Fenxing]) -> list[Bi]:
    if len(fenxing) < 2:
        return []
    bi: list[Bi] = []
    start = fenxing[0]
    for fx in fenxing[1:]:
        if fx.kind == start.kind:
            start = _more_extreme(start, fx)
            continue
        if _valid_stroke(start, fx):
            bi.append(Bi(start, fx, True))
            start = fx
            continue
        if start.kind == "top" and fx.kind == "bottom" and fx.price > start.price:
            continue
        if start.kind == "bottom" and fx.kind == "top" and fx.price < start.price:
            continue
    if bi:
        last = bi[-1]
        bi[-1] = Bi(last.frm, last.to, False)
    return bi


def _range_of(seg_from: Fenxing, seg_to: Fenxing) -> _Range:
    return _Range(
        max(seg_from.price, seg_to.price),
        min(seg_from.price, seg_to.price),
        min(seg_from.x, seg_to.x),
        max(seg_from.x, seg_to.x),
    )


def _three_overlap(a: _Range, b: _Range, c: _Range) -> tuple[float, float] | None:
    zg = min(a.high, b.high, c.high)
    zd = max(a.low, b.low, c.low)
    if zg <= zd:
        return None
    return zg, zd


def build_zhongshu(segs: list[Bi] | list[Xianduan], level: ZhongshuLevel = "bi") -> list[Zhongshu]:
    out: list[Zhongshu] = []
    i = 0
    while i + 2 < len(segs):
        r0 = _range_of(segs[i].frm, segs[i].to)
        r1 = _range_of(segs[i + 1].frm, segs[i + 1].to)
        r2 = _range_of(segs[i + 2].frm, segs[i + 2].to)
        ov = _three_overlap(r0, r1, r2)
        if ov is None:
            i += 1
            continue
        zg, zd = ov
        end = i + 2
        while end + 1 < len(segs):
            nxt = _range_of(segs[end + 1].frm, segs[end + 1].to)
            if not (nxt.high > zd and nxt.low < zg):
                break
            end += 1
        last = _range_of(segs[end].frm, segs[end].to)
        out.append(
            Zhongshu(
                level=level,
                start_bi=i,
                end_bi=end,
                zg=zg,
                zd=zd,
                start_x=r0.start_x,
                end_x=last.end_x,
                start_date=segs[i].frm.date,
                end_date=segs[end].to.date,
                confirmed=all(stroke.confirmed for stroke in segs[i : end + 1]),
            )
        )
        i = end + 1
    return out


def _bi_dir(stroke: Bi) -> Dir:
    return 1 if stroke.frm.kind == "bottom" else -1


def _feat_of(stroke: Bi, bi_index: int) -> _Feat:
    return _Feat(max(stroke.frm.price, stroke.to.price), min(stroke.frm.price, stroke.to.price), bi_index)


def _feat_contains(a: _Feat, b: _Feat) -> bool:
    return (a.high >= b.high and a.low <= b.low) or (b.high >= a.high and b.low <= a.low)


def _merge_feat(a: _Feat, b: _Feat, direction: Dir) -> _Feat:
    if direction == 1:
        return _Feat(max(a.high, b.high), max(a.low, b.low), b.bi_index)
    return _Feat(min(a.high, b.high), min(a.low, b.low), b.bi_index)


def _include_feats(raw: list[_Feat], direction: Dir) -> list[_Feat]:
    if not raw:
        return []
    out = [raw[0]]
    for cur in raw[1:]:
        last = out[-1]
        if _feat_contains(last, cur):
            out[-1] = _merge_feat(last, cur, direction)
        else:
            out.append(cur)
    return out


def _collect_feats(bi: list[Bi], start: int, end: int) -> list[_Feat]:
    return [_feat_of(bi[j], j) for j in range(start + 1, end + 1, 2)]


def _feat_gap(a: _Feat, b: _Feat) -> bool:
    return a.low > b.high or b.low > a.high


def _ending_fenxing(feats: list[_Feat], direction: Dir) -> tuple[_Feat, _Feat] | None:
    for i in range(1, len(feats) - 1):
        prev, cur, nxt = feats[i - 1], feats[i], feats[i + 1]
        is_fx = (
            cur.high > prev.high and cur.high > nxt.high
            if direction == 1
            else cur.low < prev.low and cur.low < nxt.low
        )
        if not is_fx:
            continue
        if _feat_gap(prev, cur):
            broken = nxt.high > cur.high if direction == 1 else nxt.low < cur.low
            if broken:
                continue
        return cur, nxt
    return None


def _extreme_end(bi: list[Bi], start: int, end: int, direction: Dir) -> Fenxing:
    best = bi[start].to
    for i in range(start, end + 1):
        for fx in (bi[i].frm, bi[i].to):
            if direction == 1 and fx.kind == "top" and fx.price >= best.price:
                best = fx
            if direction == -1 and fx.kind == "bottom" and fx.price <= best.price:
                best = fx
    return best


def build_xianduan(bi: list[Bi]) -> list[Xianduan]:
    out: list[Xianduan] = []
    start = 0
    while start + 2 < len(bi):
        d = _bi_dir(bi[start])
        if _bi_dir(bi[start + 1]) == d or _bi_dir(bi[start + 2]) != d:
            start += 1
            continue
        next_start = -1
        turning: Fenxing | None = None
        confirmed = False
        for k in range(start + 2, len(bi)):
            feats = _include_feats(_collect_feats(bi, start, k), d)
            if len(feats) < 3:
                continue
            fx = _ending_fenxing(feats, d)
            if fx is None:
                continue
            mid, third = fx
            if mid.bi_index - 1 < start + 2:
                continue
            next_start = mid.bi_index
            turning = bi[mid.bi_index].frm
            confirmed = all(stroke.confirmed for stroke in bi[start : third.bi_index + 1])
            break
        if turning is not None and next_start > start:
            out.append(Xianduan(bi[start].frm, turning, start, next_start - 1, confirmed))
            start = next_start
            continue
        out.append(
            Xianduan(
                bi[start].frm,
                _extreme_end(bi, start, len(bi) - 1, d),
                start,
                len(bi) - 1,
                False,
            )
        )
        break
    return out


def _xd_dir(seg: Xianduan) -> Dir:
    return 1 if seg.frm.kind == "bottom" else -1


def _zs_relation(a: Zhongshu, b: Zhongshu) -> int:
    if b.zd > a.zg:
        return 1
    if b.zg < a.zd:
        return -1
    return 0


def _extreme_of_xd(xd: list[Xianduan], start: int, end: int, direction: Dir) -> Fenxing:
    best = xd[start].to
    for i in range(start, end + 1):
        for fx in (xd[i].frm, xd[i].to):
            if direction == 1 and fx.kind == "top" and fx.price >= best.price:
                best = fx
            if direction == -1 and fx.kind == "bottom" and fx.price <= best.price:
                best = fx
    return best


def _leave_span(
    xd: list[Xianduan], from_idx: int, to_idx: int, direction: Dir
) -> tuple[Fenxing, Fenxing] | None:
    if from_idx < 0 or to_idx >= len(xd) or from_idx > to_idx:
        return None
    return xd[from_idx].frm, _extreme_of_xd(xd, from_idx, to_idx, direction)


def build_zoushi(xd: list[Xianduan], zs: list[Zhongshu]) -> list[ZouShi]:
    if not xd or not zs:
        return []
    out: list[ZouShi] = []
    i = 0
    while i < len(zs):
        group = [zs[i]]
        kind: ZouShiKind = "pan"
        j = i + 1
        while j < len(zs):
            rel = _zs_relation(group[-1], zs[j])
            if rel == 0:
                group.append(zs[j])
                j += 1
                continue
            if kind == "pan":
                kind = "up" if rel == 1 else "down"
                group.append(zs[j])
                j += 1
                continue
            if (kind == "up" and rel == 1) or (kind == "down" and rel == -1):
                group.append(zs[j])
                j += 1
                continue
            break
        start_xd = group[0].start_bi
        end_xd = max(start_xd, zs[j].start_bi - 1) if j < len(zs) else len(xd) - 1
        direction: Dir = -1 if kind == "down" else 1
        out_kind: ZouShiKind = kind if len(group) >= 2 and kind != "pan" else "pan"
        leave_dir: Dir = _xd_dir(xd[start_xd]) if out_kind == "pan" else direction
        out.append(
            ZouShi(
                kind=out_kind,
                start_xd=start_xd,
                end_xd=end_xd,
                zhongshu=tuple(group),
                frm=xd[start_xd].frm if start_xd < len(xd) else xd[0].frm,
                to=_extreme_of_xd(xd, start_xd, end_xd, leave_dir),
                confirmed=all(z.confirmed for z in group)
                and (j < len(zs) or (end_xd < len(xd) and xd[end_xd].confirmed)),
            )
        )
        i = j if j > i else i + 1
    return out


def _ema(values: list[float], period: int) -> list[float]:
    k = 2 / (period + 1)
    out: list[float] = []
    prev = values[0] if values else 0.0
    for i, raw in enumerate(values):
        v = raw
        prev = v if i == 0 else v * k + prev * (1 - k)
        out.append(prev)
    return out


def _macd_hist(rows: list[dict]) -> list[float]:
    close = [_num(row.get("close")) or 0.0 for row in rows]
    if not close:
        return []
    e12 = _ema(close, 12)
    e26 = _ema(close, 26)
    dif = [a - b for a, b in zip(e12, e26)]
    dea = _ema(dif, 9)
    return [(a - b) * 2 for a, b in zip(dif, dea)]


def _hist_area(hist: list[float], a: Fenxing, b: Fenxing, direction: Dir) -> float:
    x0 = max(0, min(a.x, b.x))
    x1 = min(len(hist) - 1, max(a.x, b.x))
    total = 0.0
    for i in range(x0, x1 + 1):
        h = hist[i] if i < len(hist) else 0.0
        if direction == 1 and h > 0:
            total += h
        if direction == -1 and h < 0:
            total -= h
    return total


def _slope_of(a: Fenxing, b: Fenxing) -> float:
    return abs(b.price - a.price) / max(1, abs(b.x - a.x))


def _weaker(
    leave1: tuple[Fenxing, Fenxing],
    leave2: tuple[Fenxing, Fenxing],
    hist: list[float],
    direction: Dir,
) -> float | None:
    a1 = _hist_area(hist, leave1[0], leave1[1], direction)
    a2 = _hist_area(hist, leave2[0], leave2[1], direction)
    if a1 > 0 and a2 < a1:
        return a2 / a1
    s1 = _slope_of(leave1[0], leave1[1])
    s2 = _slope_of(leave2[0], leave2[1])
    if s1 > 0 and s2 < s1 * 0.85:
        return s2 / s1
    return None


def build_beichi(rows: list[dict], xd: list[Xianduan], zoushi: list[ZouShi]) -> list[Beichi]:
    hist = _macd_hist(rows)
    out: list[Beichi] = []
    for zs in zoushi:
        if zs.kind in {"up", "down"}:
            direction: Dir = 1 if zs.kind == "up" else -1
            if len(zs.zhongshu) < 2:
                continue
            first, last = zs.zhongshu[0], zs.zhongshu[-1]
            leave1 = _leave_span(xd, first.end_bi + 1, max(first.end_bi + 1, last.start_bi - 1), direction)
            leave2 = _leave_span(xd, last.end_bi + 1, zs.end_xd, direction)
            if leave1 is None or leave2 is None:
                continue
            made_extreme = (
                leave2[1].price >= leave1[1].price if direction == 1 else leave2[1].price <= leave1[1].price
            )
            if not made_extreme:
                continue
            ratio = _weaker(leave1, leave2, hist, direction)
            if ratio is None:
                continue
            confirmed = zs.end_xd < len(xd) and xd[zs.end_xd].confirmed
            out.append(Beichi(direction, leave2[0], leave2[1], ratio, confirmed))
            continue
        hub = zs.zhongshu[0] if zs.zhongshu else None
        if hub is None or hub.start_bi == 0 or hub.end_bi + 1 > zs.end_xd:
            continue
        enter_dir = _xd_dir(xd[hub.start_bi - 1])
        leave_dir = _xd_dir(xd[hub.end_bi + 1])
        if enter_dir != leave_dir:
            continue
        enter = _leave_span(xd, max(zs.start_xd, hub.start_bi - 1), hub.start_bi - 1, enter_dir)
        leave = _leave_span(xd, hub.end_bi + 1, zs.end_xd, leave_dir)
        if enter is None or leave is None:
            continue
        made_extreme = leave[1].price >= enter[1].price if leave_dir == 1 else leave[1].price <= enter[1].price
        if not made_extreme:
            continue
        ratio = _weaker(enter, leave, hist, leave_dir)
        if ratio is None:
            continue
        confirmed = zs.end_xd < len(xd) and xd[zs.end_xd].confirmed
        out.append(Beichi(leave_dir, leave[0], leave[1], ratio, confirmed))
    return out


def build_signals(xd: list[Xianduan], xd_zs: list[Zhongshu], beichi: list[Beichi]) -> list[ChanlunSignal]:
    out: list[ChanlunSignal] = []
    seen: set[str] = set()

    def push(kind: SignalKind, at: Fenxing) -> None:
        key = f"{kind}:{at.x}:{at.price}"
        if key in seen:
            return
        seen.add(key)
        out.append(ChanlunSignal(kind, at))

    for bc in beichi:
        push("s1" if bc.dir == 1 else "b1", bc.to)

    for signal in list(out):
        if signal.kind not in {"b1", "s1"}:
            continue
        i = next((idx for idx, seg in enumerate(xd) if seg.to.x == signal.at.x), -1)
        if i < 0 or i + 2 >= len(xd):
            continue
        pull = xd[i + 2]
        if signal.kind == "b1" and pull.to.kind == "bottom" and pull.to.price > signal.at.price:
            push("b2", pull.to)
        if signal.kind == "s1" and pull.to.kind == "top" and pull.to.price < signal.at.price:
            push("s2", pull.to)

    for zs in xd_zs:
        leave_idx = zs.end_bi + 1
        if leave_idx >= len(xd) or leave_idx + 1 >= len(xd):
            continue
        pull = xd[leave_idx + 1]
        d = _xd_dir(xd[leave_idx])
        if _xd_dir(pull) == d:
            continue
        if d == 1 and pull.to.kind == "bottom" and pull.to.price > zs.zg:
            push("b3", pull.to)
        if d == -1 and pull.to.kind == "top" and pull.to.price < zs.zd:
            push("s3", pull.to)
    return out


def chanlun_summary(result: ChanlunResult) -> str:
    last = result.zoushi[-1] if result.zoushi else None
    kind = "上涨趋势" if last and last.kind == "up" else "下跌趋势" if last and last.kind == "down" else "盘整" if last else ""
    sig = " ".join(SIGNAL_LABELS[s.kind] for s in result.signals)
    parts = [
        f"分型 {len(result.fenxing)}",
        f"笔 {len(result.bi)}",
        f"线段 {len(result.xianduan)}",
        f"中枢 {len(result.xd_zhongshu) or len(result.zhongshu)}",
        kind,
        sig,
    ]
    return " · ".join(p for p in parts if p)


def build_chanlun(rows: list[dict]) -> ChanlunResult:
    bars = include_bars(rows)
    fenxing = find_fenxing(bars, rows)
    bi = build_bi(fenxing)
    xianduan = build_xianduan(bi)
    zhongshu = build_zhongshu(bi, "bi")
    xd_zhongshu = build_zhongshu(xianduan, "xd")
    zoushi = build_zoushi(xianduan, xd_zhongshu)
    beichi = build_beichi(rows, xianduan, zoushi)
    signals = build_signals(xianduan, xd_zhongshu, beichi)
    return ChanlunResult(bars, fenxing, bi, xianduan, zhongshu, xd_zhongshu, zoushi, beichi, signals)
