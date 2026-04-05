import { useState, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const HOUSEHOLD_SIZE = 5

export default function Report() {
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [authError, setAuthError] = useState(false)
  const [receipts, setReceipts] = useState([])
  const [groceryInventory, setGroceryInventory] = useState([])
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState('')

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

      // Fetch grocery inventory
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

  function toggleExpand(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  // Spike detection
  function detectSpikes(receipts) {
    const spikes = {}
    const byWorkerCategory = {}

    // Build running averages
    const sorted = [...receipts].sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at))
    for (const r of sorted) {
      const key = `${r.worker}:${r.category}`
      if (!byWorkerCategory[key]) byWorkerCategory[key] = []
      byWorkerCategory[key].push(r)
    }

    for (const r of receipts) {
      const key = `${r.worker}:${r.category}`
      const history = byWorkerCategory[key].filter(h => h.id !== r.id && new Date(h.submitted_at) < new Date(r.submitted_at))
      if (history.length < 2) continue

      if (r.category === 'Groceries') {
        // Per-person cost
        const perPerson = Number(r.total) / HOUSEHOLD_SIZE
        const avgPerPerson = history.reduce((s, h) => s + Number(h.total) / HOUSEHOLD_SIZE, 0) / history.length
        // Count distinct items
        const itemCount = Array.isArray(r.items) ? r.items.length : 0
        // Don't flag if 10+ items (full weekly shop)
        if (itemCount >= 10) continue
        if (perPerson > avgPerPerson * 1.6) {
          spikes[r.id] = {
            type: 'grocery',
            perPerson: perPerson.toFixed(2),
            avgPerPerson: avgPerPerson.toFixed(2),
          }
        }
      } else {
        const avg = history.reduce((s, h) => s + Number(h.total), 0) / history.length
        if (Number(r.total) > avg * 1.5) {
          spikes[r.id] = {
            type: 'other',
            total: Number(r.total).toFixed(2),
            avg: avg.toFixed(2),
          }
        }
      }
    }
    return spikes
  }

  if (!authed) {
    return (
      <div className="worker-ui">
        <h1>🔒 Manager Report</h1>
        <div className="section">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            className="password-input"
            placeholder="Enter password"
          />
          <button className="submit-btn" onClick={handleLogin} disabled={loading}>
            {loading ? 'Verifying...' : 'Login'}
          </button>
          {authError && <div className="msg error">Invalid password</div>}
        </div>
      </div>
    )
  }

  const workers = ['تحسين', 'Biswajit']
  const spikes = detectSpikes(receipts)
  const grandTotal = receipts.reduce((s, r) => s + Number(r.total), 0)

  return (
    <div className="report-ui">
      <h1>📊 Expense Report</h1>

      {workers.map(w => {
        const wReceipts = receipts.filter(r => r.worker === w)
        const wTotal = wReceipts.reduce((s, r) => s + Number(r.total), 0)

        // Category breakdown
        const cats = {}
        wReceipts.forEach(r => { cats[r.category] = (cats[r.category] || 0) + Number(r.total) })

        // Authorizer breakdown
        const auths = {}
        wReceipts.forEach(r => { auths[r.authorizer] = (auths[r.authorizer] || 0) + Number(r.total) })

        return (
          <div key={w} className="worker-section">
            <h2>{w}</h2>
            <div className="stat">Total: <strong>SAR {wTotal.toFixed(2)}</strong></div>

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
                <div key={r.id} className={`receipt-card ${spikes[r.id] ? 'spiked' : ''}`}>
                  <div className="receipt-header" onClick={() => toggleExpand(r.id)}>
                    <div>
                      <strong>{r.store || 'Unknown'}</strong>
                      <span className="receipt-meta"> — {r.date} — SAR {Number(r.total).toFixed(2)}</span>
                    </div>
                    <div className="receipt-badges">
                      <span className="pill cat small">{r.category}</span>
                      {spikes[r.id] && (
                        <span className="spike-badge" title={
                          spikes[r.id].type === 'grocery'
                            ? `SAR ${spikes[r.id].perPerson}/person vs avg SAR ${spikes[r.id].avgPerPerson}/person`
                            : `SAR ${spikes[r.id].total} vs avg SAR ${spikes[r.id].avg}`
                        }>
                          ⚠ SPIKE
                          <span className="spike-detail">
                            {spikes[r.id].type === 'grocery'
                              ? ` SAR ${spikes[r.id].perPerson}/person vs avg SAR ${spikes[r.id].avgPerPerson}/person`
                              : ` SAR ${spikes[r.id].total} vs avg SAR ${spikes[r.id].avg}`}
                          </span>
                        </span>
                      )}
                      <span className="expand-icon">{expanded[r.id] ? '▼' : '▶'}</span>
                    </div>
                  </div>

                  {expanded[r.id] && (
                    <div className="receipt-detail">
                      <div className="detail-meta">Authorized by: {r.authorizer}</div>
                      {r.notes && <div className="detail-notes">Notes: {r.notes}</div>}

                      {r.category === 'Groceries' && Array.isArray(r.items) && r.items.length > 0 && typeof r.items[0] === 'object' ? (
                        <table className="items-table">
                          <thead>
                            <tr><th>Item</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Total</th></tr>
                          </thead>
                          <tbody>
                            {r.items.map((item, i) => (
                              <tr key={i}>
                                <td>{item.name}</td>
                                <td>{item.quantity}</td>
                                <td>{item.unit}</td>
                                <td>SAR {Number(item.unit_price).toFixed(2)}</td>
                                <td>SAR {Number(item.line_total).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : Array.isArray(r.items) ? (
                        <ul className="items-list">
                          {r.items.map((item, i) => <li key={i}>{typeof item === 'string' ? item : item.name || JSON.stringify(item)}</li>)}
                        </ul>
                      ) : null}

                      {r.image_url && (
                        <img src={r.image_url} alt="Receipt" className="receipt-img" />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* Grocery Tracker */}
      {groceryInventory.length > 0 && (
        <div className="grocery-tracker">
          <h2>🛒 Grocery Tracker</h2>
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
        </div>
      )}

      <div className="grand-total">
        Grand Total: <strong>SAR {grandTotal.toFixed(2)}</strong>
      </div>
    </div>
  )
}
