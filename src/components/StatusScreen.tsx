import type { ReactNode } from 'react'

interface StatusScreenProps {
  title: string
  description?: string
  /** Anuncia el contenido a lectores de pantalla mientras algo está en curso. */
  live?: boolean
  children?: ReactNode
}

export function StatusScreen({ title, description, live = false, children }: StatusScreenProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <div className="w-full max-w-md text-center">
        <div role={live ? 'status' : undefined}>
          <h1 className="text-3xl font-semibold">{title}</h1>
          {description && <p className="mt-3 text-slate-300">{description}</p>}
        </div>
        {children && <div className="mt-6">{children}</div>}
      </div>
    </main>
  )
}

export const primaryActionClass =
  'inline-block rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 hover:bg-teal-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300'
