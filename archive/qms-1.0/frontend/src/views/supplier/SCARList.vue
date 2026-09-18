<template>
  <div class="scar-list">
    <div class="page-header">
      <h2>SCAR 管理</h2>
      <el-button v-if="canCreate" type="primary" @click="showCreateDialog = true">
        <el-icon><Plus /></el-icon>
        创建 SCAR
      </el-button>
    </div>

    <el-card class="filter-card" shadow="never">
      <el-form :model="filterForm" inline class="list-filter-form">
        <el-form-item label="状态" class="list-filter-item list-filter-item--status" style="width: 236px">
          <el-select v-model="filterForm.status" placeholder="全部" clearable class="filter-select">
            <el-option label="待处理" value="open" />
            <el-option label="供应商回复中" value="supplier_responding" />
            <el-option label="待审核" value="under_review" />
            <el-option label="已驳回" value="rejected" />
            <el-option label="已批准" value="approved" />
            <el-option label="已关闭" value="closed" />
          </el-select>
        </el-form-item>

        <el-form-item label="严重度" class="list-filter-item list-filter-item--severity" style="width: 206px">
          <el-select v-model="filterForm.severity" placeholder="全部" clearable class="filter-select">
            <el-option label="重大" value="critical" />
            <el-option label="高" value="high" />
            <el-option label="中" value="medium" />
            <el-option label="低" value="low" />
          </el-select>
        </el-form-item>

        <el-form-item label="开始日期" class="list-filter-item list-filter-item--date" style="width: 286px">
          <el-date-picker
            v-model="filterForm.start_date"
            type="date"
            placeholder="选择日期"
            value-format="YYYY-MM-DD"
            class="filter-date"
          />
        </el-form-item>

        <el-form-item label="结束日期" class="list-filter-item list-filter-item--date" style="width: 286px">
          <el-date-picker
            v-model="filterForm.end_date"
            type="date"
            placeholder="选择日期"
            value-format="YYYY-MM-DD"
            class="filter-date"
          />
        </el-form-item>

        <el-form-item class="list-filter-item list-filter-item--actions">
          <el-button type="primary" @click="handleSearch">
            <el-icon><Search /></el-icon>
            查询
          </el-button>
          <el-button @click="handleReset">
            <el-icon><Refresh /></el-icon>
            重置
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="table-card" shadow="never">
      <el-table
        v-loading="loading"
        :data="scarList"
        stripe
        row-key="id"
        :row-class-name="getRowClassName"
        style="cursor: pointer"
        @row-click="handleRowClick"
      >
        <el-table-column label="报告编号" width="170" fixed align="center" header-align="center">
          <template #default="{ row }">
            {{ getReportNumber(row) }}
          </template>
        </el-table-column>
        <el-table-column prop="supplier_name" label="供应商" width="150" align="center" header-align="center" />
        <el-table-column prop="material_code" label="物料编码" width="140" align="center" header-align="center" />
        <el-table-column prop="material_category" label="来料分类" width="120" align="center" header-align="center">
          <template #default="{ row }">
            {{ getMaterialCategoryLabel(row.material_category) }}
          </template>
        </el-table-column>
        <el-table-column prop="defect_description" label="缺陷描述" min-width="220" show-overflow-tooltip align="left" header-align="center" />
        <el-table-column prop="defect_qty" label="不良数量" width="100" align="center" header-align="center" />
        <el-table-column prop="severity" label="严重度" width="100" align="center" header-align="center">
          <template #default="{ row }">
            <el-tag :type="getSeverityType(row.severity)" size="small">
              {{ getSeverityLabel(row.severity) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="120" align="center" header-align="center">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)" size="small">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="deadline" label="截止日期" width="120" align="center" header-align="center">
          <template #default="{ row }">
            <span :class="{ 'text-danger': isOverdue(row.deadline) }">
              {{ formatDate(row.deadline) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="current_handler_name" label="当前处理人" width="120" align="center" header-align="center" />
        <el-table-column label="操作" width="170" fixed="right" align="center" header-align="center">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click.stop="handleView(row)">
              查看
            </el-button>
            <el-button
              v-if="canSubmit8D(row)"
              type="success"
              size="small"
              @click.stop="handleSubmit8D(row)"
            >
              提交8D
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-container">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.page_size"
          :total="pagination.total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="handlePageChange"
        />
      </div>
    </el-card>

    <el-dialog v-model="showCreateDialog" title="创建 SCAR" width="600px" @paste="handleCreateEvidencePaste">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="120px">
        <el-form-item label="供应商" prop="supplier_id">
          <el-select
            v-model="createForm.supplier_id"
            placeholder="请输入供应商代码或名称"
            filterable
            remote
            reserve-keyword
            clearable
            remote-show-suffix
            :remote-method="loadSupplierOptions"
            :loading="supplierSearchLoading"
            @visible-change="handleSupplierSelectVisibleChange"
          >
            <el-option
              v-for="supplier in suppliers"
              :key="supplier.id"
              :label="formatSupplierOptionLabel(supplier)"
              :value="supplier.id"
            >
              <div class="supplier-option">
                <span class="supplier-option__name">{{ supplier.name }}</span>
                <span class="supplier-option__code">{{ supplier.code }}</span>
              </div>
            </el-option>
          </el-select>
        </el-form-item>

        <el-form-item label="物料编码" prop="material_code">
          <el-input v-model="createForm.material_code" placeholder="请输入物料编码" />
        </el-form-item>

        <el-form-item label="来料分类" prop="material_category">
          <el-select v-model="createForm.material_category" placeholder="请选择来料分类">
            <el-option label="结构料（IQ0）" value="structure" />
            <el-option label="电子料（IQ1）" value="electronic" />
          </el-select>
        </el-form-item>

        <el-form-item label="缺陷描述" prop="defect_description">
          <el-input
            v-model="createForm.defect_description"
            type="textarea"
            :rows="4"
            placeholder="请详细描述缺陷情况"
          />
        </el-form-item>

        <el-form-item label="不良数量" prop="defect_qty">
          <el-input-number v-model="createForm.defect_qty" :min="1" />
        </el-form-item>

        <el-form-item label="严重度" prop="severity">
          <el-select v-model="createForm.severity" placeholder="请选择严重度">
            <el-option label="重大" value="critical" />
            <el-option label="高" value="high" />
            <el-option label="中" value="medium" />
            <el-option label="低" value="low" />
          </el-select>
        </el-form-item>

        <el-form-item label="截止日期" prop="deadline">
          <el-date-picker
            v-model="createForm.deadline"
            type="datetime"
            placeholder="选择截止日期"
            value-format="YYYY-MM-DD HH:mm:ss"
          />
        </el-form-item>

        <el-form-item label="附图佐证">
          <div class="scar-evidence" tabindex="0" @paste="handleCreateEvidencePaste">
            <el-upload
              drag
              action="#"
              multiple
              accept="image/*"
              :auto-upload="false"
              :show-file-list="false"
              :on-change="handleCreateEvidenceChange"
            >
              <div class="scar-evidence__drop">
                <div class="scar-evidence__title">上传附图</div>
              </div>
            </el-upload>

            <div v-if="createEvidenceFiles.length" class="scar-evidence__list">
              <div
                v-for="file in createEvidenceFiles"
                :key="file.id"
                class="scar-evidence__item"
              >
                <el-image
                  v-if="file.data_url"
                  class="scar-evidence__thumb"
                  :src="file.data_url"
                  fit="cover"
                  :preview-src-list="createEvidencePreviewList"
                />
                <div class="scar-evidence__meta">
                  <el-input v-model="file.name" size="small" />
                  <span>{{ formatFileSize(file.size) }}</span>
                </div>
                <el-button link type="danger" @click="removeCreateEvidence(file.id)">删除</el-button>
              </div>
            </div>
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreate">
          创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'

import { supplierApi } from '@/api/supplier'
import { useAuthStore } from '@/stores/auth'
import type { EvidenceFile, SCAR, SCARListParams, SCARSupplierOption } from '@/types/supplier'
import { isScarRouteName } from '@/utils/problemIssueSummary'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const loading = ref(false)
const creating = ref(false)
const supplierSearchLoading = ref(false)
const showCreateDialog = ref(false)
const scarList = ref<SCAR[]>([])
const suppliers = ref<SCARSupplierOption[]>([])
const createEvidenceFiles = ref<EvidenceFile[]>([])
const createEvidencePreviewList = computed(() =>
  createEvidenceFiles.value.map((item) => item.data_url).filter(Boolean) as string[]
)

const filterForm = reactive<SCARListParams>({
  status: undefined,
  severity: undefined,
  start_date: undefined,
  end_date: undefined,
})

const pagination = reactive({
  page: 1,
  page_size: 20,
  total: 0,
})

const createForm = reactive<any>({
  supplier_id: undefined,
  material_code: '',
  material_category: undefined,
  defect_description: '',
  defect_qty: 1,
  severity: 'medium',
  deadline: '',
})

const createFormRef = ref()

const createRules = {
  supplier_id: [{ required: true, message: '请选择供应商', trigger: 'change' }],
  material_code: [{ required: true, message: '请输入物料编码', trigger: 'blur' }],
  material_category: [{ required: true, message: '请选择来料分类', trigger: 'change' }],
  defect_description: [{ required: true, message: '请输入缺陷描述', trigger: 'blur' }],
  defect_qty: [{ required: true, message: '请输入不良数量', trigger: 'blur' }],
  severity: [{ required: true, message: '请选择严重度', trigger: 'change' }],
  deadline: [{ required: true, message: '请选择截止日期', trigger: 'change' }],
}

const canCreate = computed(() => authStore.isInternal)
const focusedScarId = computed(() => parseFocusId(route.query.focusId))
const currentRouteName = computed(() => (authStore.isInternal ? 'ScarManagement' : 'SCARList'))

const canSubmit8D = (row: SCAR) => {
  return authStore.isSupplier && ['open', 'supplier_responding', 'rejected'].includes(row.status)
}

function parseFocusId(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) {
    return null
  }

  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function getSeverityType(severity: string) {
  switch (severity) {
    case 'critical':
      return 'danger'
    case 'high':
      return 'warning'
    case 'medium':
      return 'primary'
    default:
      return 'info'
  }
}

function getSeverityLabel(severity: string) {
  const labels: Record<string, string> = {
    critical: '重大',
    high: '高',
    medium: '中',
    low: '低',
  }
  return labels[severity] || severity
}

function getMaterialCategoryLabel(category?: string) {
  const labels: Record<string, string> = {
    structure: '结构料（IQ0）',
    electronic: '电子料（IQ1）',
  }
  return labels[category || ''] || '待选择'
}

function getMaterialCategoryCode(category?: string) {
  const codeMap: Record<string, string> = {
    structure: '0',
    electronic: '1',
  }
  return codeMap[category || ''] || '?'
}

function formatYearMonth(value?: string) {
  const date = value ? new Date(value) : new Date()
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date
  const year = String(validDate.getFullYear()).slice(-2)
  const month = String(validDate.getMonth() + 1).padStart(2, '0')
  return `${year}${month}`
}

function formatSequence(value?: number) {
  if (!value || value < 1) {
    return '001'
  }

  return String(((value - 1) % 999) + 1).padStart(3, '0')
}

function getReportNumber(row: SCAR) {
  return `ZX8D-IQ${getMaterialCategoryCode(row.material_category)}-${formatYearMonth(row.created_at)}-${formatSequence(row.id)}`
}

function getStatusType(status: string) {
  switch (status) {
    case 'approved':
    case 'closed':
      return 'success'
    case 'rejected':
      return 'danger'
    case 'supplier_responding':
      return 'primary'
    case 'under_review':
      return 'warning'
    default:
      return 'info'
  }
}

function getStatusLabel(status: string) {
  const labels: Record<string, string> = {
    open: '待处理',
    supplier_responding: '供应商回复中',
    under_review: '待审核',
    rejected: '已驳回',
    approved: '已批准',
    closed: '已关闭',
  }
  return labels[status] || status
}

function formatDate(date: string) {
  if (!date) {
    return ''
  }
  return new Date(date).toLocaleDateString('zh-CN')
}

function isOverdue(deadline: string) {
  if (!deadline) {
    return false
  }
  return new Date(deadline) < new Date()
}

async function loadFocusedScar() {
  if (!focusedScarId.value || scarList.value.some((item) => item.id === focusedScarId.value)) {
    return
  }

  try {
    const focusedScar = await supplierApi.getSCAR(focusedScarId.value)
    scarList.value = [focusedScar, ...scarList.value]
  } catch (error) {
    console.error('Failed to load focused SCAR:', error)
  }
}

async function loadSCARList() {
  try {
    loading.value = true
    const params: SCARListParams = {
      page: pagination.page,
      page_size: pagination.page_size,
      ...filterForm,
    }
    const response = await supplierApi.getSCARList(params)
    scarList.value = response.items
    pagination.total = response.total
    await loadFocusedScar()
  } catch (error) {
    console.error('Failed to load SCAR list:', error)
    ElMessage.error('加载 SCAR 列表失败')
  } finally {
    loading.value = false
  }
}

async function handleSearch() {
  pagination.page = 1
  await loadSCARList()
}

async function handleReset() {
  Object.assign(filterForm, {
    status: undefined,
    severity: undefined,
    start_date: undefined,
    end_date: undefined,
  })
  await handleSearch()
}

async function handleSizeChange() {
  pagination.page = 1
  await loadSCARList()
}

async function handlePageChange() {
  await loadSCARList()
}

function getSourceRouteName() {
  const routeName = typeof route.name === 'string' ? route.name : ''
  return isScarRouteName(routeName) ? routeName : currentRouteName.value
}

function handleRowClick(row: SCAR) {
  handleView(row)
}

function handleView(row: SCAR) {
  router.push({
    name: authStore.isInternal ? 'ScarEightDReview' : 'EightDForm',
    params: { id: String(row.id) },
    query: {
      sourceRouteName: getSourceRouteName(),
      sourceFocusId: String(row.id),
    },
  })
}

function handleSubmit8D(row: SCAR) {
  router.push({
    name: 'EightDForm',
    params: { id: String(row.id) },
    query: {
      action: 'submit',
      sourceRouteName: getSourceRouteName(),
      sourceFocusId: String(row.id),
    },
  })
}

function getRowClassName({ row }: { row: SCAR }) {
  return focusedScarId.value === row.id ? 'focused-row' : ''
}

function formatSupplierOptionLabel(supplier: SCARSupplierOption) {
  return `${supplier.name} (${supplier.code})`
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function buildEvidenceFile(file: File, source: string): Promise<EvidenceFile> {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: file.name || `图片佐证${createEvidenceFiles.value.length + 1}.png`,
    original_name: file.name,
    size: file.size,
    type: file.type,
    data_url: await readFileAsDataUrl(file),
    source,
    uploaded_at: new Date().toISOString(),
  }
}

async function appendCreateEvidence(files: File[], source: string) {
  const maxSize = 10 * 1024 * 1024
  const imageFiles = files.filter((file) => file.type.startsWith('image/'))
  if (imageFiles.length !== files.length) {
    ElMessage.warning('附图佐证仅支持图片文件')
  }

  const validFiles = imageFiles.filter((file) => file.size <= maxSize)
  if (validFiles.length !== imageFiles.length) {
    ElMessage.warning('单张附图不能超过 10MB')
  }

  const evidenceList = await Promise.all(validFiles.map((file) => buildEvidenceFile(file, source)))
  createEvidenceFiles.value.push(...evidenceList)
}

function handleCreateEvidenceChange(uploadFile: any) {
  const rawFile = uploadFile?.raw as File | undefined
  if (rawFile) {
    void appendCreateEvidence([rawFile], 'upload')
  }
}

function handleCreateEvidencePaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files || [])
  if (!files.length) {
    return
  }

  event.preventDefault()
  void appendCreateEvidence(files, 'paste')
}

function removeCreateEvidence(id?: string) {
  createEvidenceFiles.value = createEvidenceFiles.value.filter((file) => file.id !== id)
}

function formatFileSize(size?: number) {
  if (!size) {
    return ''
  }

  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

async function loadSupplierOptions(keyword = '') {
  supplierSearchLoading.value = true
  try {
    suppliers.value = await supplierApi.getSCARSupplierOptions({
      keyword: keyword.trim() || undefined,
      limit: 20,
    })
  } catch (error: any) {
    suppliers.value = []
    ElMessage.error(error.message || '搜索供应商失败')
  } finally {
    supplierSearchLoading.value = false
  }
}

function handleSupplierSelectVisibleChange(visible: boolean) {
  if (visible && suppliers.value.length === 0) {
    void loadSupplierOptions()
  }
}

async function handleCreate() {
  try {
    await createFormRef.value.validate()
    creating.value = true
    await supplierApi.createSCAR({
      ...createForm,
      evidence_files: createEvidenceFiles.value,
    })
    ElMessage.success('创建成功')
    showCreateDialog.value = false
    createFormRef.value?.resetFields()
    createEvidenceFiles.value = []
    await loadSCARList()
  } catch (error) {
    console.error('Failed to create SCAR:', error)
    if (error !== false) {
      ElMessage.error('创建失败')
    }
  } finally {
    creating.value = false
  }
}

watch(
  () => route.query.focusId,
  async (current, previous) => {
    if (current === previous) {
      return
    }
    await loadSCARList()
  }
)

onMounted(async () => {
  await loadSCARList()
})
</script>

<style scoped lang="scss">
.scar-list {
  padding: 20px;

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;

    h2 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
  }

  .filter-card {
    margin-bottom: 20px;
  }

  .filter-card :deep(.el-card__body) {
    overflow-x: hidden;
  }

  .list-filter-form {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 16px;
    align-items: center;
    overflow-x: hidden;
  }

  .list-filter-form :deep(.el-form-item) {
    margin-bottom: 0;
  }

  .list-filter-item {
    margin-right: 0;
  }

  .list-filter-item :deep(.el-form-item__label) {
    height: 32px;
    padding-right: 6px;
    color: #334155;
    font-size: 13px;
    font-weight: 600;
    line-height: 32px;
  }

  .list-filter-item :deep(.el-form-item__content) {
    width: 100%;
  }

  .list-filter-item--status {
    width: 236px;
  }

  .list-filter-item--severity {
    width: 206px;
  }

  .list-filter-item--date {
    width: 286px;
  }

  .list-filter-item--actions {
    margin-left: auto;
  }

  .list-filter-item :deep(.el-select),
  .list-filter-item :deep(.el-date-editor) {
    width: 100% !important;
  }

  .list-filter-item :deep(.el-select__wrapper),
  .list-filter-item :deep(.el-input__wrapper) {
    min-height: 32px;
    font-size: 13px;
  }

  .filter-select,
  .filter-date {
    width: 100%;
  }

  .supplier-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
  }

  .supplier-option__name {
    overflow: hidden;
    color: #1f2937;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .supplier-option__code {
    flex: 0 0 auto;
    color: #64748b;
    font-size: 12px;
  }

  .scar-evidence {
    width: 100%;
  }

  .scar-evidence :deep(.el-upload),
  .scar-evidence :deep(.el-upload-dragger) {
    width: 100%;
  }

  .scar-evidence__drop {
    padding: 8px 0;
    color: #64748b;
    text-align: center;
  }

  .scar-evidence__title {
    color: #1f2937;
    font-weight: 700;
  }

  .scar-evidence__list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 12px;
  }

  .scar-evidence__item {
    display: grid;
    grid-template-columns: 54px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #f8fafc;
  }

  .scar-evidence__thumb {
    width: 54px;
    height: 54px;
    border-radius: 6px;
    overflow: hidden;
    background: #e2e8f0;
  }

  .scar-evidence__meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;

    span {
      color: #64748b;
      font-size: 12px;
    }
  }

  .table-card {
    :deep(.el-table__header th) {
      text-align: center;
    }

    :deep(.el-table__cell) {
      vertical-align: middle;
    }

    .pagination-container {
      margin-top: 20px;
      display: flex;
      justify-content: flex-end;
    }
  }

  .text-danger {
    color: #f56c6c;
  }

  :deep(.focused-row td) {
    background-color: #ecf5ff !important;
  }

  @media (max-width: 768px) {
    padding: 10px;

    .page-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;

      h2 {
        font-size: 20px;
      }
    }
  }
}
</style>
