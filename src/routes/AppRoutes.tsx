import { lazy, Suspense } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useSession } from '../auth/session'
import { Layout } from '../components/Layout'
import { StatusScreen } from '../components/StatusScreen'
import { LoginPage } from '../pages/LoginPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { RegisterPage } from '../pages/RegisterPage'
import { RequireAuth } from './RequireAuth'
import { RequirePermission } from './RequirePermission'

// Todo lo que no es el login va en chunks aparte para que la carga inicial sea liviana.
const FilesPage = lazy(() => import('../pages/FilesPage').then((m) => ({ default: m.FilesPage })))
const EstadoPage = lazy(() => import('../pages/EstadoPage').then((m) => ({ default: m.EstadoPage })))
const RefinePage = lazy(() => import('../pages/RefinePage'))

/** Marca de posición: cada página real reemplaza su `element` en este archivo. */
function Pending({ name }: { name: string }) {
  return <StatusScreen title={name} description="Pendiente de construir." />
}

function EstadoLayout() {
  return useSession().status === 'authenticated' ? <Layout /> : <Outlet />
}

export function AppRoutes() {
  return (
    <Suspense fallback={<StatusScreen live title="Cargando…" />}>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="registro" element={<RegisterPage />} />
        <Route element={<EstadoLayout />}>
          <Route path="estado" element={<EstadoPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/files" replace />} />

            <Route element={<RequirePermission permissions={['files:read']} />}>
              <Route path="files" element={<FilesPage />} />
              <Route path="files/:id/refine" element={<RefinePage />} />
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
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}
