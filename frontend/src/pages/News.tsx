import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { api, type NewsItem } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { AiDock } from "../components/AiDock";
import { StockKlineDialog, type StockRef } from "../components/StockKlineDialog";
import { AiChatProvider, NEWS_INTRO, useAiChat } from "../lib/aiChat";

type SourceTab = "all" | "cls" | "eastmoney" | "weibo" | "xueqiu";

const TABS: Array<{ id: SourceTab; label: string }> = [
  { id: "all", label: "全部" },
  { id: "cls", label: "财联社" },
  { id: "eastmoney", label: "东财 7x24" },
  { id: "weibo", label: "微博" },
  { id: "xueqiu", label: "雪球" },
];

const MAX_BASKET = 12;

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
  if (source === "weibo") return "news-badge is-weibo";
  if (source === "xueqiu") return "news-badge is-xq";
  return "news-badge";
}

function clip(text: string, limit = 160): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…`;
}

function formatBasket(items: NewsItem[], question: string): string {
  const body = items
    .map((item, index) => {
      const summary = clip(item.content || "");
      const tags = [
        ...(item.stocks ?? []).map((stock) => `${stock.name}(${stock.symbol})`),
        ...(item.boards ?? []),
        ...(item.concepts ?? []),
        ...(item.industries ?? []),
      ];
      const tagLine = tags.length ? `\n标的：${tags.join("、")}` : "";
      return `${index + 1}. [${item.source_label} ${item.published_at}] ${item.title}${summary ? `\n摘要：${summary}` : ""}${tagLine}`;
    })
    .join("\n\n");
  const extra = question.trim();
  return extra
    ? `请分析以下快讯：\n\n${body}\n\n用户问题：${extra}`
    : `请分析以下快讯对 A 股盘面的影响，给出要点、主线或板块线索，以及需要继续观察的风险。\n\n${body}`;
}

function NewsTags({
  item,
  onStock,
  onBoard,
}: {
  item: NewsItem;
  onStock: (ref: StockRef) => void;
  onBoard: (kind: "board" | "concept" | "industry", name: string) => void;
}) {
  const chips: Array<{
    key: string;
    label: string;
    kind: "stock" | "board" | "concept" | "industry";
    symbol?: string;
  }> = [
    ...(item.stocks ?? []).map((stock) => ({
      key: `s-${stock.symbol}`,
      label: stock.name,
      kind: "stock" as const,
      symbol: stock.symbol,
    })),
    ...(item.boards ?? []).map((board) => ({
      key: `b-${board}`,
      label: board,
      kind: "board" as const,
    })),
    ...(item.concepts ?? []).map((name) => ({
      key: `c-${name}`,
      label: name,
      kind: "concept" as const,
    })),
    ...(item.industries ?? []).map((name) => ({
      key: `i-${name}`,
      label: name,
      kind: "industry" as const,
    })),
  ];
  if (!chips.length) return null;
  return (
    <div className="news-tags">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className={`news-tag is-${chip.kind}`}
          title={`查看${chip.label}`}
          onClick={(event) => {
            event.stopPropagation();
            if (chip.kind === "stock" && chip.symbol) onStock({ symbol: chip.symbol, name: chip.label });
            else if (chip.kind !== "stock") onBoard(chip.kind, chip.label);
          }}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}

const BOARD_KIND_LABEL: Record<string, string> = {
  board: "板块",
  concept: "概念",
  industry: "行业",
};

function BoardMembersDialog({
  kind,
  name,
  onClose,
  onStock,
}: {
  kind: "board" | "concept" | "industry";
  name: string;
  onClose: () => void;
  onStock: (ref: StockRef) => void;
}) {
  const members = useQuery({
    queryKey: queryKeys.newsMembers(kind, name),
    queryFn: () => api.newsMembers(kind, name),
  });
  const rows = members.data?.rows ?? [];
  const emptyHint =
    kind === "board"
      ? "没有成分股"
      : "暂无成分股。概念/行业需先在数据页拉取同花顺扩展表。";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="kline-root news-board-root" role="dialog" aria-modal="true" aria-label={`${name} 成分`}>
      <button className="kline-scrim" type="button" aria-label="关闭" onClick={onClose} />
      <section className="kline-dialog news-board-dialog">
        <header className="kline-head">
          <div>
            <div className="kline-title">
              {name}
              <span className="kline-code">{BOARD_KIND_LABEL[kind] || kind}</span>
            </div>
            <div className="kline-quote">
              {members.data?.total != null
                ? members.data.total > rows.length
                  ? `显示 ${rows.length} / ${members.data.total} 只`
                  : `${members.data.total} 只`
                : ""}
            </div>
          </div>
          <button className="btn-quiet" type="button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </header>
        <div className="news-board-list">
          {members.isLoading ? <p className="muted">加载成分…</p> : null}
          {members.isError ? <p className="muted">成分加载失败</p> : null}
          {!members.isLoading && !rows.length ? <p className="muted">{emptyHint}</p> : null}
          {rows.map((row) => (
            <button
              key={row.symbol}
              type="button"
              className="news-board-row"
              onClick={() => onStock({ symbol: row.symbol, name: row.name })}
            >
              <span>
                <strong>{row.name}</strong>
                <span className="kline-code">{row.symbol}</span>
              </span>
              <span className="news-tag is-board">{row.board}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export function News() {
  return (
    <AiChatProvider workspace="news" intro={NEWS_INTRO}>
      <NewsShell />
    </AiChatProvider>
  );
}

function NewsShell() {
  const { ask, pending, prompt } = useAiChat();
  const [source, setSource] = useState<SourceTab>("all");
  const [keyword, setKeyword] = useState("");
  const [preview, setPreview] = useState<StockRef | null>(null);
  const [board, setBoard] = useState<{ kind: "board" | "concept" | "industry"; name: string } | null>(null);
  const [symbol, setSymbol] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [basket, setBasket] = useState<NewsItem[]>([]);
  const [notice, setNotice] = useState("");
  const [sideOpen, setSideOpen] = useState(() => localStorage.getItem("nextleek_news_ai_open") !== "0");
  const [sideWidth, setSideWidth] = useState(() => Number(localStorage.getItem("nextleek_news_side_width") || 340));
  const sideDragging = useRef(false);

  const feed = useQuery({
    queryKey: queryKeys.news(source, keyword.trim(), symbol.trim()),
    queryFn: () =>
      api.newsList({
        source,
        q: keyword.trim() || undefined,
        symbol: symbol.trim() || undefined,
      }),
  });

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!sideDragging.current) return;
      event.preventDefault();
      const next = Math.max(280, Math.min(720, window.innerWidth - event.clientX));
      setSideWidth(next);
      localStorage.setItem("nextleek_news_side_width", String(next));
    };
    const up = () => {
      if (!sideDragging.current) return;
      sideDragging.current = false;
      document.body.classList.remove("is-resizing");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.classList.remove("is-resizing");
    };
  }, []);

  const items = feed.data?.items ?? [];
  const selected: NewsItem | null = useMemo(() => {
    if (!items.length) return null;
    return items.find((item) => item.id === selectedId) ?? items[0];
  }, [items, selectedId]);
  const inBasket = useMemo(() => new Set(basket.map((item) => item.id)), [basket]);

  function toggleBasket(item: NewsItem) {
    setNotice("");
    setBasket((prev) => {
      if (prev.some((row) => row.id === item.id)) return prev.filter((row) => row.id !== item.id);
      if (prev.length >= MAX_BASKET) {
        setNotice(`最多加入 ${MAX_BASKET} 条`);
        return prev;
      }
      if (!sideOpen) {
        setSideOpen(true);
        localStorage.setItem("nextleek_news_ai_open", "1");
      }
      return [...prev, item];
    });
  }

  function analyzeBasket() {
    if (!basket.length || pending) return;
    ask("strategy", formatBasket(basket, prompt));
  }

  return (
    <div className="ide">
      <section className="ide-editor">
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
            <button type="button" className="btn btn-ghost" onClick={() => feed.refetch()} disabled={feed.isFetching}>
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
          {notice ? <p className="news-warn">{notice}</p> : null}
          <div className="news-split">
            <div className="news-list">
              {feed.isLoading ? <p className="muted">加载中…</p> : null}
              {feed.isError ? <p className="muted">新闻加载失败</p> : null}
              {!feed.isLoading && !items.length ? <p className="muted">暂无快讯</p> : null}
              {items.map((item) => {
                const added = inBasket.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`news-row${selected?.id === item.id ? " is-active" : ""}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <div className="news-row-head">
                      <div className="news-row-meta">
                        <span className={sourceClass(item.source)}>{item.source_label}</span>
                        <span>{relativeTime(item.published_at)}</span>
                      </div>
                      <button
                        type="button"
                        className={`news-add${added ? " is-on" : ""}`}
                        title={added ? "移出待分析" : "加入待分析"}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleBasket(item);
                        }}
                      >
                        {added ? <Check size={13} /> : <Plus size={13} />}
                        {added ? "已加" : "加入"}
                      </button>
                    </div>
                    <strong>{item.title}</strong>
                    <NewsTags item={item} onStock={setPreview} onBoard={(kind, name) => setBoard({ kind, name })} />
                    {item.content ? <p>{item.content}</p> : null}
                  </div>
                );
              })}
            </div>
            <article className="news-detail">
              {selected ? (
                <>
                  <div className="news-row-head">
                    <div className="news-row-meta">
                      <span className={sourceClass(selected.source)}>{selected.source_label}</span>
                      <span>{selected.published_at}</span>
                    </div>
                    <button
                      type="button"
                      className={`news-add${inBasket.has(selected.id) ? " is-on" : ""}`}
                      onClick={() => toggleBasket(selected)}
                    >
                      {inBasket.has(selected.id) ? <Check size={13} /> : <Plus size={13} />}
                      {inBasket.has(selected.id) ? "已加" : "加入分析"}
                    </button>
                  </div>
                  <h2>{selected.title}</h2>
                  <NewsTags item={selected} onStock={setPreview} onBoard={(kind, name) => setBoard({ kind, name })} />
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
      </section>
      <aside className="ide-side">
        {sideOpen ? (
          <div className="ide-side-panel" style={{ width: sideWidth }}>
            <div
              className="ide-side-resize"
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                sideDragging.current = true;
                document.body.classList.add("is-resizing");
                window.getSelection()?.removeAllRanges();
              }}
              aria-label="拖动调整侧栏宽度"
            />
            <div className="ide-ai-head">
              <span>AI · 新闻分析</span>
            </div>
            <div className="news-basket">
              <div className="news-basket-head">
                <span>待分析 {basket.length}/{MAX_BASKET}</span>
                {basket.length ? (
                  <button type="button" className="btn-quiet" onClick={() => setBasket([])}>
                    清空
                  </button>
                ) : null}
              </div>
              {basket.length === 0 ? (
                <p className="news-basket-empty">从左侧加入快讯后再分析</p>
              ) : (
                <ul className="news-basket-list">
                  {basket.map((item) => (
                    <li key={item.id} className="news-basket-chip">
                      <span title={item.title}>{item.title}</span>
                      <button type="button" aria-label="移出" onClick={() => toggleBasket(item)}>
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="btn btn-primary news-basket-run"
                disabled={!basket.length || pending}
                onClick={analyzeBasket}
              >
                {pending ? "分析中…" : `分析这 ${basket.length} 条`}
              </button>
            </div>
            <AiDock mode="news" />
          </div>
        ) : null}
        <nav className="ide-rail" aria-label="侧栏">
          <button
            type="button"
            className={`wb-item${sideOpen ? " is-active" : ""}`}
            aria-label="AI"
            title="AI"
            onClick={() => {
              setSideOpen((open) => {
                const next = !open;
                localStorage.setItem("nextleek_news_ai_open", next ? "1" : "0");
                return next;
              });
            }}
          >
            <Sparkles size={15} className="wb-item-icon" />
          </button>
        </nav>
      </aside>
      {board ? (
        <BoardMembersDialog
          kind={board.kind}
          name={board.name}
          onClose={() => setBoard(null)}
          onStock={setPreview}
        />
      ) : null}
      {preview ? <StockKlineDialog {...preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}
