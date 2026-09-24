export function isMobileUA(ua = typeof navigator === "undefined" ? "" : navigator.userAgent) {
  return /Android|webOS|iPhone|iPod|iPad|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
}

export function isMobileApp() {
  if (typeof window === "undefined") return false;
  return window.location.pathname === "/m" || window.location.pathname.startsWith("/m/");
}
