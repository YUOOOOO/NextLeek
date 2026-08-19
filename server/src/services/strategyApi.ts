const STRATEGY_API = process.env.STRATEGY_API_URL || 'http://localhost:8001'

function detailFromBody(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  if (!('detail' in data)) return null
  const detail = data.detail
  if (typeof detail === 'string') return detail
  if (detail == null) return null
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}

async function strategyProxy(path: string, init?: RequestInit) {
  const res = await fetch(`${STRATEGY_API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  if (!res.ok) {
    const detail = detailFromBody(data)
    const err = new Error(detail || `Strategy API error: ${res.status}`) as Error & {
      status?: number
      body?: unknown
    }
    err.status = res.status
    err.body = data
    throw err
  }
  return data
}

export { strategyProxy, STRATEGY_API }
