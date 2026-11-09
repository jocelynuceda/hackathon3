declare const __LUMON_BUILD__: string

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Falta la variable de entorno ${name}`)
  return value
}

export const config = {
  apiBaseUrl: required('VITE_API_BASE_URL', import.meta.env.VITE_API_BASE_URL),
  wsBaseUrl: required('VITE_WS_BASE_URL', import.meta.env.VITE_WS_BASE_URL),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
  supabaseBucket: import.meta.env.VITE_SUPABASE_BUCKET ?? 'lumon-media',
  build: __LUMON_BUILD__,
} as const
