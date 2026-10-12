declare const __ZTOOLS_OFFICIAL_SYNC_SERVER_URL__: string

// 官方配置只接受 HTTP(S)；API 直接使用该地址，仅同步侧派生 WebSocket 地址。
const configuredServerUrl =
  typeof __ZTOOLS_OFFICIAL_SYNC_SERVER_URL__ === 'string'
    ? __ZTOOLS_OFFICIAL_SYNC_SERVER_URL__.trim() || 'https://z-tools.top'
    : 'https://z-tools.top'
export const OFFICIAL_SERVER_HTTP_URL = normalizeHttpServerUrl(configuredServerUrl)
export const OFFICIAL_SYNC_SERVER_URL = normalizeSyncServerUrl(OFFICIAL_SERVER_HTTP_URL)
// 3.2.0 使用过该官方域名，保留信任以便原 token 无感迁回主域名。
export const LEGACY_OFFICIAL_SYNC_SERVER_URLS = ['wss://z.zosen.link'] as const

const TRUSTED_OFFICIAL_SYNC_SERVER_URLS = new Set<string>([
  OFFICIAL_SYNC_SERVER_URL,
  ...LEGACY_OFFICIAL_SYNC_SERVER_URLS
])

/**
 * 校验完整 Server 地址，不补全域名或推断协议。
 * @param input 带 http/https/ws/wss 协议的地址。
 * @returns 已校验的服务器 URL。
 * @throws 当地址为空、协议不受支持、包含凭据、查询参数、锚点或非根路径时抛出错误。
 */
function parseServerAddress(input: string): URL {
  const value = input.trim()
  if (!value) throw new Error('请填写服务器地址')

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('服务器地址格式不正确')
  }

  // 同步协议当前挂载在服务根路径，拒绝容易产生错误请求地址的额外 URL 部分。
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
    throw new Error('服务器地址仅支持 http、https、ws 或 wss 协议')
  }
  if (!parsed.hostname) throw new Error('服务器地址缺少主机名')
  if (parsed.username || parsed.password) throw new Error('服务器地址不能包含账号或密码')
  if (parsed.search || parsed.hash) throw new Error('服务器地址不能包含查询参数或锚点')
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('服务器地址暂不支持子路径')
  }

  return parsed
}

/**
 * 将 Server 地址转换为同步客户端使用的 WebSocket origin。
 * @param input 完整 HTTP(S) 地址或已保存的 WS/WSS 同步地址。
 * @returns ws 或 wss 服务地址，保持现有会话与同步 checkpoint 的地址格式。
 * @throws 地址不合法时抛出校验错误。
 */
export function normalizeSyncServerUrl(input: string): string {
  const parsed = parseServerAddress(input)
  // HTTP 和 WebSocket 使用同一服务地址，TLS 选择保持一致。
  parsed.protocol = ['https:', 'wss:'].includes(parsed.protocol) ? 'wss:' : 'ws:'
  parsed.pathname = ''
  return parsed.origin
}

/**
 * 校验官方 Server 配置，HTTP 客户端直接使用返回值，不转换协议。
 * @param input 带 http 或 https 协议的 Server 地址。
 * @returns 不含末尾斜杠的 http 或 https 服务地址。
 * @throws 地址不合法时抛出校验错误。
 */
export function normalizeHttpServerUrl(input: string): string {
  const parsed = parseServerAddress(input)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('ZTOOLS_OFFICIAL_SYNC_SERVER_URL 必须使用 http:// 或 https://')
  }
  return parsed.origin
}

/**
 * 判断给定地址是否指向当前或受信任的历史 ZTools 官方同步服务。
 * @param input 待判断的同步服务器地址。
 * @returns 地址规范化后命中官方服务迁移白名单时返回 true。
 */
export function isOfficialSyncServerUrl(input?: string | null): boolean {
  if (!input) return false
  try {
    return TRUSTED_OFFICIAL_SYNC_SERVER_URLS.has(normalizeSyncServerUrl(input))
  } catch {
    return false
  }
}
