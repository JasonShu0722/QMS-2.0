import type { User } from './user'

export type TaskUrgency = 'overdue' | 'urgent' | 'normal'
export type TaskColor = 'red' | 'yellow' | 'green'

export interface TodoTask {
  task_type: string
  task_id: string | number
  deadline: string | null
  remaining_hours: number
  urgency: TaskUrgency
  color: TaskColor
  link: string
  title?: string
  description?: string
}

export interface Metric {
  key: string
  name: string
  value: string | number
  status: 'good' | 'warning' | 'danger'
  achievement?: number
  unit?: string
}

export interface TodoSummary {
  total: number
  overdue: number
  due_soon: number
}

export interface PerformanceStatus {
  grade: 'A' | 'B' | 'C' | 'D'
  score: number
  deduction_this_month: number
}

export interface QuickAction {
  title: string
  description: string
  link: string
}

export interface DashboardFeatureBlocks {
  metrics: boolean
  announcements: boolean
  notifications: boolean
}

export interface DashboardBase {
  user_info: User
  environment: string
  quick_actions: QuickAction[]
  feature_blocks: DashboardFeatureBlocks
  todo_summary: TodoSummary
}

export interface InternalDashboard extends DashboardBase {
  metrics: Metric[]
  todos: TodoTask[]
  notifications: number
}

export interface SupplierDashboard extends DashboardBase {
  performance_status: PerformanceStatus | null
  action_required_tasks: TodoTask[]
}

export type DashboardData = InternalDashboard | SupplierDashboard

export interface ChangePasswordRequest {
  old_password: string
  new_password: string
}

export interface ProfileUpdateRequest {
  full_name?: string
  email?: string
  phone?: string | null
  department?: string | null
  position?: string | null
}

export interface SignatureUploadResponse {
  signature_path: string
  message: string
}
