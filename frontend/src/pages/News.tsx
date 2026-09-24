import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { api, type NewsItem } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

type SourceTab = "all" | "cls" | "eastmoney";

const TABS: Array<{ id: SourceTab; label: string }> = [
  { id: "all", label: "全部" },
  { id: "cls", label: "财联社" },
  { id: "eastmoney", label: "东财 7x24" },
];

function relativeTime(value: string): string {
  if (!value) return "";
  const parsed = Date.parse(value.replace(/-/g, "/"));
  if (Number.isNaN(parsed)) return value;
  const delta = Date.now() - parsed;
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)} 天前`;
  return value.slice(0, 16);
}

function sourceClass(source: string): string {
  if (source === "cls") return "news-badge is-cls";
  if (source === "eastmoney") return "news-badge is-em";
  return "news-badge";
}

export function News() {
  const [source, setSource] = useState<SourceTab>("all");
  const [keyword, setKeyword] = useState("");
  const [symbol, setSymbol] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const feed = useQuery({
    queryKey: queryKeys.news(source, keyword.trim(), symbol.trim()),
    queryFn: () =>
      api.newsList({
        source,
        q: keyword.trim() || undefined,
        symbol: symbol.trim() || undefined,
        limit: 80,
      }),
    refetchInterval: 60_000,
  });

  const items = feed.data?.items ?? [];
  const selected: NewsItem | null = useMemo(() => {
    if (!items.length) return null;
    return items.find((item) => item.id === selectedId) ?? items[0];
  }, [items, selectedId]);

  return (
    <section className="news-page">
      <div className="news-toolbar">
        <div className="news-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`news-tab${source === tab.id ? " is-active" : ""}`}
              onClick={() => setSource(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          className="news-input"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="关键词"
        />
        <input
          className="news-input news-input-symbol"
          value={symbol}
          onChange={(event) => setSymbol(event.target.value)}
          placeholder="个股代码 如 600519"
        />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => feed.refetch()}
          disabled={feed.isFetching}
        >
          <RefreshCw size={14} />
          {feed.isFetching ? "刷新中" : "刷新"}
        </button>
        <span className="news-meta">
          {feed.data?.fetched_at ? `更新 ${feed.data.fetched_at}` : ""}
          {feed.data?.total != null ? ` · ${feed.data.total} 条` : ""}
        </span>
      </div>
      {feed.data?.errors?.length ? (
        <p className="news-warn">{feed.data.errors.map((item) => `${item.source}: ${item.error}`).join("；")}</p>
      ) : null}
      <div className="news-split">
        <div className="news-list">
          {feed.isLoading ? <p className="muted">加载中…</p> : null}
          {feed.isError ? <p className="muted">新闻加载失败</p> : null}
          {!feed.isLoading && !items.length ? <p className="muted">暂无快讯</p> : null}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`news-row${selected?.id === item.id ? " is-active" : ""}`}
              onClick={() => setSelectedId(item.id)}
            >
              <div className="news-row-meta">
                <span className={sourceClass(item.source)}>{item.source_label}</span>
                <span>{relativeTime(item.published_at)}</span>
              </div>
              <strong>{item.title}</strong>
              {item.content ? <p>{item.content}</p> : null}
            </button>
          ))}
        </div>
        <article className="news-detail">
          {selected ? (
            <>
              <div className="news-row-meta">
                <span className={sourceClass(selected.source)}>{selected.source_label}</span>
                <span>{selected.published_at}</span>
              </div>
              <h2>{selected.title}</h2>
              <p>{selected.content || "暂无正文摘要"}</p>
              {selected.url ? (
                <a className="news-link" href={selected.url} target="_blank" rel="noreferrer">
                  原文 <ExternalLink size={13} />
                </a>
              ) : null}
            </>
          ) : (
            <p className="muted">选择一条快讯查看详情</p>
          )}
        </article>
      </div>
    </section>
  );
}
