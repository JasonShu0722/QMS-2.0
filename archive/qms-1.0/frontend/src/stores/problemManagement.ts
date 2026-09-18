import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { problemManagementApi } from '@/api/problem-management'
import type {
  NumberingRuleItem,
  ProblemCategoryItem,
  ProblemCategoryKey,
  ProblemHandlingLevel,
  ProblemManagementCatalogResponse,
  ProblemModuleKey,
  ProblemResponseMode
} from '@/types/problem-management'

type ProblemCategoryMap = Partial<Record<ProblemCategoryKey, ProblemCategoryItem>>
type ProblemCategoryGroupMap = Partial<Record<ProblemModuleKey, ProblemCategoryItem[]>>

function buildCategoryMap(categories: ProblemCategoryItem[]): ProblemCategoryMap {
  return categories.reduce<ProblemCategoryMap>((result, item) => {
    result[item.key] = item
    return result
  }, {})
}

function buildCategoryGroupMap(categories: ProblemCategoryItem[]): ProblemCategoryGroupMap {
  return categories.reduce<ProblemCategoryGroupMap>((result, item) => {
    const existing = result[item.module_key] ?? []
    result[item.module_key] = [...existing, item]
    return result
  }, {})
}

export const useProblemManagementStore = defineStore('problemManagement', () => {
  const responseModes = ref<ProblemResponseMode[]>([])
  const handlingLevels = ref<ProblemHandlingLevel[]>([])
  const categories = ref<ProblemCategoryItem[]>([])
  const numberingRule = ref<NumberingRuleItem | null>(null)
  const loading = ref(false)
  const loaded = ref(false)

  const categoryMap = computed(() => buildCategoryMap(categories.value))
  const categoriesByModule = computed(() => buildCategoryGroupMap(categories.value))

  function applyCatalog(catalog: ProblemManagementCatalogResponse) {
    responseModes.value = catalog.response_modes
    handlingLevels.value = catalog.handling_levels
    categories.value = catalog.categories
    numberingRule.value = catalog.numbering_rule
    loaded.value = true
  }

  function reset() {
    responseModes.value = []
    handlingLevels.value = []
    categories.value = []
    numberingRule.value = null
    loading.value = false
    loaded.value = false
  }

  function getCategory(categoryKey: ProblemCategoryKey): ProblemCategoryItem | null {
    return categoryMap.value[categoryKey] ?? null
  }

  async function loadCatalog(force = false): Promise<void> {
    const token = localStorage.getItem('access_token')

    if (!token) {
      reset()
      return
    }

    if (!force && loaded.value) {
      return
    }

    loading.value = true

    try {
      const catalog = await problemManagementApi.getCatalog()
      applyCatalog(catalog)
    } catch (error) {
      console.error('Failed to load problem management catalog:', error)
      reset()
    } finally {
      loading.value = false
    }
  }

  return {
    responseModes,
    handlingLevels,
    categories,
    numberingRule,
    loading,
    loaded,
    categoryMap,
    categoriesByModule,
    getCategory,
    loadCatalog,
    reset
  }
})
