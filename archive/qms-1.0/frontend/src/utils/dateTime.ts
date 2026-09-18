const BEIJING_TIMEZONE = 'Asia/Shanghai'

function normalizeBackendDateInput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return trimmed
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00Z`
  }

  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed
  }

  return `${trimmed.replace(' ', 'T')}Z`
}

export function formatDateTimeInBeijing(value?: string | null): string {
  if (!value) {
    return '-'
  }

  const normalized = normalizeBackendDateInput(value)
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}
