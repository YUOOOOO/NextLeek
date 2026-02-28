import { Request, Response } from 'express'
import { proxy } from '../services/dataApi'

export async function getIndices(req: Request, res: Response) {
  try {
    const data = await proxy('/api/indices')
    res.json(data)
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
}

export async function getQuote(req: Request, res: Response) {
  try {
    const { symbol } = req.query
    const data = await proxy(`/api/quote?symbol=${symbol}`)
    res.json(data)
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
}

export async function getHistory(req: Request, res: Response) {
  try {
    const qs = new URLSearchParams(req.query as Record<string, string>).toString()
    const data = await proxy(`/api/history?${qs}`)
    res.json(data)
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
}
