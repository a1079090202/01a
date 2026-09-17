import { Router } from 'express'
import { db, ApiError } from '../db.js'
import { nowLocal, requireDateTime } from '../util/dates.js'
import { assertSlotFree, occupancy } from '../modules/scheduleConflict.js'
import {
  createRepair, assertNoOpenRepair, RESULTS
} from '../modules/repairRounds.js'
import { syncMoldStatus } from '../modules/moldStatus.js'

const router = Router()

function loadTrial(id) {
  const t = db.prepare(`
    SELECT t.*, m.code AS mold_code, m.product_name, ma.code AS machine_code
    FROM trials t
    JOIN molds m ON m.id = t.mold_id
    JOIN machines ma ON ma.id = t.machine_id
    WHERE t.id = ?
  `).get(id)
  if (!t) throw new ApiError(404, '试模记录不存在')
  return t
}

// 试模排程列表（可按模具/机台/月份过滤）
router.get('/', (req, res) => {
  const { mold_id, machine_id, month } = req.query
  const where = []
  const params = {}
  if (mold_id) { where.push('t.mold_id = @mold'); params.mold = Number(mold_id) }
  if (machine_id) { where.push('t.machine_id = @machine'); params.machine = Number(machine_id) }
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new ApiError(400, '月份格式应为 YYYY-MM')
    where.push("substr(t.start_at,1,7) = @month"); params.month = month
  }
  const rows = db.prepare(`
    SELECT t.*, m.code AS mold_code, m.product_name, ma.code AS machine_code
    FROM trials t
    JOIN molds m ON m.id = t.mold_id
    JOIN machines ma ON ma.id = t.machine_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.start_at DESC, t.id DESC
  `).all(params)
  res.json(rows)
})

// 占用查询（排程前给前端提示）
router.get('/occupancy', (req, res) => {
  res.json(occupancy({
    machineId: req.query.machine_id ? Number(req.query.machine_id) : null,
    moldId: req.query.mold_id ? Number(req.query.mold_id) : null
  }))
})

// 排试模：选模具、机台、时段；时段冲突与未关闭改模单都在此挡住
router.post('/', (req, res) => {
  const { mold_id, machine_id, start_at, end_at } = req.body || {}
  const moldId = Number(mold_id), machineId = Number(machine_id)
  if (!moldId || !machineId) throw new ApiError(400, '模具和机台必选')
  const start = requireDateTime(start_at, '开始时间')
  const end = requireDateTime(end_at, '结束时间')

  const mold = db.prepare('SELECT * FROM molds WHERE id = ?').get(moldId)
  if (!mold) throw new ApiError(404, '模具不存在')
  if (!db.prepare('SELECT id FROM machines WHERE id = ?').get(machineId)) {
    throw new ApiError(404, '机台不存在')
  }

  // 红线 1：改模未闭环不能再试模（委外未回厂/回厂未验收都会被挡）
  assertNoOpenRepair(moldId)
  // 红线 2：机台/模具时段冲突（跨试模与排产）
  assertSlotFree({ machineId, moldId, start, end })

  const maxNo = db.prepare('SELECT COALESCE(MAX(trial_no),0) AS n FROM trials WHERE mold_id = ?')
    .get(moldId).n
  const ts = nowLocal()
  const info = db.prepare(`
    INSERT INTO trials (mold_id, trial_no, machine_id, start_at, end_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(moldId, maxNo + 1, machineId, start, end, ts)
  syncMoldStatus(moldId)
  res.status(201).json(loadTrial(info.lastInsertRowid))
})

/**
 * 试模判定：合格 / 让步接收 / 不合格。
 * 判不合格时同事务顺手开出改模单（改模类型、厂家等从 body.repair 取），
 * 返回 { trial, repair }，前端直接跳到改模单。
 */
router.post('/:id/judge', (req, res) => {
  const id = Number(req.params.id)
  const t = loadTrial(id)
  if (t.result) throw new ApiError(409, `该次试模已判定为「${t.result}」，不能重复判定`)

  const { result, problem = null } = req.body || {}
  if (!RESULTS.includes(result)) throw new ApiError(400, '样件判定必须是 合格/让步接收/不合格 之一')

  let repair = null
  const tx = db.transaction(() => {
    db.prepare('UPDATE trials SET result = ?, problem = ? WHERE id = ?')
      .run(result, problem, id)

    if (result === '不合格') {
      const r = req.body?.repair || {}
      if (!r.repair_type) throw new ApiError(400, '判定不合格必须同时选择改模类型（厂内/委外）')
      repair = createRepair({
        moldId: t.mold_id,
        trialId: id,
        repairType: r.repair_type,
        vendor: r.vendor || null,
        sendDate: r.send_date || null,
        problem: problem || r.problem || null
      })
    } else {
      // 合格 / 让步接收：试模任务结束，按当前有效任务重算资产状态
      syncMoldStatus(t.mold_id)
    }
  })
  tx()
  res.status(201).json({ trial: loadTrial(id), repair })
})

export default router
