import { Router } from 'express'
import { ApiError } from '../db.js'
import {
  listRepairs, getRepair, markReturned, acceptRepair, rework, createRepair
} from '../modules/repairRounds.js'

const router = Router()

// 手工开改模单（正常流程由试模判不合格自动开单）
router.post('/open', (req, res) => {
  const { mold_id, repair_type, vendor, send_date, problem } = req.body || {}
  if (!mold_id) throw new ApiError(400, '请选择模具')
  const r = createRepair({
    moldId: Number(mold_id),
    repairType: repair_type,
    vendor: vendor || null,
    sendDate: send_date || null,
    problem: problem || null
  })
  res.status(201).json(r)
})

// 列表（?open=1 只看进行中；&mold_id=）
router.get('/', (req, res) => {
  res.json(listRepairs({
    moldId: req.query.mold_id ? Number(req.query.mold_id) : null,
    openOnly: req.query.open === '1' || req.query.open === 'true'
  }))
})

// 详情（含每一轮）
router.get('/:id', (req, res) => {
  res.json(getRepair(Number(req.params.id)))
})

// 委外回厂登记 → 待验收
router.post('/:id/return', (req, res) => {
  const r = markReturned({
    repairId: Number(req.params.id),
    returnDate: req.body?.return_date || null
  })
  res.json(r)
})

// 验收：passed=true 合格关单；false 记不合格
router.post('/:id/accept', (req, res) => {
  const { passed, acceptor, problem } = req.body || {}
  if (typeof passed !== 'boolean') throw new ApiError(400, '验收结果 passed 必须为布尔值')
  if (!acceptor || !String(acceptor).trim()) throw new ApiError(400, '请填写验收人')
  const r = acceptRepair({
    repairId: Number(req.params.id),
    passed,
    acceptor: String(acceptor).trim(),
    problem: problem || null
  })
  res.json(r)
})

// 验收不合格 → 退回重改，开下一轮
router.post('/:id/rework', (req, res) => {
  const { repair_type, vendor, send_date, problem } = req.body || {}
  const r = rework({
    repairId: Number(req.params.id),
    repairType: repair_type || null,
    vendor: vendor || null,
    sendDate: send_date || null,
    problem: problem || null
  })
  res.status(201).json(r)
})

export default router
