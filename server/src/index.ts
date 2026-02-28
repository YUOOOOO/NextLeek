import express from 'express'
import cors from 'cors'
import apiRoutes from './routes'

const app = express()
const port = process.env.PORT || 3000

// Middleware
app.use(cors())
app.use(express.json())

// API Routes
// All routes defined in src/routes/index.ts will be prefixed with /api
app.use('/api', apiRoutes)

// Global Error Handler (Basic)
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error(err.stack)
    res.status(500).json({ error: 'Something went wrong!' })
  },
)

// Start Server
app.listen(port, () => {
  console.log(`Backend Server is running at http://localhost:${port}`)
})
