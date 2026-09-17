// 模块四：改模轮次（repairRounds）
// 流转：
//   试模判不合格 ──自动开单──▶ 第 1 轮（厂内：待验收；委外：待回厂）
//   委外送修 ──回厂登记──▶ 待验收
//   验收合格 ──▶ 关单（acceptance=合格, status=已关闭，模具回「在库」）
//   验收不合格 ──▶ 记录不合格 ──退回重改──▶ 同 root_repair_id 下新增一行，round_no+1
// 同一 root_repair_id 的行数 = 该改模单的总轮次。
//
// 状态口径（全系统唯一，围绕“当前有效任务”）：
//   · 一张改模单 = 同 root_repair_id 的一组轮次行；只要组内还有 status='进行中' 的行，
//     这张单就是进行中待办，与“封面行（首行）自身是否已关闭”无关——重改会关闭旧轮、
//     开出新轮，待办不得因此消失。
//   · 当前有效轮 = 组内进行中的那一行（任一时刻至多一行）；整组关闭后取最后一轮。
//   · 用任意一轮的 id 查详情，主体都解析到“当前有效轮”，避免拿着旧轮 id 时界面假关闭、后台却锁死。
//   · 模具资产状态统一由 modules/moldStatus.js 按当前有效任务推导，本模块不再自行映射。
// 红线：改模单未关闭（尤其委外回厂未验收）时，模具不能试模也不能排产。
import { db, ApiError } from '../db.js'
import { nowLocal, todayLocal } from '../util/dates.js'
import { syncMoldStatus, openRepairRound } from './moldStatus.js'

export const TYPES = ['厂内', '委外']
export const RESULTS = ['合格', '让步接收', '不合格']

// 与 moldStatus.openRepairRound 同一口径，这里转出口供路由/其他模块使用
export const currentOpenRepair = openRepairRound

function moldById(id) {
  const m = db.prepare('SELECT * FROM molds WHERE id = ?').get(id)
  if (!m) throw new ApiError(404, '模具不存在')
  return m
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

const ROUND_COLS = 'id, root_repair_id, round_no, repair_type, vendor, send_date, return_date, acceptance, accepted_at, acceptor, problem, status'

function joinRepair(id) {
  return db.prepare(`
    SELECT r.*, m.code AS mold_code, m.product_name
    FROM repairs r JOIN molds m ON m.id = r.mold_id WHERE r.id = ?
  `).get(id)
}

/** 一组轮次的统一视图：{ rounds, open(当前有效轮), last(末轮), total } */
function groupSummary(rootRepairId) {
  const rounds = db.prepare(
    `SELECT ${ROUND_COLS} FROM repairs WHERE root_repair_id = ? ORDER BY round_no`
  ).all(rootRepairId)
  // 任一时刻组内至多一行进行中；倒序取轮次最大者
  const open = [...rounds].reverse().find((x) => x.status === '进行中') || null
  const last = rounds[rounds.length - 1] || null
  return { rounds, open, last, total: rounds.length }
}

/** 旧轮已被重改取代时，指向当前有效轮，避免操作者对着死行无从下手 */
function staleHint(r) {
  const cur = db.prepare(`
    SELECT round_no FROM repairs
    WHERE root_repair_id = ? AND status = '进行中'
    ORDER BY round_no DESC LIMIT 1
  `).get(r.root_repair_id)
  return cur
    ? `第 ${r.round_no} 轮已结束（验收不合格已退回重改），当前有效任务是第 ${cur.round_no} 轮，请刷新后处理第 ${cur.round_no} 轮`
    : '改模单已关闭'
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
  const r = loadRound(repairId)
  if (r.status !== '进行中') throw new ApiError(409, staleHint(r))
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
  const r = loadRound(repairId)
  if (r.status !== '进行中') throw new ApiError(409, staleHint(r))
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
  const r = loadRound(repairId)
  if (r.status !== '进行中' || r.acceptance !== '不合格') {
    if (r.status !== '进行中') throw new ApiError(409, staleHint(r))
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
  // 上一轮被本轮取代：保留其「不合格」验收记录，状态关闭；
  // 整组仍因新行 status='进行中' 而属于进行中待办（待办是否存在按组判定，不看封面行）。
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
  return getRepair(Number(info.lastInsertRowid))
})

function loadRound(id) {
  const r = db.prepare('SELECT * FROM repairs WHERE id = ?').get(id)
  if (!r) throw new ApiError(404, '改模单不存在')
  return r
}

/**
 * 详情：传入任意一轮 id，主体始终解析为该组“当前有效轮”（进行中轮，整组关闭后取末轮），
 * rounds 给出每一轮。requested_id 为实际请求的轮，current_id 为当前有效轮。
 */
export function getRepair(id) {
  const requested = joinRepair(id)
  if (!requested) throw new ApiError(404, '改模单不存在')
  const g = groupSummary(requested.root_repair_id)
  const subject = g.open || g.last
  const base = joinRepair(subject.id)
  return {
    ...base,
    requested_id: requested.id,
    current_id: subject.id,
    current_round: subject.round_no,
    total_rounds: g.total,
    group_open: !!g.open,
    rounds: g.rounds
  }
}

export function listRepairs({ moldId = null, openOnly = false } = {}) {
  const where = [`r.id = r.root_repair_id`] // 每张单只取首行（封面）
  const params = {}
  if (moldId) { where.push('r.mold_id = @mold'); params.mold = moldId }
<<<<<<< Updated upstream
=======
<<<<<<< HEAD
  // 是否进行中按“整组是否还有进行中轮”判定，与封面行自身状态解耦——重改后待办不消失
  if (openOnly) {
    where.push(`EXISTS (SELECT 1 FROM repairs o
      WHERE o.root_repair_id = r.root_repair_id AND o.status = '进行中')`)
  }
=======
>>>>>>> Stashed changes
  // 「进行中」按整单判定：同 root_repair_id 下存在进行中轮次即为进行中。
  // 不能看封面行（第 1 轮）——退回重改会把第 1 轮关掉，但单子还在推进，
  // 按封面行过滤会让重改后的单子从待办里消失。
  if (openOnly) {
    where.push(`EXISTS (SELECT 1 FROM repairs x
      WHERE x.root_repair_id = r.root_repair_id AND x.status = '进行中')`)
  }
  // 每个改模单只取首行作为封面，状态以当前有效轮次（进行中轮，否则最后一轮）为准
<<<<<<< Updated upstream
=======
>>>>>>> b7c5d4c61f231d011e73d85e9f3a188d12308cc8
>>>>>>> Stashed changes
  const rows = db.prepare(`
    SELECT r.*, m.code AS mold_code, m.product_name
    FROM repairs r
    JOIN molds m ON m.id = r.mold_id
    WHERE ${where.join(' AND ')}
    ORDER BY r.id DESC
  `).all(params)
<<<<<<< HEAD

  return rows.map((cover) => {
    const g = groupSummary(cover.root_repair_id)
    const cur = g.open || g.last
    return {
      ...cover,
      // 封面字段以当前有效轮为准，列表直接反映“现在该处理什么”
      acceptance: cur.acceptance,
      current_round: cur.round_no,
      current_id: cur.id,
      repair_type: cur.repair_type,
      vendor: cur.vendor,
      send_date: cur.send_date,
      return_date: cur.return_date,
      total_rounds: g.total,
      status: g.open ? '进行中' : '已关闭'
=======
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
        send_date: cur.send_date,
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
      send_date: last.send_date,
      return_date: last.return_date,
      current_id: last.id,
      status: '已关闭'
>>>>>>> b7c5d4c61f231d011e73d85e9f3a188d12308cc8
    }
  })
}
