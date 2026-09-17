import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, fmtDT, defaultDT, currentMonth } from '../api.js'
import { useToast } from '../App.jsx'
import { Badge, Modal, errorTip } from '../components/ui.jsx'

export default function TrialsPage() {
  const notify = useToast()
  const [trials, setTrials] = useState([])
  const [molds, setMolds] = useState([])
  const [machines, setMachines] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [judgeTarget, setJudgeTarget] = useState(null)
  const [month, setMonth] = useState(currentMonth())
  const [machineFilter, setMachineFilter] = useState('')

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ month })
    if (machineFilter) qs.set('machine_id', machineFilter)
    const [ts, ms, mac] = await Promise.all([
      api.get(`/trials?${qs}`), api.get('/molds'), api.get('/machines')
    ])
    setTrials(ts); setMolds(ms); setMachines(mac)
  }, [month, machineFilter])
  useEffect(() => { load().catch((e) => notify(errorTip(e), 'err')) }, [load, notify])

  return (
    <div>
      <div className="page-title">试模排程
        <span className="page-sub">排机台与时段；一次试模填次数、样件判定与问题，判不合格自动开改模单</span>
      </div>
      <div className="panel">
        <div className="toolbar">
          <label className="fld" style={{ minWidth: 160 }}>月份
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
          <label className="fld" style={{ minWidth: 160 }}>机台
            <select value={machineFilter} onChange={(e) => setMachineFilter(e.target.value)}>
              <option value="">全部机台</option>
              {machines.map((m) => <option key={m.id} value={m.id}>{m.code} {m.name}</option>)}
            </select>
          </label>
          <span className="spacer" />
          <button className="primary" onClick={() => setShowCreate(true)}>＋ 排试模</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>模具 / 产品</th><th className="num">试模次数</th><th>机台</th>
              <th>时段</th><th>样件判定</th><th>问题描述</th><th></th>
            </tr>
          </thead>
          <tbody>
            {trials.map((t) => (
              <tr key={t.id}>
                <td><b>{t.mold_code}</b><div className="hint">{t.product_name}</div></td>
                <td className="num">第 {t.trial_no} 次</td>
                <td>{t.machine_code}</td>
                <td className="nowrap">{fmtDT(t.start_at)} ~ {fmtDT(t.end_at).slice(11)}</td>
                <td>{t.result ? <Badge value={t.result} /> : <Badge value="待判定" />}</td>
                <td className="muted" style={{ maxWidth: 260 }}>{t.problem || ''}</td>
                <td className="nowrap">
                  {!t.result
                    ? <button className="sm primary" onClick={() => setJudgeTarget(t)}>填判定</button>
                    : <span className="hint">已判定</span>}
                </td>
              </tr>
            ))}
            {trials.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>该月没有试模记录</td></tr>}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateTrialModal molds={molds} machines={machines} onClose={() => setShowCreate(false)}
        onDone={() => { setShowCreate(false); load() }} />}
      {judgeTarget && <JudgeModal trial={judgeTarget} onClose={() => setJudgeTarget(null)}
        onDone={() => { setJudgeTarget(null); load() }} />}
    </div>
  )
}

function CreateTrialModal({ molds, machines, onClose, onDone }) {
  const notify = useToast()
  const [moldId, setMoldId] = useState('')
  const [machineId, setMachineId] = useState('')
  const [start, setStart] = useState(defaultDT(1, 9, 0))
  const [end, setEnd] = useState(defaultDT(1, 12, 0))
  const [busy, setBusy] = useState(false)

  const mold = molds.find((m) => m.id === Number(moldId))

  const submit = async () => {
    setBusy(true)
    try {
      const t = await api.post('/trials', {
        mold_id: Number(moldId), machine_id: Number(machineId),
        start_at: start, end_at: end
      })
      notify(`已排产：${t.mold_code} 第 ${t.trial_no} 次试模，${t.start_at} @ ${t.machine_code}`)
      onDone()
    } catch (e) { notify(errorTip(e), 'err') } finally { setBusy(false) }
  }

  return (
    <Modal title="排试模" onClose={onClose}>
      <div className="form-grid">
        <label className="fld">模具 *
          <select value={moldId} onChange={(e) => setMoldId(e.target.value)}>
            <option value="">请选择</option>
            {molds.map((m) => <option key={m.id} value={m.id}>
              {m.code} {m.product_name}{m.status !== '在库' ? `（${m.status}）` : ''}
            </option>)}
          </select>
        </label>
        <label className="fld">试模机台 *
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            <option value="">请选择</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.code} {m.name}</option>)}
          </select>
        </label>
        <label className="fld">开始时间 *<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="fld">结束时间 *<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      {mold && (
        <div className="stack" style={{ marginTop: 12 }}>
          <span className="hint">该模具当前模次 {mold.current_cycles.toLocaleString('zh-CN')} / {mold.rated_life.toLocaleString('zh-CN')}，寿命状态：<Badge value={mold.life.level} /></span>
          {mold.open_repair
            ? <span className="alert-banner red" style={{ margin: 0 }}>该模具有未关闭改模单（第 {mold.open_repair.round_no} 轮 · {mold.open_repair.acceptance}），系统会阻止本次排程，请先到「改模单」走完流程。</span>
            : <span className="hint">系统会校验：同一机台/模具时段冲突、改模是否闭环。</span>}
        </div>
      )}
      <div className="form-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" disabled={busy} onClick={submit}>确认排试模</button>
      </div>
    </Modal>
  )
}

function JudgeModal({ trial, onClose, onDone }) {
  const notify = useToast()
  const [result, setResult] = useState('合格')
  const [problem, setProblem] = useState('')
  // 不合格 → 改模单信息
  const [repairType, setRepairType] = useState('委外')
  const [vendor, setVendor] = useState('')
  const [sendDate, setSendDate] = useState(defaultDT(0, 9).slice(0, 10))

  const submit = async () => {
    try {
      const body = { result, problem: problem || null }
      if (result === '不合格') {
        body.repair = {
          repair_type: repairType,
          vendor: repairType === '委外' ? vendor : null,
          send_date: sendDate || null,
          problem: problem || null
        }
      }
      const r = await api.post(`/trials/${trial.id}/judge`, body)
      if (result === '不合格' && r.repair) {
        notify(`已判定不合格，并自动开出第 ${r.repair.round_no} 轮${repairType}改模单 #${r.repair.root_repair_id}`)
      } else {
        notify(`试模判定已保存：${result}`)
      }
      onDone()
    } catch (e) { notify(errorTip(e), 'err') }
  }

  return (
    <Modal title={`试模判定 — ${trial.mold_code} 第 ${trial.trial_no} 次`} onClose={onClose}>
      <div className="stack">
        <div className="row">
          <span style={{ minWidth: 84 }}>样件判定 *</span>
          {['合格', '让步接收', '不合格'].map((r) => (
            <label key={r} className="checkline">
              <input type="radio" name="result" checked={result === r} onChange={() => setResult(r)} />{r}
            </label>
          ))}
        </div>
        <label className="fld">问题描述<textarea rows={3} value={problem} onChange={(e) => setProblem(e.target.value)}
          placeholder="如：浇口位置偏差，一侧困气烧白" /></label>

        {result === '不合格' && (
          <div className="panel" style={{ background: '#fdf8f7', margin: 0 }}>
            <h3>同步开改模单（判定不合格必须走改模）</h3>
            <div className="form-grid">
              <label className="fld">改模类型 *
                <select value={repairType} onChange={(e) => setRepairType(e.target.value)}>
                  <option value="委外">委外</option>
                  <option value="厂内">厂内</option>
                </select>
              </label>
              {repairType === '委外' && (
                <label className="fld">委外厂家 *<input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="如 精诚模具有限公司" /></label>
              )}
              {repairType === '委外' && (
                <label className="fld">送修日期<input type="date" value={sendDate} onChange={(e) => setSendDate(e.target.value)} /></label>
              )}
            </div>
            <p className="hint" style={{ marginBottom: 0 }}>
              委外单据开出后状态为「待回厂」，回厂登记后变「待验收」；验收合格才关单，不合格可退回重改并自动累计改模轮次。
            </p>
          </div>
        )}
      </div>
      <div className="form-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={submit}>保存判定</button>
      </div>
    </Modal>
  )
}
