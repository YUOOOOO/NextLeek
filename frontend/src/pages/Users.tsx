import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, UserRole } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { useCurrentUser } from "../lib/useAuth";

export function Users() {
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const isAdmin = me.data?.role === "admin";
  const users = useQuery({
    queryKey: queryKeys.users,
    queryFn: api.listUsers,
    enabled: isAdmin,
  });
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [error, setError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");

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
      const next = window.prompt("输入新密码（至少 10 位）");
      if (!next) return Promise.resolve(null);
      return api.resetPassword(id, next);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
    onError: (err: Error) => setError(err.message),
  });

  const changePassword = useMutation({
    mutationFn: () =>
      api.changePassword({ current_password: currentPassword, new_password: newPassword }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMsg("密码已更新");
    },
    onError: (err: Error) => setPasswordMsg(err.message),
  });

  function onCreate(event: FormEvent) {
    event.preventDefault();
    createUser.mutate();
  }

  function onChangePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordMsg("两次输入的新密码不一致");
      return;
    }
    setPasswordMsg("");
    changePassword.mutate();
  }

  return (
    <div className="space-y-5">
      <form onSubmit={onChangePassword} className="card grid gap-3 p-4 md:grid-cols-4">
        <input
          className="field"
          placeholder="当前密码"
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
        />
        <input
          className="field"
          placeholder="新密码（至少 10 位）"
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
          minLength={10}
        />
        <input
          className="field"
          placeholder="确认新密码"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          minLength={10}
        />
        <button className="btn btn-primary" type="submit" disabled={changePassword.isPending}>
          {changePassword.isPending ? "保存中…" : "修改密码"}
        </button>
      </form>
      {passwordMsg && <p className={passwordMsg === "密码已更新" ? "text-xs text-[#4ade80]" : "err"}>{passwordMsg}</p>}

      {isAdmin && (
        <>
          <form onSubmit={onCreate} className="card grid gap-3 p-4 md:grid-cols-5">
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
              minLength={10}
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
          {users.error && <p className="err">{(users.error as Error).message}</p>}

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
        </>
      )}
    </div>
  );
}
