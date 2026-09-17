// 模块三：时段占用（scheduleConflict）
// 规则：
//  1) 同一机台同一时段只能有一件事（试模/排产互查，避免撞机）；
//  2) 一副模具同一时段不能同时挂在两个产品上——即同一模具的两张单时段不得重叠；
//  3) 试模之间按机台、模具双重查重；排产之间同样查重；试模与排产跨表互查。
// 重叠判定（半开区间）：newStart < oldEnd AND newEnd > oldStart，首尾相接不算冲突。
import { db } from '../db.js'
import { ApiError } from '../db.js'

const overlapWhere = `:start < end_at AND :end > start_at`

function machineCode(machineId) {
  const m = db.prepare('SELECT code FROM machines WHERE id = ?').get(machineId)
  if (!m) throw new ApiError(404, '机台不存在')
  return m.code
}

function moldCode(moldId) {
  const m = db.prepare('SELECT code FROM molds WHERE id = ?').get(moldId)
  if (!m) throw new ApiError(404, '模具不存在')
  return m.code
}

/**
 * 校验机台与模具在 [start,end) 是否空闲（跨试模、排产两张表）。
 * @param ignore {{trial?:number, schedule?:number}} 编辑时忽略自身 id
 */
export function assertSlotFree({ machineId, moldId, start, end, ignore = {} }) {
  if (!(start < end)) throw new ApiError(400, '时段开始时间必须早于结束时间')
  const params = { start, end }

  const trialMachine = db.prepare(`
    SELECT t.*, mo.code AS mold_code FROM trials t
    JOIN molds mo ON mo.id = t.mold_id
    WHERE t.machine_id = @machine AND ${overlapWhere} AND t.id IS NOT @skipTrial
  `)
  const schedMachine = db.prepare(`
    SELECT s.*, mo.code AS mold_code FROM production_schedules s
    JOIN molds mo ON mo.id = s.mold_id
    WHERE s.machine_id = @machine AND s.status = '已排产' AND ${overlapWhere} AND s.id IS NOT @skipSched
  `)
  const trialMold = db.prepare(`
    SELECT t.*, ma.code AS machine_code FROM trials t
    JOIN machines ma ON ma.id = t.machine_id
    WHERE t.mold_id = @mold AND ${overlapWhere} AND t.id IS NOT @skipTrial
  `)
  const schedMold = db.prepare(`
    SELECT s.*, ma.code AS machine_code FROM production_schedules s
    JOIN machines ma ON ma.id = s.machine_id
    WHERE s.mold_id = @mold AND s.status = '已排产' AND ${overlapWhere} AND s.id IS NOT @skipSched
  `)

  const p = {
    ...params,
    machine: machineId,
    mold: moldId,
    skipTrial: ignore.trial ?? 0,
    skipSched: ignore.schedule ?? 0
  }

  const hitMachine = trialMachine.get(p) || schedMachine.get(p)
  if (hitMachine) {
    throw new ApiError(409,
      `机台 ${machineCode(machineId)} 在 ${start} ~ ${end} 已被模具 ${hitMachine.mold_code} 占用（${hitMachine.start_at} ~ ${hitMachine.end_at}），时段冲突`)
  }

  // 模具维度：列出时段重叠的所有排产/试模，判断是否挂了不同产品
  const others = [...trialMold.all(p), ...schedMold.all(p)]
  for (const o of others) {
    const otherProduct = o.product_name ?? null
    // 只要该模具时段内已在别的单上（试模视为占用模具本身），就不允许再挂；
    // 排产挂不同产品是重点拦截场景。
    throw new ApiError(409,
      `模具 ${moldCode(moldId)} 在 ${start} ~ ${end} 已安排在机台 ${o.machine_code}` +
      (otherProduct ? `生产「${otherProduct}」` : '试模') +
      `（${o.start_at} ~ ${o.end_at}），同一时段不能重复占用`)
  }
}

/** 查某模具/某机台未来 N 天的占用，给前端排程提示 */
export function occupancy({ machineId = null, moldId = null }) {
  const where = []
  const params = {}
  if (machineId) { where.push('machine_id = @machine'); params.machine = machineId }
  if (moldId) { where.push('mold_id = @mold'); params.mold = moldId }
  const w = where.length ? `WHERE ${where.join(' OR ')}` : ''
  const trials = db.prepare(`
    SELECT '试模' AS kind, t.id, t.mold_id, t.machine_id, t.start_at, t.end_at,
           NULL AS product_name, t.result AS state
    FROM trials t ${w} ORDER BY t.start_at
  `).all(params)
  const schedules = db.prepare(`
    SELECT '排产' AS kind, s.id, s.mold_id, s.machine_id, s.start_at, s.end_at,
           s.product_name, s.status AS state
    FROM production_schedules s ${w} ORDER BY s.start_at
  `).all(params)
  return [...trials, ...schedules].sort((a, b) => a.start_at.localeCompare(b.start_at))
}
