import { Request, Response } from 'express'
import { STRATEGY_API, strategyProxy } from '../services/strategyApi'
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function statusOf(err: unknown): number {
  if (err && typeof err === 'object' && 'status' in err) {
    const s = err.status
    if (typeof s === 'number') return s
  }
  return 502
}

function paramId(req: Request): string {
  const raw = req.params.id
  return Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '')
}

export async function strategyHealth(_req: Request, res: Response) {
  try {
    const data = await strategyProxy('/api/health')
    res.json(data)
  } catch (e: unknown) {
    res.status(statusOf(e)).json({ error: errorMessage(e) })
  }
}

export async function getUniverse(_req: Request, res: Response) {
  try {
    res.json(await strategyProxy('/api/universe'))
  } catch (e: unknown) {
    res.status(statusOf(e)).json({ error: errorMessage(e) })
  }
}

export async function getSealed(_req: Request, res: Response) {
  try {
    res.json(await strategyProxy('/api/sealed'))
  } catch (e: unknown) {
    res.status(statusOf(e)).json({ error: errorMessage(e) })
  }
}

export async function publishSealed(req: Request, res: Response) {
  try {
    res.json(
      await strategyProxy('/api/sealed/publish', {
        method: 'POST',
        body: JSON.stringify(req.body || {}),
      }),
    )
  } catch (e: unknown) {
    res.status(statusOf(e)).json({ error: errorMessage(e) })
  }
}

export async function createJob(req: Request, res: Response) {
  try {
    const data = await strategyProxy('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(req.body || {}),
    })
    res.status(201).json(data)
  } catch (e: unknown) {
    res.status(statusOf(e)).json({ error: errorMessage(e) })
  }
}

export async function listJobs(req: Request, res: Response) {
  try {
    const q = new URLSearchParams()
    if (req.query.limit) q.set('limit', String(req.query.limit))
    const suffix = q.toString() ? `?${q}` : ''
    res.json(await strategyProxy(`/api/jobs${suffix}`))
  } catch (e: unknown) {
    res.status(statusOf(e)).json({ error: errorMessage(e) })
  }
}

export async function getJob(req: Request, res: Response) {
  try {
    const id = paramId(req)
    res.json(await strategyProxy(`/api/jobs/${encodeURIComponent(id)}`))
  } catch (e: unknown) {
    res.status(statusOf(e)).json({ error: errorMessage(e) })
  }
}

export async function getJobResult(req: Request, res: Response) {
  try {
    const id = paramId(req)
    res.json(await strategyProxy(`/api/jobs/${encodeURIComponent(id)}/result`))
  } catch (e: unknown) {
    res.status(statusOf(e)).json({ error: errorMessage(e) })
  }
}


export async function getArtifact(req: Request, res: Response) {
  try {
    const id = paramId(req)
    const name = Array.isArray(req.params.name)
      ? String(req.params.name[0] ?? '')
      : String(req.params.name ?? '')
    const upstream = await fetch(
      `${STRATEGY_API}/api/artifacts/${encodeURIComponent(id)}/${encodeURIComponent(name)}`,
    )
    if (!upstream.ok) {
      const body = await upstream.text()
      res.status(upstream.status).json({ error: body || `Strategy API error: ${upstream.status}` })
      return
    }
    const contentType = upstream.headers.get('content-type')
    if (contentType) res.type(contentType)
    res.send(Buffer.from(await upstream.arrayBuffer()))
  } catch (e: unknown) {
    res.status(statusOf(e)).json({ error: errorMessage(e) })
  }
}

export async function getLatestSignal(req: Request, res: Response) {
  try {
    const q = new URLSearchParams()
    if (req.query.date) q.set('date', String(req.query.date))
    const suffix = q.toString() ? `?${q}` : ''
    res.json(await strategyProxy(`/api/signal/latest${suffix}`))
  } catch (e: unknown) {
    res.status(statusOf(e)).json({ error: errorMessage(e) })
  }
}

export async function getStockPicks(req: Request, res: Response) {
  try {
    const q = new URLSearchParams()
    if (req.query.date) q.set('date', String(req.query.date))
    if (req.query.top_n) q.set('top_n', String(req.query.top_n))
    const suffix = q.toString() ? `?${q}` : ''
    res.json(await strategyProxy(`/api/stock-picks${suffix}`))
  } catch (e: unknown) {
    res.status(statusOf(e)).json({ error: errorMessage(e) })
  }
}
