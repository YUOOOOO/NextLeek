import { Router } from 'express'
import { getHealthStatus } from '../controllers/health.controller'
import { getIndices, getQuote, getHistory } from '../controllers/market.controller'
import { chat, listStrategies, createStrategy, modifyStrategy, removeStrategy } from '../controllers/ai.controller'

const router = Router()

router.get('/health', getHealthStatus)
router.get('/market/indices', getIndices)
router.get('/market/quote', getQuote)
router.get('/market/history', getHistory)

router.post('/ai/chat', chat)
router.get('/ai/strategies', listStrategies)
router.post('/ai/strategies', createStrategy)
router.put('/ai/strategies/:id', modifyStrategy)
router.delete('/ai/strategies/:id', removeStrategy)

export default router
