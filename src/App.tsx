import { BrowserRouter } from 'react-router-dom'
import { HealthGate } from './health/HealthGate'
import { AppRoutes } from './routes/AppRoutes'

export default function App() {
  return (
    <BrowserRouter>
      <HealthGate>
        <AppRoutes />
      </HealthGate>
    </BrowserRouter>
  )
}
