import { useCurrentUser } from "../lib/useAuth";

export function Dashboard() {
  const me = useCurrentUser();
  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <h1 className="page-title">看板</h1>
          <p className="page-desc">多用户会话已就绪。数据获取走 TickFlow / 自定义源盘后管道，策略与回测后续接入。</p>
        </div>
        <span className="badge badge-on">框架就绪</span>
      </div>

      <div className="kpi-strip">
        <div className="kpi-cell">
          <div className="kpi-label">当前用户</div>
          <div className="kpi-value">{me.data?.username ?? "—"}</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">角色</div>
          <div className="kpi-value">{me.data?.role === "admin" ? "管理员" : "普通用户"}</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">邮箱</div>
          <div className="kpi-value truncate">{me.data?.email ?? "—"}</div>
        </div>
      </div>

      <section className="card">
        <div className="px-4 py-3 text-xs font-medium text-[var(--ds-color-text-placeholder)]">模块</div>
        <div className="kv-row">
          <span className="kv-key">数据</span>
          <span className="kv-val">盘后管道 / 维表 / 日K / 除权 / Enriched</span>
        </div>
        <div className="kv-row">
          <span className="kv-key">选股</span>
          <span className="kv-val">待接入</span>
        </div>
        <div className="kv-row">
          <span className="kv-key">监控</span>
          <span className="kv-val">待接入</span>
        </div>
        <div className="kv-row">
          <span className="kv-key">回测</span>
          <span className="kv-val">待接入</span>
        </div>
      </section>
    </div>
  );
}
