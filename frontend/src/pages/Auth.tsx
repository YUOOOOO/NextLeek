import { FormEvent, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { useAuthStatus, useCurrentUser } from "../lib/useAuth";

export function Auth() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useAuthStatus();
  const me = useCurrentUser(status.data?.configured === true);
  const configured = status.data?.configured ?? false;
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (!configured) {
        return api.setup({ email, username, password });
      }
      return api.login({ email, password });
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(queryKeys.me, result.user);
      queryClient.setQueryData(queryKeys.authStatus, { configured: true });
      navigate(searchParams.get("redirect") || "/", { replace: true });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (me.data) {
    return <Navigate to="/" replace />;
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    mutation.mutate();
  }

  return (
    <div className="auth-shell">
      <form onSubmit={onSubmit} className="auth-card space-y-4">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-7 w-7 rounded" />
          <div>
            <h1 className="page-title text-[18px]">NextLeek</h1>
            <p className="page-desc mt-1">
              {configured ? "多用户登录" : "创建首个管理员账号"}
            </p>
          </div>
        </div>
        <label className="block text-xs text-[var(--ds-color-text-placeholder)]">
          邮箱
          <input
            className="field mt-1"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        {!configured && (
          <label className="block text-xs text-[var(--ds-color-text-placeholder)]">
            用户名
            <input
              className="field mt-1"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              minLength={3}
            />
          </label>
        )}
        <label className="block text-xs text-[var(--ds-color-text-placeholder)]">
          密码
          <input
            className="field mt-1"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={configured ? 1 : 12}
          />
        </label>
        {error && <p className="err">{error}</p>}
        <button
          className="btn btn-primary w-full"
          disabled={mutation.isPending || status.isLoading}
          type="submit"
        >
          {configured ? "登录" : "初始化管理员"}
        </button>
      </form>
    </div>
  );
}
