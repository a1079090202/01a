// 本地化日期工具：统一存 'YYYY-MM-DD HH:mm[:ss]' 本地时间字符串，
// 定长格式可直接按字典序比较时段先后。

const pad = (n) => String(n).padStart(2, '0')

export function formatLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function nowLocal() {
  return formatLocal(new Date())
}

export function todayLocal() {
  return nowLocal().slice(0, 10)
}

/** datetime-local 输入(YYYY-MM-DDTHH:mm) → 存储格式；已经是空格分隔的原样返回 */
export function normalizeDateTime(s) {
  if (s === null || s === undefined || s === '') return null
  return String(s).replace('T', ' ').slice(0, 16)
}

/** 存储格式 → datetime-local 控件值 */
export function toInputValue(s) {
  if (!s) return ''
  return s.replace(' ', 'T').slice(0, 16)
}

/** 校验合法的 'YYYY-MM-DD HH:mm' 并返回字符串（定长字典序可比） */
export function requireDateTime(s, field = '时间') {
  const v = normalizeDateTime(s)
  if (!v || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) {
    throw new Error(`${field}格式不正确`)
  }
  return v
}
