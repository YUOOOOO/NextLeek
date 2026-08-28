import { Router } from 'express'
import { getHealthStatus } from '../controllers/health.controller'
import {
  getIndices,
  getQuote,
  getHistory,
} from '../controllers/market.controller'
import {
  chat,
  listStrategies,
  createStrategy,
  modifyStrategy,
  removeStrategy,
} from '../controllers/ai.controller'
import {
  listEtfs,
  getEtfQuote,
  getEtfHistory,
} from '../controllers/etf.controller'
import {
  strategyHealth,
  getUniverse,
  getSealed,
  publishSealed,
  createJob,
  listJobs,
  getJob,
  getJobResult,
  getArtifact,
  getLatestSignal,
  getStockPicks,
} from '../controllers/strategy.controller'
import goldRouter from '../controllers/gold.controller'

const router = Router()

router.get('/health', getHealthStatus)
router.get('/market/indices', getIndices)
router.get('/market/quote', getQuote)
router.get('/market/history', getHistory)
router.get('/etf/list', listEtfs)
router.get('/etf/quote', getEtfQuote)
router.get('/etf/history', getEtfHistory)

router.get('/strategy/health', strategyHealth)
router.get('/strategy/universe', getUniverse)
router.get('/strategy/sealed', getSealed)
router.post('/strategy/sealed/publish', publishSealed)
router.post('/strategy/jobs', createJob)
router.get('/strategy/jobs', listJobs)
router.get('/strategy/jobs/:id', getJob)
router.get('/strategy/jobs/:id/result', getJobResult)
router.get('/strategy/artifacts/:id/:name', getArtifact)
router.get('/strategy/signal/latest', getLatestSignal)
router.get('/strategy/stock-picks', getStockPicks)

router.post('/ai/chat', chat)
router.get('/ai/strategies', listStrategies)
router.post('/ai/strategies', createStrategy)
router.put('/ai/strategies/:id', modifyStrategy)
router.delete('/ai/strategies/:id', removeStrategy)

router.use('/gold', goldRouter)

export default router
