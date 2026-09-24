import { klineStamp, num, type KlineRow } from "./kline";

export type ChanlunBar = {
  start: number;
  end: number;
  high: number;
  low: number;
  highIndex: number;
  lowIndex: number;
};

export type Fenxing = {
  kind: "top" | "bottom";
  barIndex: number;
  x: number;
  price: number;
  date: string;
};

export type Bi = {
  from: Fenxing;
  to: Fenxing;
  confirmed: boolean;
};

export type Xianduan = {
  from: Fenxing;
  to: Fenxing;
  startBi: number;
  endBi: number;
  confirmed: boolean;
};

export type Zhongshu = {
  level: "bi" | "xd";
  startBi: number;
  endBi: number;
  zg: number;
  zd: number;
  startX: number;
  endX: number;
  startDate: string;
  endDate: string;
  confirmed: boolean;
};

export type ZouShiKind = "pan" | "up" | "down";

export type ZouShi = {
  kind: ZouShiKind;
  startXd: number;
  endXd: number;
  zhongshu: Zhongshu[];
  from: Fenxing;
  to: Fenxing;
  confirmed: boolean;
};

export type Beichi = {
  dir: 1 | -1;
  from: Fenxing;
  to: Fenxing;
  ratio: number;
  confirmed: boolean;
};

export type SignalKind = "b1" | "s1" | "b2" | "s2" | "b3" | "s3";

export type ChanlunSignal = {
  kind: SignalKind;
  at: Fenxing;
};

export type ChanlunResult = {
  bars: ChanlunBar[];
  fenxing: Fenxing[];
  bi: Bi[];
  xianduan: Xianduan[];
  zhongshu: Zhongshu[];
  xdZhongshu: Zhongshu[];
  zoushi: ZouShi[];
  beichi: Beichi[];
  signals: ChanlunSignal[];
};

const MIN_VERTEX_GAP = 4;

function rawBar(rows: KlineRow[], index: number): ChanlunBar | null {
  const high = num(rows[index]?.high);
  const low = num(rows[index]?.low);
  if (high == null || low == null || high < low) return null;
  return { start: index, end: index, high, low, highIndex: index, lowIndex: index };
}

function contains(a: ChanlunBar, b: ChanlunBar): boolean {
  return (a.high >= b.high && a.low <= b.low) || (b.high >= a.high && b.low <= a.low);
}

function merge(a: ChanlunBar, b: ChanlunBar, dir: 1 | -1): ChanlunBar {
  if (dir === 1) {
    const highFirst = a.high >= b.high;
    const lowFirst = a.low >= b.low;
    return {
      start: a.start,
      end: b.end,
      high: highFirst ? a.high : b.high,
      low: lowFirst ? a.low : b.low,
      highIndex: highFirst ? a.highIndex : b.highIndex,
      lowIndex: lowFirst ? a.lowIndex : b.lowIndex,
    };
  }
  const highFirst = a.high <= b.high;
  const lowFirst = a.low <= b.low;
  return {
    start: a.start,
    end: b.end,
    high: highFirst ? a.high : b.high,
    low: lowFirst ? a.low : b.low,
    highIndex: highFirst ? a.highIndex : b.highIndex,
    lowIndex: lowFirst ? a.lowIndex : b.lowIndex,
  };
}

function directionOf(prev: ChanlunBar, next: ChanlunBar): 1 | -1 | 0 {
  if (next.high > prev.high && next.low > prev.low) return 1;
  if (next.high < prev.high && next.low < prev.low) return -1;
  return 0;
}

export function includeBars(rows: KlineRow[]): ChanlunBar[] {
  const bars: ChanlunBar[] = [];
  let dir: 1 | -1 | 0 = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const cur = rawBar(rows, i);
    if (!cur) continue;
    if (bars.length === 0) {
      bars.push(cur);
      continue;
    }
    const last = bars[bars.length - 1];
    if (contains(last, cur)) {
      let use: 1 | -1 = dir === 0 ? 1 : dir;
      if (dir === 0 && bars.length >= 2) {
        const inferred = directionOf(bars[bars.length - 2], last);
        if (inferred !== 0) use = inferred;
      }
      dir = use;
      bars[bars.length - 1] = merge(last, cur, use);
      continue;
    }
    const nextDir = directionOf(last, cur);
    if (nextDir !== 0) dir = nextDir;
    bars.push(cur);
  }
  return bars;
}

export function findFenxing(bars: ChanlunBar[], rows: KlineRow[]): Fenxing[] {
  const out: Fenxing[] = [];
  for (let i = 1; i < bars.length - 1; i += 1) {
    const prev = bars[i - 1];
    const cur = bars[i];
    const next = bars[i + 1];
    const isTop = cur.high > prev.high && cur.high > next.high;
    const isBottom = cur.low < prev.low && cur.low < next.low;
    if (isTop === isBottom) continue;
    const kind = isTop ? "top" : "bottom";
    const x = isTop ? cur.highIndex : cur.lowIndex;
    const price = isTop ? cur.high : cur.low;
    out.push({ kind, barIndex: i, x, price, date: klineStamp(rows[x]?.date) });
  }
  return out;
}

function validStroke(a: Fenxing, b: Fenxing): boolean {
  if (a.kind === b.kind) return false;
  if (b.barIndex - a.barIndex < MIN_VERTEX_GAP) return false;
  if (a.kind === "bottom" && b.kind === "top") return b.price > a.price;
  if (a.kind === "top" && b.kind === "bottom") return b.price < a.price;
  return false;
}

function moreExtreme(cur: Fenxing, next: Fenxing): Fenxing {
  if (cur.kind !== next.kind) return cur;
  if (cur.kind === "top") return next.price >= cur.price ? next : cur;
  return next.price <= cur.price ? next : cur;
}

export function buildBi(fenxing: Fenxing[]): Bi[] {
  if (fenxing.length < 2) return [];
  const bi: Bi[] = [];
  let start = fenxing[0];
  for (let i = 1; i < fenxing.length; i += 1) {
    const fx = fenxing[i];
    if (fx.kind === start.kind) {
      start = moreExtreme(start, fx);
      continue;
    }
    if (validStroke(start, fx)) {
      bi.push({ from: start, to: fx, confirmed: true });
      start = fx;
      continue;
    }
    if (start.kind === "top" && fx.kind === "bottom" && fx.price > start.price) continue;
    if (start.kind === "bottom" && fx.kind === "top" && fx.price < start.price) continue;
  }
  if (bi.length > 0) bi[bi.length - 1] = { ...bi[bi.length - 1], confirmed: false };
  return bi;
}

function rangeOf(seg: { from: Fenxing; to: Fenxing }): { high: number; low: number; startX: number; endX: number } {
  return {
    high: Math.max(seg.from.price, seg.to.price),
    low: Math.min(seg.from.price, seg.to.price),
    startX: Math.min(seg.from.x, seg.to.x),
    endX: Math.max(seg.from.x, seg.to.x),
  };
}

function threeOverlap(
  a: { high: number; low: number },
  b: { high: number; low: number },
  c: { high: number; low: number },
): { zg: number; zd: number } | null {
  const zg = Math.min(a.high, b.high, c.high);
  const zd = Math.max(a.low, b.low, c.low);
  if (zg <= zd) return null;
  return { zg, zd };
}

export function buildZhongshu(
  segs: Array<{ from: Fenxing; to: Fenxing; confirmed: boolean }>,
  level: "bi" | "xd" = "bi",
): Zhongshu[] {
  const out: Zhongshu[] = [];
  let i = 0;
  while (i + 2 < segs.length) {
    const r0 = rangeOf(segs[i]);
    const r1 = rangeOf(segs[i + 1]);
    const r2 = rangeOf(segs[i + 2]);
    const ov = threeOverlap(r0, r1, r2);
    if (!ov) {
      i += 1;
      continue;
    }
    let end = i + 2;
    while (end + 1 < segs.length) {
      const next = rangeOf(segs[end + 1]);
      if (!(next.high > ov.zd && next.low < ov.zg)) break;
      end += 1;
    }
    const last = rangeOf(segs[end]);
    out.push({
      level,
      startBi: i,
      endBi: end,
      zg: ov.zg,
      zd: ov.zd,
      startX: r0.startX,
      endX: last.endX,
      startDate: segs[i].from.date,
      endDate: segs[end].to.date,
      confirmed: segs.slice(i, end + 1).every((stroke) => stroke.confirmed),
    });
    i = end + 1;
  }
  return out;
}

type Feat = { high: number; low: number; biIndex: number };

function biDir(stroke: Bi): 1 | -1 {
  return stroke.from.kind === "bottom" ? 1 : -1;
}

function featOf(stroke: Bi, biIndex: number): Feat {
  return {
    high: Math.max(stroke.from.price, stroke.to.price),
    low: Math.min(stroke.from.price, stroke.to.price),
    biIndex,
  };
}

function featContains(a: Feat, b: Feat): boolean {
  return (a.high >= b.high && a.low <= b.low) || (b.high >= a.high && b.low <= a.low);
}

function mergeFeat(a: Feat, b: Feat, dir: 1 | -1): Feat {
  if (dir === 1) {
    return {
      high: Math.max(a.high, b.high),
      low: Math.max(a.low, b.low),
      biIndex: b.biIndex,
    };
  }
  return {
    high: Math.min(a.high, b.high),
    low: Math.min(a.low, b.low),
    biIndex: b.biIndex,
  };
}

function includeFeats(raw: Feat[], dir: 1 | -1): Feat[] {
  if (raw.length === 0) return [];
  const out: Feat[] = [raw[0]];
  for (let i = 1; i < raw.length; i += 1) {
    const last = out[out.length - 1];
    const cur = raw[i];
    if (featContains(last, cur)) out[out.length - 1] = mergeFeat(last, cur, dir);
    else out.push(cur);
  }
  return out;
}

function collectFeats(bi: Bi[], start: number, end: number): Feat[] {
  const out: Feat[] = [];
  for (let j = start + 1; j <= end; j += 2) out.push(featOf(bi[j], j));
  return out;
}

function featGap(a: Feat, b: Feat): boolean {
  return a.low > b.high || b.low > a.high;
}

function endingFenxing(
  feats: Feat[],
  dir: 1 | -1,
): { mid: Feat; third: Feat } | null {
  for (let i = 1; i < feats.length - 1; i += 1) {
    const prev = feats[i - 1];
    const cur = feats[i];
    const next = feats[i + 1];
    const isFx = dir === 1 ? cur.high > prev.high && cur.high > next.high : cur.low < prev.low && cur.low < next.low;
    if (!isFx) continue;
    if (featGap(prev, cur)) {
      const broken = dir === 1 ? next.high > cur.high : next.low < cur.low;
      if (broken) continue;
    }
    return { mid: cur, third: next };
  }
  return null;
}

export function buildXianduan(bi: Bi[]): Xianduan[] {
  const out: Xianduan[] = [];
  let start = 0;
  while (start + 2 < bi.length) {
    const d = biDir(bi[start]);
    if (biDir(bi[start + 1]) === d || biDir(bi[start + 2]) !== d) {
      start += 1;
      continue;
    }

    let nextStart = -1;
    let turning: Fenxing | null = null;
    let confirmed = false;
    for (let k = start + 2; k < bi.length; k += 1) {
      const feats = includeFeats(collectFeats(bi, start, k), d);
      if (feats.length < 3) continue;
      const fx = endingFenxing(feats, d);
      if (!fx) continue;
      const m = fx.mid.biIndex;
      if (m - 1 < start + 2) continue;
      nextStart = m;
      turning = bi[m].from;
      confirmed = bi.slice(start, fx.third.biIndex + 1).every((stroke) => stroke.confirmed);
      break;
    }

    if (turning && nextStart > start) {
      out.push({
        from: bi[start].from,
        to: turning,
        startBi: start,
        endBi: nextStart - 1,
        confirmed,
      });
      start = nextStart;
      continue;
    }

    out.push({
      from: bi[start].from,
      to: extremeEnd(bi, start, bi.length - 1, d),
      startBi: start,
      endBi: bi.length - 1,
      confirmed: false,
    });
    break;
  }
  return out;
}

function extremeEnd(bi: Bi[], start: number, end: number, dir: 1 | -1): Fenxing {
  let best = dir === 1 ? bi[start].to : bi[start].to;
  for (let i = start; i <= end; i += 1) {
    for (const fx of [bi[i].from, bi[i].to]) {
      if (dir === 1 && fx.kind === "top" && fx.price >= best.price) best = fx;
      if (dir === -1 && fx.kind === "bottom" && fx.price <= best.price) best = fx;
    }
  }
  return best;
}

function xdDir(seg: Xianduan): 1 | -1 {
  return seg.from.kind === "bottom" ? 1 : -1;
}

function zsRelation(a: Zhongshu, b: Zhongshu): 1 | -1 | 0 {
  if (b.zd > a.zg) return 1;
  if (b.zg < a.zd) return -1;
  return 0;
}

function extremeOfXd(xd: Xianduan[], start: number, end: number, dir: 1 | -1): Fenxing {
  let best = xd[start].to;
  for (let i = start; i <= end; i += 1) {
    for (const fx of [xd[i].from, xd[i].to]) {
      if (dir === 1 && fx.kind === "top" && fx.price >= best.price) best = fx;
      if (dir === -1 && fx.kind === "bottom" && fx.price <= best.price) best = fx;
    }
  }
  return best;
}

function leaveSpan(
  xd: Xianduan[],
  fromIdx: number,
  toIdx: number,
  dir: 1 | -1,
): { from: Fenxing; to: Fenxing } | null {
  if (fromIdx < 0 || toIdx >= xd.length || fromIdx > toIdx) return null;
  return { from: xd[fromIdx].from, to: extremeOfXd(xd, fromIdx, toIdx, dir) };
}

export function buildZoushi(xd: Xianduan[], zs: Zhongshu[]): ZouShi[] {
  if (xd.length === 0 || zs.length === 0) return [];
  const out: ZouShi[] = [];
  let i = 0;
  while (i < zs.length) {
    const group = [zs[i]];
    let kind: ZouShiKind = "pan";
    let j = i + 1;
    while (j < zs.length) {
      const rel = zsRelation(group[group.length - 1], zs[j]);
      if (rel === 0) {
        group.push(zs[j]);
        j += 1;
        continue;
      }
      if (kind === "pan") {
        kind = rel === 1 ? "up" : "down";
        group.push(zs[j]);
        j += 1;
        continue;
      }
      if ((kind === "up" && rel === 1) || (kind === "down" && rel === -1)) {
        group.push(zs[j]);
        j += 1;
        continue;
      }
      break;
    }
    const startXd = group[0].startBi;
    const endXd = j < zs.length ? Math.max(startXd, zs[j].startBi - 1) : xd.length - 1;
    const dir: 1 | -1 = kind === "down" ? -1 : 1;
    out.push({
      kind: group.length >= 2 && kind !== "pan" ? kind : "pan",
      startXd,
      endXd,
      zhongshu: group,
      from: xd[startXd]?.from ?? xd[0].from,
      to: extremeOfXd(xd, startXd, endXd, kind === "pan" ? xdDir(xd[startXd]) : dir),
      confirmed: group.every((z) => z.confirmed) && (j < zs.length || xd[endXd]?.confirmed === true),
    });
    i = j > i ? j : i + 1;
  }
  return out;
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] ?? prev;
    prev = i === 0 ? v : v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function macdHist(rows: KlineRow[]): number[] {
  const close = rows.map((row) => num(row.close) ?? 0);
  if (close.length === 0) return [];
  const e12 = ema(close, 12);
  const e26 = ema(close, 26);
  const dif = e12.map((v, i) => v - e26[i]);
  const dea = ema(dif, 9);
  return dif.map((v, i) => (v - dea[i]) * 2);
}

function histArea(hist: number[], a: Fenxing, b: Fenxing, dir: 1 | -1): number {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const x1 = Math.min(hist.length - 1, Math.max(a.x, b.x));
  let sum = 0;
  for (let i = x0; i <= x1; i += 1) {
    const h = hist[i] ?? 0;
    if (dir === 1 && h > 0) sum += h;
    if (dir === -1 && h < 0) sum -= h;
  }
  return sum;
}

function slopeOf(a: Fenxing, b: Fenxing): number {
  return Math.abs(b.price - a.price) / Math.max(1, Math.abs(b.x - a.x));
}

function weaker(leave1: { from: Fenxing; to: Fenxing }, leave2: { from: Fenxing; to: Fenxing }, hist: number[], dir: 1 | -1): number | null {
  const a1 = histArea(hist, leave1.from, leave1.to, dir);
  const a2 = histArea(hist, leave2.from, leave2.to, dir);
  if (a1 > 0 && a2 < a1) return a2 / a1;
  const s1 = slopeOf(leave1.from, leave1.to);
  const s2 = slopeOf(leave2.from, leave2.to);
  if (s1 > 0 && s2 < s1 * 0.85) return s2 / s1;
  return null;
}

export function buildBeichi(rows: KlineRow[], xd: Xianduan[], zoushi: ZouShi[]): Beichi[] {
  const hist = macdHist(rows);
  const out: Beichi[] = [];
  for (const zs of zoushi) {
    if (zs.kind === "up" || zs.kind === "down") {
      const dir: 1 | -1 = zs.kind === "up" ? 1 : -1;
      if (zs.zhongshu.length < 2) continue;
      const first = zs.zhongshu[0];
      const last = zs.zhongshu[zs.zhongshu.length - 1];
      const leave1 = leaveSpan(xd, first.endBi + 1, Math.max(first.endBi + 1, last.startBi - 1), dir);
      const leave2 = leaveSpan(xd, last.endBi + 1, zs.endXd, dir);
      if (!leave1 || !leave2) continue;
      const madeExtreme = dir === 1 ? leave2.to.price >= leave1.to.price : leave2.to.price <= leave1.to.price;
      if (!madeExtreme) continue;
      const ratio = weaker(leave1, leave2, hist, dir);
      if (ratio == null) continue;
      out.push({
        dir,
        from: leave2.from,
        to: leave2.to,
        ratio,
        confirmed: xd[zs.endXd]?.confirmed === true,
      });
      continue;
    }
    const hub = zs.zhongshu[0];
    if (!hub || hub.startBi === 0 || hub.endBi + 1 > zs.endXd) continue;
    const enterDir = xdDir(xd[hub.startBi - 1]);
    const leaveDir = xdDir(xd[hub.endBi + 1]);
    if (enterDir !== leaveDir) continue;
    const enter = leaveSpan(xd, Math.max(zs.startXd, hub.startBi - 1), hub.startBi - 1, enterDir);
    const leave = leaveSpan(xd, hub.endBi + 1, zs.endXd, leaveDir);
    if (!enter || !leave) continue;
    const madeExtreme = leaveDir === 1 ? leave.to.price >= enter.to.price : leave.to.price <= enter.to.price;
    if (!madeExtreme) continue;
    const ratio = weaker(enter, leave, hist, leaveDir);
    if (ratio == null) continue;
    out.push({
      dir: leaveDir,
      from: leave.from,
      to: leave.to,
      ratio,
      confirmed: xd[zs.endXd]?.confirmed === true,
    });
  }
  return out;
}

export function buildSignals(xd: Xianduan[], xdZs: Zhongshu[], beichi: Beichi[]): ChanlunSignal[] {
  const out: ChanlunSignal[] = [];
  const seen = new Set<string>();
  const push = (kind: SignalKind, at: Fenxing) => {
    const key = `${kind}:${at.x}:${at.price}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, at });
  };

  for (const bc of beichi) {
    push(bc.dir === 1 ? "s1" : "b1", bc.to);
  }

  for (const s of [...out]) {
    if (s.kind !== "b1" && s.kind !== "s1") continue;
    const i = xd.findIndex((seg) => seg.to.x === s.at.x);
    if (i < 0 || i + 2 >= xd.length) continue;
    const pull = xd[i + 2];
    if (s.kind === "b1" && pull.to.kind === "bottom" && pull.to.price > s.at.price) push("b2", pull.to);
    if (s.kind === "s1" && pull.to.kind === "top" && pull.to.price < s.at.price) push("s2", pull.to);
  }

  for (const zs of xdZs) {
    const leaveIdx = zs.endBi + 1;
    const pull = xd[leaveIdx + 1];
    if (!xd[leaveIdx] || !pull) continue;
    const d = xdDir(xd[leaveIdx]);
    if (xdDir(pull) === d) continue;
    if (d === 1 && pull.to.kind === "bottom" && pull.to.price > zs.zg) push("b3", pull.to);
    if (d === -1 && pull.to.kind === "top" && pull.to.price < zs.zd) push("s3", pull.to);
  }
  return out;
}

const SIGNAL_ZH: Record<SignalKind, string> = {
  b1: "买1",
  s1: "卖1",
  b2: "买2",
  s2: "卖2",
  b3: "买3",
  s3: "卖3",
};

export function chanlunSummary(result: ChanlunResult): string {
  const last = result.zoushi[result.zoushi.length - 1];
  const kind =
    last?.kind === "up" ? "上涨趋势" : last?.kind === "down" ? "下跌趋势" : last ? "盘整" : "";
  const sig = result.signals.map((s) => SIGNAL_ZH[s.kind]).join(" ");
  return [
    `分型 ${result.fenxing.length}`,
    `笔 ${result.bi.length}`,
    `线段 ${result.xianduan.length}`,
    `中枢 ${result.xdZhongshu.length || result.zhongshu.length}`,
    kind,
    sig,
  ]
    .filter(Boolean)
    .join(" · ");
}

export type ChanlunPosition = {
  trend: string;
  xd: string;
  lastLabel: string | null;
  lastAgo: string | null;
  inZhongshu: boolean;
  text: string;
};

export function chanlunPosition(result: ChanlunResult, barCount: number): ChanlunPosition {
  const lastZs = result.zoushi[result.zoushi.length - 1];
  const lastXd = result.xianduan[result.xianduan.length - 1];
  const lastBi = result.bi[result.bi.length - 1];
  const trend = lastZs
    ? lastZs.kind === "up"
      ? "上涨趋势"
      : lastZs.kind === "down"
        ? "下跌趋势"
        : "盘整"
    : result.xianduan.length
      ? "走势未成"
      : result.bi.length
        ? "线段未成"
        : result.fenxing.length
          ? "笔未成"
          : "K线不足";
  const xd = lastXd
    ? lastXd.to.kind === "top"
      ? "线段向上"
      : "线段向下"
    : lastBi
      ? lastBi.to.kind === "top"
        ? "笔向上"
        : "笔向下"
      : "";
  const lastSig = result.signals[result.signals.length - 1];
  const lastLabel = lastSig ? SIGNAL_ZH[lastSig.kind] : null;
  const barsAgo = lastSig ? Math.max(0, barCount - 1 - lastSig.at.x) : null;
  const lastAgo =
    barsAgo == null ? null : barsAgo <= 0 ? "最新K" : barsAgo === 1 ? "1根前" : `${barsAgo}根前`;
  const x = barCount - 1;
  const xdHub = result.xdZhongshu[result.xdZhongshu.length - 1];
  const biHub = result.zhongshu[result.zhongshu.length - 1];
  const inZhongshu = Boolean(
    (xdHub && x >= xdHub.startX && x <= xdHub.endX) ||
      (!xdHub && biHub && x >= biHub.startX && x <= biHub.endX),
  );
  const hubLabel = xdHub && x >= xdHub.startX && x <= xdHub.endX
    ? "中枢内"
    : !xdHub && biHub && x >= biHub.startX && x <= biHub.endX
      ? "笔中枢内"
      : "";
  const text = [trend, xd, lastLabel ? `${lastLabel} · ${lastAgo}` : "", hubLabel].filter(Boolean).join(" · ");
  return { trend, xd, lastLabel, lastAgo, inZhongshu, text };
}

export function buildChanlun(rows: KlineRow[]): ChanlunResult {
  const bars = includeBars(rows);
  const fenxing = findFenxing(bars, rows);
  const bi = buildBi(fenxing);
  const xianduan = buildXianduan(bi);
  const zhongshu = buildZhongshu(bi, "bi");
  const xdZhongshu = buildZhongshu(xianduan, "xd");
  const zoushi = buildZoushi(xianduan, xdZhongshu);
  const beichi = buildBeichi(rows, xianduan, zoushi);
  const signals = buildSignals(xianduan, xdZhongshu, beichi);
  return { bars, fenxing, bi, xianduan, zhongshu, xdZhongshu, zoushi, beichi, signals };
}
