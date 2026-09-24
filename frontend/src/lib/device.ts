export function isMobileUA(ua = typeof navigator === "undefined" ? "" : navigator.userAgent) {
  return /Android|webOS|iPhone|iPod|iPad|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
}
