import type { PermissionOperation } from '@/types/user'

export type RouteAudience = 'all' | 'internal' | 'supplier'

export interface RoutePermissionMeta {
  modulePath: string
  operation: PermissionOperation
}

export interface RouteAccessMeta {
  requiresAuth?: boolean
  requiresPlatformAdmin?: boolean
  featureKey?: string
  audience?: RouteAudience
  permission?: RoutePermissionMeta
}

export interface RouteAccessContext {
  isAuthenticated: boolean
  isInternal: boolean
  isSupplier: boolean
  isPlatformAdmin: boolean
  isFeatureEnabled: (featureKey: string) => boolean
  hasPermission: (modulePath: string, operation: PermissionOperation) => boolean
}

export function matchesRouteAudience(
  audience: RouteAudience | undefined,
  context: RouteAccessContext
): boolean {
  if (!audience || audience === 'all') {
    return true
  }

  if (audience === 'internal') {
    return context.isInternal
  }

  if (audience === 'supplier') {
    return context.isSupplier
  }

  return false
}

export function canAccessRouteMeta(
  meta: RouteAccessMeta | undefined,
  context: RouteAccessContext
): boolean {
  const requiresAuth = meta?.requiresAuth !== false

  if (requiresAuth && !context.isAuthenticated) {
    return false
  }

  if (!matchesRouteAudience(meta?.audience, context)) {
    return false
  }

  if (meta?.requiresPlatformAdmin && !context.isPlatformAdmin) {
    return false
  }

  if (meta?.featureKey && !context.isFeatureEnabled(meta.featureKey)) {
    return false
  }

  if (meta?.permission) {
    return context.hasPermission(meta.permission.modulePath, meta.permission.operation)
  }

  return true
}
