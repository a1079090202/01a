import { Router } from 'express'
import { db, ApiError } from '../db.js'
import { alerts } from '../modules/lifeAlert.js'

const router = Router()

// 寿命预警看板（≥80% 与超寿命）
router.get('/alerts', (req, res) => {
  res.json(alerts())
})

/**
 * 月底统计：按模具的试模次数与改模轮次。
 * GET /api/reports/monthly?month=YYYY-MM（默认本月）
 * 试模次数 = 当月试模记录数；改模轮次 = 当月开出的改模轮次行数；
 * 另附当月生产模次、截至月末的累计模次与寿命状态，方便月底复盘。
 */
router.get('/monthly', (req, res) => {
  const month = req.query.month
  if (month && !/^\d{4}-\d{2}$/.test(month)) throw new ApiError(400, '月份格式应为 YYYY-MM')

  const rows = db.prepare(`
    SELECT m.id, m.code, m.product_name, m.cavities, m.rated_life, m.current_cycles,
      (SELECT COUNT(*) FROM trials t
         WHERE t.mold_id = m.id AND substr(t.start_at,1,7) = @month) AS trial_count,
      (SELECT COUNT(*) FROM trials t
         WHERE t.mold_id = m.id AND substr(t.start_at,1,7) = @month AND t.result = '不合格') AS ng_count,
      (SELECT COUNT(*) FROM repairs r
         WHERE r.mold_id = m.id AND substr(r.created_at,1,7) = @month) AS repair_rounds,
      (SELECT COUNT(DISTINCT r.root_repair_id) FROM repairs r
         WHERE r.mold_id = m.id AND substr(r.created_at,1,7) = @month) AS repair_orders,
      (SELECT COALESCE(SUM(l.cycles),0) FROM production_logs l
         WHERE l.mold_id = m.id AND substr(l.produced_at,1,7) = @month) AS month_cycles
    FROM molds m
    ORDER BY m.code
  `).all({ month })

  const totals = rows.reduce((acc, r) => {
    acc.trial_count += r.trial_count
    acc.ng_count += r.ng_count
    acc.repair_rounds += r.repair_rounds
    acc.repair_orders += r.repair_orders
    acc.month_cycles += r.month_cycles
    return acc
  }, { trial_count: 0, ng_count: 0, repair_rounds: 0, repair_orders: 0, month_cycles: 0 })

  res.json({
    month,
    generated_at: new Date().toLocaleString('zh-CN', { hour12: false }),
    molds: rows,
    totals
  })
})

export default router
