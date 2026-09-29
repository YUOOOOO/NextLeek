import { FormEvent, useState } from "react";
import { Search, TrendingUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function StockAnalysisHub() {
  const navigate = useNavigate();
  const [symbol, setSymbol] = useState("");
  const watchlist = useQuery({ queryKey: ["watchlist", "analysis"], queryFn: api.listWatchlist });
  const search = useQuery({
    queryKey: ["analysis-instruments", symbol],
    queryFn: () => api.searchInstruments(symbol),
    enabled: symbol.trim().length >= 1,
  });

  function open(value: string) {
    const normalized = value.trim().toUpperCase();
    if (normalized) navigate(`/analysis/${encodeURIComponent(normalized)}`);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    open(symbol);
  }

  const items = watchlist.data?.items ?? [];
  const results = search.data?.results ?? [];

  return (
    <div className="analysis-hub">
      <div className="analysis-hub-head">
        <div>
          <div className="eyebrow">PRICE ACTION WORKSPACE</div>
          <h1>个股分析</h1>
          <p>输入标的，查看技术结构、关键价位、风险状态，并按需启动 AI 分析。</p>
        </div>
        <TrendingUp size={28} className="analysis-hub-icon" />
      </div>
      <form className="analysis-search" onSubmit={submit}>
        <Search size={17} />
        <input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="输入股票代码或名称" autoFocus />
        <button type="submit">开始分析</button>
      </form>
      {results.length > 0 ? (
        <div className="analysis-search-results">
          {results.slice(0, 8).map((item) => (
            <button key={`${item.symbol}-${item.name}`} type="button" onClick={() => open(item.symbol)}>
              <span>{item.name || item.symbol}</span><code>{item.symbol}</code>
            </button>
          ))}
        </div>
      ) : null}
      <section className="analysis-hub-section">
        <div className="section-title">我的自选</div>
        {items.length === 0 ? <div className="analysis-empty">暂无自选股，直接输入代码开始。</div> : (
          <div className="analysis-watch-grid">
            {items.map((item) => (
              <button key={item.symbol} type="button" className="analysis-watch-card" onClick={() => open(item.symbol)}>
                <strong>{item.name || item.symbol}</strong><code>{item.symbol}</code>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
