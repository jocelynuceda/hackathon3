import { Link } from 'react-router-dom'
import { primaryActionClass, StatusScreen } from '../components/StatusScreen'

export function NotFoundPage() {
  return (
    <StatusScreen title="Página no encontrada" description="Esta sala no existe en el piso separado.">
      <Link to="/" className={primaryActionClass}>
        Volver al inicio
      </Link>
    </StatusScreen>
  )
}
