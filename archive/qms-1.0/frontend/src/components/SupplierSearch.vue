<template>
  <!-- 桌面端版本 (Element Plus) -->
  <el-select
    v-if="!mobile"
    :model-value="modelValue"
    filterable
    remote
    reserve-keyword
    placeholder="请输入供应商名称或代码进行搜索"
    :remote-method="handleSearch"
    :loading="loading"
    clearable
    style="width: 100%"
    @update:model-value="handleSelect"
  >
    <el-option
      v-for="supplier in suppliers"
      :key="supplier.id"
      :label="`${supplier.name} (${supplier.code})`"
      :value="supplier.id"
    >
      <div class="supplier-option">
        <span class="supplier-name">{{ supplier.name }}</span>
        <span class="supplier-code">{{ supplier.code }}</span>
      </div>
    </el-option>
  </el-select>

  <!-- 移动端版本 (原生 HTML + Tailwind) -->
  <div v-else class="mobile-supplier-search">
    <div class="relative">
      <input
        v-model="searchKeyword"
        type="text"
        placeholder="请输入供应商名称或代码"
        class="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        @input="handleSearchDebounced"
        @focus="showDropdown = true"
      />
      
      <!-- 搜索结果下拉列表 -->
      <div
        v-if="showDropdown && (suppliers.length > 0 || loading)"
        class="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
      >
        <!-- 加载状态 -->
        <div v-if="loading" class="p-4 text-center text-gray-500">
          搜索中...
        </div>
        
        <!-- 搜索结果 -->
        <div
          v-for="supplier in suppliers"
          :key="supplier.id"
          class="p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
          @click="handleSelectMobile(supplier)"
        >
          <div class="font-medium text-gray-900">{{ supplier.name }}</div>
          <div class="text-sm text-gray-500">{{ supplier.code }}</div>
        </div>
        
        <!-- 无结果 -->
        <div v-if="!loading && suppliers.length === 0 && searchKeyword" class="p-4 text-center text-gray-500">
          未找到匹配的供应商
        </div>
      </div>
    </div>
    
    <!-- 已选择的供应商显示 -->
    <div v-if="supplierName" class="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-blue-900">已选择：{{ supplierName }}</div>
      </div>
      <button
        type="button"
        class="text-blue-500 hover:text-blue-700"
        @click="handleClearMobile"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi } from '@/api/admin'

interface Supplier {
  id: number
  name: string
  code: string
  status: string
}

interface Props {
  modelValue?: number
  supplierName?: string
  mobile?: boolean
}

interface Emits {
  (e: 'update:modelValue', value: number | undefined): void
  (e: 'update:supplierName', value: string): void
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: undefined,
  supplierName: '',
  mobile: false
})

const emit = defineEmits<Emits>()

// 状态
const suppliers = ref<Supplier[]>([])
const loading = ref(false)
const searchKeyword = ref('')
const showDropdown = ref(false)

// 防抖定时器
let debounceTimer: ReturnType<typeof setTimeout> | null = null

// 搜索供应商
const handleSearch = async (query: string) => {
  if (!query || query.trim().length === 0) {
    suppliers.value = []
    return
  }

  loading.value = true

  try {
    const response = await adminApi.getSuppliers({
      keyword: query.trim(),
      status: 'active',
    })
    suppliers.value = response
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '搜索供应商失败')
    suppliers.value = []
  } finally {
    loading.value = false
  }
}

// 防抖搜索（移动端）
const handleSearchDebounced = () => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  debounceTimer = setTimeout(() => {
    handleSearch(searchKeyword.value)
  }, 300)
}

// 选择供应商（桌面端）
const handleSelect = (supplierId: number | undefined) => {
  emit('update:modelValue', supplierId)
  
  if (supplierId) {
    const selectedSupplier = suppliers.value.find(s => s.id === supplierId)
    if (selectedSupplier) {
      emit('update:supplierName', selectedSupplier.name)
    }
  } else {
    emit('update:supplierName', '')
  }
}

// 选择供应商（移动端）
const handleSelectMobile = (supplier: Supplier) => {
  emit('update:modelValue', supplier.id)
  emit('update:supplierName', supplier.name)
  searchKeyword.value = supplier.name
  showDropdown.value = false
}

// 清除选择（移动端）
const handleClearMobile = () => {
  emit('update:modelValue', undefined)
  emit('update:supplierName', '')
  searchKeyword.value = ''
  suppliers.value = []
}

// 监听外部点击关闭下拉列表
if (props.mobile) {
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (!target.closest('.mobile-supplier-search')) {
      showDropdown.value = false
    }
  })
}

// 监听 supplierName 变化，更新搜索关键词
watch(() => props.supplierName, (newName) => {
  if (props.mobile && newName) {
    searchKeyword.value = newName
  }
})
</script>

<style scoped>
.supplier-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.supplier-name {
  font-weight: 500;
  color: #303133;
}

.supplier-code {
  font-size: 12px;
  color: #909399;
  margin-left: 8px;
}

.mobile-supplier-search {
  position: relative;
}
</style>
