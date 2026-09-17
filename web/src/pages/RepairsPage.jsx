import { useCallback, useEffect, useState } from 'react'
import { api, fmtDate, defaultDT } from '../api.js'
import { useToast } from '../App.jsx'
import { Badge, Modal, errorTip } from '../components/ui.jsx'

export default function RepairsPage() {
  const notify = useToast()
  const [repairs, setRepairs] = useState([])
  const [molds, setMolds] = useState([])
  const [openOnly, setOpenOnly] = useState(true)
  const [detailId, setDetailId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    const [rs, ms] = await Promise.all([
      api.get(`/repairs?${openOnly ? 'open=1' : ''}`),
      api.get('/molds')
    ])
    setRepairs(rs); setMolds(ms)
  }, [openOnly])
  useEffect(() => { load().catch((e) => notify(errorTip(e), 'err')) }, [load, notify])

  const openDetail = async (id) => {
    setDetailId(id)
    try { setDetail(await api.get(`/repairs/${id}`)) }
    catch (e) { notify(errorTip(e), 'err'); setDetailId(null) }
  }
  const refreshDetail = async (newId) => {
    const id = newId ?? detailId
    if (newId) setDetailId(newId)
    setDetail(await api.get(`/repairs/${id}`))
    await load()
  }

  return (
    <div>
      <div className="page-title">改模单
        <span className="page-sub">委外回厂必须验收：合格关单，不合格退回重改并累计改模轮次；未关单不能试模/排产</span>
      </div>
      <div className="panel">
        <div className="toolbar">
          <label className="checkline">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            只看进行中
          </label>
          <span className="spacer" />
          <button onClick={() => setShowCreate(true)}>手工开改模单</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>单号</th><th>模具 / 产品</th><th className="num">当前/总轮次</th>
              <th>类型</th><th>委外厂家</th><th>送修</th><th>回厂</th>
              <th>验收状态</th><th>单据</th><th></th>
            </tr>
          </thead>
          <tbody>
            {repairs.map((r) => (
              <tr key={r.id}>
                <td><b>#{r.root_repair_id}</b></td>
                <td>{r.mold_code}<div className="hint">{r.product_name}</div></td>
                <td className="num">第 {r.current_round} 轮 / 共 {r.total_rounds} 轮</td>
                <td>{r.repair_type}</td>
                <td>{r.vendor || '—'}</td>
                <td>{fmtDate(r.send_date)}</td>
                <td>{fmtDate(r.return_date)}</td>
                <td><Badge value={r.status === '已关闭' ? '合格' : r.acceptance} /></td>
                <td><Badge value={r.status} /></td>
                <td><button className="sm" onClick={() => openDetail(r.current_id)}>处理 / 查看</button></td>
              </tr>
            ))}
            {repairs.length === 0 && <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 24 }}>没有进行中的改模单</td></tr>}
          </tbody>
        </table>
      </div>

      {detail && (
        <RepairDetailModal key={detail.current_id} detail={detail} onClose={() => { setDetail(null); setDetailId(null); load() }}
          onChanged={refreshDetail} />
      )}
      {showCreate && <CreateRepairModal molds={molds} onClose={() => setShowCreate(false)}
        onDone={() => { setShowCreate(false); load() }} />}
    </div>
  )
}

function RoundTimeline({ detail }) {
  return (
    <ul className="rounds">
      {detail.rounds.map((r) => {
        const isCurrent = r.id === detail.current_id
        const cls = isCurrent && detail.group_open ? 'cur'
          : r.status === '已关闭' && r.acceptance === '合格' ? 'ok'
          : r.acceptance === '不合格' ? 'bad' : 'cur'
        return (
          <li key={r.id} className={cls}>
            <b>第 {r.round_no} 轮 · {r.repair_type}{r.vendor ? ` · ${r.vendor}` : ''}</b>{' '}
            {isCurrent && detail.group_open && <span className="badge blue">当前有效轮</span>}{' '}
            <Badge value={r.acceptance} />
            <div className="round-meta">
              送修 {fmtDate(r.send_date)} ｜ 回厂 {fmtDate(r.return_date)}
              {r.acceptor ? <> ｜ 验收人 {r.acceptor}（{String(r.accepted_at || '').slice(0, 16)}）</> : null}
            </div>
            {r.problem && <div className="hint" style={{ marginTop: 3 }}>{r.problem}</div>}
          </li>
        )
      })}
    </ul>
  )
}

function RepairDetailModal({ detail, onClose, onChanged }) {
  const notify = useToast()
  const cur = detail // 详情主体始终是当前轮（接口按 current id 打开）
  const closed = cur.status === '已关闭'
  const [returnDate, setReturnDate] = useState(defaultDT(0, 9).slice(0, 10))
  const [acceptor, setAcceptor] = useState('')
  const [ngProblem, setNgProblem] = useState('')
  const [rwType, setRwType] = useState(cur.repair_type)
  const [rwVendor, setRwVendor] = useState(cur.vendor || '')

  const doReturn = async () => {
    try { await api.post(`/repairs/${cur.id}/return`, { return_date: returnDate || null })
      notify('回厂已登记，状态变为待验收'); await onChanged()
    } catch (e) { notify(errorTip(e), 'err') }
  }
  const doAccept = async (passed) => {
    try {
      await api.post(`/repairs/${cur.id}/accept`, {
        passed, acceptor, problem: ngProblem || null
      })
      notify(passed ? '验收合格，改模单已关闭，模具回在库' : '已记录验收不合格，请安排退回重改')
      await onChanged()
    } catch (e) { notify(errorTip(e), 'err') }
  }
  const doRework = async () => {
    try {
      const r = await api.post(`/repairs/${cur.id}/rework`, {
        repair_type: rwType, vendor: rwVendor || null
      })
      notify(`已退回重改，开出第 ${r.round_no} 轮`)
      await onChanged(r.id)
    } catch (e) { notify(errorTip(e), 'err') }
  }

  return (
    <Modal title={`改模单 #${detail.root_repair_id} · ${detail.mold_code}（${detail.product_name}）`}
      onClose={onClose} wide>
      <RoundTimeline detail={detail} />

      {detail.requested_id && detail.requested_id !== detail.current_id && (
        <div className="alert-banner amber" style={{ marginTop: 12 }}>
          你打开的第 {detail.rounds.find((r) => r.id === detail.requested_id)?.round_no} 轮已结束（验收不合格已退回重改），
          以下操作区已自动定位到<b>当前有效任务：第 {detail.current_round} 轮</b>。
        </div>
      )}

      {!closed && (
        <div className="panel" style={{ background: '#f7f9fc', marginTop: 14 }}>
          {cur.acceptance === '待回厂' && (
            <div className="stack">
              <div className="alert-banner amber" style={{ margin: 0 }}>
                该轮正在{cur.repair_type === '委外' ? '委外' : '厂内'}送修，未回厂。回厂前试模与排产都会被拦截。
              </div>
              {cur.repair_type === '委外' && (
                <div className="row">
                  <label className="fld" style={{ minWidth: 180 }}>回厂日期
                    <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} /></label>
                  <button className="primary" onClick={doReturn}>登记回厂（→ 待验收）</button>
                </div>
              )}
            </div>
          )}

          {cur.acceptance === '待验收' && (
            <div className="stack">
              <div className="alert-banner amber" style={{ margin: 0 }}>
                已回厂，<b>必须验收合格才关单</b>；不验收则该模具无法试模、无法排产。
              </div>
              <label className="fld" style={{ maxWidth: 260 }}>验收人 *<input value={acceptor} onChange={(e) => setAcceptor(e.target.value)} placeholder="谁验收谁签字" /></label>
              <label className="fld">不合格说明（判不合格时填）<textarea rows={2} value={ngProblem} onChange={(e) => setNgProblem(e.target.value)} /></label>
              <div className="row">
                <button className="success" onClick={() => doAccept(true)} disabled={!acceptor.trim()}>✓ 验收合格，关单</button>
                <button className="danger" onClick={() => doAccept(false)} disabled={!acceptor.trim()}>✗ 验收不合格</button>
              </div>
            </div>
          )}

          {cur.acceptance === '不合格' && (
            <div className="stack">
              <div className="alert-banner red" style={{ margin: 0 }}>
                本轮验收不合格，请退回重改；提交后自动开出第 {cur.round_no + 1} 轮。
              </div>
              <div className="row">
                <label className="fld" style={{ minWidth: 140 }}>重改类型
                  <select value={rwType} onChange={(e) => setRwType(e.target.value)}>
                    <option value="委外">委外</option><option value="厂内">厂内</option>
                  </select>
                </label>
                {rwType === '委外' && (
                  <label className="fld" style={{ minWidth: 220 }}>委外厂家
                    <input value={rwVendor} onChange={(e) => setRwVendor(e.target.value)} /></label>
                )}
                <button className="primary" onClick={doRework}>退回重改，开第 {cur.round_no + 1} 轮</button>
              </div>
            </div>
          )}
        </div>
      )}
      {closed && <p className="hint" style={{ marginTop: 12 }}>该改模单已关闭。</p>}
    </Modal>
  )
}

function CreateRepairModal({ molds, onClose, onDone }) {
  const notify = useToast()
  const [moldId, setMoldId] = useState('')
  const [type, setType] = useState('委外')
  const [vendor, setVendor] = useState('')
  const [problem, setProblem] = useState('')

  const submit = async () => {
    try {
      // 手工开单走「先建一次无判定的试模再判不合格」太重，这里直接借判定接口不合适：
      // 后端未暴露独立开单端点，改由请求改模列表接口无对应——故用内部约定：直接 POST /trials/judge 不适用。
      // 实际通过新增一个仅开单的接口（见 /api/repairs/open）。
      const r = await api.post('/repairs/open', {
        mold_id: Number(moldId), repair_type: type,
        vendor: vendor || null, problem: problem || null
      })
      notify(`已开改模单 #${r.root_repair_id} 第 1 轮`)
      onDone()
    } catch (e) { notify(errorTip(e), 'err') }
  }
  return (
    <Modal title="手工开改模单" onClose={onClose}>
      <div className="form-grid">
        <label className="fld">模具 *
          <select value={moldId} onChange={(e) => setMoldId(e.target.value)}>
            <option value="">请选择</option>
            {molds.map((m) => <option key={m.id} value={m.id}>{m.code} {m.product_name}</option>)}
          </select>
        </label>
        <label className="fld">改模类型 *
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="委外">委外</option><option value="厂内">厂内</option>
          </select>
        </label>
        {type === '委外' && <label className="fld">委外厂家 *<input value={vendor} onChange={(e) => setVendor(e.target.value)} /></label>}
        <label className="fld" style={{ gridColumn: '1 / -1' }}>问题描述<textarea rows={2} value={problem} onChange={(e) => setProblem(e.target.value)} /></label>
      </div>
      <div className="form-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={submit}>开单</button>
      </div>
    </Modal>
  )
}
