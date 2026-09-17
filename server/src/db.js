import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
fs.mkdirSync(dataDir, { recursive: true })

export const db = new Database(path.join(dataDir, 'mold-ledger.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

/** 业务异常：带 HTTP 状态码，路由层统一兜底 */
export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function initDb() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS machines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,          -- 机台编号
    name TEXT NOT NULL,                 -- 机台名称/规格
    tonnage INTEGER,                    -- 锁模力(吨)
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS molds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,          -- 模具编号
    product_name TEXT NOT NULL,         -- 对应产品
    cavities INTEGER NOT NULL,          -- 型腔数
    rated_life INTEGER NOT NULL,        -- 额定模次寿命
    current_cycles INTEGER NOT NULL DEFAULT 0, -- 当前模次（整数累计）
    -- 在库 / 试模中 / 改模中 / 委外中 / 待验收 / 禁用
    status TEXT NOT NULL DEFAULT '在库',
    note TEXT,
    created_at TEXT NOT NULL
  );

  -- 试模排程（一条记录 = 一次试模，占机台+模具时段）
  CREATE TABLE IF NOT EXISTS trials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mold_id INTEGER NOT NULL REFERENCES molds(id),
    trial_no INTEGER NOT NULL,          -- 该模具第几次试模
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    start_at TEXT NOT NULL,             -- 'YYYY-MM-DD HH:mm' 本地时间
    end_at TEXT NOT NULL,
    -- NULL=待判定；合格 / 让步接收 / 不合格
    result TEXT,
    problem TEXT,                       -- 问题描述
    created_at TEXT NOT NULL,
    UNIQUE(mold_id, trial_no)
  );

  -- 改模单（一行 = 一个改模轮次；验收不合格退回重改就新增一行，root_repair_id 相同）
  CREATE TABLE IF NOT EXISTS repairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_repair_id INTEGER NOT NULL,    -- 同一改模单的首单 id
    mold_id INTEGER NOT NULL REFERENCES molds(id),
    trial_id INTEGER REFERENCES trials(id),
    round_no INTEGER NOT NULL,          -- 改模轮次，从 1 起
    repair_type TEXT NOT NULL,          -- 厂内 / 委外
    vendor TEXT,                        -- 委外厂家
    send_date TEXT,                     -- 送修日期
    return_date TEXT,                   -- 回厂日期
    -- 待回厂 / 待验收 / 合格 / 不合格
    acceptance TEXT NOT NULL DEFAULT '待回厂',
    accepted_at TEXT,
    acceptor TEXT,
    problem TEXT,
    -- 进行中 / 已关闭（整组在验收合格后关闭）
    status TEXT NOT NULL DEFAULT '进行中',
    created_at TEXT NOT NULL
  );

  -- 生产排产（模具挂产品、占机台+模具时段；超寿命需主管确认）
  CREATE TABLE IF NOT EXISTS production_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mold_id INTEGER NOT NULL REFERENCES molds(id),
    product_name TEXT NOT NULL,         -- 本次排产挂的产品
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    qty INTEGER,                        -- 计划数量
    overlife_confirmed INTEGER NOT NULL DEFAULT 0, -- 超寿命主管确认凭证
    confirmer TEXT,                     -- 确认主管姓名
    -- 已排产 / 已完工
    status TEXT NOT NULL DEFAULT '已排产',
    created_at TEXT NOT NULL
  );

  -- 实际生产记录（每次记一笔，事务内累加到模具当前模次）
  CREATE TABLE IF NOT EXISTS production_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mold_id INTEGER NOT NULL REFERENCES molds(id),
    schedule_id INTEGER REFERENCES production_schedules(id),
    produced_at TEXT NOT NULL,
    cycles INTEGER NOT NULL,            -- 本次模次（正整数）
    operator TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_trials_time ON trials(start_at, end_at);
  CREATE INDEX IF NOT EXISTS idx_sched_time ON production_schedules(start_at, end_at);
  CREATE INDEX IF NOT EXISTS idx_repairs_mold ON repairs(mold_id);
  CREATE INDEX IF NOT EXISTS idx_logs_mold ON production_logs(mold_id);

  -- ========================================================================
  -- 数据库级红线（防线二）：触发器对任意连接、任意写入路径生效，
  -- 即使绕过 HTTP 直连写库、或多进程并发也无法突破。
  -- 应用层（modules/*）仍先行校验，给出更精确的中文 409（防线一）。
  -- 时段重叠采用半开区间：NEW.start_at < old.end_at AND NEW.end_at > old.start_at，
  -- 首尾相接不算冲突；时间为定长 'YYYY-MM-DD HH:mm' 字符串，可直接按字典序比较。
  -- ========================================================================

  -- 试模：同机台时段互斥（对撞其他试模 或 已排产的排产单）
  CREATE TRIGGER IF NOT EXISTS trg_trials_busy_machine
  BEFORE INSERT ON trials
  FOR EACH ROW
  WHEN EXISTS (
        SELECT 1 FROM trials t
        WHERE t.machine_id = NEW.machine_id
          AND NEW.start_at < t.end_at AND NEW.end_at > t.start_at
       )
    OR EXISTS (
        SELECT 1 FROM production_schedules s
        WHERE s.machine_id = NEW.machine_id AND s.status = '已排产'
          AND NEW.start_at < s.end_at AND NEW.end_at > s.start_at
       )
  BEGIN
    SELECT RAISE(ABORT, '该时段机台已被其他试模/排产占用，时段冲突');
  END;

  -- 试模：同模具时段互斥（一副模具同一时段不能挂两件事）
  CREATE TRIGGER IF NOT EXISTS trg_trials_busy_mold
  BEFORE INSERT ON trials
  FOR EACH ROW
  WHEN EXISTS (
        SELECT 1 FROM trials t
        WHERE t.mold_id = NEW.mold_id
          AND NEW.start_at < t.end_at AND NEW.end_at > t.start_at
       )
    OR EXISTS (
        SELECT 1 FROM production_schedules s
        WHERE s.mold_id = NEW.mold_id AND s.status = '已排产'
          AND NEW.start_at < s.end_at AND NEW.end_at > s.start_at
       )
  BEGIN
    SELECT RAISE(ABORT, '该模具在同一时段已被其他试模/排产占用，不能重复占用');
  END;

  -- 试模：改模单未闭环不得排试模
  CREATE TRIGGER IF NOT EXISTS trg_trials_open_repair
  BEFORE INSERT ON trials
  FOR EACH ROW
  WHEN EXISTS (
        SELECT 1 FROM repairs r
        WHERE r.mold_id = NEW.mold_id AND r.status = '进行中'
       )
  BEGIN
    SELECT RAISE(ABORT, '该模具有未关闭的改模单，必须验收合格闭环后才能排试模');
  END;

  -- 排产：同机台时段互斥（仅当新单本身为“已排产”；完工单是历史记录，不占时段）
  CREATE TRIGGER IF NOT EXISTS trg_sched_busy_machine
  BEFORE INSERT ON production_schedules
  FOR EACH ROW
  WHEN NEW.status = '已排产'
   AND (
        EXISTS (
          SELECT 1 FROM trials t
          WHERE t.machine_id = NEW.machine_id
            AND NEW.start_at < t.end_at AND NEW.end_at > t.start_at
        )
     OR EXISTS (
          SELECT 1 FROM production_schedules s
          WHERE s.machine_id = NEW.machine_id AND s.status = '已排产'
            AND NEW.start_at < s.end_at AND NEW.end_at > s.start_at
        )
       )
  BEGIN
    SELECT RAISE(ABORT, '该时段机台已被其他试模/排产占用，时段冲突');
  END;

  -- 排产：同模具时段互斥
  CREATE TRIGGER IF NOT EXISTS trg_sched_busy_mold
  BEFORE INSERT ON production_schedules
  FOR EACH ROW
  WHEN NEW.status = '已排产'
   AND (
        EXISTS (
          SELECT 1 FROM trials t
          WHERE t.mold_id = NEW.mold_id
            AND NEW.start_at < t.end_at AND NEW.end_at > t.start_at
        )
     OR EXISTS (
          SELECT 1 FROM production_schedules s
          WHERE s.mold_id = NEW.mold_id AND s.status = '已排产'
            AND NEW.start_at < s.end_at AND NEW.end_at > s.start_at
        )
       )
  BEGIN
    SELECT RAISE(ABORT, '该模具在同一时段已被其他试模/排产占用，不能重复占用');
  END;

  -- 排产：超寿命模具未经主管确认（确认标记=0）不得排产
  CREATE TRIGGER IF NOT EXISTS trg_sched_overlife
  BEFORE INSERT ON production_schedules
  FOR EACH ROW
  WHEN NEW.status = '已排产'
   AND NEW.overlife_confirmed = 0
   AND EXISTS (
        SELECT 1 FROM molds m
        WHERE m.id = NEW.mold_id AND m.current_cycles >= m.rated_life
       )
  BEGIN
    SELECT RAISE(ABORT, '模具已超额定寿命，未经主管确认不得排产');
  END;

  -- 排产：改模单未闭环不得排产
  CREATE TRIGGER IF NOT EXISTS trg_sched_open_repair
  BEFORE INSERT ON production_schedules
  FOR EACH ROW
  WHEN NEW.status = '已排产'
   AND EXISTS (
        SELECT 1 FROM repairs r
        WHERE r.mold_id = NEW.mold_id AND r.status = '进行中'
       )
  BEGIN
    SELECT RAISE(ABORT, '该模具有未关闭的改模单，必须验收合格闭环后才能排产');
  END;
  `)
}
