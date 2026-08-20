"""公共因子池目录：中文标签、分桶与原理说明。

供 /api/universe 与前端研究区使用；active_factors 仍以 combo_wfo_config 为准。
"""
from __future__ import annotations

from typing import Any

from .etf_strategy.core.factor_buckets import FACTOR_TO_BUCKET
from .etf_strategy.core.factor_registry import FACTOR_SPECS, get_factor_direction

BUCKET_LABEL_ZH: dict[str, str] = {
    "TREND_MOMENTUM": "趋势/动量",
    "SUSTAINED_POSITION": "中长期位置",
    "VOLUME_CONFIRMATION": "量能确认",
    "MICROSTRUCTURE": "微观结构",
    "TREND_STRENGTH_RISK": "趋势强度/风险",
    "FUND_FLOW": "基金份额",
    "LEVERAGE": "融资杠杆",
}

GROUP_LABEL_ZH: dict[str, str] = {
    "ohlcv": "行情类",
    "fund_share": "份额/融资类",
    "margin": "份额/融资类",
}

# 展示名（短）
FACTOR_LABEL_ZH: dict[str, str] = {
    "ADX_14D": "趋势强度 ADX",
    "AMIHUD_ILLIQUIDITY": "非流动性",
    "BREAKOUT_20D": "突破 20 日",
    "CALMAR_RATIO_60D": "Calmar 比率",
    "CORRELATION_TO_MARKET_20D": "与市场相关性",
    "GK_VOL_RATIO_20D": "GK 波动比",
    "MAX_DD_60D": "最大回撤 60 日",
    "MOM_20D": "动量 20 日",
    "OBV_SLOPE_10D": "OBV 斜率",
    "PRICE_POSITION_20D": "价格位置 20 日",
    "PRICE_POSITION_120D": "价格位置 120 日",
    "PV_CORR_20D": "价量相关",
    "SHARPE_RATIO_20D": "夏普 20 日",
    "SLOPE_20D": "价格斜率",
    "UP_DOWN_VOL_RATIO_20D": "涨跌量比",
    "VOL_RATIO_20D": "波动率比",
    "VORTEX_14D": "涡旋指标",
    "SHARE_CHG_5D": "份额变化 5 日",
    "SHARE_CHG_10D": "份额变化 10 日",
    "SHARE_CHG_20D": "份额变化 20 日",
    "SHARE_ACCEL": "份额加速度",
    "MARGIN_CHG_10D": "融资变化 10 日",
    "MARGIN_BUY_RATIO": "融资买入比",
}

# 原理：面向研究 UI，说明「量什么 / 为何有用 / 方向语义」
FACTOR_PRINCIPLE_ZH: dict[str, str] = {
    "ADX_14D": (
        "平均趋向指数，衡量趋势「有多强」而不管涨跌方向。"
        "高 ADX 表示行情更可能处于单边趋势段，低 ADX 更像震荡。"
        "常作条件/强度因子，与纯动量因子互补。"
    ),
    "AMIHUD_ILLIQUIDITY": (
        "Amihud 非流动性：单位成交额对应的价格冲击（|收益|/成交额）。"
        "值越高越「难成交、冲击大」。在 ETF 截面上常作逆向/质量过滤："
        "更偏好相对好成交、冲击更小的标的（low_is_good）。"
    ),
    "BREAKOUT_20D": (
        "近 20 日突破类信号：价格是否站上近期高点区间。"
        "捕捉趋势启动或加速段；单独使用噪声大，适合与量能、风险因子组合。"
    ),
    "CALMAR_RATIO_60D": (
        "约 60 日收益相对最大回撤的性价比（Calmar 思想）。"
        "同样涨幅下，回撤更小的 ETF 得分更高，偏向「稳中有进」的中期趋势。"
    ),
    "CORRELATION_TO_MARKET_20D": (
        "近 20 日与市场（代理指数）收益相关性。"
        "相关性过高≈纯贝塔搬运；截面上偏好相对独立、分散贡献更大的标的（low_is_good）。"
    ),
    "GK_VOL_RATIO_20D": (
        "Garman-Klass 等高开低收信息估计的波动，相对基准波动的比值。"
        "刻画实现波动结构，而非单纯收盘价波动；多用于风险与微观结构维度。"
    ),
    "MAX_DD_60D": (
        "近 60 日最大回撤深度。"
        "回撤过大表示路径质量差或刚经历深跌；排序上通常回撤越小越好（low_is_good）。"
    ),
    "MOM_20D": (
        "经典 20 日动量：过去一段时间涨得多的继续占优的截面溢价。"
        "ETF 轮动里最核心的趋势维度之一，但拥挤时回撤大，需搭配风险/拥挤类因子。"
    ),
    "OBV_SLOPE_10D": (
        "能量潮（OBV）近 10 日斜率：价涨是否有累计成交量确认。"
        "量价同向增强趋势可信度；与纯价格动量相关性通常低于动量桶内部。"
    ),
    "PRICE_POSITION_20D": (
        "收盘价在近 20 日高低点区间中的相对位置（0~1）。"
        "靠近上沿偏强势/超买区，靠近下沿偏弱势/超卖区；常作短周期位置态。"
    ),
    "PRICE_POSITION_120D": (
        "收盘价在近 120 日高低点区间中的相对位置。"
        "时间尺度更长，刻画中期结构高低，和 20 日位置互补，避免只看短线脉冲。"
    ),
    "PV_CORR_20D": (
        "近 20 日价格变动与成交量的相关性。"
        "价涨放量、价跌缩量时相关偏正，趋势质量更好；价涨缩量则信号打折。"
    ),
    "SHARPE_RATIO_20D": (
        "近 20 日收益/波动的风险调整动量。"
        "比裸动量更惩罚「大起大落」的上涨，偏好涨得稳的品种。"
    ),
    "SLOPE_20D": (
        "近 20 日价格对时间的线性回归斜率。"
        "平滑版趋势方向与速度，对单日跳空不如动量敏感，适合组合里做趋势确认。"
    ),
    "UP_DOWN_VOL_RATIO_20D": (
        "上涨日成交量合计 / 下跌日成交量合计（近 20 日）。"
        "比值高说明买盘量能占优，用于量能确认趋势，而非预测绝对涨幅。"
    ),
    "VOL_RATIO_20D": (
        "近期波动相对更长窗口波动的比值（波动是否升温）。"
        "波动骤升常伴随风险事件或趋势加速；在组合中多作风险/状态维度。"
    ),
    "VORTEX_14D": (
        "涡旋指标（Vortex）：刻画正向/反向趋势运动的相对优势。"
        "与动量同属趋势族，但构造不同，可提供一定增量；方向语义接近中性到偏趋势。"
    ),
    "SHARE_CHG_5D": (
        "ETF 近 5 日份额（规模）变化率，反映短线申赎。"
        "历史 IC 多为负向：份额快速扩张有时对应拥挤/追高，"
        "份额收缩或对应供给回收（low_is_good 的逆向解读需结合样本期）。"
    ),
    "SHARE_CHG_10D": (
        "近 10 日份额变化率，申赎拥挤度的中短窗口。"
        "研究里常是份额类里更稳的一档；方向同份额变化族，偏逆向资金流解读。"
    ),
    "SHARE_CHG_20D": (
        "近 20 日份额变化率，过滤更短噪声后的申赎趋势。"
        "与 5/10 日同族，用于看中等周期资金进出是否持续。"
    ),
    "SHARE_ACCEL": (
        "份额变化的加速度（变化率是否在加快）。"
        "捕捉申赎节奏拐点；与水平变化率不完全相同，研究中曾出现与水平因子不同的 IC 符号。"
    ),
    "MARGIN_CHG_10D": (
        "成分/相关融资余额近 10 日变化（杠杆资金加减仓代理）。"
        "融资猛增常伴随投机拥挤；截面上常作逆向/拥挤度（low_is_good）。"
    ),
    "MARGIN_BUY_RATIO": (
        "融资买入额占相关成交的比例，衡量杠杆买盘活跃度。"
        "比值过高可能表示短线投机过热；排序上偏低更干净（low_is_good）。"
    ),
}

DIRECTION_NOTE_ZH: dict[str, str] = {
    "high_is_good": "截面排序：数值越高通常越被看好（high_is_good）。",
    "low_is_good": "截面排序：数值越低通常越被看好（low_is_good，常作逆向/风险）。",
    "neutral": "方向中性或视组合符号（factor_signs）决定，不单边假设越高越好。",
}


def build_factor_catalog(active_factors: list[str] | None = None) -> list[dict[str, Any]]:
    """按 active_factors 顺序输出目录；未知因子仍返回最小字段。"""
    codes = list(active_factors or [])
    out: list[dict[str, Any]] = []
    for code in codes:
        code = str(code).strip()
        if not code:
            continue
        spec = FACTOR_SPECS.get(code)
        source = spec.source if spec else (
            "fund_share"
            if code.startswith("SHARE_")
            else "margin"
            if code.startswith("MARGIN_")
            else "ohlcv"
        )
        direction = get_factor_direction(code)
        bucket = FACTOR_TO_BUCKET.get(code)
        out.append(
            {
                "code": code,
                "label": FACTOR_LABEL_ZH.get(code) or (spec.description if spec else code),
                "group": GROUP_LABEL_ZH.get(source, "其他"),
                "source": source,
                "bucket": bucket,
                "bucket_label": BUCKET_LABEL_ZH.get(bucket or "", bucket or "未分桶"),
                "direction": direction,
                "direction_note": DIRECTION_NOTE_ZH.get(direction, ""),
                "summary": (spec.description if spec else "") or FACTOR_LABEL_ZH.get(code, code),
                "principle": FACTOR_PRINCIPLE_ZH.get(
                    code,
                    (spec.description if spec else "")
                    or "暂无详细原理，详见因子注册表与研究文档。",
                ),
            }
        )
    return out
