// 模块四：改模轮次（repairRounds）
// 流转：
//   试模判不合格 ──自动开单──▶ 第 1 轮（厂内：待验收；委外：待回厂）
//   委外送修 ──回厂登记──▶ 待验收
//   验收合格 ──▶ 关单（acceptance=合格, status=已关闭，模具回「在库」）
//   验收不合格 ──▶ 记录不合格 ──退回重改──▶ 同 root_repair_id 下新增一行，round_no+1
// 同一 root_repair_id 的行数 = 该改模单的总轮次。
// 红线：改模单未关闭（尤其委外回厂未验收）时，模具不能试模也不能排产。
import { db, ApiError } from '../db.js'
import { nowLocal, todayLocal } from '../util/dates.js'

export const TYPES = ['厂内', '委外']
export const RESULTS = ['合格', '让步接收', '不合格']

function moldById(id) {
  const m = db.prepare('SELECT * FROM molds WHERE id = ?').get(id)
  if (!m) throw new ApiError(404, '模具不存在')
  return m
}

/** 该模具当前进行中的改模轮次（同组取最大轮次行），无则 null */
export function currentOpenRepair(moldId) {
  return db.prepare(`
    SELECT * FROM repairs
    WHERE mold_id = ? AND status = '进行中'
    ORDER BY root_repair_id DESC, round_no DESC
    LIMIT 1
  `).get(moldId) || null
}

/** 硬卡口：改模单没关掉，试模/排产一律挡住 */
export function assertNoOpenRepair(moldId) {
  const open = currentOpenRepair(moldId)
  if (open) {
    const where = open.acceptance === '待回厂'
      ? `还在${open.repair_type === '委外' ? '委外' : '厂内'}送修，未回厂`
      : open.acceptance === '待验收'
        ? '已回厂但尚未验收，必须验收合格才能继续'
        : '上一轮验收不合格，尚未退回重改'
    throw new ApiError(409, `模具改模单 #${open.root_repair_id} 第 ${open.round_no} 轮${where}，请先走完改模验收流程`)
  }
}

function syncMoldStatus(moldId) {
  const open = currentOpenRepair(moldId)
  if (!open) {
    db.prepare("UPDATE molds SET status = '在库' WHERE id = ? AND status != '禁用'").run(moldId)
    return
  }
  const statusMap = {
    待回厂: open.repair_type === '委外' ? '委外中' : '改模中',
    待验收: '待验收',
    不合格: '待验收'
  }
  db.prepare('UPDATE molds SET status = ? WHERE id = ?').run(statusMap[open.acceptance] || '改模中', moldId)
}

/** 开改模单（试模判不合格时自动调用，也可手工开） */
export const createRepair = db.transaction(({ moldId, trialId = null, repairType, vendor = null, sendDate = null, problem = null }) => {
  const mold = moldById(moldId)
  if (!TYPES.includes(repairType)) throw new ApiError(400, '改模类型必须是 厂内/委外')
  if (repairType === '委外' && (!vendor || !String(vendor).trim())) {
    throw new ApiError(400, '委外改模必须填写委外厂家')
  }
  if (currentOpenRepair(moldId)) throw new ApiError(409, '该模具已有进行中的改模单，请先关闭')

  const ts = nowLocal()
  const info = db.prepare(`
    INSERT INTO repairs (root_repair_id, mold_id, trial_id, round_no, repair_type, vendor,
      send_date, return_date, acceptance, problem, status, created_at)
    VALUES (@rid, @mold, @trial, 1, @type, @vendor, @send, NULL, @accept, @problem, '进行中', @ts)
  `).run({
    rid: 0, // 先占位，下面回填为自身 id
    mold: mold.id,
    trial: trialId,
    type: repairType,
    vendor: repairType === '委外' ? vendor.trim() : null,
    send: sendDate || (repairType === '委外' ? todayLocal() : null),
    accept: repairType === '委外' ? '待回厂' : '待验收',
    problem,
    ts
  })
  const id = Number(info.lastInsertRowid)
  db.prepare('UPDATE repairs SET root_repair_id = ? WHERE id = ?').run(id, id)
  syncMoldStatus(mold.id)
  return getRepair(id)
})

/** 委外回厂登记：待回厂 → 待验收（不验收永远卡在此状态） */
export const markReturned = db.transaction(({ repairId, returnDate = null }) => {
  const r = getRepair(repairId)
  if (r.status !== '进行中') throw new ApiError(409, '改模单已关闭')
  if (r.repair_type !== '委外') throw new ApiError(400, '厂内改模无需回厂登记')
  if (r.acceptance !== '待回厂') throw new ApiError(409, `当前状态为「${r.acceptance}」，不能登记回厂`)
  db.prepare('UPDATE repairs SET return_date = ?, acceptance = ? WHERE id = ?')
    .run(returnDate || todayLocal(), '待验收', r.id)
  syncMoldStatus(r.mold_id)
  return getRepair(r.id)
})

/**
 * 验收。
 * pass=true  → 合格关单，模具回在库；
 * pass=false → 记不合格（仍进行中），随后必须走「退回重改」开出下一轮。
 */
export const acceptRepair = db.transaction(({ repairId, passed, acceptor, problem = null }) => {
  const r = getRepair(repairId)
  if (r.status !== '进行中') throw new ApiError(409, '改模单已关闭，不能重复验收')
  if (r.acceptance !== '待验收') {
    throw new ApiError(409, `当前状态为「${r.acceptance}」，${r.repair_type === '委外' ? '委外回厂登记后' : ''}才能验收`)
  }
  if (!acceptor || !String(acceptor).trim()) throw new ApiError(400, '验收必须填写验收人')

  if (passed) {
    db.prepare(`UPDATE repairs SET acceptance = '合格', accepted_at = ?, acceptor = ?, status = '已关闭'
      WHERE id = ?`).run(nowLocal(), acceptor.trim(), r.id)
    syncMoldStatus(r.mold_id)
    return getRepair(r.id)
  }
  db.prepare(`UPDATE repairs SET acceptance = '不合格', accepted_at = ?, acceptor = ?,
      problem = COALESCE(?, problem) WHERE id = ?`)
    .run(nowLocal(), acceptor.trim(), problem, r.id)
  syncMoldStatus(r.mold_id)
  return getRepair(r.id)
})

/** 退回重改：验收不合格后开出下一轮（轮次 +1） */
export const rework = db.transaction(({ repairId, repairType = null, vendor = null, sendDate = null, problem = null }) => {
  const r = getRepair(repairId)
  if (r.status !== '进行中' || r.acceptance !== '不合格') {
    throw new ApiError(409, '只有验收不合格的轮次才能退回重改')
  }
  const type = repairType || r.repair_type
  if (!TYPES.includes(type)) throw new ApiError(400, '改模类型必须是 厂内/委外')
  const finalVendor = (vendor && String(vendor).trim()) || (type === '委外' ? r.vendor : null)
  if (type === '委外' && !finalVendor) {
    throw new ApiError(400, '委外重改必须填写委外厂家')
  }
  const maxRound = db.prepare('SELECT MAX(round_no) AS n FROM repairs WHERE root_repair_id = ?')
    .get(r.root_repair_id).n
  const ts = nowLocal()
  // 上一轮被本轮取代：保留其「不合格」验收记录，状态关闭
  db.prepare("UPDATE repairs SET status = '已关闭' WHERE id = ?").run(r.id)
  const info = db.prepare(`
    INSERT INTO repairs (root_repair_id, mold_id, trial_id, round_no, repair_type, vendor,
      send_date, return_date, acceptance, problem, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, '进行中', ?)
  `).run(r.root_repair_id, r.mold_id, r.trial_id, maxRound + 1, type,
    type === '委外' ? finalVendor : null,
    sendDate || (type === '委外' ? todayLocal() : null),
    type === '委外' ? '待回厂' : '待验收',
    problem || r.problem, ts)
  syncMoldStatus(r.mold_id)
  return getRepair(info.lastInsertRowid)
})

export function getRepair(id) {
  const r = db.prepare(`
    SELECT r.*, m.code AS mold_code, m.product_name
    FROM repairs r JOIN molds m ON m.id = r.mold_id WHERE r.id = ?
  `).get(id)
  if (!r) throw new ApiError(404, '改模单不存在')
  return withGroup(r)
}

function withGroup(r) {
  const rounds = db.prepare(
    'SELECT id, round_no, repair_type, vendor, send_date, return_date, acceptance, acceptor, accepted_at, status, problem FROM repairs WHERE root_repair_id = ? ORDER BY round_no'
  ).all(r.root_repair_id)
  return { ...r, total_rounds: rounds.length, rounds }
}

export function listRepairs({ moldId = null, openOnly = false } = {}) {
  const where = []
  const params = {}
  if (moldId) { where.push('r.mold_id = @mold'); params.mold = moldId }
  if (openOnly) where.push("r.status = '进行中'")
  // 每个改模单只取首行作为封面，结论以最后一轮为准
  const rows = db.prepare(`
    SELECT r.*, m.code AS mold_code, m.product_name,
           g.total_rounds AS total_rounds, g.max_round AS max_round
    FROM repairs r
    JOIN molds m ON m.id = r.mold_id
    JOIN (SELECT root_repair_id, COUNT(*) AS total_rounds, MAX(round_no) AS max_round
          FROM repairs GROUP BY root_repair_id) g
      ON g.root_repair_id = r.root_repair_id
    WHERE r.id = r.root_repair_id ${where.length ? 'AND ' + where.join(' AND ') : ''}
    ORDER BY r.id DESC
  `).all(params)
  return rows.map((r) => {
    const cur = db.prepare(`SELECT * FROM repairs WHERE root_repair_id = ? AND status='进行中'
      ORDER BY round_no DESC LIMIT 1`).get(r.root_repair_id)
    if (cur) {
      return {
        ...r,
        acceptance: cur.acceptance,
        current_round: cur.round_no,
        repair_type: cur.repair_type,
        vendor: cur.vendor,
        return_date: cur.return_date,
        current_id: cur.id,
        status: '进行中'
      }
    }
    // 已关闭：取最后一轮的验收结论（合格/…）
    const last = db.prepare('SELECT * FROM repairs WHERE root_repair_id = ? ORDER BY round_no DESC LIMIT 1')
      .get(r.root_repair_id)
    return {
      ...r,
      acceptance: last.acceptance,
      current_round: last.round_no,
      repair_type: last.repair_type,
      vendor: last.vendor,
      return_date: last.return_date,
      current_id: last.id,
      status: '已关闭'
    }
  })
}
