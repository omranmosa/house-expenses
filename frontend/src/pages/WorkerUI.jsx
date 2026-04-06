import { useState, useRef, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const WORKERS = [
  { name: 'تحسين', pin: '1689', lang: 'ar' },
  { name: 'Biswajit', pin: '1590', lang: 'en' },
]
const AUTHORIZERS = ['Omran عمران', 'Juju الجوهره']

const T = {
  en: {
    title: 'House Expenses',
    selectName: 'Select your name to continue',
    enterPin: (name) => `Enter PIN for ${name}`,
    wrongPin: 'Wrong PIN. Try again.',
    back: 'Back',
    switchUser: 'Switch user',
    loggedInAs: (name) => `Logged in as ${name}`,
    offline: "You're offline — receipts will be queued and synced automatically",
    savedOffline: (n) => `${n} receipt${n > 1 ? 's' : ''} saved offline`,
    syncNow: 'Sync now',
    syncing: 'Syncing...',
    authorizedBy: 'Authorized by',
    receipts: 'Receipts',
    tapToPhoto: 'Tap to take photos or browse',
    dragDrop: 'Select multiple — or drag & drop',
    ready: 'Ready',
    scanning: 'Scanning...',
    queuedOffline: 'Queued offline',
    scanningReceipts: 'Scanning receipts...',
    submit: (n) => `Submit ${n} receipt${n !== 1 ? 's' : ''}`,
    clearAll: 'Clear all & start fresh',
    receiptSaved: 'Receipt saved!',
    failedOffline: 'Failed to save offline',
    savedOfflineSync: 'Saved offline — will sync when online',
  },
  ar: {
    title: 'مصاريف المنزل',
    selectName: 'اختر اسمك للمتابعة',
    enterPin: (name) => `أدخل الرمز لـ ${name}`,
    wrongPin: 'رمز خاطئ. حاول مرة أخرى.',
    back: 'رجوع',
    switchUser: 'تبديل المستخدم',
    loggedInAs: (name) => `تم الدخول كـ ${name}`,
    offline: 'أنت غير متصل — سيتم حفظ الإيصالات ومزامنتها تلقائياً',
    savedOffline: (n) => `${n} إيصال${n > 1 ? 'ات' : ''} محفوظة بدون اتصال`,
    syncNow: 'مزامنة الآن',
    syncing: 'جاري المزامنة...',
    authorizedBy: 'بإذن من',
    receipts: 'الإيصالات',
    tapToPhoto: 'اضغط لالتقاط صورة أو تصفح',
    dragDrop: 'اختر عدة صور — أو اسحب وأفلت',
    ready: 'جاهز',
    scanning: 'جاري المسح...',
    queuedOffline: 'في الانتظار بدون اتصال',
    scanningReceipts: 'جاري مسح الإيصالات...',
    submit: (n) => `إرسال ${n} إيصال${n !== 1 ? 'ات' : ''}`,
    clearAll: 'مسح الكل والبدء من جديد',
    receiptSaved: 'تم حفظ الإيصال!',
    failedOffline: 'فشل الحفظ بدون اتصال',
    savedOfflineSync: 'تم الحفظ بدون اتصال — ستتم المزامنة عند الاتصال',
  },
}

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
  const [worker, setWorker] = useState(null) // { name, pin }
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
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
    formData.append('worker', worker.name)
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
            worker: worker.name,
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
  const lang = worker?.lang || 'en'
  const t = T[lang]
  const isRtl = lang === 'ar'

  // Force direction on <html> to override system Arabic settings
  useEffect(() => {
    if (authenticated && worker) {
      document.documentElement.dir = isRtl ? 'rtl' : 'ltr'
      document.documentElement.lang = isRtl ? 'ar' : 'en'
    } else {
      document.documentElement.dir = 'ltr'
      document.documentElement.lang = 'en'
    }
  }, [authenticated, worker, isRtl])

  function selectWorker(w) {
    setWorker(w)
    setPinInput('')
    setPinError(false)
    setAuthenticated(false)
  }

  function verifyPin() {
    if (pinInput === worker.pin) {
      setAuthenticated(true)
      setPinError(false)
    } else {
      setPinError(true)
    }
  }

  function logout() {
    setWorker(null)
    setAuthenticated(false)
    setPinInput('')
    setAuthorizer('')
    setFiles([])
  }

  // Step 1: Worker selection (no language yet, show bilingual, force LTR to avoid system Arabic issues)
  if (!worker) {
    return (
      <div className="worker-ui" dir="ltr">
        <h1>House Expenses / مصاريف المنزل</h1>
        <p className="subtitle">Select your name / اختر اسمك</p>
        <div className="section">
          <div className="toggle-group">
            {WORKERS.map(w => (
              <button key={w.name} className="toggle-btn worker-select" onClick={() => selectWorker(w)}>{w.name}</button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Step 2: PIN entry
  if (!authenticated) {
    return (
      <div className="worker-ui" dir={isRtl ? 'rtl' : 'ltr'}>
        <h1>{t.title}</h1>
        <p className="subtitle">{t.enterPin(worker.name)}</p>
        <div className="section">
          <div className="pin-input-row">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={`pin-dot ${pinInput.length > i ? 'filled' : ''}`} />
            ))}
          </div>
          <div className="pin-pad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del'].map((key, i) => (
              key === null ? <div key={i} className="pin-key empty" /> :
              key === 'del' ? (
                <button key={i} className="pin-key del" onClick={() => setPinInput(p => p.slice(0, -1))}>&#9003;</button>
              ) : (
                <button key={i} className="pin-key" onClick={() => {
                  const next = pinInput + key
                  setPinInput(next)
                  setPinError(false)
                  if (next.length === 4) {
                    if (next === worker.pin) { setAuthenticated(true); setPinError(false) }
                    else { setPinError(true); setPinInput('') }
                  }
                }}>{key}</button>
              )
            ))}
          </div>
          {pinError && <div className="msg error">{t.wrongPin}</div>}
          <button className="clear-all-btn" onClick={() => setWorker(null)}>{t.back}</button>
        </div>
      </div>
    )
  }

  // Step 3: Authenticated — upload receipts
  return (
    <div className="worker-ui" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="worker-header">
        <h1>{t.title}</h1>
        <button className="logout-btn" onClick={logout}>{t.switchUser}</button>
      </div>
      <p className="subtitle">{t.loggedInAs(worker.name)}</p>

      {!navigator.onLine && <div className="msg offline">{t.offline}</div>}

      {queueCount > 0 && (
        <div className="msg queued-banner">
          {t.savedOffline(queueCount)}
          {navigator.onLine && (
            <button className="sync-btn" onClick={syncQueue} disabled={syncing}>
              {syncing ? t.syncing : t.syncNow}
            </button>
          )}
        </div>
      )}

      <div className="section">
        <label>{t.authorizedBy}</label>
        <div className="toggle-group">
          {AUTHORIZERS.map(a => (
            <button key={a} className={`toggle-btn ${authorizer === a ? 'active' : ''}`} onClick={() => setAuthorizer(a)}>{a}</button>
          ))}
        </div>
      </div>

      <div className="section">
        <label>{t.receipts} {files.length > 0 && `(${files.length})`}</label>
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
            <span>{t.tapToPhoto}</span>
            <span className="drop-hint">{t.dragDrop}</span>
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

      {files.length > 0 && (
        <div className="file-grid">
          {files.map(f => (
            <div key={f.id} className={`file-card ${f.status}`}>
              <img src={f.preview} alt="Receipt" className="file-thumb" />
              <div className="file-info">
                {f.status === 'pending' && <span className="file-status pending-dot">{t.ready}</span>}
                {f.status === 'uploading' && <span className="file-status"><span className="mini-spinner" /> {t.scanning}</span>}
                {f.status === 'done' && (
                  <span className="file-status done-text" dir="ltr">
                    {f.result.store} — SAR {Number(f.result.total).toFixed(2)}
                  </span>
                )}
                {f.status === 'error' && <span className="file-status error-text">{f.error}</span>}
                {f.status === 'queued' && <span className="file-status queued-text">{t.queuedOffline}</span>}
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
        disabled={anyUploading || pendingCount === 0 || !authorizer}
      >
        {anyUploading ? t.scanningReceipts : t.submit(pendingCount)}
      </button>

      {files.length > 0 && files.every(f => f.status === 'done') && (
        <button className="clear-all-btn" onClick={() => setFiles([])}>{t.clearAll}</button>
      )}
    </div>
  )
}
