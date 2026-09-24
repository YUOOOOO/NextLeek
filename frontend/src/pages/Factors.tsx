import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Factor, ResearchResult } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { FactorEditor } from "../components/FactorEditor";
import { UniverseBar } from "../components/UniverseBar";
import { useUniverse } from "../lib/universe";
type Tab = "mine" | "subscribed" | "market";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "mine", label: "我的" },
  { id: "subscribed", label: "已订阅" },
  { id: "market", label: "市场" },
];

export function Factors() {
  const queryClient = useQueryClient();
  const { universe } = useUniverse();
  const catalog = useQuery({ queryKey: queryKeys.factors(universe), queryFn: () => api.listFactors(universe) });
  const options = useQuery({ queryKey: queryKeys.factorOptions, queryFn: api.factorOptions });
  const [tab, setTab] = useState<Tab>("mine");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [research, setResearch] = useState<ResearchResult | null>(null);
  useEffect(() => {
    setSelectedId(null);
    setEditorOpen(false);
    setEditingId(null);
    setResearch(null);
    setError("");
  }, [universe]);

  const items = catalog.data?.[tab] ?? [];
  const editing = useMemo(() => {
    if (!editingId || !catalog.data) return null;
    return catalog.data.mine.find((item) => item.id === editingId) ?? null;
  }, [catalog.data, editingId]);

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: queryKeys.factors(universe) });
  }

  const publish = useMutation({
    mutationFn: (id: string) => api.publishFactor(id),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });
  const unpublish = useMutation({
    mutationFn: (id: string) => api.unpublishFactor(id),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteFactor(id),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });
  const subscribe = useMutation({
    mutationFn: (id: string) => api.subscribeFactor(id),
    onSuccess: async () => {
      setTab("subscribed");
      await invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });
  const unsubscribe = useMutation({
    mutationFn: (id: string) => api.unsubscribeFactor(id),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });
  const acceptUpdate = useMutation({
    mutationFn: (id: string) => api.updateFactorSubscription(id),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });
  const runResearch = useMutation({
    mutationFn: (id: string) => api.researchFactor(id),
    onSuccess: (payload) => {
      setResearch(payload);
      setError("");
    },
    onError: (err: Error) => setError(err.message),
  });
  const mine = useMutation({
    mutationFn: () => api.mineFactors(),
    onSuccess: (payload) => {
      setResearch(payload);
      setError("");
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="space-y-5">
      <UniverseBar />
      <div className="page-head">
        <div>
          <h1 className="page-title">因子</h1>
          <p className="page-desc">公式定义指标。写 ts_mean(close, 120) 就是 MA120，发布后策略公式可直接引用代码。</p>
        </div>
        <div className="sort-row">
          <button type="button" className="btn btn-ghost" onClick={() => mine.mutate()} disabled={mine.isPending}>
            {mine.isPending ? "挖掘中…" : "挖掘"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditingId(null);
              setEditorOpen(true);
            }}
          >
            新建因子
          </button>
        </div>
      </div>

      {error && <div className="err">{error}</div>}

      {editorOpen && (
        <FactorEditor
          factor={editing}
          examples={options.data?.examples}
          operators={options.data?.operators}
          onClose={() => setEditorOpen(false)}
          onSaved={async (factor) => {
            setEditorOpen(false);
            setSelectedId(factor.id);
            setTab("mine");
            await invalidate();
          }}
        />
      )}

      <nav className="settings-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-tab${tab === item.id ? " is-active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {catalog.isLoading && <div className="text-sm text-[var(--ds-color-text-placeholder)]">加载中…</div>}
      {!catalog.isLoading && items.length === 0 && (
        <div className="card p-6 text-sm text-[var(--ds-color-text-placeholder)]">
          {tab === "mine" && "还没有因子。点右上角新建，用公式定义 MA120 这类指标。"}
          {tab === "subscribed" && "还没有订阅。到市场里订阅他人发布的因子。"}
          {tab === "market" && "暂无已发布因子。"}
        </div>
      )}

      {items.length > 0 && (
        <div className="strat-grid">
          {items.map((factor: Factor) => {
            const active = selectedId === factor.id;
            return (
              <div
                key={factor.id}
                className={`strat-card${active ? " is-active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setSelectedId(factor.id);
                  if (selectedId !== factor.id) setResearch(null);
                }}
              >
                <div className="strat-card-top">
                  <span className="strat-card-name">{factor.name}</span>
                  <span className={`badge ${factor.status === "published" ? "badge-on" : "badge-off"}`}>
                    {factor.status === "published" ? "已发布" : "草稿"}
                  </span>
                </div>
                <div className="strat-meta">
                  {factor.code} · {factor.is_owner ? "我" : factor.owner_username} · 订阅 {factor.subscriber_count}
                </div>
                <div className="strat-conds">{factor.formula}</div>
                {active && (
                  <div className="strat-card-actions" onClick={(event) => event.stopPropagation()}>
                    {tab === "market" && factor.is_owner && (
                      <button type="button" className="btn btn-ghost" onClick={() => unpublish.mutate(factor.id)}>
                        撤回
                      </button>
                    )}
                    {tab === "market" && !factor.is_owner && !factor.subscribed && (
                      <button type="button" className="btn btn-primary" onClick={() => subscribe.mutate(factor.id)}>
                        订阅
                      </button>
                    )}
                    {tab === "market" && !factor.is_owner && factor.subscribed && (
                      <button type="button" className="btn btn-ghost" onClick={() => unsubscribe.mutate(factor.id)}>
                        取消订阅
                      </button>
                    )}
                    {tab !== "market" && (factor.is_owner || factor.subscribed) && (
                      <button type="button" className="btn btn-primary" onClick={() => runResearch.mutate(factor.id)}>
                        {runResearch.isPending ? "回测中…" : "回测"}
                      </button>
                    )}
                    {tab === "mine" && factor.is_owner && (
                      <>
                        <button type="button" className="btn btn-ghost" onClick={() => publish.mutate(factor.id)}>
                          {factor.status === "published" ? "再发布" : "发布"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            setEditingId(factor.id);
                            setEditorOpen(true);
                          }}
                        >
                          编辑
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => remove.mutate(factor.id)}>
                          删除
                        </button>
                      </>
                    )}
                    {tab === "subscribed" && factor.update_available && (
                      <button type="button" className="btn btn-primary" onClick={() => acceptUpdate.mutate(factor.id)}>
                        更新
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {research && (
        <section className="card p-4 text-sm">
          <div className="builder-section-head">回测 / 挖掘</div>
          {research.warning && <div className="muted">{research.warning}</div>}
          {research.ok && research.ic != null && (
            <div className="muted">
              IC {research.ic} · IR {research.ir} · 样本 {research.days} 日
            </div>
          )}
          {research.items && research.items.length > 0 && (
            <div className="cond-list">
              {research.items.map((item, index) => (
                <div key={index} className="preview-line">
                  {String(item.code || item.name || item.formula)} · IC {String(item.ic ?? item.avg_return ?? "")}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
