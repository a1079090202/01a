// 模块一：模次累计（lifeCounter）
// 职责：模次按整数记账，每次实际生产记一笔日志，并在同一事务内累加到模具当前模次。
import { db } from '../db.js'
import { ApiError } from '../db.js'
import { nowLocal } from '../util/dates.js'

function toPositiveInt(value, field = '模次') {
  // 模次一律按整数：拒绝小数、非数字、负数和 0
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError(400, `${field}必须是正整数`)
  }
  return n
}

export function getMold(moldId) {
  const mold = db.prepare('SELECT * FROM molds WHERE id = ?').get(moldId)
  if (!mold) throw new ApiError(404, '模具不存在')
  return mold
}

/**
 * 累计一次实际生产模次。
 * @returns {{mold:object, log:object}} 累加后的模具与日志
 */
export const addCycles = db.transaction(({ moldId, cycles, scheduleId = null, producedAt = null, operator = null, note = null }) => {
  const mold = getMold(moldId)
  const add = toPositiveInt(cycles, '本次模次')

  if (scheduleId) {
    const sched = db.prepare('SELECT * FROM production_schedules WHERE id = ?').get(scheduleId)
    if (!sched) throw new ApiError(404, '排产单不存在')
    if (sched.mold_id !== mold.id) throw new ApiError(400, '排产单与模具不匹配')
    if (sched.status !== '已排产') throw new ApiError(400, '该排产单已完工，不能继续记模次')
  }

  const ts = nowLocal()
  const info = db.prepare(`
    INSERT INTO production_logs (mold_id, schedule_id, produced_at, cycles, operator, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(mold.id, scheduleId, producedAt ?? ts, add, operator, note, ts)

  db.prepare('UPDATE molds SET current_cycles = current_cycles + ? WHERE id = ?')
    .run(add, mold.id)

  const updated = getMold(mold.id)
  const log = db.prepare('SELECT * FROM production_logs WHERE id = ?').get(info.lastInsertRowid)
  return { mold: updated, log }
})

export function listLogs(moldId, limit = 100) {
  return db.prepare(`
    SELECT l.*, s.start_at AS schedule_start
    FROM production_logs l
    LEFT JOIN production_schedules s ON s.id = l.schedule_id
    WHERE l.mold_id = ?
    ORDER BY l.id DESC LIMIT ?
  `).all(moldId, limit)
}

/** 人工校准模次（如盘点），留日志痕迹 */
export function resetCycles({ moldId, cycles }) {
  const mold = getMold(moldId)
  const n = Number(cycles)
  if (!Number.isInteger(n) || n < 0) throw new ApiError(400, '当前模次必须是非负整数')
  const ts = nowLocal()
  db.prepare('UPDATE molds SET current_cycles = ? WHERE id = ?').run(n, mold.id)
  db.prepare(`INSERT INTO production_logs (mold_id, schedule_id, produced_at, cycles, operator, note, created_at)
    VALUES (?, NULL, ?, ?, ?, ?, ?)`)
    .run(mold.id, ts, 0, '系统', `盘点校准为 ${n}（原 ${mold.current_cycles}）`, ts)
  return getMold(mold.id)
}
