import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Database,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  X,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { useCurrentUser } from "../lib/useAuth";

const VERSION = "0.1.0";
const COLLAPSE_KEY = "nextleek_sidebar";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
};

const NAV: NavItem[] = [
  { to: "/", label: "看板", icon: LayoutDashboard, end: true },
  { to: "/data", label: "数据", icon: Database },
  { to: "/settings", label: "设置", icon: Settings },
];

function formatBJT(date: Date) {
  const stamp = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
  return `${stamp}BJT`;
}

function useBeijingClock() {
  const [now, setNow] = useState(() => formatBJT(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setNow(formatBJT(new Date())), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const me = useCurrentUser();
  const clock = useBeijingClock();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      await queryClient.removeQueries({ queryKey: queryKeys.me });
      navigate("/login", { replace: true });
    },
  });

  const current = useMemo(
    () =>
      NAV.find((entry) =>
        entry.end ? location.pathname === entry.to : location.pathname.startsWith(entry.to),
      ) ?? null,
    [location.pathname],
  );

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  if (me.isLoading) {
    return <div className="grid min-h-screen place-items-center text-[var(--ds-color-text-placeholder)]">加载中…</div>;
  }

  if (!me.data) {
    return <Navigate to="/login" replace />;
  }

  const nav = (compact: boolean, onNavigate?: () => void) => (
    <>
      <nav className="wb-nav">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={compact ? item.label : undefined}
              className={({ isActive }) => `wb-item${isActive ? " is-active" : ""}`}
              onClick={onNavigate}
            >
              <Icon size={15} className="wb-item-icon" />
              {!compact && <span className="wb-item-text">{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>
      <div className="wb-rail-foot">
        {compact && (
          <button
            type="button"
            className="wb-icon-btn"
            title="展开侧栏"
            aria-label="展开侧栏"
            onClick={toggleCollapsed}
          >
            <PanelLeftOpen size={15} />
          </button>
        )}
        <button
          type="button"
          className="wb-item wb-item-danger"
          title="退出"
          onClick={() => logout.mutate()}
        >
          <LogOut size={15} className="wb-item-icon" />
          {!compact && <span className="wb-item-text">退出</span>}
        </button>
      </div>
    </>
  );

  return (
    <div className="wb">
      <aside id="nextleek-sidebar" className={`wb-rail${collapsed ? " is-collapsed" : ""}`}>
        <div className="wb-brand">
          <img src="/favicon.svg" className="wb-logo" alt="" />
          {!collapsed && (
            <>
              <div className="wb-brand-text">
                <span className="wb-brand-name">NextLeek</span>
                <span className="wb-version">{VERSION}</span>
              </div>
              <button
                type="button"
                className="wb-icon-btn"
                title="折叠侧栏"
                aria-label="折叠侧栏"
                onClick={toggleCollapsed}
              >
                <PanelLeftClose size={15} />
              </button>
            </>
          )}
        </div>
        {nav(collapsed)}
      </aside>

      <div className="wb-stage">
        <header className="wb-topbar">
          <button
            type="button"
            className="wb-icon-btn wb-burger"
            aria-label={drawerOpen ? "关闭导航" : "打开导航"}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            <Menu size={16} />
          </button>
          <nav className="wb-crumbs" aria-label="Breadcrumb">
            <span>NextLeek</span>
            {current && (
              <>
                <span className="wb-crumb-sep">/</span>
                <span className="wb-crumb-cur">
                  <current.icon size={14} />
                  {current.label}
                </span>
              </>
            )}
          </nav>
          <div className="wb-topbar-right">
            <div className="wb-clock">{clock}</div>
            <div className="wb-userchip">
              {me.data.username} · {me.data.role === "admin" ? "管理员" : "用户"}
            </div>
          </div>
        </header>
        <main id="main-content" className="wb-main">
          <div className="wb-content">
            <Outlet />
          </div>
        </main>
      </div>

      {drawerOpen && (
        <div className="wb-drawer-root">
          <div className="wb-scrim" onClick={() => setDrawerOpen(false)} />
          <aside className="wb-drawer" aria-label="导航">
            <div className="wb-drawer-head">
              <span className="wb-brand-name">NextLeek</span>
              <button type="button" className="wb-icon-btn" aria-label="关闭" onClick={() => setDrawerOpen(false)}>
                <X size={15} />
              </button>
            </div>
            {nav(false, () => setDrawerOpen(false))}
          </aside>
        </div>
      )}
    </div>
  );
}
