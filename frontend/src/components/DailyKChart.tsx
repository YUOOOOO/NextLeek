import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { klineDate, num, type KlineRow } from "../lib/kline";

const BULL = "#f87171";
const BEAR = "#34d399";

type Props = {
  rows: KlineRow[];
  height?: number;
};

function seriesOf(rows: KlineRow[], key: keyof KlineRow): (number | null)[] {
  return rows.map((row) => num(row[key]));
}

export function DailyKChart({ rows, height = 380 }: Props) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = el.current;
    if (!host || rows.length === 0) return;
    const chart = echarts.init(host, undefined, { renderer: "canvas" });

    const dates = rows.map((row) => klineDate(row.date));
    const candles = rows.map((row) => [num(row.open), num(row.close), num(row.low), num(row.high)]);
    const volumes = rows.map((row) => {
      const open = num(row.open) ?? 0;
      const close = num(row.close) ?? 0;
      return {
        value: num(row.volume),
        itemStyle: { color: close >= open ? BULL : BEAR },
      };
    });
    const start = rows.length > 80 ? Math.round((1 - 80 / rows.length) * 100) : 0;
    const text = getComputedStyle(document.documentElement).getPropertyValue("--ds-color-text-placeholder").trim() || "#8894a7";
    const grid = getComputedStyle(document.documentElement).getPropertyValue("--ds-color-border-default").trim() || "#283042";

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
        { left: 56, right: 16, top: 24, height: "58%" },
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
          axisLabel: { color: text, fontSize: 10 },
          axisTick: { show: false },
          splitLine: { show: false },
        },
      ],
      yAxis: [
        {
          scale: true,
          boundaryGap: [0.03, 0.03],
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
        },
        { name: "MA5", type: "line", data: seriesOf(rows, "ma5"), symbol: "none", lineStyle: { width: 1.2, color: "#eab308" } },
        { name: "MA10", type: "line", data: seriesOf(rows, "ma10"), symbol: "none", lineStyle: { width: 1.2, color: "#38bdf8" } },
        { name: "MA20", type: "line", data: seriesOf(rows, "ma20"), symbol: "none", lineStyle: { width: 1.2, color: "#a855f7" } },
        { name: "成交量", type: "bar", data: volumes, xAxisIndex: 1, yAxisIndex: 1 },
      ],
    };
    chart.setOption(option);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(host);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [rows]);

  return <div ref={el} className="kline-chart" style={{ height }} />;
}
