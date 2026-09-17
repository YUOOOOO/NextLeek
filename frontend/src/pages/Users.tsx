import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, UserRole } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { useCurrentUser } from "../lib/useAuth";

export function Users() {
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const users = useQuery({
    queryKey: queryKeys.users,
    queryFn: api.listUsers,
    enabled: me.data?.role === "admin",
  });
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [error, setError] = useState("");

  const createUser = useMutation({
    mutationFn: () => api.createUser({ email, username, password, role }),
    onSuccess: async () => {
      setEmail("");
      setUsername("");
      setPassword("");
      setRole("user");
      setError("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
    onError: (err: Error) => setError(err.message),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.updateUser(id, { is_active }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
  });

  const resetPassword = useMutation({
    mutationFn: (id: string) => {
      const next = window.prompt("输入新密码（至少 12 位）");
      if (!next) return Promise.resolve(null);
      return api.resetPassword(id, next);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (me.data && me.data.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    createUser.mutate();
  }

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <h1 className="page-title">用户管理</h1>
          <p className="page-desc">管理员创建账号。用户不能自助注册。</p>
        </div>
        <span className="badge">{users.data?.length ?? 0} 个账号</span>
      </div>

      <form onSubmit={onSubmit} className="card grid gap-3 p-4 md:grid-cols-5">
        <input
          className="field"
          placeholder="邮箱"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <input
          className="field"
          placeholder="用户名"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />
        <input
          className="field"
          placeholder="密码"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={12}
        />
        <select
          className="field"
          value={role}
          onChange={(event) => setRole(event.target.value as UserRole)}
        >
          <option value="user">用户</option>
          <option value="admin">管理员</option>
        </select>
        <button className="btn btn-primary" type="submit" disabled={createUser.isPending}>
          创建
        </button>
      </form>
      {error && <p className="err">{error}</p>}

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>角色</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.map((user) => (
              <tr key={user.id}>
                <td>
                  <div className="text-[var(--ds-color-text-primary)]">{user.username}</div>
                  <div className="text-xs text-[var(--ds-color-text-placeholder)]">{user.email}</div>
                </td>
                <td>{user.role === "admin" ? "管理员" : "用户"}</td>
                <td>
                  <span className={user.is_active ? "badge badge-on" : "badge badge-off"}>
                    {user.is_active ? "启用" : "停用"}
                  </span>
                </td>
                <td className="space-x-4">
                  <button
                    className="btn btn-quiet"
                    type="button"
                    onClick={() => updateUser.mutate({ id: user.id, is_active: !user.is_active })}
                    disabled={user.id === me.data?.id}
                  >
                    {user.is_active ? "停用" : "启用"}
                  </button>
                  <button className="btn btn-quiet" type="button" onClick={() => resetPassword.mutate(user.id)}>
                    重置密码
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
