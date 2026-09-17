import React from "react";
import ReactDOM from "react-dom/client";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import "./index.css";

const redirectToLogin = (() => {
  let redirecting = false;
  return (err: unknown) => {
    if (redirecting || !(err instanceof Error)) return;
    const message = err.message || "";
    if (!message.includes("未登录") && !message.includes("会话已过期") && !message.includes("401")) {
      return;
    }
    if (window.location.pathname === "/login") return;
    redirecting = true;
    const redirect = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?redirect=${redirect}`;
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
