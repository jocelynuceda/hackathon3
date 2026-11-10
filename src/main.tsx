import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Tras un deploy nuevo, una pestaña abierta puede pedir un chunk que ya no existe: se recarga una vez.
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('lumon.reloadedForChunk') === location.pathname) return
    sessionStorage.setItem('lumon.reloadedForChunk', location.pathname)
  } catch {
    // sin storage: se recarga igual
  }
  event.preventDefault()
  location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
