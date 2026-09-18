import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEnvironment } from '@/composables/useEnvironment'

type StorageState = Record<string, string>

function installStorage(initialState: StorageState = {}) {
  const state: StorageState = { ...initialState }

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => state[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        state[key] = String(value)
      }),
      removeItem: vi.fn((key: string) => {
        delete state[key]
      }),
      clear: vi.fn(() => {
        Object.keys(state).forEach((key) => delete state[key])
      })
    }
  })

  return state
}

function installLocation(hostname: string, href: string, reload = vi.fn()) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      hostname,
      href,
      reload
    }
  })

  return reload
}

describe('useEnvironment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installStorage()
  })

  it('detects preview environment from preview hostname', () => {
    installLocation('preview.qms.example.com', 'https://preview.qms.example.com/login')

    const environment = useEnvironment()

    expect(environment.currentEnvironment.value).toBe('preview')
    expect(environment.isPreview.value).toBe(true)
  })

  it('reads local development environment from local storage', () => {
    installStorage({ current_environment: 'preview' })
    installLocation('localhost', 'http://localhost:5173/workbench')

    const environment = useEnvironment()

    expect(environment.currentEnvironment.value).toBe('preview')
    expect(environment.switchButtonText.value).toContain('正式')
  })

  it('normalizes unsupported local environment markers back to stable entry mode', () => {
    installStorage({ current_environment: 'dev' })
    installLocation('localhost', 'http://localhost:5173/workbench')

    const environment = useEnvironment()

    expect(environment.currentEnvironment.value).toBe('stable')
    expect(environment.environmentName.value).toContain('正式')
  })

  it('switches local development environment by updating storage and reloading', () => {
    installStorage({ current_environment: 'stable' })
    const reloadMock = installLocation('localhost', 'http://localhost:5173/workbench')

    const environment = useEnvironment()
    environment.switchEnvironment()

    expect(window.localStorage.setItem).toHaveBeenCalledWith('current_environment', 'preview')
    expect(reloadMock).toHaveBeenCalled()
  })
})
