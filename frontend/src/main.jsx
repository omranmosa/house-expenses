import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import WorkerUI from './pages/WorkerUI'
import Report from './pages/Report'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WorkerUI />} />
        <Route path="/report" element={<Report />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
