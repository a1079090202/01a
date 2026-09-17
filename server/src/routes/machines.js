import { Router } from 'express'
import { db, ApiError } from '../db.js'
import { nowLocal } from '../util/dates.js'

const router = Router()

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM machines ORDER BY code').all())
})

router.post('/', (req, res) => {
  const { code, name, tonnage } = req.body || {}
  if (!code || !String(code).trim()) throw new ApiError(400, '机台编号必填')
  if (!name || !String(name).trim()) throw new ApiError(400, '机台名称必填')
  const t = tonnage === undefined || tonnage === '' || tonnage === null ? null : Number(tonnage)
  if (t !== null && (!Number.isInteger(t) || t <= 0)) throw new ApiError(400, '锁模力须为正整数')
  try {
    const info = db.prepare('INSERT INTO machines (code, name, tonnage, created_at) VALUES (?, ?, ?, ?)')
      .run(String(code).trim(), String(name).trim(), t, nowLocal())
    res.status(201).json(db.prepare('SELECT * FROM machines WHERE id = ?').get(info.lastInsertRowid))
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new ApiError(409, `机台编号 ${code} 已存在`)
    throw e
  }
})

export default router
