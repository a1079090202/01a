import { createApp } from './app.js'
import { initDb } from './db.js'
import { recomputeAllMoldStatuses } from './modules/moldStatus.js'

const PORT = process.env.PORT || 3001

initDb()
// 启动对账：按“当前有效任务”重算模具资产状态，自愈历史脏数据（如重改后残留的错误状态）
const fixed = recomputeAllMoldStatuses()
if (fixed > 0) console.log(`启动对账：已纠正 ${fixed} 副模具的资产状态`)
const app = createApp()
app.listen(PORT, () => {
  console.log(`模具台账系统后端已启动： http://localhost:${PORT}`)
  console.log(`API 健康检查：          http://localhost:${PORT}/api/health`)
})
