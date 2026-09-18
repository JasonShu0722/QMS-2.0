import { computed } from 'vue'
import {
  detectEntryEnvironment,
  ENV_STORAGE_KEY,
  getEnvironmentEditionLabel,
  getEnvironmentSwitchText,
  isLocalHost,
  isPreviewEnvironment,
  PREVIEW_PREFIX
} from '@/utils/environment'

/**
 * Shared environment state for login, desktop and mobile layouts.
 *
 * Product rule:
 * - Stable and preview each have their own entry domain.
 * - The UI still exposes an explicit switch button.
 * - On server domains, switching jumps between domains.
 * - In local development, switching falls back to local state.
 */
export function useEnvironment() {
  const currentEnvironment = computed<'stable' | 'preview'>(() => detectEntryEnvironment())
  const isPreview = computed(() => isPreviewEnvironment(currentEnvironment.value))

  const environmentName = computed(() => {
    return getEnvironmentEditionLabel(currentEnvironment.value)
  })

  const switchButtonText = computed(() => {
    return getEnvironmentSwitchText(currentEnvironment.value)
  })

  const environmentBadgeClass = computed(() => {
    return isPreview.value ? 'environment-badge-preview' : 'environment-badge-stable'
  })

  const syncEnvironmentState = () => {
    localStorage.setItem(ENV_STORAGE_KEY, currentEnvironment.value)
  }

  const switchEnvironment = () => {
    const targetEnvironment: 'stable' | 'preview' = isPreview.value ? 'stable' : 'preview'
    const currentUrl = new URL(window.location.href)
    const hostname = currentUrl.hostname

    localStorage.setItem(ENV_STORAGE_KEY, targetEnvironment)

    if (isLocalHost(hostname)) {
      window.location.reload()
      return
    }

    currentUrl.hostname = isPreview.value
      ? hostname.replace(/^preview\./, '')
      : `${PREVIEW_PREFIX}${hostname}`

    window.location.href = currentUrl.toString()
  }

  return {
    currentEnvironment,
    isPreview,
    environmentName,
    switchButtonText,
    switchEnvironment,
    environmentBadgeClass,
    syncEnvironmentState
  }
}
