import { useState, useRef } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const WORKERS = ['تحسين', 'Biswajit']
const AUTHORIZERS = ['Omran عمران', 'Juju الجوهره']

export default function WorkerUI() {
  const [worker, setWorker] = useState('')
  const [authorizer, setAuthorizer] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const fileRef = useRef()
  const dropRef = useRef()

  function handleFile(f) {
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
    setResult(null)
    setError(null)
  }

  function handleDrop(e) {
    e.preventDefault()
    dropRef.current?.classList.remove('drag-over')
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  async function handleSubmit() {
    if (!worker || !authorizer || !file) {
      setError('Please select worker, authorizer, and upload a receipt.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)

    const formData = new FormData()
    formData.append('image', file)
    formData.append('worker', worker)
    formData.append('authorizer', authorizer)

    try {
      const res = await fetch(`${API_URL}/api/receipts`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setResult(data.receipt)
      setFile(null)
      setPreview(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="worker-ui">
      <h1>🏠 House Expenses</h1>
      <p className="subtitle">Upload a receipt to track expenses</p>

      <div className="section">
        <label>Worker</label>
        <div className="toggle-group">
          {WORKERS.map(w => (
            <button
              key={w}
              className={`toggle-btn ${worker === w ? 'active' : ''}`}
              onClick={() => setWorker(w)}
            >{w}</button>
          ))}
        </div>
      </div>

      <div className="section">
        <label>Authorized by</label>
        <div className="toggle-group">
          {AUTHORIZERS.map(a => (
            <button
              key={a}
              className={`toggle-btn ${authorizer === a ? 'active' : ''}`}
              onClick={() => setAuthorizer(a)}
            >{a}</button>
          ))}
        </div>
      </div>

      <div className="section">
        <label>Receipt</label>
        <div
          ref={dropRef}
          className="drop-zone"
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); dropRef.current?.classList.add('drag-over') }}
          onDragLeave={() => dropRef.current?.classList.remove('drag-over')}
          onDrop={handleDrop}
        >
          {preview ? (
            <img src={preview} alt="Receipt preview" className="preview-img" />
          ) : (
            <div className="drop-text">
              <span className="drop-icon">📷</span>
              <span>Tap to take photo or browse</span>
              <span className="drop-hint">or drag & drop</span>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={e => handleFile(e.target.files[0])}
          />
        </div>
      </div>

      <button
        className="submit-btn"
        onClick={handleSubmit}
        disabled={loading || !worker || !authorizer || !file}
      >
        {loading ? 'Scanning receipt...' : 'Submit Receipt'}
      </button>

      {loading && <div className="spinner" />}

      {error && <div className="msg error">{error}</div>}

      {result && (
        <div className="msg success">
          <strong>Receipt saved!</strong>
          <div>{result.store} — SAR {Number(result.total).toFixed(2)}</div>
          <div>{result.category} • {result.date}</div>
        </div>
      )}
    </div>
  )
}
