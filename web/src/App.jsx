import { createContext, useCallback, useContext, useState } from 'react'
import { NavLink, Route, Routes, Navigate } from 'react-router-dom'
import MoldsPage from './pages/MoldsPage.jsx'
import TrialsPage from './pages/TrialsPage.jsx'
import RepairsPage from './pages/RepairsPage.jsx'
import ProductionPage from './pages/ProductionPage.jsx'
import ReportsPage from './pages/ReportsPage.jsx'

const ToastCtx = createContext(null)
export const useToast = () => useContext(ToastCtx)

function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const notify = useCallback((message, kind = 'ok') => {
    setToast({ message, kind })
    setTimeout(() => setToast(null), 3200)
  }, [])
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
    </ToastCtx.Provider>
  )
}

const NAV = [
  { to: '/molds', label: '模具台账' },
  { to: '/trials', label: '试模排程' },
  { to: '/repairs', label: '改模单' },
  { to: '/production', label: '生产排产' },
  { to: '/reports', label: '月度统计' }
]

export default function App() {
  return (
    <ToastProvider>
      <div className="topbar">
        <h1>🔧 注塑车间模具台账</h1>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to}
              className={({ isActive }) => (isActive ? 'active' : '')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="container">
        <Routes>
          <Route path="/" element={<Navigate to="/molds" replace />} />
          <Route path="/molds" element={<MoldsPage />} />
          <Route path="/trials" element={<TrialsPage />} />
          <Route path="/repairs" element={<RepairsPage />} />
          <Route path="/production" element={<ProductionPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="*" element={<Navigate to="/molds" replace />} />
        </Routes>
      </div>
    </ToastProvider>
  )
}
