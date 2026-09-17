// 共享小组件：弹层、状态徽章、寿命条
export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal${wide ? ' wide' : ''}`}>
        <header>
          <h2>{title}</h2>
          <button className="close" onClick={onClose}>×</button>
        </header>
        <div className="body">{children}</div>
      </div>
    </div>
  )
}

const BADGE = {
  // 寿命
  正常: 'green', 预警: 'amber', 超寿命: 'red',
  // 模具状态
  在库: 'green', 试模中: 'blue', 改模中: 'amber', 委外中: 'red', 待验收: 'amber', 生产中: 'blue', 禁用: 'gray',
  // 试模判定
  合格: 'green', 让步接收: 'amber', 不合格: 'red',
  // 验收
  待回厂: 'red',
  // 单据状态
  进行中: 'amber', 已关闭: 'green', 已排产: 'blue', 已完工: 'gray'
}

export function Badge({ value }) {
  if (!value) return <span className="muted">—</span>
  return <span className={`badge ${BADGE[value] || 'gray'}`}>{value}</span>
}

export function LifeBar({ life }) {
  const cls = life.level === '超寿命' ? 'lvl-over' : life.level === '预警' ? 'lvl-warn' : 'lvl-normal'
  const pct = Math.min(100, life.percent)
  return (
    <div className="row" style={{ gap: 8 }}>
      <div className="lifebar"><div className={cls} style={{ width: `${pct}%` }} /></div>
      <span className="hint nowrap">{life.percent}%</span>
    </div>
  )
}

export function errorTip(err) {
  return err?.message || '操作失败'
}
