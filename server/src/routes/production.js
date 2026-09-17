import { Router } from 'express'
import { db, ApiError } from '../db.js'
import { nowLocal, requireDateTime } from '../util/dates.js'
import { assertSlotFree } from '../modules/scheduleConflict.js'
import { assertCanSchedule, lifeOf } from '../modules/lifeAlert.js'
import { assertNoOpenRepair } from '../modules/repairRounds.js'
import { addCycles } from '../modules/lifeCounter.js'

const router = Router()

function loadSchedule(id) {
  const s = db.prepare(`
    SELECT s.*, m.code AS mold_code, ma.code AS machine_code
    FROM production_schedules s
    JOIN molds m ON m.id = s.mold_id
    JOIN machines ma ON ma.id = s.machine_id
    WHERE s.id = ?
  `).get(id)
  if (!s) throw new ApiError(404, '排产单不存在')
  return s
}

// 排产列表
router.get('/schedules', (req, res) => {
  const { mold_id, status } = req.query
  const where = []
  const params = {}
  if (mold_id) { where.push('s.mold_id = @mold'); params.mold = Number(mold_id) }
  if (status) { where.push('s.status = @status'); params.status = status }
  const rows = db.prepare(`
    SELECT s.*, m.code AS mold_code, m.rated_life, m.current_cycles, ma.code AS machine_code
    FROM production_schedules s
    JOIN molds m ON m.id = s.mold_id
    JOIN machines ma ON ma.id = s.machine_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.start_at DESC, s.id DESC
  `).all(params)
  res.json(rows.map((r) => ({ ...r, life: lifeOf(r) })))
})

/**
 * 排产：模具挂产品 + 选机台时段。
 * 三道卡口：改模未闭环 / 时段冲突（机台+模具） / 超寿命无主管确认。
 */
router.post('/schedules', (req, res) => {
  const b = req.body || {}
  const moldId = Number(b.mold_id), machineId = Number(b.machine_id)
  if (!moldId || !machineId) throw new ApiError(400, '模具和机台必选')
  if (!b.product_name || !String(b.product_name).trim()) throw new ApiError(400, '请填写本次生产的产品名称')
  const start = requireDateTime(b.start_at, '开始时间')
  const end = requireDateTime(b.end_at, '结束时间')
  const qty = b.qty === '' || b.qty === undefined || b.qty === null ? null : Number(b.qty)
  if (qty !== null && (!Number.isInteger(qty) || qty <= 0)) throw new ApiError(400, '计划数量须为正整数')

  const mold = db.prepare('SELECT * FROM molds WHERE id = ?').get(moldId)
  if (!mold) throw new ApiError(404, '模具不存在')
  if (!db.prepare('SELECT id FROM machines WHERE id = ?').get(machineId)) throw new ApiError(404, '机台不存在')

  assertNoOpenRepair(moldId)
  assertSlotFree({ machineId, moldId, start, end })
  // 超寿命生命线：必须 confirmed=true 且填写主管姓名
  const verdict = assertCanSchedule(mold, {
    confirmed: b.overlife_confirmed === true,
    confirmer: b.confirmer || ''
  })

  const ts = nowLocal()
  const info = db.prepare(`
    INSERT INTO production_schedules
      (mold_id, product_name, machine_id, start_at, end_at, qty,
       overlife_confirmed, confirmer, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '已排产', ?)
  `).run(moldId, String(b.product_name).trim(), machineId, start, end, qty,
    verdict.overlifeConfirmed ? 1 : 0, verdict.confirmer, ts)
  db.prepare("UPDATE molds SET status = '生产中' WHERE id = ? AND status = '在库'").run(moldId)

  res.status(201).json(loadSchedule(info.lastInsertRowid))
})

// 完工
router.post('/schedules/:id/finish', (req, res) => {
  const s = loadSchedule(Number(req.params.id))
  if (s.status !== '已排产') throw new ApiError(409, '排产单已完工')
  db.prepare("UPDATE production_schedules SET status = '已完工' WHERE id = ?").run(s.id)
  db.prepare("UPDATE molds SET status = '在库' WHERE id = ? AND status = '生产中'").run(s.mold_id)
  res.json(loadSchedule(s.id))
})

// 针对某张排产单记实际生产模次（整数，事务内累计；超寿命后只拦排产，不拦已排产单的记账）
router.post('/schedules/:id/cycles', (req, res) => {
  const s = loadSchedule(Number(req.params.id))
  const { cycles, operator, note } = req.body || {}
  const result = addCycles({
    moldId: s.mold_id,
    cycles,
    scheduleId: s.id,
    operator: operator || null,
    note: note || null
  })
  res.status(201).json({ ...result, life: lifeOf(result.mold) })
})

export default router
