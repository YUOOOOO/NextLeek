import { Request, Response } from 'express'
import { proxy } from '../services/dataApi'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function listEtfs(req: Request, res: Response) {
  try {
    const qs = new URLSearchParams(req.query as Record<string, string>).toString()
    const data = await proxy(`/api/etf/list${qs ? `?${qs}` : ''}`)
    res.json(data)
  } catch (e: unknown) {
    res.status(502).json({ error: errorMessage(e) })
  }
}

export async function getEtfQuote(req: Request, res: Response) {
  try {
    const { symbol } = req.query
    const data = await proxy(`/api/etf/quote?symbol=${symbol}`)
    res.json(data)
  } catch (e: unknown) {
    res.status(502).json({ error: errorMessage(e) })
  }
}

export async function getEtfHistory(req: Request, res: Response) {
  try {
    const qs = new URLSearchParams(req.query as Record<string, string>).toString()
    const data = await proxy(`/api/etf/history?${qs}`)
    res.json(data)
  } catch (e: unknown) {
    res.status(502).json({ error: errorMessage(e) })
  }
}
