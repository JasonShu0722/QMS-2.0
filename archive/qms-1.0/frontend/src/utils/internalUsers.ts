import type { InternalUserOption } from '@/types/problem-management'

export function formatInternalUserLabel(user: InternalUserOption): string {
  const baseName = user.full_name || user.username
  return user.department ? `${baseName} (${user.username}) / ${user.department}` : `${baseName} (${user.username})`
}

export function buildInternalUserLabelMap(
  users: InternalUserOption[]
): Record<number, string> {
  return users.reduce<Record<number, string>>((result, user) => {
    result[user.id] = formatInternalUserLabel(user)
    return result
  }, {})
}
