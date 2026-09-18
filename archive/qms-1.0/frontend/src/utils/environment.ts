export type EntryEnvironment = 'stable' | 'preview'

export const PREVIEW_PREFIX = 'preview.'
export const ENV_STORAGE_KEY = 'current_environment'

export function isLocalHost(hostname: string) {
  return hostname === 'localhost' || hostname.startsWith('127.0.0.1')
}

export function normalizeEntryEnvironment(value: string | null | undefined): EntryEnvironment {
  return value === 'preview' ? 'preview' : 'stable'
}

export function isPreviewEnvironment(value: string | null | undefined) {
  return normalizeEntryEnvironment(value) === 'preview'
}

export function getEnvironmentLabel(value: string | null | undefined) {
  return isPreviewEnvironment(value) ? '预览环境' : '正式环境'
}

export function getEnvironmentEditionLabel(value: string | null | undefined) {
  return isPreviewEnvironment(value) ? '预览版' : '正式版'
}

export function getEnvironmentSwitchText(value: string | null | undefined) {
  return isPreviewEnvironment(value) ? '切换到正式版' : '切换到预览版'
}

export function detectEntryEnvironment(): EntryEnvironment {
  const hostname = window.location.hostname

  if (hostname.includes('preview')) {
    return 'preview'
  }

  if (isLocalHost(hostname)) {
    return normalizeEntryEnvironment(window.localStorage.getItem(ENV_STORAGE_KEY))
  }

  return 'stable'
}
