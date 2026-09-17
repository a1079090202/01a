// 种子数据：8 副模具（2 副委外改模中、1 副已超寿命）、4 台机台、近一个月的试模/改模/生产记录。
// 运行：npm run seed  （会清空并重建 server/data 下的数据库）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
fs.mkdirSync(dataDir, { recursive: true })

// ---- 清库重建：必须在打开数据库连接之前删文件 ----
for (const f of fs.readdirSync(dataDir)) {
  if (f.endsWith('.sqlite') || f.endsWith('.sqlite-wal') || f.endsWith('.sqlite-shm')) {
    fs.rmSync(path.join(dataDir, f), { force: true })
  }
}

const { db, initDb } = await import(pathToFileURL(path.join(__dirname, 'db.js')).href)
const { formatLocal } = await import(pathToFileURL(path.join(__dirname, 'util', 'dates.js')).href)
initDb()

// ---- 相对今天的日期工具，保证“近一个月记录”永远成立 ----
const pad = (n) => String(n).padStart(2, '0')
function at(dayOffset, hh, mm = 0) {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hh, mm, 0, 0)
  return formatLocal(d)
}
const day = (dayOffset) => at(dayOffset, 9).slice(0, 10)
const ts = () => formatLocal(new Date())

// ---- 机台 ----
const machines = [
  { code: 'IM-01', name: '80吨注塑机', tonnage: 80 },
  { code: 'IM-02', name: '160吨注塑机', tonnage: 160 },
  { code: 'IM-03', name: '320吨注塑机', tonnage: 320 },
  { code: 'IM-04', name: '650吨注塑机', tonnage: 650 }
]
const insMachine = db.prepare('INSERT INTO machines (code, name, tonnage, created_at) VALUES (?, ?, ?, ?)')
const machineIds = {}
for (const m of machines) machineIds[m.code] = insMachine.run(m.code, m.name, m.tonnage, ts()).lastInsertRowid

// ---- 模具 ----
// 1001 委外中(待回厂)；1004 委外已回厂待验收；1005 寿命83%预警；1008 已超寿命
const molds = [
  { code: 'MJ-1001', product_name: '汽车前保险杠', cavities: 1, rated_life: 300000, current_cycles: 128600, status: '委外中', note: '第三次试模浇口位置不对，委外精诚改模中' },
  { code: 'MJ-1002', product_name: '汽车后保险杠', cavities: 1, rated_life: 300000, current_cycles: 96400, status: '在库' },
  { code: 'MJ-1003', product_name: '门内拉手', cavities: 2, rated_life: 500000, current_cycles: 210400, status: '在库' },
  { code: 'MJ-1004', product_name: '仪表板饰条', cavities: 1, rated_life: 250000, current_cycles: 45200, status: '待验收', note: '委外改模已回厂，等待验收' },
  { code: 'MJ-1005', product_name: '空调出风口格栅', cavities: 4, rated_life: 400000, current_cycles: 332000, status: '在库', note: '寿命已超80%，排产时留意预警' },
  { code: 'MJ-1006', product_name: '轮罩内衬', cavities: 2, rated_life: 350000, current_cycles: 178300, status: '在库' },
  { code: 'MJ-1007', product_name: '手套箱储物盒', cavities: 1, rated_life: 150000, current_cycles: 32100, status: '在库' },
  { code: 'MJ-1008', product_name: '标牌卡扣', cavities: 8, rated_life: 200000, current_cycles: 206500, status: '在库', note: '已超额定寿命，排产须主管确认' }
]
const insMold = db.prepare(`INSERT INTO molds
  (code, product_name, cavities, rated_life, current_cycles, status, note, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
const moldIds = {}
for (const m of molds) {
  moldIds[m.code] = insMold.run(m.code, m.product_name, m.cavities, m.rated_life,
    m.current_cycles, m.status, m.note ?? null, ts()).lastInsertRowid
}

// ---- 试模 & 改模流水 ----
const insTrial = db.prepare(`INSERT INTO trials
  (mold_id, trial_no, machine_id, start_at, end_at, result, problem, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
const insRepair = db.prepare(`INSERT INTO repairs
  (root_repair_id, mold_id, trial_id, round_no, repair_type, vendor, send_date, return_date,
   acceptance, accepted_at, acceptor, problem, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

function addRepair(o) {
  const id = Number(insRepair.run(
    0, o.moldId, o.trialId ?? null, o.round, o.type, o.vendor ?? null,
    o.sendDate ?? null, o.returnDate ?? null, o.acceptance, o.acceptedAt ?? null,
    o.acceptor ?? null, o.problem ?? null, o.status, o.createdAt
  ).lastInsertRowid)
  db.prepare('UPDATE repairs SET root_repair_id = ? WHERE id = ?').run(o.root ?? id, id)
  return id
}
function trial(code, no, machine, dOff, sh, eh, result, problem) {
  return insTrial.run(moldIds[code], no, machineIds[machine],
    at(dOff, sh[0], sh[1]), at(dOff, eh[0], eh[1]), result, problem, at(dOff, sh[0], sh[1])).lastInsertRowid
}

// MJ-1001：第1次试模不合格→厂内改模合格；第2次让步接收；第3次不合格(浇口位置)→委外中，未回厂
{
  const t1 = trial('MJ-1001', 1, 'IM-04', -25, [9, 0], [12, 0], '不合格', '充填不足，保险杠远端有飞边')
  addRepair({ moldId: moldIds['MJ-1001'], trialId: t1, round: 1, type: '厂内',
    sendDate: day(-25), acceptance: '合格', acceptedAt: at(-23, 15), acceptor: '李建国',
    problem: '打磨分型面、调整充型参数', status: '已关闭', createdAt: at(-25, 12, 30) })
  trial('MJ-1001', 2, 'IM-04', -16, [14, 0], [17, 0], '让步接收', '表面有轻微熔接痕，客户同意让步')
  const t3 = trial('MJ-1001', 3, 'IM-04', -5, [9, 0], [12, 30], '不合格', '浇口位置偏差，料流不对称，一侧困气烧白')
  addRepair({ moldId: moldIds['MJ-1001'], trialId: t3, round: 1, type: '委外',
    vendor: '精诚模具有限公司', sendDate: day(-4), acceptance: '待回厂',
    problem: '重新核算浇口位置，热流道改点并抛光', status: '进行中', createdAt: at(-4, 10) })
}

// MJ-1002：第1次不合格（顶白）→厂内改模合格；第2次合格
{
  const t1 = trial('MJ-1002', 1, 'IM-04', -22, [9, 0], [11, 30], '不合格', '顶出位置顶白')
  addRepair({ moldId: moldIds['MJ-1002'], trialId: t1, round: 1, type: '厂内',
    sendDate: day(-22), acceptance: '合格', acceptedAt: at(-20, 16), acceptor: '李建国',
    problem: '增大顶针、调整顶出速度', status: '已关闭', createdAt: at(-22, 11, 30) })
  trial('MJ-1002', 2, 'IM-04', -12, [9, 0], [11, 0], '合格', null)
}

// MJ-1003：一次合格
trial('MJ-1003', 1, 'IM-02', -18, [10, 0], [12, 0], '合格', null)

// MJ-1004：第1次合格；第2次不合格（装配间隙超差）→委外，已回厂、未验收（卡验收流程）
{
  trial('MJ-1004', 1, 'IM-03', -20, [13, 0], [15, 30], '合格', null)
  const t2 = trial('MJ-1004', 2, 'IM-03', -9, [9, 0], [11, 30], '不合格', '饰条与仪表板装配间隙超差 0.8mm')
  addRepair({ moldId: moldIds['MJ-1004'], trialId: t2, round: 1, type: '委外',
    vendor: '恒盛精密模具厂', sendDate: day(-8), returnDate: day(-2),
    acceptance: '待验收', problem: '修配安装卡扣配合面，补焊后重新CNC',
    status: '进行中', createdAt: at(-8, 14) })
}

// MJ-1005：两次合格（寿命 83% 预警）
trial('MJ-1005', 1, 'IM-02', -15, [9, 0], [11, 0], '合格', null)
trial('MJ-1005', 2, 'IM-02', -3, [14, 0], [16, 0], '合格', null)

// MJ-1006：第1次不合格→委外第1轮验收不合格→退回重改第2轮→合格关单；第2次试模合格
{
  const t1 = trial('MJ-1006', 1, 'IM-03', -24, [9, 0], [12, 0], '不合格', '脱模拉伤，内壁有划痕')
  const rid = addRepair({ moldId: moldIds['MJ-1006'], trialId: t1, round: 1, type: '委外',
    vendor: '鑫达模修加工厂', sendDate: day(-23), returnDate: day(-20),
    acceptance: '不合格', acceptedAt: at(-19, 10, 30), acceptor: '王海涛',
    problem: '抛光不到位，试模拉伤复现', status: '已关闭', createdAt: at(-23, 8, 30) })
  addRepair({ root: rid, moldId: moldIds['MJ-1006'], trialId: t1, round: 2, type: '委外',
    vendor: '鑫达模修加工厂', sendDate: day(-18), returnDate: day(-14),
    acceptance: '合格', acceptedAt: at(-13, 11, 0), acceptor: '王海涛',
    problem: '重新抛光并加大脱模斜度', status: '已关闭', createdAt: at(-18, 8, 30) })
  trial('MJ-1006', 2, 'IM-03', -7, [9, 0], [11, 30], '合格', null)
}

// MJ-1007：一次合格
trial('MJ-1007', 1, 'IM-01', -10, [9, 0], [10, 30], '合格', null)

// MJ-1008：老模具，两次试模均让步/合格
trial('MJ-1008', 1, 'IM-01', -27, [13, 0], [15, 0], '合格', null)
trial('MJ-1008', 2, 'IM-01', -14, [9, 0], [10, 30], '让步接收', '飞边轻微，调机可控制，注意已超寿命')

// ---- 排产单（部分已完工）+ 实际生产模次流水 ----
const insSched = db.prepare(`INSERT INTO production_schedules
  (mold_id, product_name, machine_id, start_at, end_at, qty, overlife_confirmed, confirmer, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
const insLog = db.prepare(`INSERT INTO production_logs
  (mold_id, schedule_id, produced_at, cycles, operator, note, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)`)

function schedule(code, machine, dOff, sh, eh, qty, status = '已完工', confirmed = 0, confirmer = null) {
  return insSched.run(moldIds[code], molds.find((m) => m.code === code).product_name,
    machineIds[machine], at(dOff, sh[0], sh[1]), at(dOff, eh[0], eh[1]),
    qty, confirmed, confirmer, status, at(dOff, sh[0])).lastInsertRowid
}

// 把总模次拆成 n 个整数份，均匀撒在最近 n 天，保证 current_cycles 与流水合计一致
function spreadCycles(code, total, parts, operator = '张强') {
  const base = Math.floor(total / parts)
  const remainder = total - base * parts
  let used = 0
  for (let i = 0; i < parts; i++) {
    const c = base + (i === parts - 1 ? remainder : 0)
    used += c
    const dOff = -26 + Math.round((26 * i) / (parts - 1 || 1))
    let schedId = null
    if (i === 0 && ['MJ-1002', 'MJ-1005', 'MJ-1008'].includes(code)) {
      schedId = schedule(code, code === 'MJ-1005' ? 'IM-02' : code === 'MJ-1008' ? 'IM-01' : 'IM-04',
        dOff, [8, 0], [17, 0], c)
    }
    insLog.run(moldIds[code], schedId, at(dOff, 16, 30), c, operator,
      schedId ? '排产完工记账' : '实际生产累计', at(dOff, 16, 30))
  }
  return used
}

for (const m of molds) {
  spreadCycles(m.code, m.current_cycles, 6)
}

// ---- 输出种子摘要 ----
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
console.log('种子数据已写入：')
console.log(`  机台 ${count('machines')} 台，模具 ${count('molds')} 副`)
console.log(`  试模记录 ${count('trials')} 条，改模轮次 ${count('repairs')} 行（含两轮重改）`)
console.log(`  排产单 ${count('production_schedules')} 张，生产模次流水 ${count('production_logs')} 条`)
console.log('')
console.log('重点试玩数据：')
console.log('  · MJ-1001 前保险杠：委外中（待回厂），未回厂不能试模/排产')
console.log('  · MJ-1004 仪表板饰条：委外已回厂待验收，不验收不能继续')
console.log('  · MJ-1005 出风口格栅：332000/400000 = 83%，寿命预警中')
console.log('  · MJ-1008 标牌卡扣：206500/200000，已超寿命，排产须主管确认')
