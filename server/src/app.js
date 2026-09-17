import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError } from './db.js'

import moldsRouter from './routes/molds.js'
import machinesRouter from './routes/machines.js'
import trialsRouter from './routes/trials.js'
import repairsRouter from './routes/repairs.js'
import productionRouter from './routes/production.js'
import reportsRouter from './routes/reports.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function createApp() {
  const app = express()
  app.use(cors())
  app.use(express.json())

  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toLocaleString('zh-CN', { hour12: false }) }))
  app.use('/api/molds', moldsRouter)
  app.use('/api/machines', machinesRouter)
  app.use('/api/trials', trialsRouter)
  app.use('/api/repairs', repairsRouter)
  app.use('/api/production', productionRouter)
  app.use('/api/reports', reportsRouter)

  // 统一业务异常
  app.use('/api', (err, req, res, next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: err.message })
    }
    console.error(err)
    res.status(500).json({ error: '服务器内部错误' })
  })

  // 单机部署：托管前端构建产物，车间电脑只需打开 http://本机IP:3001
  const distDir = path.join(__dirname, '..', '..', 'web', 'dist')
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir))
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')))
  }

  return app
}
