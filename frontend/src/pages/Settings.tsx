import { useCurrentUser } from "../lib/useAuth";

export function Settings() {
  const me = useCurrentUser();
  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <h1 className="page-title">设置</h1>
          <p className="page-desc">会话、安全与后续模块接入点。</p>
        </div>
      </div>
      <section className="card">
        <div className="kv-row">
          <span className="kv-key">当前登录</span>
          <span className="kv-val">{me.data?.email}</span>
        </div>
        <div className="kv-row">
          <span className="kv-key">会话 Cookie</span>
          <span className="kv-val">HttpOnly + SameSite=Lax</span>
        </div>
        <div className="kv-row">
          <span className="kv-key">写操作校验</span>
          <span className="kv-val">CSRF</span>
        </div>
        <div className="kv-row">
          <span className="kv-key">数据源 / 策略 / 回测</span>
          <span className="kv-val">后续模块接入</span>
        </div>
      </section>
    </div>
  );
}
