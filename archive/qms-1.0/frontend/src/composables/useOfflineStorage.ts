import { ref } from 'vue'

/**
 * 离线暂存 Composable
 * 用于在无网络环境下暂存数据，网络恢复后自动同步
 * 
 * 使用场景：审核员在车间无信号场景，支持将审核打分表"暂存本地"
 */

interface OfflineData {
  id: string
  type: string  // 数据类型标识，如 'audit', 'inspection'
  data: any
  timestamp: number
  synced: boolean
}

const STORAGE_KEY = 'qms_offline_data'

export function useOfflineStorage() {
  const isOnline = ref(navigator.onLine)
  const pendingItems = ref<OfflineData[]>([])

  // 监听网络状态变化
  const updateOnlineStatus = () => {
    isOnline.value = navigator.onLine
    if (isOnline.value) {
      // 网络恢复，尝试同步
      syncPendingData()
    }
  }

  // 保存数据到本地存储
  const saveToLocal = (type: string, data: any): string => {
    const id = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const offlineData: OfflineData = {
      id,
      type,
      data,
      timestamp: Date.now(),
      synced: false
    }

    // 获取现有数据
    const existing = getLocalData()
    existing.push(offlineData)
    
    // 保存到 localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing))
    pendingItems.value = existing.filter(item => !item.synced)
    
    return id
  }

  // 从本地存储获取数据
  const getLocalData = (): OfflineData[] => {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  }

  // 获取待同步的数据
  const getPendingData = (): OfflineData[] => {
    return getLocalData().filter(item => !item.synced)
  }

  // 标记数据为已同步
  const markAsSynced = (id: string) => {
    const data = getLocalData()
    const item = data.find(d => d.id === id)
    if (item) {
      item.synced = true
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      pendingItems.value = data.filter(item => !item.synced)
    }
  }

  // 删除已同步的数据
  const clearSyncedData = () => {
    const data = getLocalData()
    const unsyncedData = data.filter(item => !item.synced)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unsyncedData))
    pendingItems.value = unsyncedData
  }

  // 同步待处理数据（预留接口）
  const syncPendingData = async () => {
    const pending = getPendingData()
    
    if (pending.length === 0) {
      return
    }

    console.log(`[离线同步] 发现 ${pending.length} 条待同步数据`)

    // 预留：实际同步逻辑需要根据具体业务实现
    // 这里仅提供框架，实际使用时需要调用对应的 API
    for (const item of pending) {
      try {
        // TODO: 根据 item.type 调用对应的 API 进行同步
        // 例如：
        // if (item.type === 'audit') {
        //   await auditApi.submitAudit(item.data)
        // }
        
        console.log(`[离线同步] 数据 ${item.id} 同步成功（预留接口）`)
        markAsSynced(item.id)
      } catch (error) {
        console.error(`[离线同步] 数据 ${item.id} 同步失败:`, error)
      }
    }

    // 清理已同步的数据
    clearSyncedData()
  }

  // 初始化
  const init = () => {
    // 加载待同步数据
    pendingItems.value = getPendingData()

    // 监听网络状态
    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)

    // 如果当前在线，尝试同步
    if (isOnline.value) {
      syncPendingData()
    }
  }

  // 清理
  const cleanup = () => {
    window.removeEventListener('online', updateOnlineStatus)
    window.removeEventListener('offline', updateOnlineStatus)
  }

  return {
    isOnline,
    pendingItems,
    saveToLocal,
    getPendingData,
    syncPendingData,
    markAsSynced,
    clearSyncedData,
    init,
    cleanup
  }
}
