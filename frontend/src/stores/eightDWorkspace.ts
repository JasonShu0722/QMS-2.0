import { defineStore } from 'pinia'

export type EightDWorkspaceTabKind = 'supplier' | 'customer'

export interface EightDWorkspaceTab {
  key: string
  kind: EightDWorkspaceTabKind
  recordId: number
  title: string
  sourceRouteName?: string
  sourceFocusId?: string
  sourceComplaintId?: string
  action?: string
}

const STORAGE_KEY = 'qms.eight-d-workspace'

type EightDWorkspaceState = {
  tabs: EightDWorkspaceTab[]
  activeKey: string
  initialized: boolean
}

function buildDefaultTitle(kind: EightDWorkspaceTabKind, recordId: number) {
  return kind === 'supplier' ? `SCAR 8D #${recordId}` : `客诉 8D #${recordId}`
}

function isBrowser() {
  return typeof window !== 'undefined'
}

export const useEightDWorkspaceStore = defineStore('eightDWorkspace', {
  state: (): EightDWorkspaceState => ({
    tabs: [],
    activeKey: 'overview',
    initialized: false,
  }),

  actions: {
    initialize() {
      if (this.initialized) {
        return
      }

      if (isBrowser()) {
        const raw = window.sessionStorage.getItem(STORAGE_KEY)
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as Partial<EightDWorkspaceState>
            this.tabs = Array.isArray(parsed.tabs) ? parsed.tabs : []
            this.activeKey =
              typeof parsed.activeKey === 'string' && parsed.activeKey ? parsed.activeKey : 'overview'
          } catch (error) {
            console.error('Failed to restore 8D workspace tabs:', error)
          }
        }
      }

      this.initialized = true
    },

    persist() {
      if (!isBrowser()) {
        return
      }

      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          tabs: this.tabs,
          activeKey: this.activeKey,
        })
      )
    },

    openTab(payload: {
      kind: EightDWorkspaceTabKind
      recordId: number
      sourceRouteName?: string
      sourceFocusId?: string
      sourceComplaintId?: string
      action?: string
      title?: string
    }) {
      this.initialize()

      const key = `${payload.kind}:${payload.recordId}`
      const existingTab = this.tabs.find((item) => item.key === key)

      if (existingTab) {
        existingTab.sourceRouteName = payload.sourceRouteName ?? existingTab.sourceRouteName
        existingTab.sourceFocusId = payload.sourceFocusId ?? existingTab.sourceFocusId
        existingTab.sourceComplaintId = payload.sourceComplaintId ?? existingTab.sourceComplaintId
        existingTab.action = payload.action ?? existingTab.action
        existingTab.title = payload.title || existingTab.title
      } else {
        this.tabs.push({
          key,
          kind: payload.kind,
          recordId: payload.recordId,
          title: payload.title || buildDefaultTitle(payload.kind, payload.recordId),
          sourceRouteName: payload.sourceRouteName,
          sourceFocusId: payload.sourceFocusId,
          sourceComplaintId: payload.sourceComplaintId,
          action: payload.action,
        })
      }

      this.activeKey = key
      this.persist()
      return key
    },

    closeTab(key: string) {
      this.initialize()

      const currentIndex = this.tabs.findIndex((item) => item.key === key)
      if (currentIndex === -1) {
        return
      }

      this.tabs.splice(currentIndex, 1)

      if (this.activeKey === key) {
        const fallbackTab = this.tabs[currentIndex - 1] || this.tabs[currentIndex] || null
        this.activeKey = fallbackTab?.key || 'overview'
      }

      this.persist()
    },

    setActiveKey(key: string) {
      this.initialize()
      this.activeKey = key
      this.persist()
    },

    updateTabMeta(key: string, patch: Partial<Pick<EightDWorkspaceTab, 'title' | 'action'>>) {
      this.initialize()

      const tab = this.tabs.find((item) => item.key === key)
      if (!tab) {
        return
      }

      Object.assign(tab, patch)
      this.persist()
    },

    clearAction(key: string) {
      this.updateTabMeta(key, { action: undefined })
    },
  },
})
