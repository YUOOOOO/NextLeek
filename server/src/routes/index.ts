import { Router } from 'express'
import { getHealthStatus } from '../controllers/health.controller'
import { getIndices, getQuote, getHistory } from '../controllers/market.controller'

const router = Router()

router.get('/health', getHealthStatus)
router.get('/market/indices', getIndices)
router.get('/market/quote', getQuote)
router.get('/market/history', getHistory)

export default router
