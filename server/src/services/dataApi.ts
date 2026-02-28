const DATA_API = process.env.DATA_API_URL || 'http://localhost:8000'

async function proxy(path: string) {
  const res = await fetch(`${DATA_API}${path}`)
  if (!res.ok) throw new Error(`Data API error: ${res.status}`)
  return res.json()
}

export { proxy, DATA_API }
