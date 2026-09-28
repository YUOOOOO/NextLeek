import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Database,
  Menu,
  Moon,
  Newspaper,
  Radio,
  ScanSearch,
  Settings,
  Star,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { useCurrentUser } from "../lib/useAuth";
import { AiChatProvider } from "../lib/aiChat";

const THEME_KEY = "nextleek_theme";
type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
};

const NAV: NavItem[] = [
  { to: "/watchlist", label: "自选", icon: Star },
  { to: "/strategies", label: "策略", icon: ScanSearch },
  { to: "/monitor", label: "监控", icon: Radio },
  { to: "/news", label: "新闻", icon: Newspaper },
  { to: "/data", label: "数据", icon: Database },
  { to: "/settings", label: "设置", icon: Settings },
];

function beijingClock(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const time = `${parts.hour}:${parts.minute}:${parts.second}`;
  const weekday = parts.weekday !== "Sat" && parts.weekday !== "Sun";
  const seconds = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  const open =
    weekday &&
    ((seconds >= 9 * 3600 + 30 * 60 && seconds <= 11 * 3600 + 30 * 60) ||
      (seconds >= 13 * 3600 && seconds <= 15 * 3600));
  return { time, open };
}

function useBeijingClock() {
  const [clock, setClock] = useState(() => beijingClock(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setClock(beijingClock(new Date())), 1000);
    return () => window.clearInterval(id);
  }, []);
  return clock;
}

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const me = useCurrentUser();
  const clock = useBeijingClock();
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [accountOpen]);

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

  if (me.isLoading) {
    return <div className="grid min-h-screen place-items-center text-[var(--ds-color-text-placeholder)]">加载中…</div>;
  }

  if (!me.data) {
    return <Navigate to="/login" replace />;
  }

  const flushPage =
    location.pathname === "/strategies" ||
    location.pathname === "/monitor" ||
    location.pathname === "/news" ||
    location.pathname === "/watchlist";


  const nav = (compact: boolean, onNavigate?: () => void) => (
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
  );

  return (
    <AiChatProvider>
    <div className="wb">
      <aside id="nextleek-sidebar" className="wb-rail">
        <div className="wb-brand">
          <img src="/favicon.svg" className="wb-logo" alt="" />
        </div>
        {nav(true)}
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
            <div className="wb-clock">
              <span className={`wb-market-dot${clock.open ? " is-open" : ""}`} />
              <span>{clock.open ? "开市" : "休市"}</span>
              <span>{clock.time}</span>
            </div>
            <button
              type="button"
              className="wb-icon-btn"
              title={theme === "dark" ? "切换浅色" : "切换深色"}
              aria-label={theme === "dark" ? "切换浅色" : "切换深色"}
              onClick={() => {
                const next = theme === "dark" ? "light" : "dark";
                document.documentElement.dataset.theme = next;
                localStorage.setItem(THEME_KEY, next);
                setTheme(next);
              }}
            >
              {theme === "dark" ? <Moon size={15} /> : <Sun size={15} />}
            </button>
            <div className="wb-account" ref={accountRef}>
              <button
                type="button"
                className="wb-userchip"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((open) => !open)}
              >
                {me.data.username}
              </button>
              {accountOpen && (
                <div className="wb-account-pop">
                  <div className="wb-account-name">{me.data.username}</div>
                  <div className="wb-account-email">{me.data.email}</div>
                  <button
                    type="button"
                    className="wb-account-logout"
                    onClick={() => logout.mutate()}
                    disabled={logout.isPending}
                  >
                    退出登录
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main-content" className={`wb-main${flushPage ? " is-flush" : ""}`}>
          <div className={`wb-content${flushPage ? " is-flush" : ""}`}>
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
    </AiChatProvider>
  );
}
