export type KlineRow = {
  date?: unknown;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
  amount?: number | null;
  ma5?: number | null;
  ma10?: number | null;
  ma20?: number | null;
  ma60?: number | null;
  vol_ratio_5d?: number | null;
  change_pct?: number | null;
  [key: string]: unknown;
};

export type TrendTag = {
  id: string;
  label: string;
  tone: "bull" | "bear" | "neutral";
};

export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function klineDate(v: unknown): string {
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date && Number.isFinite(v.getTime())) return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
}

function flagged(row: KlineRow, key: string): boolean {
  const v = row[key];
  return v === true || v === 1 || v === "1";
}

export function lastKline(rows: KlineRow[] | undefined): KlineRow | undefined {
  if (!rows?.length) return undefined;
  return rows[rows.length - 1];
}

export function trendTags(row: KlineRow | undefined): TrendTag[] {
  if (!row) return [];
  const tags: TrendTag[] = [];
  const close = num(row.close);
  const ma5 = num(row.ma5);
  const ma10 = num(row.ma10);
  const ma20 = num(row.ma20);
  const vr = num(row.vol_ratio_5d);

  if (close != null && ma20 != null) {
    tags.push(
      close >= ma20
        ? { id: "above20", label: "站上20线", tone: "bull" }
        : { id: "below20", label: "跌破20线", tone: "bear" },
    );
  }
  if (ma5 != null && ma10 != null && ma20 != null) {
    if (ma5 > ma10 && ma10 > ma20) tags.push({ id: "bull-align", label: "多头排列", tone: "bull" });
    else if (ma5 < ma10 && ma10 < ma20) tags.push({ id: "bear-align", label: "空头排列", tone: "bear" });
  }
  if (vr != null) {
    if (vr >= 2) tags.push({ id: "vol-up", label: `放量 ${vr.toFixed(1)}x`, tone: "bull" });
    else if (vr <= 0.5) tags.push({ id: "vol-dn", label: `缩量 ${vr.toFixed(1)}x`, tone: "bear" });
  }
  if (flagged(row, "signal_ma20_breakout")) tags.push({ id: "break20", label: "突破20线", tone: "bull" });
  if (flagged(row, "signal_volume_surge")) tags.push({ id: "surge", label: "放量异动", tone: "bull" });
  if (flagged(row, "signal_macd_golden")) tags.push({ id: "macd-g", label: "MACD金叉", tone: "bull" });
  if (flagged(row, "signal_macd_dead")) tags.push({ id: "macd-d", label: "MACD死叉", tone: "bear" });
  if (flagged(row, "signal_ma_golden_5_20")) tags.push({ id: "ma-g", label: "MA5上穿MA20", tone: "bull" });
  if (flagged(row, "signal_ma_dead_5_20")) tags.push({ id: "ma-d", label: "MA5下穿MA20", tone: "bear" });
  if (flagged(row, "signal_n_day_high")) tags.push({ id: "nh", label: "阶段新高", tone: "bull" });
  if (flagged(row, "signal_n_day_low")) tags.push({ id: "nl", label: "阶段新低", tone: "bear" });
  return tags;
}

export function trendFacts(row: KlineRow | undefined): string {
  if (!row) return "";
  const close = num(row.close);
  const ma20 = num(row.ma20);
  const vr = num(row.vol_ratio_5d);
  const date = klineDate(row.date);
  const parts: string[] = [];
  if (date) parts.push(date);
  if (close != null) parts.push(`收盘 ${close.toFixed(2)}`);
  if (close != null && ma20 != null) {
    const pct = ((close - ma20) / ma20) * 100;
    parts.push(`MA20 ${ma20.toFixed(2)}（${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%）`);
  }
  if (vr != null) parts.push(`量比 ${vr.toFixed(2)}x`);
  return parts.join(" · ");
}
