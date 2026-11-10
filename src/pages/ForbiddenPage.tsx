import { Link } from 'react-router-dom'
import { primaryActionClass, StatusScreen } from '../components/StatusScreen'

export function ForbiddenPage() {
  return (
    <StatusScreen title="Sin permiso" description="Tu cuenta no tiene permiso para abrir esta página.">
      <Link to="/" className={primaryActionClass}>
        Volver al inicio
      </Link>
    </StatusScreen>
  )
}
