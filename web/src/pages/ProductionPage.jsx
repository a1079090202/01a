import { useCallback, useEffect, useState } from 'react'
import { api, fmtInt, fmtDT, defaultDT } from '../api.js'
import { useToast } from '../App.jsx'
import { Badge, Modal, errorTip } from '../components/ui.jsx'

export default function ProductionPage() {
  const notify = useToast()
  const [schedules, setSchedules] = useState([])
  const [molds, setMolds] = useState([])
  const [machines, setMachines] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [logTarget, setLogTarget] = useState(null)

  const load = useCallback(async () => {
    const [ss, ms, mac] = await Promise.all([
      api.get('/production/schedules'), api.get('/molds'), api.get('/machines')
    ])
    setSchedules(ss); setMolds(ms); setMachines(mac)
  }, [])
  useEffect(() => { load().catch((e) => notify(errorTip(e), 'err')) }, [load, notify])

  const finish = async (s) => {
    try { await api.post(`/production/schedules/${s.id}/finish`, {})
      notify(`排产单 #${s.id} 已完工`); load()
    } catch (e) { notify(errorTip(e), 'err') }
  }

  return (
    <div>
      <div className="page-title">生产排产
        <span className="page-sub">一副模具同一时段只能挂一个产品；超寿命模具未经主管签字确认不能排产</span>
      </div>
      <div className="panel">
        <div className="toolbar">
          <span className="hint">试模与排产共享机台/模具时段占用表，撞期会被一并拦下</span>
          <span className="spacer" />
          <button className="primary" onClick={() => setShowCreate(true)}>＋ 新排产</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>模具 / 产品</th><th>机台</th><th>时段</th><th className="num">计划量</th>
              <th>寿命</th><th>超寿命确认</th><th>状态</th><th></th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id}>
                <td><b>{s.mold_code}</b><div className="hint">生产：{s.product_name}</div></td>
                <td>{s.machine_code}</td>
                <td className="nowrap">{fmtDT(s.start_at)} ~ {fmtDT(s.end_at).slice(11)}</td>
                <td className="num">{s.qty ? fmtInt(s.qty) : '—'}</td>
                <td><Badge value={s.life.level} /><span className="hint"> {s.life.percent}%</span></td>
                <td>{s.overlife_confirmed ? <span className="badge green">主管 {s.confirmer} 已确认</span> : '—'}</td>
                <td><Badge value={s.status} /></td>
                <td className="nowrap">
                  {s.status === '已排产' && <>
                    <button className="sm primary" onClick={() => setLogTarget(s)}>记模次</button>{' '}
                    <button className="sm" onClick={() => finish(s)}>完工</button>
                  </>}
                </td>
              </tr>
            ))}
            {schedules.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>暂无排产单</td></tr>}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateScheduleModal molds={molds} machines={machines} onClose={() => setShowCreate(false)}
        onDone={() => { setShowCreate(false); load() }} />}
      {logTarget && <LogCyclesModal schedule={logTarget} onClose={() => { setLogTarget(null); load() }} />}
    </div>
  )
}

function CreateScheduleModal({ molds, machines, onClose, onDone }) {
  const notify = useToast()
  const [moldId, setMoldId] = useState('')
  const [product, setProduct] = useState('')
  const [machineId, setMachineId] = useState('')
  const [start, setStart] = useState(defaultDT(1, 8, 0))
  const [end, setEnd] = useState(defaultDT(1, 17, 0))
  const [qty, setQty] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [confirmer, setConfirmer] = useState('')
  const [busy, setBusy] = useState(false)

  const mold = molds.find((m) => m.id === Number(moldId))

  const submit = async () => {
    setBusy(true)
    try {
      await api.post('/production/schedules', {
        mold_id: Number(moldId), product_name: product, machine_id: Number(machineId),
        start_at: start, end_at: end,
        qty: qty === '' ? null : Number(qty),
        overlife_confirmed: confirmed, confirmer
      })
      notify(mold?.life.level === '超寿命' ? `主管 ${confirmer} 已确认，超寿命排产放行` : '排产成功')
      onDone()
    } catch (e) { notify(errorTip(e), 'err') } finally { setBusy(false) }
  }

  return (
    <Modal title="新排产" onClose={onClose}>
      <div className="form-grid">
        <label className="fld">模具 *
          <select value={moldId} onChange={(e) => {
            setMoldId(e.target.value)
            const m = molds.find((x) => x.id === Number(e.target.value))
            if (m) setProduct(m.product_name)
          }}>
            <option value="">请选择</option>
            {molds.map((m) => <option key={m.id} value={m.id}>
              {m.code} {m.product_name}{m.status !== '在库' ? `（${m.status}）` : ''}
            </option>)}
          </select>
        </label>
        <label className="fld">本次生产产品 *<input value={product} onChange={(e) => setProduct(e.target.value)} /></label>
        <label className="fld">机台 *
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            <option value="">请选择</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.code} {m.name}</option>)}
          </select>
        </label>
        <label className="fld">计划数量（件，整数）<input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label className="fld">开始时间 *<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="fld">结束时间 *<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>

      {mold && (
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="row">
            <span className="hint">寿命：{fmtInt(mold.current_cycles)} / {fmtInt(mold.rated_life)}（{mold.life.percent}%）</span>
            <Badge value={mold.life.level} />
            {mold.open_repair && <Badge value={`改模单 #${mold.open_repair.root_repair_id} ${mold.open_repair.acceptance}`} />}
          </div>

          {mold.life.level === '超寿命' && (
            <div className="alert-banner red">
              <div>
                <b>该模具已超额定寿命，系统默认禁止排产。</b>如必须上机，请由主管核对状态后勾选确认并签字：
                <div className="row" style={{ marginTop: 10 }}>
                  <label className="checkline">
                    <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                    主管确认知悉超寿命风险并批准本次排产
                  </label>
                  <label className="fld" style={{ minWidth: 180 }}>主管姓名 *
                    <input value={confirmer} onChange={(e) => setConfirmer(e.target.value)} placeholder="签字留痕" /></label>
                </div>
              </div>
            </div>
          )}
          {mold.life.level === '预警' && (
            <div className="alert-banner amber" style={{ margin: 0 }}>
              已到 80% 寿命预警线（剩余 {fmtInt(mold.life.remaining)} 模次），可以排产，但请提前安排模具保养/备模。
            </div>
          )}
        </div>
      )}

      <div className="form-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" disabled={busy} onClick={submit}>确认排产</button>
      </div>
    </Modal>
  )
}

function LogCyclesModal({ schedule, onClose }) {
  const notify = useToast()
  const [cycles, setCycles] = useState('')
  const [operator, setOperator] = useState('')
  const submit = async () => {
    try {
      const r = await api.post(`/production/schedules/${schedule.id}/cycles`, {
        cycles: Number(cycles), operator: operator || null
      })
      notify(`已记账，${r.mold.code} 累计 ${r.mold.current_cycles.toLocaleString('zh-CN')}，寿命状态：${r.life.level}`)
      onClose()
    } catch (e) { notify(errorTip(e), 'err') }
  }
  return (
    <Modal title={`记生产模次 — 排产单 #${schedule.id}`} onClose={onClose}>
      <p className="hint">{schedule.mold_code} 在 {schedule.machine_code} 生产「{schedule.product_name}」，
        {fmtDT(schedule.start_at)} ~ {fmtDT(schedule.end_at).slice(11)}</p>
      <div className="form-grid">
        <label className="fld">本次实际模次（正整数）*
          <input type="number" min={1} step={1} value={cycles} onChange={(e) => setCycles(e.target.value)} autoFocus /></label>
        <label className="fld">操作员<input value={operator} onChange={(e) => setOperator(e.target.value)} /></label>
      </div>
      <div className="form-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={submit}>累计入账</button>
      </div>
    </Modal>
  )
}
