import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { StockKlineDialog, type StockRef } from "../components/StockKlineDialog";

function fmtPrice(v: number | null | undefined) {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : "—";
}

function fmtPct(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
}

function pctClass(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v) || v === 0) return "";
  return v > 0 ? "is-up" : "is-down";
}

export function Watchlist() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{ symbol: string; name: string } | null>(null);
  const [preview, setPreview] = useState<StockRef | null>(null);

  const list = useQuery({
    queryKey: queryKeys.watchlist,
    queryFn: api.listWatchlist,
    refetchInterval: 5_000,
  });
  const search = useQuery({
    queryKey: ["instruments", "search", query],
    queryFn: () => api.searchInstruments(query, "stock,etf"),
    enabled: query.trim().length >= 1,
  });

  const add = useMutation({
    mutationFn: () => {
      const target = picked ?? search.data?.results[0];
      if (!target) throw new Error("先搜索代码 / 名称 / 拼音");
      return api.addWatchlist({ symbol: target.symbol, name: target.name });
    },
    onSuccess: () => {
      setQuery("");
      setPicked(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.watchlist });
    },
  });
  const remove = useMutation({
    mutationFn: (symbol: string) => api.removeWatchlist(symbol),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.watchlist });
    },
  });

  const items = list.data?.items ?? [];
  const canAdd = Boolean(picked || search.data?.results[0]);
  const hits = !picked && query.trim() ? search.data?.results ?? [] : [];

  return (
    <div className="wl-page">
      <div className="mon-col-head">
        <span>自选</span>
        <span className="mon-col-count">{items.length} 只</span>
      </div>
      <div className="mon-add wl-search">
        <div className="wl-search-bar">
          <div className="wl-search-field">
            <input
              className="mon-add-input"
              value={picked ? `${picked.name} ${picked.symbol}` : query}
              placeholder="代码 / 名称 / 拼音，如 000001、平安、payh"
              onChange={(event) => {
                setPicked(null);
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canAdd) add.mutate();
              }}
            />
            {hits.length > 0 ? (
              <div className="mon-add-hits">
                {hits.map((item) => (
                  <button
                    key={item.symbol}
                    type="button"
                    onClick={() => {
                      setPicked({ symbol: item.symbol, name: item.name });
                      setQuery("");
                    }}
                  >
                    <span>{item.name}</span>
                    <span className="mon-sym-code">{item.symbol}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className="btn btn-primary" disabled={!canAdd || add.isPending} onClick={() => add.mutate()}>
            添加
          </button>
        </div>
        {add.error ? <div className="mon-add-err">{(add.error as Error).message}</div> : null}
      </div>
      {list.isError ? (
        <div className="mon-empty">
          自选加载失败
          <div>
            <button className="btn btn-primary mt-3" type="button" onClick={() => list.refetch()}>
              重试
            </button>
          </div>
        </div>
      ) : list.isLoading && !list.data ? (
        <div className="mon-empty">加载自选…</div>
      ) : items.length === 0 ? (
        <div className="mon-empty">还没有自选。搜索代码、名称或拼音添加，或在个股详情点「加自选」。</div>
      ) : (
        <div className="mon-board-body">
          <table className="data-table mon-table">
            <thead>
              <tr>
                <th>标的</th>
                <th className="text-right">现价</th>
                <th className="text-right">涨跌</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="mon-row"
                  onClick={() => setPreview({ symbol: item.symbol, name: item.name })}
                >
                  <td>
                    <div className="mon-sym-name">{item.name}</div>
                    <div className="mon-sym-code">{item.symbol}</div>
                  </td>
                  <td className="text-right font-mono">{fmtPrice(item.close)}</td>
                  <td className={`text-right font-mono ${pctClass(item.change_pct)}`}>{fmtPct(item.change_pct)}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn-quiet"
                      disabled={remove.isPending}
                      onClick={(event) => {
                        event.stopPropagation();
                        remove.mutate(item.symbol);
                      }}
                    >
                      移除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview ? <StockKlineDialog symbol={preview.symbol} name={preview.name} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}
