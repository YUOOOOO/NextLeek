import { Request, Response } from 'express'
import { getStrategies, getStrategy, addStrategy, updateStrategy, deleteStrategy } from '../ai/config'
import { agentManager } from '../ai/manager'

export async function chat(req: Request, res: Response) {
  try {
    const { message, strategyId } = req.body
    if (!message) return res.status(400).json({ error: 'message is required' })
    const result = await agentManager.chat(message, strategyId)
    res.json(result)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

export function listStrategies(req: Request, res: Response) {
  res.json(getStrategies())
}

export function createStrategy(req: Request, res: Response) {
  const data = req.body
  if (!data.id || !data.name || !data.agents) {
    return res.status(400).json({ error: 'Missing required fields: id, name, agents' })
  }
  if (getStrategy(data.id)) {
    return res.status(409).json({ error: 'Strategy id already exists' })
  }
  const strategy = addStrategy({ enabled: true, description: '', ...data })
  res.status(201).json(strategy)
}

export function modifyStrategy(req: Request<{ id: string }>, res: Response) {
  const result = updateStrategy(req.params.id, req.body)
  if (!result) return res.status(404).json({ error: 'Strategy not found' })
  res.json(result)
}

export function removeStrategy(req: Request<{ id: string }>, res: Response) {
  if (!deleteStrategy(req.params.id)) return res.status(404).json({ error: 'Strategy not found' })
  res.json({ success: true })
}
