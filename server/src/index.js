import { createApp } from './app.js'
import { initDb } from './db.js'

const PORT = process.env.PORT || 3001

initDb()
const app = createApp()
app.listen(PORT, () => {
  console.log(`模具台账系统后端已启动： http://localhost:${PORT}`)
  console.log(`API 健康检查：          http://localhost:${PORT}/api/health`)
})
