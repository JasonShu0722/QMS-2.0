export const TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'OVERDUE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
