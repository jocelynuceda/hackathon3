import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { HealthGate } from './health/HealthGate'
import { AppRoutes } from './routes/AppRoutes'

export default function App() {
  return (
    <BrowserRouter>
      <HealthGate>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </HealthGate>
    </BrowserRouter>
  )
}
