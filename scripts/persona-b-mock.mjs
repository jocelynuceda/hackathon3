import { createServer } from 'vite'

process.env.VITE_API_BASE_URL = '/lumon-mock'
process.env.VITE_WS_BASE_URL = 'ws://127.0.0.1:5177/lumon-mock'

const profile = {
  id: 1,
  email: 'demo@example.test',
  displayName: 'Cuadrilla de prueba',
  role: { code: 'SUPERVISOR', name: 'Supervisión' },
  clearance: { granted: false, grantedAt: null },
  team: { code: 'TEAM-DEMO', name: 'Cuadrilla de prueba' },
  permissions: ['team:manage', 'files:read'],
}
const email = 'demo@example.test'
const password = 'demo-lumon-123'
let roster = { members: [], complete: false, locked: false }
let accessToken
let refreshToken
let attempt = 0
let registered = false
let clearance = { granted: false, grantedAt: null, checks: [] }

function issueSession() {
  accessToken = crypto.randomUUID()
  refreshToken = crypto.randomUUID()
  return { accessToken, refreshToken, expiresIn: 180 }
}

function respond(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(body === undefined ? undefined : JSON.stringify(body))
}

function fail(response, status, error, message, details = null) {
  respond(response, status, { error, message, details })
}

async function mockApi(request, response) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
  const route = request.method + ' ' + request.url

  switch (route) {
    case 'GET /meta/health':
      return respond(response, 200, { status: 'ok', service: 'lumon-mock', time: new Date().toISOString() })
    case 'POST /auth/register':
      if (registered && body.email === email) {
        return fail(response, 409, 'EMAIL_TAKEN', 'Este correo ya está registrado.', { field: 'email' })
      }
      if (registered && body.teamName === profile.team.name) {
        return fail(response, 409, 'TEAM_NAME_TAKEN', 'Este nombre de cuadrilla ya existe.', { field: 'teamName' })
      }
      if (body.email !== email || body.password !== password || body.teamName !== profile.team.name) {
        return fail(response, 400, 'VALIDATION_ERROR', 'Usa los datos de prueba indicados.', { fields: { _: 'Usa los datos de prueba indicados.' } })
      }
      registered = true
      return respond(response, 201, { ...issueSession(), team: profile.team })
    case 'POST /auth/login':
      if (!registered || body.email !== email || body.password !== password) {
        return fail(response, 401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.')
      }
      return respond(response, 200, issueSession())
    case 'POST /auth/refresh':
      if (!refreshToken || body.refreshToken !== refreshToken) {
        return fail(response, 401, 'REFRESH_INVALID', 'Tu sesión ya no está disponible.')
      }
      return respond(response, 200, issueSession())
    case 'POST /auth/logout':
      if (body.refreshToken === refreshToken) {
        accessToken = undefined
        refreshToken = undefined
      }
      return respond(response, 204)
  }

  if (!accessToken || request.headers.authorization !== 'Bearer ' + accessToken) {
    return fail(response, 401, 'TOKEN_INVALID', 'Tu sesión ya no está disponible.')
  }

  switch (route) {
    case 'GET /auth/me':
      return respond(response, 200, profile)
    case 'GET /integrations/status':
      return respond(response, 200, {
        deploy: { origin: null, verifiedAt: null },
        storage: { provider: null, verifiedAt: null },
        clearance,
      })
    case 'GET /team/roster':
      return respond(response, 200, roster)
    case 'PUT /team/roster':
      if (roster.locked || body.members?.some((member) => member.code === 'LOCKED-1')) {
        roster.locked = true
        return fail(response, 409, 'ROSTER_LOCKED', 'La lista quedó cerrada por el sorteo.')
      }
      if (body.members?.length !== 3 || new Set(body.members.map((member) => member.code.toLowerCase())).size !== 3) {
        return fail(response, 400, 'VALIDATION_ERROR', 'La lista requiere tres códigos distintos.')
      }
      roster = { members: body.members, complete: true, locked: false }
      return respond(response, 200, roster)
    case 'GET /clearance':
      return respond(response, 200, clearance)
    case 'POST /clearance/check': {
      attempt += 1
      if (attempt === 1) return fail(response, 403, 'CHECK_FROM_APP_REQUIRED', 'Se requiere el dominio verificado.')
      const granted = attempt >= 3
      clearance = {
        granted,
        grantedAt: granted ? new Date().toISOString() : null,
        checks: [
          { name: 'DEPLOY', passed: true, detail: 'Dominio aprobado en la simulación.' },
          { name: 'REFINE', passed: granted, detail: granted ? 'Refinamiento aprobado en la simulación.' : 'Refinamiento pendiente en la simulación.' },
        ],
      }
      return respond(response, 200, clearance)
    }
    default:
      return fail(response, 404, 'NOT_FOUND', 'Ruta fuera de la simulación de Persona B.')
  }
}

const server = await createServer({
  server: { host: '127.0.0.1', port: 5177, strictPort: true },
  plugins: [{
    name: 'lumon-persona-b-mock',
    configureServer(vite) {
      vite.middlewares.use('/lumon-mock', (request, response) => {
        void mockApi(request, response).catch(() => {
          fail(response, 400, 'INVALID_JSON', 'La solicitud simulada no se pudo procesar.')
        })
      })
    },
  }],
})

await server.listen()
console.log('Simulación local de Persona B. Los datos se reinician al detenerla.')
console.log('Cuadrilla de prueba · demo@example.test · demo-lumon-123')
server.printUrls()
