import type { UserType } from '@/types/user'

export const REMEMBERED_USERNAME_KEY = 'remembered_username'
export const REMEMBERED_PASSWORD_KEY = 'remembered_password'
export const REMEMBERED_USER_TYPE_KEY = 'remembered_user_type'

export interface RememberedLogin {
  username: string
  password: string
  userType: UserType
}

export function loadRememberedLogin(storage: Pick<Storage, 'getItem'>): RememberedLogin | null {
  const username = storage.getItem(REMEMBERED_USERNAME_KEY)
  const password = storage.getItem(REMEMBERED_PASSWORD_KEY)
  const userType = storage.getItem(REMEMBERED_USER_TYPE_KEY)

  if (!username || !password) {
    return null
  }

  return {
    username,
    password,
    userType: userType === 'supplier' ? 'supplier' : 'internal'
  }
}

export function persistRememberedLogin(
  storage: Pick<Storage, 'setItem'>,
  payload: RememberedLogin
) {
  storage.setItem(REMEMBERED_USERNAME_KEY, payload.username)
  storage.setItem(REMEMBERED_PASSWORD_KEY, payload.password)
  storage.setItem(REMEMBERED_USER_TYPE_KEY, payload.userType)
}

export function clearRememberedLogin(storage: Pick<Storage, 'removeItem'>) {
  storage.removeItem(REMEMBERED_USERNAME_KEY)
  storage.removeItem(REMEMBERED_PASSWORD_KEY)
  storage.removeItem(REMEMBERED_USER_TYPE_KEY)
}
