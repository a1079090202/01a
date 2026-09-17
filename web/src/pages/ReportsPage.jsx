import { useCallback, useEffect, useState } from 'react'
import { api, fmtInt, currentMonth } from '../api.js'
import { useToast } from '../App.jsx'
import { Badge, errorTip } from '../components/ui.jsx'

export default function ReportsPage() {
  const notify = useToast()
  const [month, setMonth] = useState(currentMonth())
  const [data, setData] = useState(null)

  const load = useCallback(async () => {
    setData(await api.get(`/reports/monthly?month=${month}`))
  }, [month])
  useEffect(() => { load().catch((e) => notify(errorTip(e), 'err')) }, [load, notify])

  if (!data) return null
  const t = data.totals
  const hasActivity = (r) => r.trial_count + r.repair_rounds + r.month_cycles > 0

  return (
    <div>
      <div className="page-title">月度统计
        <span className="page-sub">按模具汇总试模次数、不合格次数、改模单与改模轮次、当月生产模次</span>
      </div>

      <div className="panel">
        <div className="toolbar">
          <label className="fld" style={{ minWidth: 170 }}>统计月份
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
          <span className="hint">生成于 {data.generated_at}</span>
          <span className="spacer" />
          <button onClick={() => window.print()}>🖨 打印 / 另存 PDF</button>
        </div>

        <div className="kpi-grid" style={{ marginBottom: 16 }}>
          <div className="kpi blue"><div className="v">{t.trial_count}</div><div className="k">当月试模总次数</div></div>
          <div className="kpi red"><div className="v">{t.ng_count}</div><div className="k">其中不合格次数</div></div>
          <div className="kpi amber"><div className="v">{t.repair_orders}</div><div className="k">新开改模单（张）</div></div>
          <div className="kpi amber"><div className="v">{t.repair_rounds}</div><div className="k">改模轮次合计（含退回重改）</div></div>
          <div className="kpi"><div className="v">{fmtInt(t.month_cycles)}</div><div className="k">当月生产模次</div></div>
        </div>

        <table>
          <thead>
            <tr>
              <th>模具编号</th><th>对应产品</th><th className="num">型腔</th>
              <th className="num">试模次数</th><th className="num">不合格</th>
              <th className="num">改模单</th><th className="num">改模轮次</th>
              <th className="num">当月模次</th>
              <th className="num">累计/额定</th><th>寿命</th>
            </tr>
          </thead>
          <tbody>
            {data.molds.map((r) => {
              const ratio = r.rated_life > 0 ? r.current_cycles / r.rated_life : 0
              const level = ratio >= 1 ? '超寿命' : ratio >= 0.8 ? '预警' : '正常'
              return (
                <tr key={r.id} style={{ opacity: hasActivity(r) ? 1 : 0.55 }}>
                  <td><b>{r.code}</b></td>
                  <td>{r.product_name}</td>
                  <td className="num">{r.cavities}</td>
                  <td className="num">{r.trial_count}</td>
                  <td className="num">{r.ng_count > 0 ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>{r.ng_count}</span> : 0}</td>
                  <td className="num">{r.repair_orders}</td>
                  <td className="num">{r.repair_rounds}</td>
                  <td className="num">{fmtInt(r.month_cycles)}</td>
                  <td className="num nowrap">{fmtInt(r.current_cycles)} / {fmtInt(r.rated_life)}</td>
                  <td><Badge value={level} /></td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="totals-row">
              <td colSpan={3}>合计（{data.molds.length} 副模具）</td>
              <td className="num">{t.trial_count}</td>
              <td className="num">{t.ng_count}</td>
              <td className="num">{t.repair_orders}</td>
              <td className="num">{t.repair_rounds}</td>
              <td className="num">{fmtInt(t.month_cycles)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
        <p className="hint" style={{ marginTop: 12 }}>
          说明：改模单按当月开单计数；一张改模单验收不合格退回重改会产生多轮，故“改模轮次”可能大于“改模单”。
          灰行表示当月无试模/改模/生产活动。
        </p>
      </div>
    </div>
  )
}
