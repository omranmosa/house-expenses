import { useState, useRef, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const WORKERS = ['تحسين', 'Biswajit']
const AUTHORIZERS = ['Omran عمران', 'Juju الجوهره']
const DB_NAME = 'receipts-offline'
const STORE_NAME = 'queue'

// IndexedDB helpers for offline queue
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function enqueue(item) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).add(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function getQueue() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function removeFromQueue(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export default function WorkerUI() {
  const [worker, setWorker] = useState('')
  const [authorizer, setAuthorizer] = useState('')
  const [files, setFiles] = useState([]) // { id, file, preview, status: 'pending'|'uploading'|'done'|'error', result, error }
  const [queueCount, setQueueCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const fileRef = useRef()
  const dropRef = useRef()

  // Check offline queue on mount and when coming online
  useEffect(() => {
    checkQueue()
    window.addEventListener('online', syncQueue)
    return () => window.removeEventListener('online', syncQueue)
  }, [])

  async function checkQueue() {
    try {
      const q = await getQueue()
      setQueueCount(q.length)
    } catch {}
  }

  async function syncQueue() {
    setSyncing(true)
    try {
      const q = await getQueue()
      for (const item of q) {
        try {
          const formData = new FormData()
          formData.append('image', new Blob([item.imageData], { type: item.mimeType }), item.fileName)
          formData.append('worker', item.worker)
          formData.append('authorizer', item.authorizer)
          const res = await fetch(`${API_URL}/api/receipts`, { method: 'POST', body: formData })
          if (res.ok) await removeFromQueue(item.id)
        } catch {}
      }
    } finally {
      await checkQueue()
      setSyncing(false)
    }
  }

  function handleFiles(newFiles) {
    const added = Array.from(newFiles).map((f, i) => ({
      id: Date.now() + i,
      file: f,
      preview: URL.createObjectURL(f),
      status: 'pending',
      result: null,
      error: null,
    }))
    setFiles(prev => [...prev, ...added])
  }

  function handleDrop(e) {
    e.preventDefault()
    dropRef.current?.classList.remove('drag-over')
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
  }

  function removeFile(id) {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  async function submitOne(fileEntry) {
    setFiles(prev => prev.map(f => f.id === fileEntry.id ? { ...f, status: 'uploading' } : f))

    const formData = new FormData()
    formData.append('image', fileEntry.file)
    formData.append('worker', worker)
    formData.append('authorizer', authorizer)

    try {
      const res = await fetch(`${API_URL}/api/receipts`, { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setFiles(prev => prev.map(f => f.id === fileEntry.id ? { ...f, status: 'done', result: data.receipt } : f))
    } catch (err) {
      // If offline, queue it
      if (!navigator.onLine) {
        try {
          const buf = await fileEntry.file.arrayBuffer()
          await enqueue({
            imageData: buf,
            mimeType: fileEntry.file.type,
            fileName: fileEntry.file.name,
            worker,
            authorizer,
          })
          await checkQueue()
          setFiles(prev => prev.map(f => f.id === fileEntry.id ? { ...f, status: 'queued', error: 'Saved offline — will sync when online' } : f))
        } catch {
          setFiles(prev => prev.map(f => f.id === fileEntry.id ? { ...f, status: 'error', error: 'Failed to save offline' } : f))
        }
      } else {
        setFiles(prev => prev.map(f => f.id === fileEntry.id ? { ...f, status: 'error', error: err.message } : f))
      }
    }
  }

  async function handleSubmitAll() {
    if (!worker || !authorizer) return
    const pending = files.filter(f => f.status === 'pending')
    for (const f of pending) {
      await submitOne(f)
    }
  }

  const pendingCount = files.filter(f => f.status === 'pending').length
  const anyUploading = files.some(f => f.status === 'uploading')

  return (
    <div className="worker-ui">
      <h1>House Expenses</h1>
      <p className="subtitle">Upload receipts to track expenses</p>

      {!navigator.onLine && <div className="msg offline">You're offline — receipts will be queued and synced automatically</div>}

      {queueCount > 0 && (
        <div className="msg queued-banner">
          {queueCount} receipt{queueCount > 1 ? 's' : ''} saved offline
          {navigator.onLine && (
            <button className="sync-btn" onClick={syncQueue} disabled={syncing}>
              {syncing ? 'Syncing...' : 'Sync now'}
            </button>
          )}
        </div>
      )}

      <div className="section">
        <label>Worker</label>
        <div className="toggle-group">
          {WORKERS.map(w => (
            <button key={w} className={`toggle-btn ${worker === w ? 'active' : ''}`} onClick={() => setWorker(w)}>{w}</button>
          ))}
        </div>
      </div>

      <div className="section">
        <label>Authorized by</label>
        <div className="toggle-group">
          {AUTHORIZERS.map(a => (
            <button key={a} className={`toggle-btn ${authorizer === a ? 'active' : ''}`} onClick={() => setAuthorizer(a)}>{a}</button>
          ))}
        </div>
      </div>

      <div className="section">
        <label>Receipts {files.length > 0 && `(${files.length})`}</label>
        <div
          ref={dropRef}
          className="drop-zone"
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); dropRef.current?.classList.add('drag-over') }}
          onDragLeave={() => dropRef.current?.classList.remove('drag-over')}
          onDrop={handleDrop}
        >
          <div className="drop-text">
            <span className="drop-icon">📷</span>
            <span>Tap to take photos or browse</span>
            <span className="drop-hint">Select multiple — or drag & drop</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
          />
        </div>
      </div>

      {/* File previews */}
      {files.length > 0 && (
        <div className="file-grid">
          {files.map(f => (
            <div key={f.id} className={`file-card ${f.status}`}>
              <img src={f.preview} alt="Receipt" className="file-thumb" />
              <div className="file-info">
                {f.status === 'pending' && <span className="file-status pending-dot">Ready</span>}
                {f.status === 'uploading' && <span className="file-status"><span className="mini-spinner" /> Scanning...</span>}
                {f.status === 'done' && (
                  <span className="file-status done-text">
                    {f.result.store} — SAR {Number(f.result.total).toFixed(2)}
                  </span>
                )}
                {f.status === 'error' && <span className="file-status error-text">{f.error}</span>}
                {f.status === 'queued' && <span className="file-status queued-text">Queued offline</span>}
              </div>
              {(f.status === 'pending' || f.status === 'error') && (
                <button className="file-remove" onClick={(e) => { e.stopPropagation(); removeFile(f.id) }}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        className="submit-btn"
        onClick={handleSubmitAll}
        disabled={anyUploading || pendingCount === 0 || !worker || !authorizer}
      >
        {anyUploading ? 'Scanning receipts...' : `Submit ${pendingCount} receipt${pendingCount !== 1 ? 's' : ''}`}
      </button>

      {files.length > 0 && files.every(f => f.status === 'done') && (
        <button className="clear-all-btn" onClick={() => setFiles([])}>Clear all & start fresh</button>
      )}
    </div>
  )
}
