import { Router } from 'express'
import { getHealthStatus } from '../controllers/health.controller'

const router = Router()

// Define routes
router.get('/health', getHealthStatus)

// Future routes can be added here, e.g.:
// import userRoutes from './user.routes';
// router.use('/users', userRoutes);

export default router
