import { Request, Response } from 'express'

export const getHealthStatus = (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'Node.js Backend API is running smoothly!',
    timestamp: new Date().toISOString(),
  })
}
