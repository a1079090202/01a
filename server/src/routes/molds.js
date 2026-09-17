import { Router } from 'express'
import { db, ApiError } from '../db.js'
import { nowLocal } from '../util/dates.js'
import { lifeOf } from '../modules/lifeAlert.js'
import { listWithLife } from '../modules/lifeAlert.js'
import { addCycles, resetCycles, listLogs } from '../modules/lifeCounter.js'
import { currentOpenRepair, listRepairs } from '../modules/repairRounds.js'

const router = Router()

const intField = (v, field) => {
  const n = Number(v)
  if (!Number.isInteger(n)) throw new ApiError(400, `${field}必须是整数`)
  return n
}

// 列表（带寿命状态 + 当前改模单）
router.get('/', (req, res) => {
  const molds = listWithLife().map((m) => ({
    ...m,
    open_repair: currentOpenRepair(m.id)
  }))
  res.json(molds)
})

// 新增模具
router.post('/', (req, res) => {
  const { code, product_name, cavities, rated_life, current_cycles = 0, note } = req.body || {}
  if (!code || !String(code).trim()) throw new ApiError(400, '模具编号必填')
  if (!product_name || !String(product_name).trim()) throw new ApiError(400, '对应产品必填')
  const cav = intField(cavities, '型腔数')
  const life = intField(rated_life, '额定模次寿命')
  const cur = intField(current_cycles, '当前模次')
  if (cav <= 0) throw new ApiError(400, '型腔数必须大于 0')
  if (life <= 0) throw new ApiError(400, '额定模次寿命必须大于 0')
  if (cur < 0) throw new ApiError(400, '当前模次不能为负')
  const ts = nowLocal()
  try {
    const info = db.prepare(`
      INSERT INTO molds (code, product_name, cavities, rated_life, current_cycles, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(String(code).trim(), String(product_name).trim(), cav, life, cur, note ?? null, ts)
    res.status(201).json(db.prepare('SELECT * FROM molds WHERE id = ?').get(info.lastInsertRowid))
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new ApiError(409, `模具编号 ${code} 已存在`)
    throw e
  }
})

// 详情
router.get('/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM molds WHERE id = ?').get(req.params.id)
  if (!m) throw new ApiError(404, '模具不存在')
  res.json({ ...m, life: lifeOf(m), open_repair: currentOpenRepair(m.id) })
})

// 模具的试模记录
router.get('/:id/trials', (req, res) => {
  res.json(db.prepare(`
    SELECT t.*, ma.code AS machine_code FROM trials t
    JOIN machines ma ON ma.id = t.machine_id
    WHERE t.mold_id = ? ORDER BY t.trial_no DESC
  `).all(req.params.id))
})

// 模具的改模单（封面列表，状态以当前有效轮次为准，与改模单列表同一口径）
router.get('/:id/repairs', (req, res) => {
  res.json(listRepairs({ moldId: Number(req.params.id) }))
})

// 生产模次日志
router.get('/:id/logs', (req, res) => {
  res.json(listLogs(Number(req.params.id), Number(req.query.limit) || 100))
})

// 手动累计模次（实际生产记账）
router.post('/:id/cycles', (req, res) => {
  const { cycles, operator, note, produced_at } = req.body || {}
  const result = addCycles({
    moldId: Number(req.params.id),
    cycles,
    operator: operator || null,
    note: note || null,
    producedAt: produced_at || null
  })
  res.status(201).json({ ...result, life: lifeOf(result.mold) })
})

// 盘点校准模次
router.post('/:id/reset-cycles', (req, res) => {
  const mold = resetCycles({ moldId: Number(req.params.id), cycles: req.body?.cycles })
  res.json({ ...mold, life: lifeOf(mold) })
})

export default router
