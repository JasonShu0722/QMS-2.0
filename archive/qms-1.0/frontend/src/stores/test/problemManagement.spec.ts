import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProblemManagementStore } from '@/stores/problemManagement'

const { getCatalogMock } = vi.hoisted(() => ({
  getCatalogMock: vi.fn()
}))

vi.mock('@/api/problem-management', () => ({
  problemManagementApi: {
    getCatalog: getCatalogMock
  }
}))

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

describe('problem management store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    installStorage()
  })

  it('skips catalog loading when the user is not authenticated', async () => {
    const store = useProblemManagementStore()

    await store.loadCatalog()

    expect(getCatalogMock).not.toHaveBeenCalled()
    expect(store.loaded).toBe(false)
    expect(store.categories).toEqual([])
  })

  it('hydrates shared category and numbering metadata', async () => {
    installStorage({ access_token: 'token-123' })
    getCatalogMock.mockResolvedValue({
      response_modes: ['brief', 'eight_d'],
      handling_levels: ['simple', 'complex', 'major'],
      categories: [
        {
          key: 'CQ1',
          category_code: 'CQ',
          subcategory_code: '1',
          module_key: 'customer_quality',
          label: '售后'
        },
        {
          key: 'AQ3',
          category_code: 'AQ',
          subcategory_code: '3',
          module_key: 'audit_management',
          label: '客户审核问题'
        }
      ],
      numbering_rule: {
        issue_prefix: 'ZXQ',
        report_prefix: 'ZX8D',
        issue_pattern: 'ZXQ-<分类子类>-<YYMM>-<SEQ3>',
        report_pattern: 'ZX8D-<分类子类>-<YYMM>-<SEQ3>'
      }
    })

    const store = useProblemManagementStore()
    await store.loadCatalog()

    expect(getCatalogMock).toHaveBeenCalledTimes(1)
    expect(store.loaded).toBe(true)
    expect(store.responseModes).toEqual(['brief', 'eight_d'])
    expect(store.handlingLevels).toEqual(['simple', 'complex', 'major'])
    expect(store.numberingRule?.issue_prefix).toBe('ZXQ')
    expect(store.getCategory('CQ1')?.label).toBe('售后')
    expect(store.categoryMap.AQ3?.label).toBe('客户审核问题')
    expect(store.categoriesByModule.customer_quality).toEqual([
      expect.objectContaining({ key: 'CQ1' })
    ])
  })

  it('reuses the in-memory catalog until force reload is requested', async () => {
    installStorage({ access_token: 'token-456' })
    getCatalogMock.mockResolvedValue({
      response_modes: ['brief'],
      handling_levels: ['simple'],
      categories: [],
      numbering_rule: {
        issue_prefix: 'ZXQ',
        report_prefix: 'ZX8D',
        issue_pattern: 'ZXQ-<分类子类>-<YYMM>-<SEQ3>',
        report_pattern: 'ZX8D-<分类子类>-<YYMM>-<SEQ3>'
      }
    })

    const store = useProblemManagementStore()
    await store.loadCatalog()
    await store.loadCatalog()
    await store.loadCatalog(true)

    expect(getCatalogMock).toHaveBeenCalledTimes(2)
  })
})
