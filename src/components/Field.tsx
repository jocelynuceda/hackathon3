import { useId } from 'react'

interface FieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  type?: string
  autoComplete?: string
  required?: boolean
  minLength?: number
  maxLength?: number
}

export function Field({ label, value, onChange, error, type = 'text', ...rest }: FieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-200">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 focus:border-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-300/40 aria-[invalid=true]:border-rose-400"
        {...rest}
      />
      {error && (
        <p id={errorId} className="text-sm text-rose-300">
          {error}
        </p>
      )}
    </div>
  )
}
