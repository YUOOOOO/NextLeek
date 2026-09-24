import React from "react";
import ReactDOM from "react-dom/client";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { isMobileUA } from "@/lib/device";
import { router } from "./App";
import "./index.css";

if (!isMobileUA() && window.location.pathname.startsWith("/m")) {
  const rest = window.location.pathname.replace(/^\/m/, "") || "/watchlist";
  window.location.replace(`${rest}${window.location.search}${window.location.hash}`);
}

const redirectToLogin = (() => {
  let redirecting = false;
  return (err: unknown) => {
    if (redirecting || !(err instanceof Error)) return;
    const message = err.message || "";
    if (!message.includes("未登录") && !message.includes("会话已过期") && !message.includes("401")) {
      return;
    }
    if (window.location.pathname.endsWith("/login")) return;
    redirecting = true;
    const redirect = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/m/login?redirect=${redirect}`;
  };
})();

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => redirectToLogin(err),
  }),
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      onError: (err) => redirectToLogin(err),
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
