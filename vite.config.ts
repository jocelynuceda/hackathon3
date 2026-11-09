import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// SHA corto del commit, inyectado en tiempo de build para la cabecera X-Lumon-Build.
// En Vercel viene de VERCEL_GIT_COMMIT_SHA; en local se intenta con git y, si no, vale "dev".
function resolveBuildSha(command: 'build' | 'serve'): string {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.CF_PAGES_COMMIT_SHA ?? process.env.COMMIT_REF
  if (fromEnv) return fromEnv.slice(0, 7)
  if (command === 'serve') return 'dev'
  try {
    return execSync('git rev-parse --short=7 HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    __LUMON_BUILD__: JSON.stringify(resolveBuildSha(command)),
  },
}))
