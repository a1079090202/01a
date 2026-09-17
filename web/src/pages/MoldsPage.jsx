import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, fmtInt, fmtDT } from '../api.js'
import { useToast } from '../App.jsx'
import { Badge, LifeBar, Modal, errorTip } from '../components/ui.jsx'

export default function MoldsPage() {
  const notify = useToast()
  const [molds, setMolds] = useState([])
  const [alerts, setAlerts] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [cycleTarget, setCycleTarget] = useState(null)
  const [detail, setDetail] = useState(null)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    const [ms, al] = await Promise.all([api.get('/molds'), api.get('/reports/alerts')])
    setMolds(ms); setAlerts(al)
  }, [])
  useEffect(() => { load().catch((e) => notify(errorTip(e), 'err')) }, [load, notify])

  const filtered = useMemo(() => {
    const k = q.trim()
    if (!k) return molds
    return molds.filter((m) => m.code.includes(k) || m.product_name.includes(k))
  }, [molds, q])

  const overCount = alerts.filter((m) => m.life.level === '超寿命').length

  return (
    <div>
      <div className="page-title">模具台账
        <span className="page-sub">共 {molds.length} 副模具 · 寿命预警 {alerts.length} 副（超寿命 {overCount} 副）</span>
      </div>

      {alerts.length > 0 && (
        <div className={`alert-banner ${overCount ? 'red' : 'amber'}`}>
          <span>⚠️</span>
          <div>
            {alerts.slice(0, 4).map((m) => (
              <span key={m.id} style={{ marginRight: 18 }}>
                <b>{m.code}</b>（{m.product_name}）当前 {fmtInt(m.current_cycles)} / {fmtInt(m.rated_life)}，
                {m.life.level === '超寿命'
                  ? <>已超寿命，<b>未经主管确认不能排产</b></>
                  : <>剩余 {fmtInt(m.life.remaining)} 模次到寿，已到 80% 预警线</>}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="toolbar">
          <input style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6, width: 220 }}
            placeholder="搜编号 / 产品名" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="spacer" />
          <button className="primary" onClick={() => setShowCreate(true)}>＋ 登记新模具</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>模具编号</th><th>对应产品</th><th className="num">型腔数</th>
              <th className="num">额定寿命</th><th className="num">当前模次</th>
              <th style={{ width: 190 }}>寿命进度</th><th>状态</th><th>改模单</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.id}>
                <td className="clickable" onClick={() => setDetail(m)}><b>{m.code}</b></td>
                <td>{m.product_name}</td>
                <td className="num">{m.cavities}</td>
                <td className="num">{fmtInt(m.rated_life)}</td>
                <td className="num">{fmtInt(m.current_cycles)}</td>
                <td><LifeBar life={m.life} />
                  <span className="hint">
                    {m.life.level === '超寿命'
                      ? `已超 ${fmtInt(-m.life.remaining)} 模次`
                      : `剩 ${fmtInt(m.life.remaining)}（${m.life.warnAt.toLocaleString('zh-CN')} 预警）`}
                  </span>
                </td>
                <td><Badge value={m.status} /></td>
                <td>{m.open_repair
                  ? <Badge value={`#${m.open_repair.root_repair_id} 第${m.open_repair.round_no}轮 ${m.open_repair.acceptance}`} />
                  : <span className="muted">无</span>}</td>
                <td className="nowrap">
                  <button className="sm" onClick={() => setDetail(m)}>详情</button>{' '}
                  <button className="sm primary" onClick={() => setCycleTarget(m)}>记模次</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 24 }}>没有匹配的模具</td></tr>}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateMoldModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load() }} />}
      {cycleTarget && <CycleModal mold={cycleTarget} onClose={() => setCycleTarget(null)}
        onDone={() => { setCycleTarget(null); load() }} />}
      {detail && <DetailModal mold={detail} onClose={() => setDetail(null)}
        onChanged={() => { setDetail(null); load() }} />}
    </div>
  )
}

function CreateMoldModal({ onClose, onDone }) {
  const notify = useToast()
  const [f, setF] = useState({ code: '', product_name: '', cavities: '', rated_life: '', current_cycles: 0, note: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async () => {
    try {
      await api.post('/molds', {
        code: f.code, product_name: f.product_name,
        cavities: Number(f.cavities), rated_life: Number(f.rated_life),
        current_cycles: f.current_cycles === '' ? 0 : Number(f.current_cycles),
        note: f.note || null
      })
      notify('模具已登记')
      onDone()
    } catch (e) { notify(errorTip(e), 'err') }
  }
  return (
    <Modal title="登记新模具" onClose={onClose}>
      <div className="form-grid">
        <label className="fld">模具编号 *<input value={f.code} onChange={set('code')} placeholder="如 MJ-1009" /></label>
        <label className="fld">对应产品 *<input value={f.product_name} onChange={set('product_name')} placeholder="如 前保险杠" /></label>
        <label className="fld">型腔数 *<input type="number" min={1} value={f.cavities} onChange={set('cavities')} /></label>
        <label className="fld">额定模次寿命 *<input type="number" min={1} value={f.rated_life} onChange={set('rated_life')} /></label>
        <label className="fld">当前模次（老模具带入，整数）<input type="number" min={0} step={1} value={f.current_cycles} onChange={set('current_cycles')} /></label>
        <label className="fld" style={{ gridColumn: '1 / -1' }}>备注<input value={f.note} onChange={set('note')} /></label>
      </div>
      <div className="form-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={submit}>保存</button>
      </div>
    </Modal>
  )
}

function CycleModal({ mold, onClose, onDone }) {
  const notify = useToast()
  const [cycles, setCycles] = useState('')
  const [operator, setOperator] = useState('')
  const [note, setNote] = useState('')
  const [logs, setLogs] = useState([])

  useEffect(() => {
    api.get(`/molds/${mold.id}/logs`).then(setLogs).catch(() => {})
  }, [mold.id])

  const submit = async () => {
    try {
      const r = await api.post(`/molds/${mold.id}/cycles`, {
        cycles: Number(cycles), operator: operator || null, note: note || null
      })
      notify(`已记账 ${Number(cycles).toLocaleString('zh-CN')} 模次，累计 ${r.mold.current_cycles.toLocaleString('zh-CN')}，寿命状态：${r.life.level}`)
      onDone()
    } catch (e) { notify(errorTip(e), 'err') }
  }

  return (
    <Modal title={`记实际生产模次 — ${mold.code}（${mold.product_name}）`} onClose={onClose} wide>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <span>当前累计 <b style={{ fontSize: 18 }}>{fmtInt(mold.current_cycles)}</b> / {fmtInt(mold.rated_life)}（预警线 {fmtInt(mold.life.warnAt)}）</span>
        <Badge value={mold.life.level} />
      </div>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="fld">本次模次（正整数）*
          <input type="number" min={1} step={1} value={cycles} onChange={(e) => setCycles(e.target.value)} autoFocus /></label>
        <label className="fld">操作员<input value={operator} onChange={(e) => setOperator(e.target.value)} /></label>
        <label className="fld" style={{ gridColumn: '1 / -1' }}>说明<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如 夜班实际生产" /></label>
      </div>
      {mold.life.level === '超寿命' && (
        <div className="alert-banner red" style={{ marginTop: 12 }}>该模具已超额定寿命，记账不拦截，但新开排产必须主管确认。</div>
      )}
      <div className="form-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={submit}>累计入账</button>
      </div>

      <h3 style={{ marginTop: 18 }}>模次流水（近 {logs.length} 笔）</h3>
      <table>
        <thead><tr><th>时间</th><th className="num">本次模次</th><th>操作员</th><th>说明</th></tr></thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td className="nowrap">{fmtDT(l.produced_at)}</td>
              <td className="num">{l.cycles === 0 ? '校准' : '+' + fmtInt(l.cycles)}</td>
              <td>{l.operator || '—'}</td>
              <td className="muted">{l.note || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}

function DetailModal({ mold, onClose, onChanged }) {
  const notify = useToast()
  const [trials, setTrials] = useState([])
  const [logs, setLogs] = useState([])
  useEffect(() => {
    Promise.all([api.get(`/molds/${mold.id}/trials`), api.get(`/molds/${mold.id}/logs?limit=8`)])
      .then(([t, l]) => { setTrials(t); setLogs(l) })
      .catch((e) => notify(errorTip(e), 'err'))
  }, [mold.id, notify])

  return (
    <Modal title={`${mold.code} · ${mold.product_name}`} onClose={onClose} wide>
      <div className="kpi-grid">
        <div className="kpi"><div className="v">{m.cavities}</div><div className="k">型腔数</div></div>
        <div className="kpi blue"><div className="v">{fmtInt(m.rated_life)}</div><div className="k">额定寿命（模次）</div></div>
        <div className={`kpi ${mold.life.level === '超寿命' ? 'red' : mold.life.level === '预警' ? 'amber' : ''}`}>
          <div className="v">{fmtInt(mold.current_cycles)}</div><div className="k">当前模次（{mold.life.percent}%）</div></div>
        <div className="kpi"><div className="v" style={{ fontSize: 16 }}><Badge value={mold.status} /></div><div className="k">当前状态</div></div>
      </div>
      {mold.note && <p className="hint" style={{ marginTop: 12 }}>备注：{mold.note}</p>}

      <h3 style={{ marginTop: 18 }}>试模记录（{trials.length} 次）</h3>
      <table>
        <thead><tr><th className="num">次数</th><th>机台</th><th>时段</th><th>判定</th><th>问题</th></tr></thead>
        <tbody>
          {trials.map((t) => (
            <tr key={t.id}>
              <td className="num">第 {t.trial_no} 次</td>
              <td>{t.machine_code}</td>
              <td className="nowrap">{fmtDT(t.start_at)} ~ {fmtDT(t.end_at).slice(11)}</td>
              <td>{t.result ? <Badge value={t.result} /> : <span className="muted">待判定</span>}</td>
              <td className="muted">{t.problem || ''}</td>
            </tr>
          ))}
          {trials.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>暂无试模</td></tr>}
        </tbody>
      </table>

      <h3 style={{ marginTop: 18 }}>近期生产模次</h3>
      <table>
        <thead><tr><th>时间</th><th className="num">模次</th><th>操作员</th><th>说明</th></tr></thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td>{fmtDT(l.produced_at)}</td>
              <td className="num">{l.cycles === 0 ? '校准' : '+' + fmtInt(l.cycles)}</td>
              <td>{l.operator || '—'}</td>
              <td className="muted">{l.note || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-actions"><button onClick={onClose}>关闭</button></div>
    </Modal>
  )
}
