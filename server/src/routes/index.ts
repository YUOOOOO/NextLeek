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
import goldRouter from '../controllers/gold.controller'

const router = Router()

router.get('/health', getHealthStatus)
router.get('/market/indices', getIndices)
router.get('/market/quote', getQuote)
router.get('/market/history', getHistory)
router.get('/etf/list', listEtfs)
router.get('/etf/quote', getEtfQuote)
router.get('/etf/history', getEtfHistory)

router.post('/ai/chat', chat)
router.get('/ai/strategies', listStrategies)
router.post('/ai/strategies', createStrategy)
router.put('/ai/strategies/:id', modifyStrategy)
router.delete('/ai/strategies/:id', removeStrategy)

router.use('/gold', goldRouter)

export default router
