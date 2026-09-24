import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { buildChanlun, chanlunSummary, type Fenxing } from "../lib/chanlun";
import { klineAxisLabel, klineStamp, num, type KlineRow } from "../lib/kline";

const BULL = "#f87171";
const BEAR = "#34d399";
const BI = "#fbbf24";
const XD = "#67e8f9";
const BC = "#f472b6";
const SIG: Record<string, string> = { b1: "买1", s1: "卖1", b2: "买2", s2: "卖2", b3: "买3", s3: "卖3" };

type Props = {
  rows: KlineRow[];
  height?: number;
  axis?: "day" | "minute";
};

function seriesOf(rows: KlineRow[], key: keyof KlineRow): (number | null)[] {
  return rows.map((row) => num(row[key]));
}

export function DailyKChart({ rows, height = 380, axis = "day" }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const [showChanlun, setShowChanlun] = useState(true);

  useEffect(() => {
    const host = el.current;
    if (!host || rows.length === 0) return;
    const chart = echarts.init(host, undefined, { renderer: "canvas" });

    const dates = rows.map((row) => klineStamp(row.date));
    const candles = rows.map((row) => [num(row.open), num(row.close), num(row.low), num(row.high)]);
    const volumes = rows.map((row) => {
      const open = num(row.open) ?? 0;
      const close = num(row.close) ?? 0;
      return {
        value: num(row.volume),
        itemStyle: { color: close >= open ? BULL : BEAR },
      };
    });
    const start =
      (axis === "minute" && rows.length <= 280) || rows.length <= 80
        ? 0
        : Math.round((1 - 80 / rows.length) * 100);
    const text = getComputedStyle(document.documentElement).getPropertyValue("--ds-color-text-placeholder").trim() || "#8894a7";
    const grid = getComputedStyle(document.documentElement).getPropertyValue("--ds-color-border-default").trim() || "#283042";

    const chanlun = showChanlun ? buildChanlun(rows) : null;
    const endpointFx: Fenxing[] = [];
    const seen = new Set<string>();
    for (const stroke of chanlun?.bi ?? []) {
      for (const fx of [stroke.from, stroke.to]) {
        const key = `${fx.kind}:${fx.x}`;
        if (seen.has(key)) continue;
        seen.add(key);
        endpointFx.push(fx);
      }
    }
    const signalAt = new Map((chanlun?.signals ?? []).map((s) => [s.at.x, s]));
    const fenxingPoints = [
      ...(chanlun?.signals ?? []).map((s) => {
        const buy = s.kind.startsWith("b");
        return {
          coord: [dates[s.at.x], s.at.price] as [string, number],
          name: SIG[s.kind],
          value: SIG[s.kind],
          symbol: "circle",
          symbolSize: 18,
          symbolOffset: buy ? [0, 10] : [0, -10],
          itemStyle: { color: buy ? BULL : BEAR },
          label: {
            show: true,
            formatter: SIG[s.kind],
            color: buy ? BULL : BEAR,
            fontSize: 11,
            fontWeight: 700,
            offset: buy ? [0, 16] : [0, -16],
          },
        };
      }),
      ...endpointFx
        .filter((fx) => !signalAt.has(fx.x))
        .map((fx) => ({
          coord: [dates[fx.x], fx.price] as [string, number],
          name: fx.kind === "top" ? "顶" : "底",
          value: fx.kind === "top" ? "顶" : "底",
          symbol: "triangle",
          symbolSize: 10,
          symbolRotate: fx.kind === "top" ? 0 : 180,
          symbolOffset: fx.kind === "top" ? [0, -6] : [0, 6],
          itemStyle: { color: fx.kind === "top" ? BULL : BEAR },
          label: {
            show: true,
            formatter: fx.kind === "top" ? "顶" : "底",
            color: fx.kind === "top" ? BULL : BEAR,
            fontSize: 10,
            offset: fx.kind === "top" ? [0, -12] : [0, 12],
          },
        })),
    ];
    const confirmedPath: Array<[string, number]> = [];
    const draftPath: Array<[string, number]> = [];
    for (const stroke of chanlun?.bi ?? []) {
      const path = stroke.confirmed ? confirmedPath : draftPath;
      if (path.length === 0) path.push([dates[stroke.from.x], stroke.from.price]);
      path.push([dates[stroke.to.x], stroke.to.price]);
    }
    const xdConfirmed: Array<[string, number]> = [];
    const xdDraft: Array<[string, number]> = [];
    for (const xd of chanlun?.xianduan ?? []) {
      const path = xd.confirmed ? xdConfirmed : xdDraft;
      if (path.length === 0) path.push([dates[xd.from.x], xd.from.price]);
      path.push([dates[xd.to.x], xd.to.price]);
    }
    const beichiPaths = (chanlun?.beichi ?? []).map((bc) => [
      [dates[bc.from.x], bc.from.price] as [string, number],
      [dates[bc.to.x], bc.to.price] as [string, number],
    ]);

    const option: EChartsOption = {
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(18,20,28,0.92)",
        borderColor: grid,
        textStyle: { color: "#e2e8f0", fontSize: 12, fontFamily: "ui-monospace, monospace" },
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [
        { left: 56, right: 16, top: 28, height: "56%" },
        { left: 56, right: 16, top: "76%", height: "16%" },
      ],
      xAxis: [
        {
          type: "category",
          data: dates,
          boundaryGap: true,
          axisLine: { lineStyle: { color: grid } },
          axisLabel: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
        },
        {
          type: "category",
          data: dates,
          gridIndex: 1,
          boundaryGap: true,
          axisLine: { lineStyle: { color: grid } },
          axisLabel: {
            color: text,
            fontSize: 10,
            formatter: (value: string) => klineAxisLabel(value, axis),
          },
          axisTick: { show: false },
          splitLine: { show: false },
        },
      ],
      yAxis: [
        {
          scale: true,
          boundaryGap: [0.08, 0.08],
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: grid, opacity: 0.5 } },
          axisLabel: { color: text, fontSize: 10 },
        },
        {
          gridIndex: 1,
          scale: true,
          splitNumber: 2,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { color: text, fontSize: 10 },
        },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1], start, end: 100 },
        { type: "slider", xAxisIndex: [0, 1], start, end: 100, height: 16, bottom: 4, borderColor: grid, fillerColor: "rgba(103,153,254,0.18)", handleSize: 12, textStyle: { color: text } },
      ],
      series: [
        {
          name: "K",
          type: "candlestick",
          data: candles,
          itemStyle: { color: BULL, color0: BEAR, borderColor: BULL, borderColor0: BEAR },
          markPoint: showChanlun && fenxingPoints.length ? { data: fenxingPoints, silent: true } : undefined,
          markArea:
            showChanlun && (chanlun?.zhongshu.length ?? 0) > 0
              ? {
                  silent: true,
                  itemStyle: {
                    color: "rgba(251, 191, 36, 0.08)",
                    borderColor: "rgba(251, 191, 36, 0.45)",
                    borderWidth: 1,
                  },
                  data: (chanlun?.zhongshu ?? []).map((zs) => [
                    {
                      coord: [dates[zs.startX], zs.zd],
                      itemStyle: zs.confirmed
                        ? undefined
                        : {
                            color: "rgba(251, 191, 36, 0.05)",
                            borderColor: "rgba(251, 191, 36, 0.3)",
                            borderType: "dashed" as const,
                          },
                    },
                    { coord: [dates[zs.endX], zs.zg] },
                  ]),
                }
              : undefined,
        },
        { name: "MA5", type: "line", data: seriesOf(rows, "ma5"), symbol: "none", lineStyle: { width: 1.2, color: "#eab308" } },
        { name: "MA10", type: "line", data: seriesOf(rows, "ma10"), symbol: "none", lineStyle: { width: 1.2, color: "#38bdf8" } },
        { name: "MA20", type: "line", data: seriesOf(rows, "ma20"), symbol: "none", lineStyle: { width: 1.2, color: "#a855f7" } },
        { name: "成交量", type: "bar", data: volumes, xAxisIndex: 1, yAxisIndex: 1 },
        ...(showChanlun && confirmedPath.length >= 2
          ? [
              {
                name: "笔",
                type: "line" as const,
                data: confirmedPath,
                symbol: "circle",
                symbolSize: 5,
                z: 8,
                lineStyle: { width: 1.6, color: BI },
                itemStyle: { color: BI },
                tooltip: { show: false },
              },
            ]
          : []),
        ...(showChanlun && draftPath.length >= 2
          ? [
              {
                name: "未确认笔",
                type: "line" as const,
                data: draftPath,
                symbol: "circle",
                symbolSize: 5,
                z: 8,
                lineStyle: { width: 1.6, color: BI, type: "dashed" as const },
                itemStyle: { color: BI },
                tooltip: { show: false },
              },
            ]
          : []),
        ...(showChanlun && xdConfirmed.length >= 2
          ? [
              {
                name: "线段",
                type: "line" as const,
                data: xdConfirmed,
                symbol: "diamond",
                symbolSize: 8,
                z: 10,
                lineStyle: { width: 2.2, color: XD },
                itemStyle: { color: XD },
                tooltip: { show: false },
              },
            ]
          : []),
        ...(showChanlun && xdDraft.length >= 2
          ? [
              {
                name: "未确认线段",
                type: "line" as const,
                data: xdDraft,
                symbol: "diamond",
                symbolSize: 8,
                z: 10,
                lineStyle: { width: 2.2, color: XD, type: "dashed" as const },
                itemStyle: { color: XD },
                tooltip: { show: false },
              },
            ]
          : []),
        ...(showChanlun && (chanlun?.xdZhongshu.length ?? 0) > 0
          ? [
              {
                name: "线段中枢",
                type: "line" as const,
                data: [],
                markArea: {
                  silent: true,
                  itemStyle: {
                    color: "rgba(103, 232, 249, 0.12)",
                    borderColor: "rgba(103, 232, 249, 0.75)",
                    borderWidth: 1.2,
                  },
                  data: (chanlun?.xdZhongshu ?? []).map((zs) => [
                    {
                      coord: [dates[zs.startX], zs.zd],
                      itemStyle: zs.confirmed
                        ? undefined
                        : {
                            color: "rgba(103, 232, 249, 0.06)",
                            borderColor: "rgba(103, 232, 249, 0.4)",
                            borderType: "dashed" as const,
                          },
                    },
                    { coord: [dates[zs.endX], zs.zg] },
                  ]),
                },
                tooltip: { show: false },
              },
            ]
          : []),
        ...beichiPaths.map((data, index) => ({
          name: index === 0 ? "背驰" : `背驰${index + 1}`,
          type: "line" as const,
          data,
          symbol: "none",
          z: 11,
          lineStyle: { width: 2.4, color: BC, type: "dashed" as const },
          tooltip: { show: false },
        })),
      ] as EChartsOption["series"],
    };
    chart.setOption(option);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(host);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [rows, showChanlun, axis]);

  const summary = useMemo(() => {
    if (!showChanlun || rows.length === 0) return "";
    return chanlunSummary(buildChanlun(rows));
  }, [rows, showChanlun]);

  return (
    <div className="kline-chart-wrap">
      <div className="kline-tools">
        <button type="button" className={showChanlun ? "is-on" : ""} onClick={() => setShowChanlun((v) => !v)}>
          缠论
        </button>
        {summary ? <span className="kline-tools-meta">{summary}</span> : null}
      </div>
      <div ref={el} className="kline-chart" style={{ height }} />
    </div>
  );
}
