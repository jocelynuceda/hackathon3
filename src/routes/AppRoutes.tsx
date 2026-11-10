import { Navigate, Route, Routes } from 'react-router-dom'
import { StatusScreen } from '../components/StatusScreen'
import { EstadoPage } from '../pages/EstadoPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { RequireAuth } from './RequireAuth'
import { RequirePermission } from './RequirePermission'

/** Marca de posición: cada página real reemplaza su `element` en este archivo. */
function Pending({ name }: { name: string }) {
  return <StatusScreen title={name} description="Pendiente de construir." />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="login" element={<Pending name="Login" />} />
      <Route path="estado" element={<EstadoPage />} />

      <Route element={<RequireAuth />}>
        <Route index element={<Navigate to="/files" replace />} />

        <Route element={<RequirePermission permissions={['files:read']} />}>
          <Route path="files" element={<Pending name="Archivos" />} />
          <Route path="files/:id/refine" element={<Pending name="Refinar" />} />
        </Route>

        <Route element={<RequirePermission permissions={['refiners:read']} />}>
          <Route path="refiners" element={<Pending name="Expedientes" />} />
        </Route>
        <Route element={<RequirePermission permissions={['refiners:write']} />}>
          <Route path="refiners/:id/edit" element={<Pending name="Editar expediente" />} />
        </Route>
        <Route element={<RequirePermission permissions={['refiners:write', 'media:upload']} />}>
          <Route path="refiners/:id/badge" element={<Pending name="Fotocheck" />} />
        </Route>

        <Route element={<RequirePermission permissions={['incidents:read']} />}>
          <Route path="incidents" element={<Pending name="Incidencias" />} />
        </Route>
        <Route element={<RequirePermission permissions={['incidents:create', 'media:upload']} />}>
          <Route path="incidents/new" element={<Pending name="Nueva incidencia" />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
