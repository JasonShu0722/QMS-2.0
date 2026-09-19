export interface paths {
    "/api/v1/auth/csrf": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuthController_csrf"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuthController_session"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/password-reset/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_completePasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AccountController_profile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["AccountController_update"];
        trace?: never;
    };
    "/api/v1/me/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AccountController_changePassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AccountController_sessions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/sessions/{sessionId}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AccountController_revoke"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminUserController_list"];
        put?: never;
        post: operations["AdminUserController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminUserController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["AdminUserController_update"];
        trace?: never;
    };
    "/api/v1/admin/users/{userId}/password-reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AdminUserController_resetPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/organizations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminOrganizationController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/system/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PermissionsController_permissions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminRoleController_permissions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminRoleController_list"];
        put?: never;
        post: operations["AdminRoleController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/roles/{roleId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminRoleController_detail"];
        put?: never;
        post?: never;
        delete: operations["AdminRoleController_remove"];
        options?: never;
        head?: never;
        patch: operations["AdminRoleController_update"];
        trace?: never;
    };
    "/api/v1/admin/roles/{roleId}/copy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AdminRoleController_copy"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users/{userId}/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminRoleController_assignments"];
        put: operations["AdminRoleController_assign"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/current": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrganizationController_current"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/problem-center": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ReportingController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reports/problems/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ReportingController_report"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/problems/{id}/audit-trail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ReportingController_audit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/problem-index": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProblemIndexController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/problem-index/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProblemIndexController_find"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/problem-index/{id}/workspace": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProblemIndexController_workspace"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["WorkflowController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/{id}/draft": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["WorkflowController_updateDraft"];
        trace?: never;
    };
    "/api/v1/workflows/{id}/validate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["WorkflowController_validate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["WorkflowController_publish"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/{id}/copy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["WorkflowController_copy"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ErrorResponse: {
            code: string;
            message: string;
            fields: {
                [key: string]: string[];
            };
            traceId: string;
        };
        CsrfResponseDto: {
            csrfToken: string;
        };
        LoginDto: {
            identifier: string;
            password: string;
        };
        LoginResponseDto: {
            /** @enum {string} */
            accountType: "INTERNAL" | "SUPPLIER";
            /** @enum {string} */
            landingPath: "/app/workbench" | "/supplier/inbox";
        };
        SessionUserDto: {
            id: string;
            organizationId: string;
            /** @enum {string} */
            accountType: "INTERNAL" | "SUPPLIER";
        };
        SessionResponseDto: {
            user: components["schemas"]["SessionUserDto"];
        };
        CompletePasswordResetDto: {
            temporaryCode: string;
            /** Format: uuid */
            resetId: string;
            newPassword: string;
        };
        OrganizationSummaryDto: {
            id: string;
            code: string;
            name: string;
        };
        AccountProfileDto: {
            id: string;
            username: string;
            email?: string | null;
            /** @enum {string} */
            accountType: "INTERNAL" | "SUPPLIER";
            /** @enum {string} */
            status: "ACTIVE" | "DISABLED";
            mfaEnabled: boolean;
            organization: components["schemas"]["OrganizationSummaryDto"];
        };
        UpdateAccountProfileDto: {
            email?: string | null;
        };
        ChangePasswordDto: {
            currentPassword: string;
            newPassword: string;
        };
        AccountSessionDto: {
            id: string;
            createdAt: string;
            expiresAt: string;
            revokedAt?: string | null;
            isCurrent: boolean;
        };
        AdminUserDto: {
            id: string;
            username: string;
            email?: string | null;
            /** @enum {string} */
            accountType: "INTERNAL" | "SUPPLIER";
            /** @enum {string} */
            status: "ACTIVE" | "DISABLED";
            mfaEnabled: boolean;
            organizationId: string;
            organization: components["schemas"]["OrganizationSummaryDto"];
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        CreateAdminUserDto: {
            username: string;
            email?: string | null;
            /** @enum {string} */
            accountType: "INTERNAL" | "SUPPLIER";
            organizationId: string;
            initialPassword: string;
        };
        UpdateAdminUserDto: {
            email?: string | null;
            /** @enum {string} */
            accountType?: "INTERNAL" | "SUPPLIER";
            organizationId?: string;
            /** @enum {string} */
            status?: "ACTIVE" | "DISABLED";
        };
        ResetAdminUserPasswordDto: {
            temporaryCode: string;
        };
        PasswordResetIssuedDto: {
            /** Format: uuid */
            resetId: string;
            /** Format: date-time */
            expiresAt: string;
        };
        AdminOrganizationDto: {
            id: string;
            code: string;
            name: string;
            /** @enum {string} */
            type: "INTERNAL" | "SUPPLIER";
            permissions: string[];
        };
        PermissionsResponseDto: {
            organizationId: string;
            permissions: string[];
        };
        AdminPermissionDto: {
            id: string;
            code: string;
            name: string;
        };
        AdminRoleDto: {
            id: string;
            organizationId: string | null;
            code: string;
            name: string;
            permissions: components["schemas"]["AdminPermissionDto"][];
        };
        CreateAdminRoleDto: {
            code: string;
            name: string;
            /** Format: uuid */
            organizationId: string;
            permissionCodes: string[];
        };
        CopyAdminRoleDto: {
            code: string;
            name: string;
        };
        UpdateAdminRoleDto: {
            name?: string;
            permissionCodes?: string[];
        };
        AdminUserRolesDto: {
            userId: string;
            organizationId: string;
            roles: components["schemas"]["AdminRoleDto"][];
            permissions: string[];
        };
        AssignAdminRolesDto: {
            roleIds: string[];
        };
        OrganizationDto: {
            id: string;
            code: string;
            name: string;
            /** @enum {string} */
            type: "INTERNAL" | "SUPPLIER";
        };
        CurrentOrganizationResponseDto: {
            organization: components["schemas"]["OrganizationDto"];
            userId: string;
        };
        Object: Record<string, never>;
        ProblemIndexResponseDto: {
            id: string;
            organizationId: string;
            reportNumber: string;
            domainCode: string;
            problemType: string;
            sourceType: string;
            sourceId?: string;
            /** @enum {string} */
            status: "OPEN" | "IN_PROGRESS" | "PENDING" | "RESOLVED" | "CLOSED" | "ARCHIVED";
            severity: string;
            responsibleParty?: string;
            dueAt?: string;
            version: number;
        };
        ProblemIndexPageResponseDto: {
            items: components["schemas"]["ProblemIndexResponseDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        /** @enum {string} */
        WorkflowNodeType: "ACTION" | "APPROVAL" | "VERIFICATION" | "CC" | "REJECT" | "RETURN" | "REOPEN" | "CLOSE";
        WorkflowNodeDraftDto: {
            id: string;
            type: components["schemas"]["WorkflowNodeType"];
            name: string;
            config?: Record<string, never>;
        };
        WorkflowTransitionDraftDto: {
            id: string;
            from: string;
            to: string;
            condition?: Record<string, never>;
        };
        CreateWorkflowDto: {
            nodes: components["schemas"]["WorkflowNodeDraftDto"][];
            transitions: components["schemas"]["WorkflowTransitionDraftDto"][];
            code: string;
            name: string;
            description?: string;
        };
        /** @enum {string} */
        WorkflowVersionStatus: "DRAFT" | "PUBLISHED" | "RETIRED";
        WorkflowVersionResponseDto: {
            id: string;
            workflowDefinitionId: string;
            version: number;
            status: components["schemas"]["WorkflowVersionStatus"];
            publishedAt?: string;
            publishedById?: string;
            changeNote?: string;
            structureSnapshot: Record<string, never>;
        };
        WorkflowDefinitionResponseDto: {
            id: string;
            organizationId: string;
            code: string;
            name: string;
            description?: string;
            version: components["schemas"]["WorkflowVersionResponseDto"];
        };
        UpdateWorkflowDraftDto: {
            nodes: components["schemas"]["WorkflowNodeDraftDto"][];
            transitions: components["schemas"]["WorkflowTransitionDraftDto"][];
            description?: string;
        };
        WorkflowValidationResponseDto: {
            valid: boolean;
            errors: string[];
        };
        PublishWorkflowDto: {
            changeNote?: string;
        };
        CopyWorkflowDto: {
            sourceVersionId?: string;
            description?: string;
        };
        /** @enum {string} */
        ProblemStatus: "OPEN" | "IN_PROGRESS" | "PENDING" | "RESOLVED" | "CLOSED" | "ARCHIVED";
        /** @enum {string} */
        ResponseForm: "BRIEF" | "EIGHT_D";
        /** @enum {string} */
        TaskStatus: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "OVERDUE";
        /** @enum {string} */
        NotificationStatus: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";
        /** @enum {string} */
        PlatformErrorCode: "PROBLEM_NOT_FOUND" | "NUMBERING_CONFLICT" | "WORKFLOW_VERSION_IMMUTABLE" | "WORKFLOW_DRAFT_INVALID" | "WORKFLOW_NODE_FORBIDDEN" | "IDEMPOTENCY_REPLAY" | "CONCURRENCY_CONFLICT" | "AUTH_INVALID_CREDENTIALS" | "AUTH_CURRENT_PASSWORD_INVALID" | "AUTH_PASSWORD_POLICY_INVALID" | "AUTH_SESSION_NOT_FOUND" | "AUTH_CURRENT_SESSION_REVOKE_FORBIDDEN" | "AUTH_SESSION_REQUIRED" | "AUTH_RATE_LIMITED" | "CSRF_INVALID" | "FEATURE_PERMISSION_DENIED" | "ORGANIZATION_SCOPE_AMBIGUOUS" | "ORGANIZATION_SCOPE_DENIED" | "WORKFLOW_PERMISSION_REQUIRED" | "ADMIN_USER_NOT_FOUND" | "ADMIN_USER_DUPLICATE" | "ADMIN_SELF_DISABLE_FORBIDDEN" | "ADMIN_ACCOUNT_TYPE_ORGANIZATION_MISMATCH" | "ADMIN_ROLE_NOT_FOUND" | "ADMIN_ROLE_DUPLICATE" | "ADMIN_ROLE_IN_USE" | "ADMIN_PERMISSION_NOT_FOUND" | "ADMIN_SELF_LOCK_FORBIDDEN" | "IDEMPOTENCY_KEY_REQUIRED" | "AUTH_PASSWORD_RESET_INVALID" | "ADMIN_GLOBAL_ROLE_IMMUTABLE";
        PlatformTypesDto: {
            /**
             * @description Stable code owned by the domain service.
             * @example neutral-test
             */
            problemDomainCode: string;
            problemStatus: components["schemas"]["ProblemStatus"];
            responseForm: components["schemas"]["ResponseForm"];
            workflowNodeType: components["schemas"]["WorkflowNodeType"];
            workflowVersionStatus: components["schemas"]["WorkflowVersionStatus"];
            taskStatus: components["schemas"]["TaskStatus"];
            notificationStatus: components["schemas"]["NotificationStatus"];
            platformErrorCode: components["schemas"]["PlatformErrorCode"];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    AuthController_csrf: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CsrfResponseDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AuthController_login: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginResponseDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AuthController_session: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionResponseDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AuthController_completePasswordReset: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CompletePasswordResetDto"];
            };
        };
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AuthController_logout: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AccountController_profile: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountProfileDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AccountController_update: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateAccountProfileDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountProfileDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AccountController_changePassword: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangePasswordDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AccountController_sessions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountSessionDto"][];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AccountController_revoke: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
            };
            path: {
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AdminUserController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                status?: "ACTIVE" | "DISABLED";
                accountType?: "INTERNAL" | "SUPPLIER";
                search?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserDto"][];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AdminUserController_create: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateAdminUserDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AdminUserController_detail: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header?: never;
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AdminUserController_update: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateAdminUserDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AdminUserController_resetPassword: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResetAdminUserPasswordDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PasswordResetIssuedDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AdminOrganizationController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrganizationDto"][];
                };
            };
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    PermissionsController_permissions: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PermissionsResponseDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AdminRoleController_permissions: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPermissionDto"][];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AdminRoleController_list: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminRoleDto"][];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AdminRoleController_create: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateAdminRoleDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminRoleDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AdminRoleController_detail: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header?: never;
            path: {
                roleId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminRoleDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AdminRoleController_remove: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                roleId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AdminRoleController_update: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                roleId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateAdminRoleDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminRoleDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AdminRoleController_copy: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                roleId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CopyAdminRoleDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminRoleDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AdminRoleController_assignments: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header?: never;
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserRolesDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AdminRoleController_assign: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssignAdminRolesDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserRolesDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    OrganizationController_current: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CurrentOrganizationResponseDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ReportingController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ReportingController_report: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ReportingController_audit: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProblemIndexController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
                domainCode?: string;
                problemType?: string;
                status?: "OPEN" | "IN_PROGRESS" | "PENDING" | "RESOLVED" | "CLOSED" | "ARCHIVED";
                severity?: string;
                search?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemIndexPageResponseDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ProblemIndexController_find: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemIndexResponseDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ProblemIndexController_workspace: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemIndexResponseDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    WorkflowController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateWorkflowDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkflowDefinitionResponseDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    WorkflowController_updateDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateWorkflowDraftDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkflowDefinitionResponseDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    WorkflowController_validate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkflowValidationResponseDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    WorkflowController_publish: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PublishWorkflowDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkflowVersionResponseDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    WorkflowController_copy: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CopyWorkflowDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkflowDefinitionResponseDto"];
                };
            };
            /** @description Controlled API error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
}
