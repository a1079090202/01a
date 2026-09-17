// 模具状态唯一事实来源：围绕“当前有效任务”统一推导资产状态。
// 一副模具同一时刻至多有一个当前有效任务，优先级：
//   进行中的改模轮次（硬锁试模/排产） > 未判定的试模 > 已排产单 > 在库
// 「禁用」是人工终态，任何任务流转都不得覆盖。
// 各业务模块（改模/试模/排产）一律在自己的事务内调用 syncMoldStatus()，
// 不再各自裸写 molds.status，避免状态与任务脱节、且无法自愈。
import { db } from '../db.js'

/**
 * 当前进行中的改模轮次（同组取最大轮次行）。
 * 与 repairRounds.currentOpenRepair 保持同一口径；此处直接查表以避免模块循环依赖。
 */
export function openRepairRound(moldId) {
  return db.prepare(`
    SELECT * FROM repairs
    WHERE mold_id = ? AND status = '进行中'
    ORDER BY root_repair_id DESC, round_no DESC
    LIMIT 1
  `).get(moldId) || null
}

function hasPendingTrial(moldId) {
  return !!db.prepare('SELECT 1 FROM trials WHERE mold_id = ? AND result IS NULL LIMIT 1').get(moldId)
}

function hasActiveSchedule(moldId) {
  return !!db.prepare("SELECT 1 FROM production_schedules WHERE mold_id = ? AND status = '已排产' LIMIT 1").get(moldId)
}

/** 改模轮验收态 → 模具资产态 */
function statusForRepair(round) {
  switch (round.acceptance) {
    case '待回厂':
      return round.repair_type === '委外' ? '委外中' : '改模中'
    case '待验收':
      return '待验收'
    case '不合格':
      // 上一轮验收不合格、等待退回重改，仍是改模流程在途
      return '改模中'
    default:
      return '改模中'
  }
}

/**
 * 按当前有效任务推导模具应处的状态（不写库）。
 * @returns {{status:string, task:{kind:string, ...}|null}}
 */
export function deriveMoldState(moldId) {
  const repair = openRepairRound(moldId)
  if (repair) return { status: statusForRepair(repair), task: { kind: 'repair', round: repair } }
  if (hasPendingTrial(moldId)) return { status: '试模中', task: { kind: 'trial' } }
  if (hasActiveSchedule(moldId)) return { status: '生产中', task: { kind: 'production' } }
  return { status: '在库', task: null }
}

/** 按当前有效任务回写模具状态（跳过人工禁用态，幂等可重复调用） */
export function syncMoldStatus(moldId) {
  const mold = db.prepare('SELECT status FROM molds WHERE id = ?').get(moldId)
  if (!mold || mold.status === '禁用') return
  const { status } = deriveMoldState(moldId)
  if (mold.status !== status) {
    db.prepare('UPDATE molds SET status = ? WHERE id = ?').run(status, moldId)
  }
}

/**
 * 启动对账：按当前有效任务重算全部模具状态，修复历史脏数据。
 * @returns {number} 实际被纠正的模具数
 */
export function recomputeAllMoldStatuses() {
  const ids = db.prepare('SELECT id FROM molds WHERE status != ?').all('禁用')
  let fixed = 0
  for (const { id } of ids) {
    const before = db.prepare('SELECT status FROM molds WHERE id = ?').get(id).status
    syncMoldStatus(id)
    const after = db.prepare('SELECT status FROM molds WHERE id = ?').get(id).status
    if (before !== after) fixed += 1
  }
  return fixed
}
