// 极简 API 封装：失败时抛出带后端中文信息的 Error
async function request(method, url, body) {
  const res = await fetch('/api' + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `请求失败（${res.status}）`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b ?? {})
}

export const fmtInt = (n) => Number(n || 0).toLocaleString('zh-CN')
export const fmtDate = (s) => (s ? String(s).slice(0, 10) : '—')
export const fmtDT = (s) => (s ? String(s).slice(0, 16) : '—')

/** 生成默认 datetime-local 值（本地时间，偏移分钟） */
export function defaultDT(dayOffset = 0, hh = 9, mm = 0) {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hh, mm, 0, 0)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hh)}:${p(mm)}`
}
export function currentMonth() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}`
}
