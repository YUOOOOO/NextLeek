from __future__ import annotations

from app.chanlun import build_chanlun, build_signals, build_zhongshu
from app.chanlun import Fenxing, Xianduan, Zhongshu, Beichi


def _fx(kind: str, x: int, price: float) -> Fenxing:
    return Fenxing(kind=kind, bar_index=x, x=x, price=price, date=str(x))  # type: ignore[arg-type]


def _seg(frm: Fenxing, to: Fenxing) -> Xianduan:
    return Xianduan(frm=frm, to=to, start_bi=0, end_bi=0, confirmed=True)


def test_buy2_after_buy1_pullback() -> None:
    segs = [
        _seg(_fx("bottom", 0, 10), _fx("top", 2, 20)),
        _seg(_fx("top", 2, 20), _fx("bottom", 4, 8)),
        _seg(_fx("bottom", 4, 8), _fx("top", 6, 18)),
        _seg(_fx("top", 6, 18), _fx("bottom", 8, 12)),
    ]
    zs = [
        Zhongshu(
            level="xd",
            start_bi=0,
            end_bi=2,
            zg=19,
            zd=12,
            start_x=0,
            end_x=6,
            start_date="0",
            end_date="6",
            confirmed=True,
        )
    ]
    bc = [Beichi(dir=-1, frm=segs[0].frm, to=segs[1].to, ratio=0.5, confirmed=True)]
    sig = [s.kind for s in build_signals(segs, zs, bc)]
    assert "b1" in sig
    assert "b2" in sig


def test_empty_rows() -> None:
    result = build_chanlun([])
    assert result.signals == []
    assert result.bi == []


def test_build_zhongshu_needs_three_overlaps() -> None:
    segs = [
        _seg(_fx("bottom", 0, 10), _fx("top", 2, 20)),
        _seg(_fx("top", 2, 20), _fx("bottom", 4, 12)),
        _seg(_fx("bottom", 4, 12), _fx("top", 6, 19)),
    ]
    zs = build_zhongshu(segs, "xd")
    assert len(zs) == 1
    assert zs[0].zg == 19
    assert zs[0].zd == 12
