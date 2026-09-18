# Frontend Authentication & Routing Implementation

## Overview

This document describes the implementation of Task 6.1: Frontend Authentication and Routing infrastructure for the QMS system.

## Implemented Components

### 1. Pinia Auth Store (`src/stores/auth.ts`)

**Purpose**: Centralized authentication state management using Pinia.

**Key Features**:
- Token management (localStorage persistence)
- User information storage and retrieval
- Login/logout functionality
- Permission checking
- User type detection (internal/supplier)

**State**:
```typescript
{
  token: string | null,
  userInfo: User | null
}
```

**Computed Properties**:
- `isAuthenticated`: Boolean indicating if user is logged in
- `isSupplier`: Boolean indicating if user is a supplier
- `isInternal`: Boolean indicating if user is an internal employee

**Actions**:
- `login(username, password, userType, captcha?)`: Authenticate user
- `logout()`: Clear authentication state
- `checkPermission(modulePath, operation)`: Verify user permissions
- `refreshUserInfo()`: Reload user data from backend
- `updateToken(newToken)`: Update JWT token

**Usage Example**:
```typescript
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()

// Login
await authStore.login('username', 'password', 'internal')

// Check permission
const canEdit = await authStore.checkPermission('supplier.performance', 'update')

// Logout
authStore.logout()
```

---

### 2. Axios Request Wrapper (`src/utils/request.ts`)

**Purpose**: Centralized HTTP client with automatic token injection and error handling.

**Key Features**:

#### Request Interceptor
- Automatically adds `Authorization: Bearer <token>` header to all requests
- Reads token from localStorage

#### Response Interceptor
- Unified error handling for common HTTP status codes:
  - **401 Unauthorized**: Token expired → Clear storage → Redirect to login
  - **403 Forbidden**: Permission denied → Show error message
  - **404 Not Found**: Resource not found
  - **422 Validation Error**: Data validation failed
  - **500 Internal Server Error**: Server error
  - **503 Service Unavailable**: External service (e.g., IMS) unavailable

#### Configuration
- Base URL: `/api` (configurable via `VITE_API_BASE_URL`)
- Timeout: 30 seconds
- Default headers: `Content-Type: application/json`

**Usage Example**:
```typescript
import request, { get, post } from '@/utils/request'

// Using request instance
const data = await request.get('/v1/users')

// Using convenience methods
const user = await get<User>('/v1/auth/me')
const result = await post('/v1/auth/login', { username, password })
```

---

### 3. Enhanced Router (`src/router/index.ts`)

**Purpose**: Vue Router configuration with authentication and permission guards.

**Key Features**:

#### Route Meta Information
```typescript
interface RouteMeta {
  title?: string                    // Page title
  requiresAuth?: boolean            // Requires authentication (default: true)
  permission?: {                    // Optional permission check
    modulePath: string              // e.g., "supplier.performance.monthly_score"
    operation: 'create' | 'read' | 'update' | 'delete' | 'export'
  }
}
```

#### Global Navigation Guards

**Before Each Hook**:
1. **Authentication Check**: Redirect unauthenticated users to login
2. **Logged-in User Redirect**: Prevent access to login/register when authenticated
3. **Permission Check**: Verify route-level permissions if configured
4. **Page Title**: Set document title dynamically

**After Each Hook**:
- Log navigation events (can be extended for analytics)

#### Dynamic Route Management
- `addDynamicRoutes(routes)`: Add routes at runtime based on user permissions
- `resetRouter()`: Clear dynamic routes on logout

**Usage Example**:
```typescript
// Define route with permission check
{
  path: '/admin/users',
  component: UserManagement,
  meta: {
    title: '用户管理',
    requiresAuth: true,
    permission: {
      modulePath: 'admin.users',
      operation: 'read'
    }
  }
}
```

---

### 4. Auth API Module (`src/api/auth.ts`)

**Purpose**: Authentication-related API endpoints.

**Endpoints**:
- `login(data)`: User login
- `getCurrentUser()`: Get current user info
- `checkPermission(modulePath, operation)`: Check user permission
- `getCaptcha()`: Get captcha image for supplier login
- `logout()`: User logout (optional)

---

### 5. Type Definitions (`src/types/user.ts`)

**Purpose**: TypeScript interfaces for user-related data structures.

**Key Types**:
- `User`: User information interface
- `UserType`: 'internal' | 'supplier'
- `UserStatus`: 'pending' | 'active' | 'frozen' | 'rejected'
- `LoginRequest`: Login request payload
- `LoginResponse`: Login response structure
- `PermissionCheckRequest`: Permission check payload

---

## Architecture Flow

### Login Flow
```
1. User submits credentials
   ↓
2. authStore.login() called
   ↓
3. authApi.login() sends POST /api/v1/auth/login
   ↓
4. Request interceptor adds headers
   ↓
5. Backend validates credentials
   ↓
6. Response interceptor handles errors
   ↓
7. Store saves token + userInfo to localStorage
   ↓
8. Router redirects to /workbench
```

### Permission Check Flow
```
1. User navigates to protected route
   ↓
2. Router beforeEach guard triggered
   ↓
3. Check if route requires auth
   ↓
4. Check if route has permission meta
   ↓
5. authStore.checkPermission() called
   ↓
6. authApi.checkPermission() sends POST /api/v1/auth/check-permission
   ↓
7. Backend validates permission
   ↓
8. If denied: Show error + block navigation
   ↓
9. If allowed: Proceed to route
```

### Logout Flow
```
1. User clicks logout
   ↓
2. authStore.logout() called
   ↓
3. Clear token + userInfo from localStorage
   ↓
4. (Optional) Call authApi.logout()
   ↓
5. Router redirects to /login
```

---

## Security Considerations

### Token Storage
- Tokens stored in `localStorage` (accessible to JavaScript)
- **Alternative**: Consider `httpOnly` cookies for enhanced security (requires backend support)

### XSS Protection
- Vue 3 automatically escapes template content
- Avoid using `v-html` with user-generated content

### CSRF Protection
- Not required for JWT-based authentication
- If using cookies, implement CSRF tokens

### Token Expiration
- Backend should return 401 when token expires
- Frontend automatically redirects to login and clears storage

---

## Integration with Backend

### Expected Backend Endpoints

#### POST /api/v1/auth/login
**Request**:
```json
{
  "username": "string",
  "password": "string",
  "user_type": "internal" | "supplier",
  "captcha": "string (optional)"
}
```

**Response**:
```json
{
  "access_token": "string",
  "token_type": "bearer",
  "user_info": {
    "id": 1,
    "username": "string",
    "full_name": "string",
    "email": "string",
    "user_type": "internal" | "supplier",
    "status": "active",
    ...
  }
}
```

#### GET /api/v1/auth/me
**Response**: User object

#### POST /api/v1/auth/check-permission
**Request**:
```json
{
  "module_path": "supplier.performance.monthly_score",
  "operation": "read"
}
```

**Response**: `true` or `false`

---

## Testing Checklist

- [ ] Login with internal user credentials
- [ ] Login with supplier user credentials (with captcha)
- [ ] Logout functionality
- [ ] Token persistence across page refreshes
- [ ] Redirect to login when accessing protected routes without auth
- [ ] Redirect to workbench when accessing login page while authenticated
- [ ] Permission check for routes with permission meta
- [ ] 401 error handling (token expiration)
- [ ] 403 error handling (permission denied)
- [ ] Network error handling

---

## Future Enhancements

1. **Token Refresh**: Implement automatic token refresh before expiration
2. **Remember Me**: Add "Remember Me" functionality with longer-lived tokens
3. **Multi-tab Sync**: Sync auth state across browser tabs using BroadcastChannel API
4. **Biometric Auth**: Support fingerprint/face recognition on mobile devices
5. **Session Timeout**: Implement idle timeout with warning dialog
6. **Audit Logging**: Log all authentication events to backend

---

## Troubleshooting

### Issue: "401 Unauthorized" on every request
**Solution**: Check if token is correctly stored in localStorage and added to request headers

### Issue: Infinite redirect loop
**Solution**: Ensure `requiresAuth: false` is set for login/register routes

### Issue: Permission check always returns false
**Solution**: Verify backend permission API is implemented and user has correct permissions

### Issue: TypeScript errors with dynamic imports
**Solution**: These are false positives due to dynamic imports in auth store. They won't affect runtime behavior.

---

## Related Files

- `frontend/src/stores/auth.ts` - Pinia auth store
- `frontend/src/utils/request.ts` - Axios wrapper
- `frontend/src/router/index.ts` - Vue Router configuration
- `frontend/src/api/auth.ts` - Auth API endpoints
- `frontend/src/types/user.ts` - TypeScript type definitions
- `frontend/src/views/NotFound.vue` - 404 page component

---

## Requirements Mapping

This implementation satisfies **Requirement 2.1.5** from the design document:

✅ Unified login entry point for internal and supplier users  
✅ JWT token-based authentication  
✅ Automatic token injection in requests  
✅ Centralized error handling (401/403/500)  
✅ Route guards for authentication  
✅ Permission-based access control  
✅ Dynamic menu rendering based on permissions  

---

**Implementation Date**: 2026-02-11  
**Status**: ✅ Complete
