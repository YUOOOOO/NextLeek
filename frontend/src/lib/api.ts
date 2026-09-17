export type UserRole = "admin" | "user";

export type User = {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SetupStatus = {
  configured: boolean;
};

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = readCookie("nextleek_csrf");
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : `请求失败 (${response.status})`;
    throw new Error(detail);
  }
  return payload as T;
}

export const api = {
  health: () => request<{ status: string; version: string }>("/api/health"),
  authStatus: () => request<SetupStatus>("/api/auth/status"),
  me: () => request<User>("/api/auth/me"),
  setup: (body: { email: string; username: string; password: string }) =>
    request<{ user: User }>("/api/auth/setup", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  listUsers: () => request<User[]>("/api/users"),
  createUser: (body: { email: string; username: string; password: string; role: UserRole }) =>
    request<User>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, body: { username?: string; role?: UserRole; is_active?: boolean }) =>
    request<User>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  resetPassword: (id: string, password: string) =>
    request<User>(`/api/users/${id}/password`, { method: "POST", body: JSON.stringify({ password }) }),
  deleteUser: (id: string) => request<void>(`/api/users/${id}`, { method: "DELETE" }),
};
