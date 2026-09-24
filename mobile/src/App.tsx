import { NavLink, Navigate, Outlet, createBrowserRouter, useNavigate } from "react-router-dom";
import { Radio, Star, User } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Auth } from "@/pages/Auth";
import { Monitor } from "@/pages/Monitor";
import { Watchlist } from "@/pages/Watchlist";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { useCurrentUser } from "@/lib/useAuth";

function MobileShell() {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      await queryClient.removeQueries({ queryKey: queryKeys.me });
      navigate("/login", { replace: true });
    },
  });

  if (me.isLoading) {
    return <div className="m-boot">加载中…</div>;
  }
  if (!me.data) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="m-app">
      <main className="m-main">
        <Outlet />
      </main>
      <nav className="m-tabbar">
        <NavLink to="/watchlist" className={({ isActive }) => `m-tab${isActive ? " is-on" : ""}`}>
          <Star size={18} />
          自选
        </NavLink>
        <NavLink to="/monitor" className={({ isActive }) => `m-tab${isActive ? " is-on" : ""}`}>
          <Radio size={18} />
          监控
        </NavLink>
        <button type="button" className="m-tab" onClick={() => logout.mutate()} disabled={logout.isPending}>
          <User size={18} />
          {me.data.username}
        </button>
      </nav>
    </div>
  );
}

export const router = createBrowserRouter(
  [
    { path: "/login", element: <Auth /> },
    {
      path: "/",
      element: <MobileShell />,
      children: [
        { index: true, element: <Navigate to="/watchlist" replace /> },
        { path: "watchlist", element: <Watchlist /> },
        { path: "monitor", element: <Monitor /> },
        { path: "*", element: <Navigate to="/watchlist" replace /> },
      ],
    },
  ],
  { basename: "/m" },
);
