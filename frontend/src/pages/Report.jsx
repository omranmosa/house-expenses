import { useState, useMemo } from 'react'
import { format, parseISO, startOfMonth, endOfMonth, subMonths, isWithinInterval } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from 'recharts'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const HOUSEHOLD_SIZE = 5
const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

export default function Report() {
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [authError, setAuthError] = useState(false)
  const [receipts, setReceipts] = useState([])
  const [groceryInventory, setGroceryInventory] = useState([])
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState('')
  const [tab, setTab] = useState('overview') // overview, workers, groceries
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('date-desc')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterWorker, setFilterWorker] = useState('')

  async function handleLogin() {
    setLoading(true)
    setAuthError(false)
    try {
      const res = await fetch(`${API_URL}/api/receipts`, {
        headers: { Authorization: `Bearer ${password}` },
      })
      if (!res.ok) { setAuthError(true); return }
      const data = await res.json()
      setReceipts(data)
      setToken(password)
      setAuthed(true)
      const gRes = await fetch(`${API_URL}/api/groceries/items`, {
        headers: { Authorization: `Bearer ${password}` },
      })
      if (gRes.ok) {
        const gData = await gRes.json()
        setGroceryInventory(gData.inventory || [])
      }
    } catch {
      setAuthError(true)
    } finally {
      setLoading(false)
    }
  }

  // Filtered receipts
  const filtered = useMemo(() => {
    let list = [...receipts]
    if (dateFrom) list = list.filter(r => r.date >= dateFrom)
    if (dateTo) list = list.filter(r => r.date <= dateTo)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        (r.store || '').toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q) ||
        (r.category || '').toLowerCase().includes(q)
      )
    }
    if (filterCategory) list = list.filter(r => r.category === filterCategory)
    if (filterWorker) list = list.filter(r => r.worker === filterWorker)
    // Sort
    list.sort((a, b) => {
      switch (sortBy) {
        case 'date-asc': return (a.date || '').localeCompare(b.date || '')
        case 'date-desc': return (b.date || '').localeCompare(a.date || '')
        case 'total-asc': return Number(a.total) - Number(b.total)
        case 'total-desc': return Number(b.total) - Number(a.total)
        case 'store': return (a.store || '').localeCompare(b.store || '')
        default: return 0
      }
    })
    return list
  }, [receipts, dateFrom, dateTo, search, sortBy, filterCategory, filterWorker])

  // All categories in data
  const allCategories = useMemo(() => [...new Set(receipts.map(r => r.category).filter(Boolean))], [receipts])

  // Spike detection
  function detectSpikes(list) {
    const spikes = {}
    const byWorkerCategory = {}
    const sorted = [...receipts].sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at))
    for (const r of sorted) {
      const key = `${r.worker}:${r.category}`
      if (!byWorkerCategory[key]) byWorkerCategory[key] = []
      byWorkerCategory[key].push(r)
    }
    for (const r of list) {
      const key = `${r.worker}:${r.category}`
      const history = (byWorkerCategory[key] || []).filter(h => h.id !== r.id && new Date(h.submitted_at) < new Date(r.submitted_at))
      if (history.length < 2) continue
      if (r.category === 'Groceries') {
        const perPerson = Number(r.total) / HOUSEHOLD_SIZE
        const avgPerPerson = history.reduce((s, h) => s + Number(h.total) / HOUSEHOLD_SIZE, 0) / history.length
        const itemCount = Array.isArray(r.items) ? r.items.length : 0
        if (itemCount >= 10) continue
        if (perPerson > avgPerPerson * 1.6) {
          spikes[r.id] = { type: 'grocery', perPerson: perPerson.toFixed(2), avgPerPerson: avgPerPerson.toFixed(2) }
        }
      } else {
        const avg = history.reduce((s, h) => s + Number(h.total), 0) / history.length
        if (Number(r.total) > avg * 1.5) {
          spikes[r.id] = { type: 'other', total: Number(r.total).toFixed(2), avg: avg.toFixed(2) }
        }
      }
    }
    return spikes
  }

  // Chart data
  const spendingOverTime = useMemo(() => {
    const map = {}
    for (const r of filtered) {
      const month = r.date ? r.date.substring(0, 7) : 'Unknown'
      if (!map[month]) map[month] = { month, total: 0, 'تحسين': 0, Biswajit: 0 }
      map[month].total += Number(r.total)
      map[month][r.worker] = (map[month][r.worker] || 0) + Number(r.total)
    }
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month))
  }, [filtered])

  const categoryPieData = useMemo(() => {
    const map = {}
    for (const r of filtered) {
      map[r.category] = (map[r.category] || 0) + Number(r.total)
    }
    return Object.entries(map).map(([name, value]) => ({ name, value: +value.toFixed(2) }))
  }, [filtered])

  const authorizerSummary = useMemo(() => {
    const map = {}
    for (const r of filtered) {
      if (!map[r.authorizer]) map[r.authorizer] = { name: r.authorizer, total: 0, count: 0, categories: {} }
      map[r.authorizer].total += Number(r.total)
      map[r.authorizer].count += 1
      map[r.authorizer].categories[r.category] = (map[r.authorizer].categories[r.category] || 0) + Number(r.total)
    }
    return Object.values(map)
  }, [filtered])

  // Month-over-month
  const monthOverMonth = useMemo(() => {
    if (filtered.length === 0) return null
    const now = new Date()
    const thisMonth = { start: startOfMonth(now), end: endOfMonth(now) }
    const lastMonth = { start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) }
    const thisMonthTotal = receipts.filter(r => r.date && isWithinInterval(parseISO(r.date), thisMonth)).reduce((s, r) => s + Number(r.total), 0)
    const lastMonthTotal = receipts.filter(r => r.date && isWithinInterval(parseISO(r.date), lastMonth)).reduce((s, r) => s + Number(r.total), 0)
    const change = lastMonthTotal > 0 ? ((thisMonthTotal - lastMonthTotal) / lastMonthTotal * 100) : 0
    return {
      thisMonth: thisMonthTotal,
      lastMonth: lastMonthTotal,
      change,
      thisLabel: format(now, 'MMM yyyy'),
      lastLabel: format(subMonths(now, 1), 'MMM yyyy'),
    }
  }, [receipts])

  // CSV export
  function exportCSV() {
    const headers = ['Date', 'Worker', 'Authorizer', 'Store', 'Category', 'Total (SAR)', 'Notes']
    const rows = filtered.map(r => [r.date, r.worker, r.authorizer, r.store, r.category, r.total, (r.notes || '').replace(/,/g, ';')])
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `expenses-${dateFrom || 'all'}-to-${dateTo || 'all'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // PDF export (print-friendly)
  function exportPDF() {
    window.print()
  }

  function toggleExpand(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  if (!authed) {
    return (
      <div className="worker-ui">
        <h1>Manager Report</h1>
        <div className="section">
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()} className="password-input" placeholder="Enter password" />
          <button className="submit-btn" onClick={handleLogin} disabled={loading}>
            {loading ? 'Verifying...' : 'Login'}
          </button>
          {authError && <div className="msg error">Invalid password</div>}
        </div>
      </div>
    )
  }

  const spikes = detectSpikes(filtered)
  const grandTotal = filtered.reduce((s, r) => s + Number(r.total), 0)
  const workers = ['تحسين', 'Biswajit']

  return (
    <div className="report-ui">
      <h1>Expense Report</h1>

      {/* Tabs */}
      <div className="tabs">
        {[['overview', 'Overview'], ['workers', 'By Worker'], ['groceries', 'Grocery Tracker']].map(([key, label]) => (
          <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {/* Filters bar */}
      <div className="filters-bar">
        <div className="filter-row">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="filter-input" placeholder="From" />
          <span className="filter-sep">to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="filter-input" />
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="filter-input">
            <option value="">All Categories</option>
            {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterWorker} onChange={e => setFilterWorker(e.target.value)} className="filter-input">
            <option value="">All Workers</option>
            {workers.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div className="filter-row">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} className="filter-input search"
            placeholder="Search store, notes, category..." />
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="filter-input">
            <option value="date-desc">Newest first</option>
            <option value="date-asc">Oldest first</option>
            <option value="total-desc">Highest amount</option>
            <option value="total-asc">Lowest amount</option>
            <option value="store">Store A-Z</option>
          </select>
          <button className="export-btn" onClick={exportCSV}>Export CSV</button>
          <button className="export-btn" onClick={exportPDF}>Print / PDF</button>
        </div>
        {(dateFrom || dateTo || search || filterCategory || filterWorker) && (
          <div className="filter-row">
            <span className="filter-count">{filtered.length} of {receipts.length} receipts</span>
            <button className="clear-btn" onClick={() => { setDateFrom(''); setDateTo(''); setSearch(''); setFilterCategory(''); setFilterWorker('') }}>
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* ===== OVERVIEW TAB ===== */}
      {tab === 'overview' && (
        <>
          {/* KPI Cards */}
          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-label">Total Spent</div>
              <div className="kpi-value">SAR {grandTotal.toFixed(2)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Receipts</div>
              <div className="kpi-value">{filtered.length}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Avg per Receipt</div>
              <div className="kpi-value">SAR {filtered.length ? (grandTotal / filtered.length).toFixed(2) : '0.00'}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Spikes Detected</div>
              <div className="kpi-value spike-count">{Object.keys(spikes).length}</div>
            </div>
          </div>

          {/* Month-over-month */}
          {monthOverMonth && monthOverMonth.lastMonth > 0 && (
            <div className="mom-card">
              <h3>Month-over-Month</h3>
              <div className="mom-row">
                <div className="mom-item">
                  <div className="mom-label">{monthOverMonth.lastLabel}</div>
                  <div className="mom-val">SAR {monthOverMonth.lastMonth.toFixed(2)}</div>
                </div>
                <div className="mom-arrow">{monthOverMonth.change >= 0 ? '↑' : '↓'}</div>
                <div className="mom-item">
                  <div className="mom-label">{monthOverMonth.thisLabel}</div>
                  <div className="mom-val">SAR {monthOverMonth.thisMonth.toFixed(2)}</div>
                </div>
                <div className={`mom-change ${monthOverMonth.change >= 0 ? 'up' : 'down'}`}>
                  {monthOverMonth.change >= 0 ? '+' : ''}{monthOverMonth.change.toFixed(1)}%
                </div>
              </div>
            </div>
          )}

          {/* Charts */}
          <div className="charts-row">
            <div className="chart-card">
              <h3>Spending Over Time</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={spendingOverTime}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={v => `SAR ${v.toFixed(2)}`} />
                  <Legend />
                  <Bar dataKey="تحسين" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Biswajit" fill="#16a34a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-card">
              <h3>By Category</h3>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={categoryPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={100}
                    paddingAngle={2} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                    {categoryPieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={v => `SAR ${v}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Spending trend line */}
          {spendingOverTime.length > 1 && (
            <div className="chart-card full-width">
              <h3>Spending Trend</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={spendingOverTime}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={v => `SAR ${v.toFixed(2)}`} />
                  <Line type="monotone" dataKey="total" stroke="#8b5cf6" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Authorizer Summary */}
          {authorizerSummary.length > 0 && (
            <div className="auth-summary">
              <h3>By Authorizer</h3>
              <div className="auth-cards">
                {authorizerSummary.map(a => (
                  <div key={a.name} className="auth-card">
                    <div className="auth-name">{a.name}</div>
                    <div className="auth-total">SAR {a.total.toFixed(2)} ({a.count} receipts)</div>
                    <div className="pills" style={{ marginTop: 8 }}>
                      {Object.entries(a.categories).map(([cat, amt]) => (
                        <span key={cat} className="pill cat" style={{ fontSize: 11 }}>{cat}: SAR {amt.toFixed(2)}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ===== WORKERS TAB ===== */}
      {tab === 'workers' && workers.map(w => {
        const wReceipts = filtered.filter(r => r.worker === w)
        if (filterWorker && filterWorker !== w) return null
        const wTotal = wReceipts.reduce((s, r) => s + Number(r.total), 0)
        const cats = {}
        wReceipts.forEach(r => { cats[r.category] = (cats[r.category] || 0) + Number(r.total) })
        const auths = {}
        wReceipts.forEach(r => { auths[r.authorizer] = (auths[r.authorizer] || 0) + Number(r.total) })

        return (
          <div key={w} className="worker-section">
            <h2>{w}</h2>
            <div className="stat">Total: <strong>SAR {wTotal.toFixed(2)}</strong> ({wReceipts.length} receipts)</div>
            <div className="pills">
              {Object.entries(cats).map(([cat, amt]) => (
                <span key={cat} className="pill cat">{cat}: SAR {amt.toFixed(2)}</span>
              ))}
            </div>
            <div className="pills">
              {Object.entries(auths).map(([auth, amt]) => (
                <span key={auth} className="pill auth">{auth}: SAR {amt.toFixed(2)}</span>
              ))}
            </div>
            <div className="receipt-list">
              {wReceipts.map(r => (
                <ReceiptCard key={r.id} r={r} spike={spikes[r.id]} expanded={expanded[r.id]} onToggle={() => toggleExpand(r.id)} />
              ))}
              {wReceipts.length === 0 && <div className="empty">No receipts match filters</div>}
            </div>
          </div>
        )
      })}

      {/* ===== GROCERIES TAB ===== */}
      {tab === 'groceries' && (
        <div className="grocery-tracker">
          <h2>Grocery Tracker</h2>
          {groceryInventory.length > 0 ? (
            <table className="items-table full">
              <thead>
                <tr><th>Item</th><th>Total Qty</th><th>Unit</th><th>Avg Unit Price</th><th>Total Spent</th><th>Last Bought</th></tr>
              </thead>
              <tbody>
                {groceryInventory.map((item, i) => (
                  <tr key={i}>
                    <td>{item.name}</td>
                    <td>{item.total_quantity}</td>
                    <td>{item.unit}</td>
                    <td>SAR {item.avg_unit_price.toFixed(2)}</td>
                    <td>SAR {item.total_spent.toFixed(2)}</td>
                    <td>{item.last_bought}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">No grocery data yet. Submit grocery receipts to start tracking.</div>
          )}
        </div>
      )}

      {/* Grand Total */}
      <div className="grand-total">
        Grand Total: <strong>SAR {grandTotal.toFixed(2)}</strong>
      </div>
    </div>
  )
}

function ReceiptCard({ r, spike, expanded, onToggle }) {
  return (
    <div className={`receipt-card ${spike ? 'spiked' : ''}`}>
      <div className="receipt-header" onClick={onToggle}>
        <div>
          <strong>{r.store || 'Unknown'}</strong>
          <span className="receipt-meta"> — {r.date} — SAR {Number(r.total).toFixed(2)}</span>
        </div>
        <div className="receipt-badges">
          <span className="pill cat small">{r.category}</span>
          {spike && (
            <span className="spike-badge">
              ⚠ SPIKE
              <span className="spike-detail">
                {spike.type === 'grocery'
                  ? ` SAR ${spike.perPerson}/person vs avg SAR ${spike.avgPerPerson}/person`
                  : ` SAR ${spike.total} vs avg SAR ${spike.avg}`}
              </span>
            </span>
          )}
          <span className="expand-icon">{expanded ? '▼' : '▶'}</span>
        </div>
      </div>
      {expanded && (
        <div className="receipt-detail">
          <div className="detail-meta">Authorized by: {r.authorizer}</div>
          {r.notes && <div className="detail-notes">Notes: {r.notes}</div>}
          {r.category === 'Groceries' && Array.isArray(r.items) && r.items.length > 0 && typeof r.items[0] === 'object' ? (
            <table className="items-table">
              <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Total</th></tr></thead>
              <tbody>
                {r.items.map((item, i) => (
                  <tr key={i}>
                    <td>{item.name}</td><td>{item.quantity}</td><td>{item.unit}</td>
                    <td>SAR {Number(item.unit_price).toFixed(2)}</td><td>SAR {Number(item.line_total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : Array.isArray(r.items) ? (
            <ul className="items-list">
              {r.items.map((item, i) => <li key={i}>{typeof item === 'string' ? item : item.name || JSON.stringify(item)}</li>)}
            </ul>
          ) : null}
          {r.image_url && <img src={r.image_url} alt="Receipt" className="receipt-img" />}
        </div>
      )}
    </div>
  )
}
