// 模块二：寿命预警（lifeAlert）
// 职责：根据 当前模次/额定寿命 给出 正常 / 预警(≥80%) / 超寿命(≥100%) 状态，
// 并在排产时执行硬卡口：超寿命未经主管确认（姓名+确认标记）一律不放行。
import { db } from '../db.js'
import { ApiError } from '../db.js'

export const WARN_RATIO = 0.8

export function lifeOf(mold) {
  const ratio = mold.rated_life > 0 ? mold.current_cycles / mold.rated_life : 0
  let level = '正常'
  if (mold.current_cycles >= mold.rated_life) level = '超寿命'
  else if (ratio >= WARN_RATIO) level = '预警'
  return {
    level,
    ratio: Number(ratio.toFixed(4)),
    percent: Number((ratio * 100).toFixed(1)),
    remaining: mold.rated_life - mold.current_cycles,
    warnAt: Math.floor(mold.rated_life * WARN_RATIO)
  }
}

/** 模具台账列表带上寿命状态 */
export function listWithLife() {
  return db.prepare('SELECT * FROM molds ORDER BY code').all()
    .map((m) => ({ ...m, life: lifeOf(m) }))
}

/** 当前需要关注的模具：80% 预警 + 已超寿命 */
export function alerts() {
  return listWithLife()
    .filter((m) => m.life.level !== '正常')
    .sort((a, b) => b.life.ratio - a.life.ratio)
}

/**
 * 排产生命线校验。
 * @param mold 模具（含 current_cycles / rated_life）
 * @param confirmation {confirmed:boolean, confirmer:string} 主管确认凭证
 */
export function assertCanSchedule(mold, confirmation = {}) {
  const life = lifeOf(mold)
  if (life.level === '超寿命') {
    if (!confirmation.confirmed || !confirmation.confirmer || !String(confirmation.confirmer).trim()) {
      throw new ApiError(409,
        `模具 ${mold.code} 已达额定寿命 ${mold.rated_life} 模次（当前 ${mold.current_cycles}），` +
        `未经主管确认不得排产`)
    }
    return { overlifeConfirmed: true, confirmer: String(confirmation.confirmer).trim(), life }
  }
  return { overlifeConfirmed: false, confirmer: null, life }
}
