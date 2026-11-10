import { BrowserRouter } from 'react-router-dom'
import { SessionProvider } from './auth/SessionProvider'
import { HealthGate } from './health/HealthGate'
import { AppRoutes } from './routes/AppRoutes'
import './persona-b.css'

export default function App() {
  return (
    <BrowserRouter>
      <HealthGate>
        <SessionProvider>
          <AppRoutes />
        </SessionProvider>
      </HealthGate>
    </BrowserRouter>
  )
}
