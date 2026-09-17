import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useCurrentUser } from "../lib/useAuth";

export const SETTINGS_TABS = [
  {
    to: "/settings",
    label: "通用",
    desc: "会话、安全与后续模块接入点。",
    end: true,
  },
  {
    to: "/settings/data",
    label: "数据源",
    desc: "TickFlow Key、能力路由、自定义 YAML 源与插件。仅管理员可改。",
    admin: true,
  },
  {
    to: "/settings/ai",
    label: "AI",
    desc: "OpenAI 兼容接口。用来生成因子和策略公式。",
    admin: true,
  },
  {
    to: "/settings/users",
    label: "用户",
    desc: "修改自己的密码。创建账号和用户列表仅管理员可见。",
  },
];

export function Settings() {
  const me = useCurrentUser();
  const location = useLocation();
  const tabs = SETTINGS_TABS.filter((tab) => !tab.admin || me.data?.role === "admin");
  const active = tabs.find((tab) =>
    tab.end ? location.pathname === tab.to : location.pathname.startsWith(tab.to),
  );

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <h1 className="page-title">设置</h1>
          <p className="page-desc">{active?.desc ?? "系统设置。"}</p>
        </div>
      </div>
      <nav className="settings-tabs" aria-label="设置分组">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `settings-tab${isActive ? " is-active" : ""}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

export function GeneralSettings() {
  const me = useCurrentUser();
  return (
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
        <span className="kv-key">数据源 / 策略 / 因子</span>
        <span className="kv-val">数据已接入。策略和因子用公式定义，AI 生成走设置页。</span>
      </div>
    </section>
  );
}
