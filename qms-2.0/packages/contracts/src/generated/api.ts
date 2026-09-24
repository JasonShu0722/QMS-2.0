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
    "/api/v1/me/security": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["MfaController_status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/mfa/enrollment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MfaController_enrollment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/mfa/enrollment/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MfaController_confirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/mfa/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MfaController_verify"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/reauthenticate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MfaController_reauthenticate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/mfa/recovery-codes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MfaController_recoveryCodes"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/mfa/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MfaController_disable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/email-verification": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["EmailRecoveryController_requestVerification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/email-verification/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["EmailRecoveryController_verify"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/password-recovery": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["EmailRecoveryController_requestRecovery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/password-recovery/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["EmailRecoveryController_complete"];
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
    "/api/v1/admin/permission-catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminRoleController_catalog"];
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
    "/api/v1/organizations/tree": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrganizationGovernanceController_tree"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/children": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["OrganizationGovernanceController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}": {
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
        patch: operations["OrganizationGovernanceController_update"];
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/departments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrganizationGovernanceController_departments"];
        put?: never;
        post: operations["OrganizationGovernanceController_createDepartment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/departments/{departmentId}": {
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
        patch: operations["OrganizationGovernanceController_updateDepartment"];
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/positions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrganizationGovernanceController_positions"];
        put?: never;
        post: operations["OrganizationGovernanceController_createPosition"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/positions/{positionId}": {
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
        patch: operations["OrganizationGovernanceController_updatePosition"];
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/users/{userId}/positions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrganizationGovernanceController_userPositions"];
        put: operations["OrganizationGovernanceController_replaceUserPositions"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/audit-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuditQueryController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/audit-exports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuditExportController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/audit-exports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuditExportController_download"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/configuration/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PlatformConfigurationController_settings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["PlatformConfigurationController_updateSettings"];
        trace?: never;
    };
    "/api/v1/admin/configuration/notification-rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PlatformConfigurationController_rules"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/configuration/notification-rules/{kind}": {
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
        patch: operations["PlatformConfigurationController_updateRule"];
        trace?: never;
    };
    "/api/v1/admin/configuration/position-categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PlatformConfigurationController_categories"];
        put?: never;
        post: operations["PlatformConfigurationController_createCategory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/configuration/position-categories/{id}": {
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
        patch: operations["PlatformConfigurationController_updateCategory"];
        trace?: never;
    };
    "/api/v1/files/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FileController_initialize"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FileController_complete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FileController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FileController_download"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FileController_remove"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/outbox/failures": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OutboxAdministrationController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/outbox/failures/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["OutboxAdministrationController_retry"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TaskInboxController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{id}/claim": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TaskInboxController_claim"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{id}/release": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TaskInboxController_release"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NotificationInboxController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/{id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NotificationInboxController_read"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierPortalNotificationController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/notifications/{id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierPortalNotificationController_read"];
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
    "/api/v1/problem-views": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProblemSavedViewController_list"];
        put?: never;
        post: operations["ProblemSavedViewController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/problem-views/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["ProblemSavedViewController_remove"];
        options?: never;
        head?: never;
        patch: operations["ProblemSavedViewController_update"];
        trace?: never;
    };
    "/api/v1/workflows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WorkflowController_list"];
        put?: never;
        post: operations["WorkflowController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WorkflowController_options"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WorkflowController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/{id}/versions/{versionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WorkflowController_version"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/validate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["WorkflowController_validateGraph"];
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
    "/api/v1/problem-index/{id}/upgrade-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WorkflowUpgradeController_preview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/problem-index/{id}/upgrade": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["WorkflowUpgradeController_upgrade"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/profiles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierQualityController_profiles"];
        put?: never;
        post: operations["SupplierQualityController_createProfile"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/profiles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierQualityController_profile"];
        put: operations["SupplierQualityController_updateProfile"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/supplier-options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierQualityController_supplierOptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/reference-options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierQualityController_options"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/problems": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierQualityController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/problems/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierQualityController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/drafts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierQualityController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/drafts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierQualityController_update"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/drafts/{id}/issue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierQualityController_issue"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/problems/{id}/response-draft": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierQualityController_response"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/problems/{id}/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierQualityController_action"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/problems/{id}/workflow-actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierQualityController_workflowAction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/problems": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierPortalController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/problems/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierPortalController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/problems/{id}/response-draft": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierPortalController_response"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/problems/{id}/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierPortalController_action"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/workflow-bindings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierWorkflowBindingController_list"];
        put: operations["SupplierWorkflowBindingController_set"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/process-quality/defect-types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProcessQualityController_types"];
        put?: never;
        post: operations["ProcessQualityController_createType"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/process-quality/defect-types/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["ProcessQualityController_updateType"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/process-quality/defects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProcessQualityController_list"];
        put?: never;
        post: operations["ProcessQualityController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/process-quality/defects/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProcessQualityController_detail"];
        put: operations["ProcessQualityController_update"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/process-quality/defects/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["ProcessQualityController_archive"];
        post?: never;
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
            landingPath: "/app/workbench" | "/supplier/inbox" | "/mfa";
            /** @enum {string} */
            securityState: "AUTHENTICATED" | "MFA_REQUIRED" | "MFA_ENROLLMENT_REQUIRED";
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
        SecurityStatusDto: {
            /** Format: date-time */
            emailVerifiedAt: string | null;
            mfaEnabled: boolean;
            mfaRequired: boolean;
            /** @enum {string} */
            securityState: "AUTHENTICATED" | "MFA_REQUIRED" | "MFA_ENROLLMENT_REQUIRED";
            recoveryCodesRemaining: number;
            /** Format: date-time */
            reauthenticationExpiresAt: string | null;
        };
        MfaEnrollmentDto: {
            secret: string;
            otpauthUri: string;
            /** Format: date-time */
            expiresAt: string;
        };
        MfaCodeDto: {
            code: string;
        };
        MfaEnrollmentCompleteDto: {
            /** @enum {string} */
            accountType: "INTERNAL" | "SUPPLIER";
            /** @enum {string} */
            landingPath: "/app/workbench" | "/supplier/inbox" | "/mfa";
            /** @enum {string} */
            securityState: "AUTHENTICATED" | "MFA_REQUIRED" | "MFA_ENROLLMENT_REQUIRED";
            recoveryCodes: string[];
        };
        ReauthenticateDto: {
            password: string;
            code?: string;
        };
        ReauthenticationResponseDto: {
            /** Format: date-time */
            reauthenticationExpiresAt: string;
        };
        RecoveryCodesDto: {
            /** @description Shown once. Store offline; each code can be used once. */
            recoveryCodes: string[];
        };
        CompleteEmailVerificationDto: {
            token: string;
        };
        PasswordRecoveryDto: {
            identifier: string;
            organizationCode?: string;
        };
        CompletePasswordRecoveryDto: {
            token: string;
            newPassword: string;
        };
        PermissionsResponseDto: {
            organizationId: string;
            permissions: string[];
        };
        PermissionCatalogOperationDto: {
            code: string;
            name: string;
            /** @enum {string} */
            enforcement: "guarded" | "reserved";
            grantable: boolean;
        };
        PermissionCatalogModuleDto: {
            key: string;
            name: string;
            /** @enum {string} */
            status: "active" | "planned";
            operations: components["schemas"]["PermissionCatalogOperationDto"][];
        };
        PermissionCatalogGroupDto: {
            key: string;
            name: string;
            /** @enum {string} */
            status: "active" | "planned";
            modules: components["schemas"]["PermissionCatalogModuleDto"][];
        };
        AdminPermissionDto: {
            id: string;
            code: string;
            name: string;
        };
        AdminRoleDto: {
            mfaRequired: boolean;
            id: string;
            organizationId: string | null;
            code: string;
            name: string;
            permissions: components["schemas"]["AdminPermissionDto"][];
        };
        CreateAdminRoleDto: {
            code: string;
            name: string;
            /** @default false */
            mfaRequired: boolean;
            /** Format: uuid */
            organizationId: string;
            permissionCodes: string[];
        };
        CopyAdminRoleDto: {
            code: string;
            name: string;
        };
        UpdateAdminRoleDto: {
            /** @description Required when mfaRequired is supplied; previously read MFA policy. */
            expectedMfaRequired?: boolean;
            mfaRequired?: boolean;
            /** @description Required when permissionCodes is supplied; previously read permission set. */
            expectedPermissionCodes?: string[];
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
            parentId: string | null;
            /** @enum {string} */
            status: "ACTIVE" | "DISABLED";
            version: number;
        };
        CurrentOrganizationResponseDto: {
            organization: components["schemas"]["OrganizationDto"];
            userId: string;
        };
        CreateOrganizationDto: {
            code: string;
            name: string;
        };
        UpdateOrganizationDto: {
            expectedVersion: number;
            name?: string;
            /** Format: uuid */
            parentId?: string;
            /**
             * Format: uuid
             * @description Required when moving; the original parent, or null for a root organization
             */
            expectedParentId?: string | null;
            /** @enum {string} */
            status?: "ACTIVE" | "DISABLED";
        };
        DepartmentDto: {
            id: string;
            organizationId: string;
            parentId: string | null;
            code: string;
            name: string;
            /** @enum {string} */
            status: "ACTIVE" | "DISABLED";
            version: number;
        };
        CreateDepartmentDto: {
            code: string;
            name: string;
            /** Format: uuid */
            parentId?: string | null;
        };
        UpdateDepartmentDto: {
            expectedVersion: number;
            name?: string;
            /** Format: uuid */
            parentId?: string | null;
            /** @enum {string} */
            status?: "ACTIVE" | "DISABLED";
        };
        PositionDto: {
            id: string;
            organizationId: string;
            departmentId: string;
            categoryId: string | null;
            code: string;
            name: string;
            /** @enum {string} */
            status: "ACTIVE" | "DISABLED";
            version: number;
        };
        CreatePositionDto: {
            code: string;
            name: string;
            /** Format: uuid */
            departmentId: string;
            /** Format: uuid */
            categoryId?: string | null;
        };
        UpdatePositionDto: {
            expectedVersion: number;
            name?: string;
            /** Format: uuid */
            departmentId?: string;
            /** Format: uuid */
            categoryId?: string | null;
            /** @enum {string} */
            status?: "ACTIVE" | "DISABLED";
        };
        UserPositionDto: {
            id: string;
            organizationId: string;
            userId: string;
            positionId: string;
            /** Format: date-time */
            startedAt: string;
            /** Format: date-time */
            endedAt: string | null;
            position: components["schemas"]["PositionDto"];
        };
        ReplaceUserPositionsDto: {
            positionIds: string[];
            expectedPositionIds: string[];
        };
        AuditEventDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            actorUserId: string | null;
            action: string;
            resourceType: string;
            resourceId: string | null;
            outcome: string;
            metadata: {
                [key: string]: (string | null) | number | boolean;
            };
            traceId: string;
            /** Format: date-time */
            createdAt: string;
        };
        AuditPageDto: {
            items: components["schemas"]["AuditEventDto"][];
            total: number;
            nextCursor: string | null;
        };
        AuditExportRequestDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            actorUserId?: string;
            action?: string;
            resourceType?: string;
            resourceId?: string;
            /** @enum {string} */
            outcome?: "SUCCESS" | "FAILURE" | "DENIED";
            /** Format: date-time */
            from?: string;
            /** Format: date-time */
            to?: string;
        };
        AuditExportDto: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            expiresAt: string;
            rowCount: number;
            downloadPath: string;
        };
        AuditExportContentDto: {
            filename: string;
            contentType: string;
            content: string;
        };
        PlatformSettingsDto: {
            /** @enum {string} */
            notificationLocale: "zh-CN" | "en-US";
            exportRetentionMinutes: number;
            version: number;
        };
        UpdatePlatformSettingsDto: {
            expectedVersion: number;
            /** @enum {string} */
            notificationLocale: "zh-CN" | "en-US";
            exportRetentionMinutes: number;
        };
        NotificationRuleDto: {
            /** @enum {string} */
            kind: "TASK_ASSIGNED" | "TASK_REMINDER" | "TASK_ESCALATED";
            enabled: boolean;
            subjectTemplate: string;
            bodyTemplate: string;
            version: number;
        };
        UpdateNotificationRuleDto: {
            expectedVersion: number;
            enabled: boolean;
            subjectTemplate: string;
            bodyTemplate: string;
        };
        PositionCategoryDto: {
            id: string;
            code: string;
            name: string;
            /** @enum {string} */
            status: "ACTIVE" | "DISABLED";
            sortOrder: number;
            version: number;
        };
        CreatePositionCategoryDto: {
            code: string;
            name: string;
            sortOrder: number;
        };
        UpdatePositionCategoryDto: {
            expectedVersion: number;
            name?: string;
            /** @enum {string} */
            status?: "ACTIVE" | "DISABLED";
            sortOrder?: number;
        };
        InitializeFileUploadDto: {
            resourceType: string;
            /** Format: uuid */
            resourceId: string;
            originalName: string;
            contentType: string;
            sizeBytes: number;
            sha256: string;
        };
        FileDto: {
            resourceType: string;
            /** Format: uuid */
            resourceId: string;
            /** Format: uuid */
            id: string;
            originalName: string;
            contentType: string;
            sizeBytes: number;
            sha256: string;
            /** @enum {string} */
            status: "QUARANTINED" | "AVAILABLE" | "DELETED";
            /** @enum {string} */
            scanStatus: "WAITING_UPLOAD" | "PENDING" | "CLEAN" | "REJECTED" | "ERROR" | "EXPIRED";
            scanReason: string | null;
            version: number;
            /** Format: date-time */
            uploadExpiresAt: string;
            /** Format: date-time */
            scannedAt: string | null;
            /** Format: date-time */
            deletedAt: string | null;
            /** Format: date-time */
            retainUntil: string;
        };
        FileUploadDto: {
            file: components["schemas"]["FileDto"];
            uploadUrl: string;
            headers: {
                [key: string]: string;
            };
            /** Format: date-time */
            urlExpiresAt: string;
        };
        FileMutationDto: {
            expectedVersion: number;
        };
        FileDownloadRequestDto: Record<string, never>;
        FileDownloadDto: {
            url: string;
            /** Format: date-time */
            expiresAt: string;
        };
        OutboxFailureDto: {
            /** Format: uuid */
            id: string;
            eventType: string;
            aggregateType: string;
            aggregateId: string;
            attempts: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            availableAt: string;
            /** @enum {string} */
            reasonCode: "OUTBOX_DELIVERY_FAILED";
        };
        OutboxFailurePageDto: {
            items: components["schemas"]["OutboxFailureDto"][];
            total: number;
        };
        OutboxRetryDto: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            status: "PENDING";
        };
        TaskDto: {
            /** Format: uuid */
            id: string;
            version: number;
            /** Format: uuid */
            instanceId: string;
            /** Format: uuid */
            fixedVersion: string;
            entryInstanceVersion: number;
            /** Format: uuid */
            nodeId: string;
            name: string;
            /** @enum {string} */
            type: "ACTION" | "APPROVAL" | "VERIFICATION" | "CC" | "REJECT" | "RETURN" | "REOPEN" | "CLOSE";
            /** Format: uuid */
            problemId: string;
            reportNumber: string;
            /** Format: date-time */
            dueAt: string | null;
            /** @enum {string} */
            status: "PENDING" | "IN_PROGRESS" | "OVERDUE";
            /** Format: uuid */
            claimedByUserId: string | null;
            /** Format: date-time */
            claimedAt: string | null;
            canAct: boolean;
            canClaim: boolean;
            canRelease: boolean;
        };
        TaskPageDto: {
            items: components["schemas"]["TaskDto"][];
            total: number;
        };
        InboxMutationDto: {
            expectedVersion: number;
        };
        NotificationDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            /** Format: uuid */
            problemId: string;
            version: number;
            /** Format: uuid */
            taskId: string;
            /** Format: uuid */
            instanceId: string;
            /** Format: uuid */
            fixedVersion: string;
            /** Format: uuid */
            nodeId: string;
            nodeName: string;
            /** @enum {string} */
            kind: "TASK_ASSIGNED" | "TASK_REMINDER" | "TASK_ESCALATED";
            subject: string | null;
            body: string;
            /** @enum {string} */
            status: "DELIVERED";
            /** Format: date-time */
            readAt: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        NotificationPageDto: {
            items: components["schemas"]["NotificationDto"][];
            total: number;
        };
        SupplierPortalNotificationDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            problemId: string;
            /** Format: uuid */
            taskId: string;
            reportNumber: string;
            nodeName: string;
            /** @enum {string} */
            kind: "TASK_ASSIGNED" | "TASK_REMINDER";
            subject: string | null;
            body: string;
            version: number;
            /** Format: date-time */
            readAt: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        SupplierPortalNotificationPageDto: {
            items: components["schemas"]["SupplierPortalNotificationDto"][];
            total: number;
        };
        ProblemDomainSummaryDto: {
            title: string;
            description: string;
            domainUiKey: string;
        };
        ProblemIndexResponseDto: {
            id: string;
            organizationId: string;
            reportNumber: string;
            domainCode: string;
            problemType: string;
            sourceType: string;
            /** Format: uuid */
            sourceId: string;
            /** @enum {string} */
            status: "OPEN" | "IN_PROGRESS" | "PENDING" | "RESOLVED" | "CLOSED" | "ARCHIVED";
            severity: string;
            responsibleParty: string | null;
            /** Format: uuid */
            ownerId: string | null;
            /** Format: date-time */
            dueAt: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
            summary: components["schemas"]["ProblemDomainSummaryDto"];
        };
        ProblemStatusCountDto: {
            /** @enum {string} */
            status: "OPEN" | "IN_PROGRESS" | "PENDING" | "RESOLVED" | "CLOSED" | "ARCHIVED";
            count: number;
        };
        ProblemIndexPageResponseDto: {
            items: components["schemas"]["ProblemIndexResponseDto"][];
            total: number;
            page: number;
            pageSize: number;
            statusCounts: components["schemas"]["ProblemStatusCountDto"][];
        };
        ProblemReportIdentityDto: {
            /** Format: uuid */
            id: string;
            reportNumber: string;
            domainCode: string;
            sourceType: string;
            /** Format: uuid */
            sourceId: string;
        };
        ProblemInstanceDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            workflowVersionId: string;
            version: number;
            /** @enum {string} */
            status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "SUSPENDED";
            /** Format: uuid */
            currentNodeId: string | null;
            current: boolean;
            /** Format: date-time */
            createdAt: string;
        };
        ProblemReportRevisionDto: {
            /** Format: uuid */
            id: string;
            instanceVersion: number;
            /** Format: date-time */
            recordedAt: string;
        };
        ProblemReportSnapshotDto: {
            problemType: string | null;
            severity: string | null;
            status: string | null;
            responsibleParty: string | null;
            /** Format: uuid */
            ownerId: string | null;
            /** Format: date-time */
            dueAt: string | null;
        };
        ProblemFieldDto: {
            key: string;
            label: string;
            value: string | null;
        };
        ProblemSectionDto: {
            key: string;
            title: string;
            fields: components["schemas"]["ProblemFieldDto"][];
        };
        ProblemNodeFactDto: {
            /** Format: uuid */
            id: string;
            key: string;
            name: string;
            /** @enum {string} */
            type: "ACTION" | "APPROVAL" | "VERIFICATION" | "CC" | "REJECT" | "RETURN" | "REOPEN" | "CLOSE";
            current: boolean;
            visited: boolean;
            actionCount: number;
        };
        ProblemWorkflowActionDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            nodeId: string;
            /** @enum {string} */
            action: "START" | "SUBMIT" | "APPROVE" | "VERIFY" | "REJECT" | "RETURN" | "REOPEN" | "CLOSE";
            instanceVersion: number;
            /** Format: uuid */
            actorUserId: string;
            /** Format: date-time */
            createdAt: string;
        };
        FileEvidenceDto: {
            resourceType: string;
            /** Format: uuid */
            resourceId: string;
            /** Format: uuid */
            id: string;
            originalName: string;
            contentType: string;
            sizeBytes: number;
            sha256: string;
            /** @enum {string} */
            status: "QUARANTINED" | "AVAILABLE" | "DELETED";
            /** @enum {string} */
            scanStatus: "WAITING_UPLOAD" | "PENDING" | "CLEAN" | "REJECTED" | "ERROR" | "EXPIRED";
            scanReason: string | null;
            version: number;
            /** Format: date-time */
            uploadExpiresAt: string;
            /** Format: date-time */
            scannedAt: string | null;
            /** Format: date-time */
            deletedAt: string | null;
            /** Format: date-time */
            retainUntil: string;
            downloadable: boolean;
        };
        ProblemUpgradeDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            beforeInstanceId: string;
            /** Format: uuid */
            afterInstanceId: string;
            /** Format: uuid */
            actorUserId: string;
            reason: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            beforeDomainRevisionId: string;
            /** Format: uuid */
            afterDomainRevisionId: string;
            mappingVersion: string;
        };
        ProblemReportDto: {
            /** Format: date-time */
            generatedAt: string;
            problem: components["schemas"]["ProblemReportIdentityDto"];
            instance: components["schemas"]["ProblemInstanceDto"] | null;
            revision: components["schemas"]["ProblemReportRevisionDto"] | null;
            summary: components["schemas"]["ProblemDomainSummaryDto"] | null;
            snapshot: components["schemas"]["ProblemReportSnapshotDto"] | null;
            sections: components["schemas"]["ProblemSectionDto"][];
            nodes: components["schemas"]["ProblemNodeFactDto"][];
            workflowActions: components["schemas"]["ProblemWorkflowActionDto"][];
            evidence: components["schemas"]["FileEvidenceDto"][];
            upgrades: components["schemas"]["ProblemUpgradeDto"][];
            /** @enum {string} */
            dataAvailability: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
            unavailableFields: string[];
        };
        ProblemAuditEventDto: {
            /** Format: uuid */
            id: string;
            action: string;
            outcome: string;
            resourceType: string;
            resourceId: string;
            /** Format: uuid */
            actorUserId: string | null;
            actorName: string | null;
            /** Format: date-time */
            createdAt: string;
            resourceVersion: number | null;
            reasonCode: string | null;
        };
        ProblemAuditPageDto: {
            items: components["schemas"]["ProblemAuditEventDto"][];
            nextCursor: string | null;
            domainRevisionTrailAvailable: boolean;
        };
        ProblemDomainWorkspaceDto: {
            domainVersion: number;
            /** Format: uuid */
            revisionId: string | null;
            summary: components["schemas"]["ProblemDomainSummaryDto"];
            sections: components["schemas"]["ProblemSectionDto"][];
        };
        ProblemCapabilityDto: {
            canAct: boolean;
            allowedActions: ("SUBMIT" | "APPROVE" | "VERIFY" | "REJECT" | "RETURN" | "REOPEN" | "CLOSE")[];
            reasonCode: string | null;
            /** Format: uuid */
            currentNodeId: string | null;
            /** Format: uuid */
            taskId: string | null;
            /** Format: uuid */
            claimedByUserId: string | null;
            projectionPending: boolean;
        };
        ProblemActionDescriptionDto: {
            actionKey: string;
            label: string;
            enabled: boolean;
            reasonCode: string | null;
        };
        ProblemWorkspaceDto: {
            problem: components["schemas"]["ProblemIndexResponseDto"];
            selectedInstance: components["schemas"]["ProblemInstanceDto"] | null;
            instances: components["schemas"]["ProblemInstanceDto"][];
            upgrades: components["schemas"]["ProblemUpgradeDto"][];
            domain: components["schemas"]["ProblemDomainWorkspaceDto"] | null;
            /** @enum {string} */
            domainAvailability: "AVAILABLE" | "UNAVAILABLE";
            readOnly: boolean;
            nodes: components["schemas"]["ProblemNodeFactDto"][];
            workflowActions: components["schemas"]["ProblemWorkflowActionDto"][];
            capabilities: components["schemas"]["ProblemCapabilityDto"];
            task: components["schemas"]["TaskDto"] | null;
            actions: components["schemas"]["ProblemActionDescriptionDto"][];
            evidence: components["schemas"]["FileEvidenceDto"][];
        };
        ProblemSavedViewFiltersDto: {
            domainCode?: string;
            problemType?: string;
            /** @enum {string} */
            status?: "OPEN" | "IN_PROGRESS" | "PENDING" | "RESOLVED" | "CLOSED" | "ARCHIVED";
            severity?: string;
            /** Format: uuid */
            ownerId?: string;
            search?: string;
            /** Format: date-time */
            dueFrom?: string;
            /** Format: date-time */
            dueTo?: string;
            /** Format: date-time */
            overdueAt?: string;
        };
        ProblemSavedViewSortDto: {
            /** @enum {string} */
            sortBy: "createdAt" | "updatedAt" | "dueAt" | "reportNumber" | "status" | "severity";
            /** @enum {string} */
            sortDirection: "asc" | "desc";
        };
        ProblemSavedViewConfigurationDto: {
            /** @enum {number} */
            schemaVersion: 1;
            filters: components["schemas"]["ProblemSavedViewFiltersDto"];
            sort: components["schemas"]["ProblemSavedViewSortDto"];
            visibleColumns: ("reportNumber" | "title" | "domainCode" | "problemType" | "status" | "severity" | "responsibleParty" | "ownerId" | "dueAt" | "updatedAt")[];
            columnOrder: ("reportNumber" | "title" | "domainCode" | "problemType" | "status" | "severity" | "responsibleParty" | "ownerId" | "dueAt" | "updatedAt")[];
        };
        ProblemSavedViewDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            name: string;
            configuration: components["schemas"]["ProblemSavedViewConfigurationDto"];
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        ProblemSavedViewPageDto: {
            items: components["schemas"]["ProblemSavedViewDto"][];
            total: number;
        };
        CreateProblemSavedViewDto: {
            name: string;
            configuration: components["schemas"]["ProblemSavedViewConfigurationDto"];
        };
        UpdateProblemSavedViewDto: {
            name?: string;
            configuration?: components["schemas"]["ProblemSavedViewConfigurationDto"];
            expectedVersion: number;
        };
        DeleteProblemSavedViewDto: {
            expectedVersion: number;
        };
        ProblemSavedViewDeletedDto: {
            /** Format: uuid */
            id: string;
            /** @enum {number} */
            deleted: true;
        };
        /** @enum {string} */
        WorkflowVersionStatus: "DRAFT" | "PUBLISHED" | "RETIRED";
        WorkflowVersionSummaryDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            workflowDefinitionId: string;
            version: number;
            status: components["schemas"]["WorkflowVersionStatus"];
            /** Format: date-time */
            publishedAt: string | null;
            /** Format: uuid */
            publishedById: string | null;
            changeNote: string | null;
        };
        WorkflowDefinitionSummaryDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            code: string;
            name: string;
            description: string | null;
            revision: number;
            version: components["schemas"]["WorkflowVersionSummaryDto"];
            /** Format: uuid */
            draftVersionId: string | null;
        };
        WorkflowPageDto: {
            items: components["schemas"]["WorkflowDefinitionSummaryDto"][];
            total: number;
        };
        WorkflowCodeOptionDto: {
            code: string;
            name: string;
        };
        WorkflowUserOptionDto: {
            /** Format: uuid */
            id: string;
            name: string;
        };
        WorkflowOptionsDto: {
            roles: components["schemas"]["WorkflowCodeOptionDto"][];
            users: components["schemas"]["WorkflowUserOptionDto"][];
            permissions: components["schemas"]["WorkflowCodeOptionDto"][];
        };
        WorkflowDefinitionDetailDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            code: string;
            name: string;
            description: string | null;
            revision: number;
            versions: components["schemas"]["WorkflowVersionSummaryDto"][];
        };
        /** @enum {string} */
        WorkflowAction: "SUBMIT" | "APPROVE" | "VERIFY" | "REJECT" | "RETURN" | "REOPEN" | "CLOSE";
        WorkflowConditionDto: {
            /** @enum {string} */
            field: "status" | "severity" | "problemType" | "domainCode" | "sourceType" | "responsibleParty";
            /** @enum {string} */
            operator: "eq" | "ne" | "in" | "notIn";
            value: (string | null) | (string | null)[];
        };
        WorkflowTransitionDraftDto: {
            id: string;
            from: string;
            to: string;
            action?: components["schemas"]["WorkflowAction"];
            condition?: components["schemas"]["WorkflowConditionDto"];
        };
        WorkflowAssignmentDto: {
            roleCode?: string;
            /** Format: uuid */
            assigneeUserId?: string;
            permission?: string;
        };
        WorkflowReminderDto: {
            offsetMinutes: number;
        };
        WorkflowEditorPositionDto: {
            x: number;
            y: number;
        };
        WorkflowNodeConfigDto: {
            assignment?: components["schemas"]["WorkflowAssignmentDto"];
            isStart?: boolean;
            isEnd?: boolean;
            slaMinutes?: number;
            reminders?: components["schemas"]["WorkflowReminderDto"][];
            escalation?: components["schemas"]["WorkflowAssignmentDto"];
            requireIndependentVerification?: boolean;
            editorPosition?: components["schemas"]["WorkflowEditorPositionDto"];
        };
        /** @enum {string} */
        WorkflowNodeType: "ACTION" | "APPROVAL" | "VERIFICATION" | "CC" | "REJECT" | "RETURN" | "REOPEN" | "CLOSE";
        WorkflowNodeResponseDto: {
            id: string;
            name: string;
            config?: components["schemas"]["WorkflowNodeConfigDto"];
            type: components["schemas"]["WorkflowNodeType"];
        };
        WorkflowGraphResponseDto: {
            transitions: components["schemas"]["WorkflowTransitionDraftDto"][];
            nodes: components["schemas"]["WorkflowNodeResponseDto"][];
        };
        WorkflowVersionResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            workflowDefinitionId: string;
            version: number;
            status: components["schemas"]["WorkflowVersionStatus"];
            /** Format: date-time */
            publishedAt: string | null;
            /** Format: uuid */
            publishedById: string | null;
            changeNote: string | null;
            structureSnapshot: components["schemas"]["WorkflowGraphResponseDto"];
        };
        WorkflowDefinitionResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            code: string;
            name: string;
            description: string | null;
            revision: number;
            version: components["schemas"]["WorkflowVersionResponseDto"];
        };
        /** @enum {string} */
        WorkflowEditableNodeType: "ACTION" | "APPROVAL" | "VERIFICATION" | "CC" | "CLOSE";
        WorkflowNodeDraftDto: {
            id: string;
            type: components["schemas"]["WorkflowEditableNodeType"];
            name: string;
            config?: components["schemas"]["WorkflowNodeConfigDto"];
        };
        CreateWorkflowDto: {
            nodes: components["schemas"]["WorkflowNodeDraftDto"][];
            transitions: components["schemas"]["WorkflowTransitionDraftDto"][];
            code: string;
            name: string;
            description?: string;
        };
        WorkflowGraphDto: {
            nodes: components["schemas"]["WorkflowNodeDraftDto"][];
            transitions: components["schemas"]["WorkflowTransitionDraftDto"][];
        };
        WorkflowValidationResponseDto: {
            valid: boolean;
            errors: string[];
        };
        UpdateWorkflowDraftDto: {
            nodes: components["schemas"]["WorkflowNodeDraftDto"][];
            transitions: components["schemas"]["WorkflowTransitionDraftDto"][];
            /** Format: uuid */
            draftVersionId: string;
            expectedRevision: number;
            description?: string;
        };
        PublishWorkflowDto: {
            /** Format: uuid */
            draftVersionId: string;
            expectedRevision: number;
            changeNote?: string;
        };
        CopyWorkflowDto: {
            /** Format: uuid */
            sourceVersionId: string;
            expectedRevision: number;
            description?: string;
        };
        WorkflowMappingOutcomeDto: {
            fieldId: string;
            /** @enum {string} */
            outcome: "COPIED" | "PRESERVED" | "UNMAPPED";
        };
        WorkflowUpgradePreviewDto: {
            /** Format: uuid */
            problemId: string;
            reportNumber: string;
            canUpgrade: boolean;
            reasonCode: string | null;
            /** Format: uuid */
            instanceId: string | null;
            /** Format: uuid */
            currentNodeId: string | null;
            expectedProblemVersion: number;
            expectedInstanceVersion: number | null;
            expectedDomainVersion: number | null;
            /** Format: uuid */
            targetVersionId: string | null;
            targetProblemType: string | null;
            mappingVersion: string | null;
            mappingSummary: components["schemas"]["WorkflowMappingOutcomeDto"][];
        };
        WorkflowUpgradeRequestDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            instanceId: string;
            /** Format: uuid */
            currentNodeId: string;
            expectedProblemVersion: number;
            expectedInstanceVersion: number;
            expectedDomainVersion: number;
            reason: string;
        };
        WorkflowUpgradeResultDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            problemId: string;
            reportNumber: string;
            /** Format: uuid */
            beforeInstanceId: string;
            /** Format: uuid */
            afterInstanceId: string;
            /** Format: uuid */
            workflowVersionId: string;
            /** Format: uuid */
            currentNodeId: string;
            problemVersion: number;
            instanceVersion: number;
            domainVersion: number;
            /** Format: uuid */
            beforeDomainRevisionId: string;
            /** Format: uuid */
            afterDomainRevisionId: string;
            mappingVersion: string;
            mappingSummary: components["schemas"]["WorkflowMappingOutcomeDto"][];
            /** Format: date-time */
            upgradedAt: string;
        };
        Object: Record<string, never>;
        SupplierProfileDto: {
            id: string;
            version: number;
            supplierOrganizationId: string;
            businessCode: string;
            displayName: string;
            contactName?: string;
            contactEmail?: string;
        };
        SupplierProfilePageDto: {
            items: components["schemas"]["SupplierProfileDto"][];
            total: number;
            canManage: boolean;
        };
        UpdateSupplierProfileDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            businessCode: string;
            /** @description 省略或空白表示清除 */
            contactName?: string;
            /** @description 省略表示清除 */
            contactEmail?: string;
        };
        SupplierReferenceOptionDto: {
            id: string;
            label: string;
        };
        SupplierReferenceOptionsDto: {
            items: components["schemas"]["SupplierReferenceOptionDto"][];
            total: number;
        };
        CreateSupplierProfileDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            supplierOrganizationId: string;
            businessCode: string;
            contactName?: string;
            contactEmail?: string;
        };
        SupplierResponseContentDto: {
            problemDescription?: string;
            containmentAction?: string;
            interimAction?: string;
            rootCause?: string;
            correctiveAction?: string;
            preventiveAction?: string;
            verificationResult?: string;
            /** @description 包含时区的完成时间 */
            completionTime?: string;
        };
        SupplierResponseEvidenceDto: {
            /** Format: uuid */
            fileId: string;
            purpose: string;
            originalName: string;
            /** @enum {string} */
            status: "QUARANTINED" | "AVAILABLE" | "DELETED";
            /** @enum {string} */
            scanStatus: "WAITING_UPLOAD" | "PENDING" | "CLEAN" | "REJECTED" | "ERROR" | "EXPIRED";
            downloadable: boolean;
        };
        SupplierResponseRevisionDto: {
            /** Format: uuid */
            id: string;
            revision: number;
            content: components["schemas"]["SupplierResponseContentDto"];
            /** Format: date-time */
            submittedAt: string;
            evidence: components["schemas"]["SupplierResponseEvidenceDto"][];
        };
        SupplierResponseRevisionPageDto: {
            /** @description 修订号降序；通过 revisionPage 翻页 */
            items: components["schemas"]["SupplierResponseRevisionDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        SupplierCurrentVerificationDto: {
            /** @enum {string} */
            status: "NOT_VERIFIED" | "ACCEPTED" | "INVALIDATED";
            /** Format: uuid */
            revisionId?: string;
            /** Format: date-time */
            verifiedAt?: string;
            /**
             * Format: uuid
             * @description 仅内部详情返回
             */
            verifierId?: string;
        };
        SupplierWorkflowNodeDto: {
            /** @enum {string} */
            type: "ACTION" | "APPROVAL" | "VERIFICATION" | "CC" | "REJECT" | "RETURN" | "REOPEN" | "CLOSE";
            /**
             * Format: uuid
             * @description 仅内部详情返回
             */
            id?: string;
            /** @description 仅内部详情返回 */
            name?: string;
        };
        SupplierProblemDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            profileId: string;
            title: string;
            materialCode: string;
            /** @enum {string} */
            materialCategory?: "STRUCTURE" | "ELECTRONIC";
            defectDescription: string;
            defectQuantity: number;
            /** @enum {string} */
            severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
            /** @enum {string} */
            responseForm: "BRIEF" | "EIGHT_D";
            /** @enum {string} */
            replyMode: "INTERNAL" | "SUPPLIER";
            /** Format: uuid */
            internalResponderId?: string;
            id: string;
            supplierOrganizationId: string;
            supplierName: string;
            version: number;
            /** @enum {string} */
            stage: "DRAFT" | "ISSUED";
            /**
             * Format: uuid
             * @description 仅内部详情返回；平台工作台使用的问题索引 ID
             */
            problemIndexId?: string;
            reportNumber?: string;
            /** @enum {string} */
            problemStatus?: "OPEN" | "IN_PROGRESS" | "PENDING" | "RESOLVED" | "CLOSED" | "ARCHIVED";
            /** Format: date-time */
            dueAt?: string;
            /** Format: date-time */
            updatedAt: string;
            canEditFacts: boolean;
            canEditResponse: boolean;
            responseDraft: components["schemas"]["SupplierResponseContentDto"];
            /** @description 详情中的最新已提交修订，草稿阶段省略 */
            latestResponseRevision?: components["schemas"]["SupplierResponseRevisionDto"];
            /** @description 详情中的全部修订分页，按修订号降序 */
            responseHistory?: components["schemas"]["SupplierResponseRevisionPageDto"];
            /** @description 详情中针对最新修订的当前验证状态 */
            currentVerification?: components["schemas"]["SupplierCurrentVerificationDto"];
            /** @description 详情中的当前流程节点，未发单时省略 */
            currentWorkflowNode?: components["schemas"]["SupplierWorkflowNodeDto"];
            /** @description 详情中按当前会话、节点和领域规则派生的候选动作；提交时仍由服务端重新授权 */
            availableActions?: ("SUBMIT" | "VERIFY" | "REJECT" | "RETURN" | "REOPEN" | "CLOSE")[];
            /** @description 详情中无可执行动作时的原因代码；有动作时为 null */
            actionUnavailableReason?: string | null;
        };
        SupplierProblemPageDto: {
            items: components["schemas"]["SupplierProblemDto"][];
            total: number;
            canCreateDraft: boolean;
        };
        SupplierProblemDraftDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            profileId: string;
            title: string;
            materialCode: string;
            /** @enum {string} */
            materialCategory?: "STRUCTURE" | "ELECTRONIC";
            defectDescription: string;
            defectQuantity: number;
            /** @enum {string} */
            severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
            /** @enum {string} */
            responseForm: "BRIEF" | "EIGHT_D";
            /** @enum {string} */
            replyMode: "INTERNAL" | "SUPPLIER";
            /** Format: uuid */
            internalResponderId?: string;
        };
        UpdateSupplierProblemDraftDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            profileId: string;
            title: string;
            materialCode: string;
            /** @enum {string} */
            materialCategory?: "STRUCTURE" | "ELECTRONIC";
            defectDescription: string;
            defectQuantity: number;
            /** @enum {string} */
            severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
            /** @enum {string} */
            responseForm: "BRIEF" | "EIGHT_D";
            /** @enum {string} */
            replyMode: "INTERNAL" | "SUPPLIER";
            /** Format: uuid */
            internalResponderId?: string;
            expectedVersion: number;
        };
        IssueSupplierProblemDto: {
            expectedVersion: number;
        };
        SaveSupplierResponseDraftDto: {
            expectedVersion: number;
            content: components["schemas"]["SupplierResponseContentDto"];
        };
        SubmitSupplierResponseDto: {
            expectedContentVersion: number;
            content: components["schemas"]["SupplierResponseContentDto"];
            evidenceFileIds?: string[];
            /** @default RESPONSE */
            evidencePurpose: string;
        };
        SupplierWorkflowActionDto: {
            /** @enum {string} */
            action: "VERIFY" | "REJECT" | "RETURN" | "REOPEN" | "CLOSE";
            expectedContentVersion: number;
            /** @default true */
            accepted: boolean;
        };
        SupplierWorkflowBindingDto: {
            /** @enum {string} */
            severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
            /** @enum {string} */
            responseForm: "BRIEF" | "EIGHT_D";
            /** @enum {string} */
            replyMode: "INTERNAL" | "SUPPLIER";
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            version: number;
            /** Format: uuid */
            workflowVersionId: string;
            /** Format: uuid */
            workflowDefinitionId: string;
            enabled: boolean;
            /** @enum {string} */
            workflowStatus: "DRAFT" | "PUBLISHED" | "RETIRED";
            /** @description 固定流程版本回复节点的分钟数；未配置则为 null */
            responseSlaMinutes: number | null;
            /** Format: uuid */
            createdById: string;
            /** Format: date-time */
            createdAt: string;
        };
        SupplierWorkflowBindingsDto: {
            items: components["schemas"]["SupplierWorkflowBindingDto"][];
        };
        SetSupplierWorkflowBindingDto: {
            /** @enum {string} */
            severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
            /** @enum {string} */
            responseForm: "BRIEF" | "EIGHT_D";
            /** @enum {string} */
            replyMode: "INTERNAL" | "SUPPLIER";
            expectedVersion: number;
            /** Format: uuid */
            workflowVersionId: string;
            enabled: boolean;
        };
        CreateProcessDefectTypeDto: {
            /** Format: uuid */
            organizationId?: string;
            code: string;
            name: string;
        };
        ProcessDefectTypeDto: {
            /** Format: uuid */
            id: string;
            code: string;
            name: string;
            active: boolean;
            version: number;
        };
        UpdateProcessDefectTypeDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            name: string;
            active: boolean;
        };
        CreateProcessDefectDto: {
            /** Format: uuid */
            organizationId?: string;
            defectTypeCode: string;
            description: string;
            defectQuantity: number;
            /** Format: date-time */
            occurredAt: string;
            batchCode?: string;
            workOrderCode?: string;
            operationCode?: string;
            lineCode?: string;
            projectCode?: string;
            productCode?: string;
            materialCode?: string;
            /** Format: uuid */
            supplierOrganizationId?: string;
            /** @enum {string} */
            responsibilityCategory: "MATERIAL" | "OPERATION" | "EQUIPMENT" | "PROCESS" | "DESIGN";
            /**
             * @description 人工登记的外部来源标识；接口尚未启用
             * @enum {string}
             */
            externalSourceSystem?: "MES" | "IMS";
            externalRecordKey?: string;
            /** Format: date-time */
            sourceObservedAt?: string;
        };
        ProcessDefectEvidenceDto: {
            /** Format: uuid */
            id: string;
            originalName: string;
            scanStatus: string;
            status: string;
        };
        ProcessDefectDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            defectTypeCode: string;
            description: string;
            defectQuantity: number;
            /** Format: date-time */
            occurredAt: string;
            batchCode?: string | null;
            workOrderCode?: string | null;
            operationCode?: string | null;
            lineCode?: string | null;
            projectCode?: string | null;
            productCode?: string | null;
            materialCode?: string | null;
            /** Format: uuid */
            supplierOrganizationId?: string | null;
            /** @enum {string} */
            responsibilityCategory: "MATERIAL" | "OPERATION" | "EQUIPMENT" | "PROCESS" | "DESIGN";
            /** @enum {string} */
            sourceKind: "MANUAL";
            externalSourceSystem?: string | null;
            externalRecordKey?: string | null;
            /** Format: date-time */
            sourceObservedAt?: string | null;
            /** @enum {string|null} */
            ingestionStatus?: "PENDING_VERIFICATION" | null;
            version: number;
            /** Format: date-time */
            archivedAt?: string | null;
            evidence?: components["schemas"]["ProcessDefectEvidenceDto"][];
        };
        ProcessDefectPageDto: {
            items: components["schemas"]["ProcessDefectDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        UpdateProcessDefectDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            defectTypeCode?: string;
            description?: string;
            defectQuantity?: number;
            /** Format: date-time */
            occurredAt?: string;
            batchCode?: string;
            workOrderCode?: string;
            operationCode?: string;
            lineCode?: string;
            projectCode?: string;
            productCode?: string;
            materialCode?: string;
            /** Format: uuid */
            supplierOrganizationId?: string;
            /** @enum {string} */
            responsibilityCategory?: "MATERIAL" | "OPERATION" | "EQUIPMENT" | "PROCESS" | "DESIGN";
        };
        ArchiveProcessDefectDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
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
        PlatformErrorCode: "SUPPLIER_INPUT_INVALID" | "SUPPLIER_WORKFLOW_CONFIGURATION_INVALID" | "SUPPLIER_WORKFLOW_CONFIGURATION_REQUIRED" | "SUPPLIER_RECORD_NOT_FOUND" | "SUPPLIER_DRAFT_LOCKED" | "SUPPLIER_PROFILE_DUPLICATE" | "WORKFLOW_UPGRADE_DOMAIN_DENIED" | "WORKFLOW_UPGRADE_NOT_ALLOWED" | "WORKFLOW_UPGRADE_MAPPING_INVALID" | "FILE_RESOURCE_DENIED" | "FILE_NOT_FOUND" | "FILE_NOT_AVAILABLE" | "FILE_UPLOAD_EXPIRED" | "FILE_UPLOAD_INVALID" | "FILE_QUOTA_EXCEEDED" | "FILE_OBJECT_UNAVAILABLE" | "FILE_CONTENT_MISMATCH" | "FILE_MIME_NOT_ALLOWED" | "FILE_TOO_LARGE" | "FILE_EMPTY" | "FILE_COUNT_EXCEEDED" | "TASK_NOT_FOUND" | "TASK_NOT_CLAIMED" | "TASK_CLAIM_OWNER_REQUIRED" | "TASK_ALREADY_CLAIMED" | "NOTIFICATION_NOT_FOUND" | "PROBLEM_NOT_FOUND" | "EXPORT_TOO_LARGE" | "EXPORT_NOT_FOUND" | "EXPORT_EXPIRED" | "OUTBOX_EVENT_NOT_FOUND" | "NUMBERING_CONFLICT" | "WORKFLOW_VERSION_IMMUTABLE" | "WORKFLOW_DRAFT_INVALID" | "WORKFLOW_NODE_FORBIDDEN" | "WORKFLOW_INSTANCE_NOT_FOUND" | "WORKFLOW_VERSION_NOT_FOUND" | "WORKFLOW_VERSION_MISMATCH" | "WORKFLOW_ACTION_INVALID" | "WORKFLOW_TRANSITION_AMBIGUOUS" | "WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED" | "WORKFLOW_TRANSACTION_ISOLATION_UNSUPPORTED" | "IDEMPOTENCY_REPLAY" | "CONCURRENCY_CONFLICT" | "AUTH_INVALID_CREDENTIALS" | "AUTH_MFA_REQUIRED" | "AUTH_MFA_CHALLENGE_INVALID" | "AUTH_MFA_CODE_INVALID" | "AUTH_MFA_RATE_LIMITED" | "AUTH_MFA_ALREADY_ENABLED" | "AUTH_MFA_NOT_ENABLED" | "AUTH_MFA_POLICY_REQUIRED" | "AUTH_REAUTHENTICATION_REQUIRED" | "AUTH_SECURITY_KEY_UNAVAILABLE" | "AUTH_MAIL_UNAVAILABLE" | "AUTH_EMAIL_REQUIRED" | "AUTH_RECOVERY_INVALID" | "AUTH_RECOVERY_UNAVAILABLE" | "AUTH_CURRENT_PASSWORD_INVALID" | "AUTH_PASSWORD_POLICY_INVALID" | "AUTH_SESSION_NOT_FOUND" | "AUTH_CURRENT_SESSION_REVOKE_FORBIDDEN" | "AUTH_SESSION_REQUIRED" | "AUTH_RATE_LIMITED" | "CSRF_INVALID" | "FEATURE_PERMISSION_DENIED" | "ORGANIZATION_SCOPE_AMBIGUOUS" | "ORGANIZATION_SCOPE_DENIED" | "ORGANIZATION_DISABLED" | "ORGANIZATION_NOT_FOUND" | "ORGANIZATION_HIERARCHY_INVALID" | "ORGANIZATION_TYPE_MISMATCH" | "STRUCTURE_NOT_FOUND" | "STRUCTURE_DISABLED" | "STRUCTURE_REFERENCE_INVALID" | "STRUCTURE_DUPLICATE" | "WORKFLOW_PERMISSION_REQUIRED" | "ADMIN_USER_NOT_FOUND" | "ADMIN_USER_DUPLICATE" | "ADMIN_USER_ORGANIZATION_IN_USE" | "ADMIN_SELF_DISABLE_FORBIDDEN" | "ADMIN_ACCOUNT_TYPE_ORGANIZATION_MISMATCH" | "ADMIN_ROLE_NOT_FOUND" | "ADMIN_ROLE_DUPLICATE" | "ADMIN_ROLE_IN_USE" | "ADMIN_PERMISSION_NOT_FOUND" | "ADMIN_PERMISSION_BASELINE_REQUIRED" | "ADMIN_SELF_LOCK_FORBIDDEN" | "IDEMPOTENCY_KEY_REQUIRED" | "AUTH_PASSWORD_RESET_INVALID" | "ADMIN_GLOBAL_ROLE_IMMUTABLE";
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
    MfaController_status: {
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
                    "application/json": components["schemas"]["SecurityStatusDto"];
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
    MfaController_enrollment: {
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
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MfaEnrollmentDto"];
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
    MfaController_confirm: {
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
                "application/json": components["schemas"]["MfaCodeDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MfaEnrollmentCompleteDto"];
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
    MfaController_verify: {
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
                "application/json": components["schemas"]["MfaCodeDto"];
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
    MfaController_reauthenticate: {
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
                "application/json": components["schemas"]["ReauthenticateDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReauthenticationResponseDto"];
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
    MfaController_recoveryCodes: {
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
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RecoveryCodesDto"];
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
    MfaController_disable: {
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
    EmailRecoveryController_requestVerification: {
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
            202: {
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
    EmailRecoveryController_verify: {
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
                "application/json": components["schemas"]["CompleteEmailVerificationDto"];
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
    EmailRecoveryController_requestRecovery: {
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
                "application/json": components["schemas"]["PasswordRecoveryDto"];
            };
        };
        responses: {
            202: {
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
    EmailRecoveryController_complete: {
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
                "application/json": components["schemas"]["CompletePasswordRecoveryDto"];
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
    AdminRoleController_catalog: {
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
                    "application/json": components["schemas"]["PermissionCatalogGroupDto"][];
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
    OrganizationGovernanceController_tree: {
        parameters: {
            query?: {
                organizationId?: string;
                limit?: number;
                offset?: number;
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
                    "application/json": components["schemas"]["OrganizationDto"][];
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
    OrganizationGovernanceController_create: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                organizationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateOrganizationDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrganizationDto"];
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
    OrganizationGovernanceController_update: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                organizationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateOrganizationDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrganizationDto"];
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
    OrganizationGovernanceController_departments: {
        parameters: {
            query?: {
                organizationId?: string;
                limit?: number;
                offset?: number;
            };
            header?: never;
            path: {
                organizationId: string;
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
                    "application/json": components["schemas"]["DepartmentDto"][];
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
    OrganizationGovernanceController_createDepartment: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                organizationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateDepartmentDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DepartmentDto"];
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
    OrganizationGovernanceController_updateDepartment: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                organizationId: string;
                departmentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateDepartmentDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DepartmentDto"];
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
    OrganizationGovernanceController_positions: {
        parameters: {
            query?: {
                organizationId?: string;
                limit?: number;
                offset?: number;
            };
            header?: never;
            path: {
                organizationId: string;
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
                    "application/json": components["schemas"]["PositionDto"][];
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
    OrganizationGovernanceController_createPosition: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                organizationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePositionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PositionDto"];
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
    OrganizationGovernanceController_updatePosition: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                organizationId: string;
                positionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdatePositionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PositionDto"];
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
    OrganizationGovernanceController_userPositions: {
        parameters: {
            query?: {
                organizationId?: string;
                limit?: number;
                offset?: number;
            };
            header?: never;
            path: {
                organizationId: string;
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
                    "application/json": components["schemas"]["UserPositionDto"][];
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
    OrganizationGovernanceController_replaceUserPositions: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                organizationId: string;
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReplaceUserPositionsDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserPositionDto"][];
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
    AuditQueryController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                actorUserId?: string;
                action?: string;
                resourceType?: string;
                resourceId?: string;
                outcome?: "SUCCESS" | "FAILURE" | "DENIED";
                from?: string;
                to?: string;
                pageSize?: number;
                cursor?: string;
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
                    "application/json": components["schemas"]["AuditPageDto"];
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
    AuditExportController_create: {
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
                "application/json": components["schemas"]["AuditExportRequestDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditExportDto"];
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
    AuditExportController_download: {
        parameters: {
            query?: {
                organizationId?: unknown;
            };
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
                    "application/json": components["schemas"]["AuditExportContentDto"];
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
    PlatformConfigurationController_settings: {
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
                    "application/json": components["schemas"]["PlatformSettingsDto"];
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
    PlatformConfigurationController_updateSettings: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdatePlatformSettingsDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformSettingsDto"];
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
    PlatformConfigurationController_rules: {
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
                    "application/json": components["schemas"]["NotificationRuleDto"][];
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
    PlatformConfigurationController_updateRule: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                kind: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateNotificationRuleDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationRuleDto"];
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
    PlatformConfigurationController_categories: {
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
                    "application/json": components["schemas"]["PositionCategoryDto"][];
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
    PlatformConfigurationController_createCategory: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePositionCategoryDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PositionCategoryDto"];
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
    PlatformConfigurationController_updateCategory: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdatePositionCategoryDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PositionCategoryDto"];
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
    FileController_initialize: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
                "Idempotency-Key": string;
                "x-csrf-token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InitializeFileUploadDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileUploadDto"];
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
    FileController_complete: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
                "Idempotency-Key": string;
                "x-csrf-token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FileMutationDto"];
            };
        };
        responses: {
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileDto"];
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
    FileController_get: {
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
                    "application/json": components["schemas"]["FileDto"];
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
    FileController_download: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FileDownloadRequestDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileDownloadDto"];
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
    FileController_remove: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FileMutationDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileDto"];
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
    OutboxAdministrationController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                pageSize?: number;
                offset?: number;
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
                    "application/json": components["schemas"]["OutboxFailurePageDto"];
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
    OutboxAdministrationController_retry: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OutboxRetryDto"];
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
    TaskInboxController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                pageSize?: number;
                offset?: number;
                status?: "PENDING" | "IN_PROGRESS" | "OVERDUE";
                claim?: "UNCLAIMED" | "MINE" | "OTHERS";
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
                    "application/json": components["schemas"]["TaskPageDto"];
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
    TaskInboxController_claim: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InboxMutationDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskDto"];
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
    TaskInboxController_release: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InboxMutationDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskDto"];
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
    NotificationInboxController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                pageSize?: number;
                offset?: number;
                status?: "UNREAD" | "READ";
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
                    "application/json": components["schemas"]["NotificationPageDto"];
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
    NotificationInboxController_read: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InboxMutationDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationDto"];
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
    SupplierPortalNotificationController_list: {
        parameters: {
            query?: {
                pageSize?: number;
                offset?: number;
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
                    "application/json": components["schemas"]["SupplierPortalNotificationPageDto"];
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
    SupplierPortalNotificationController_read: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InboxMutationDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPortalNotificationDto"];
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
    ReportingController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                page?: number;
                pageSize?: number;
                domainCode?: string;
                problemType?: string;
                status?: "OPEN" | "IN_PROGRESS" | "PENDING" | "RESOLVED" | "CLOSED" | "ARCHIVED";
                severity?: string;
                ownerId?: string;
                search?: string;
                dueFrom?: string;
                dueTo?: string;
                overdueAt?: string;
                sortBy?: "createdAt" | "updatedAt" | "dueAt" | "reportNumber" | "status" | "severity";
                sortDirection?: "asc" | "desc";
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
    ReportingController_report: {
        parameters: {
            query?: {
                organizationId?: string;
                instanceId?: string;
            };
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
                    "application/json": components["schemas"]["ProblemReportDto"];
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
    ReportingController_audit: {
        parameters: {
            query?: {
                organizationId?: string;
                pageSize?: number;
                cursor?: string;
            };
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
                    "application/json": components["schemas"]["ProblemAuditPageDto"];
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
    ProblemIndexController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                page?: number;
                pageSize?: number;
                domainCode?: string;
                problemType?: string;
                status?: "OPEN" | "IN_PROGRESS" | "PENDING" | "RESOLVED" | "CLOSED" | "ARCHIVED";
                severity?: string;
                ownerId?: string;
                search?: string;
                dueFrom?: string;
                dueTo?: string;
                overdueAt?: string;
                sortBy?: "createdAt" | "updatedAt" | "dueAt" | "reportNumber" | "status" | "severity";
                sortDirection?: "asc" | "desc";
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
            query?: {
                organizationId?: string;
                instanceId?: string;
            };
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
                    "application/json": components["schemas"]["ProblemWorkspaceDto"];
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
    ProblemSavedViewController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                pageSize?: number;
                offset?: number;
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
                    "application/json": components["schemas"]["ProblemSavedViewPageDto"];
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
    ProblemSavedViewController_create: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateProblemSavedViewDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemSavedViewDto"];
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
    ProblemSavedViewController_remove: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeleteProblemSavedViewDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemSavedViewDeletedDto"];
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
    ProblemSavedViewController_update: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateProblemSavedViewDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemSavedViewDto"];
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
    WorkflowController_list: {
        parameters: {
            query?: {
                search?: string;
                status?: "DRAFT" | "PUBLISHED" | "RETIRED";
                pageSize?: number;
                offset?: number;
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
                    "application/json": components["schemas"]["WorkflowPageDto"];
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
            201: {
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
    WorkflowController_options: {
        parameters: {
            query?: {
                search?: string;
                limit?: number;
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
                    "application/json": components["schemas"]["WorkflowOptionsDto"];
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
    WorkflowController_detail: {
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
                    "application/json": components["schemas"]["WorkflowDefinitionDetailDto"];
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
    WorkflowController_version: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                versionId: string;
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
    WorkflowController_validateGraph: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkflowGraphDto"];
            };
        };
        responses: {
            201: {
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
            201: {
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
            201: {
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
            201: {
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
    WorkflowUpgradeController_preview: {
        parameters: {
            query?: {
                organizationId?: string;
            };
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
                    "application/json": components["schemas"]["WorkflowUpgradePreviewDto"];
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
    WorkflowUpgradeController_upgrade: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkflowUpgradeRequestDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkflowUpgradeResultDto"];
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
    SupplierQualityController_profiles: {
        parameters: {
            query?: {
                organizationId?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["SupplierProfilePageDto"];
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
    SupplierQualityController_createProfile: {
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
                "application/json": components["schemas"]["CreateSupplierProfileDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierProfileDto"];
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
    SupplierQualityController_profile: {
        parameters: {
            query?: {
                organizationId?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
                search?: string;
            };
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
                    "application/json": components["schemas"]["SupplierProfileDto"];
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
    SupplierQualityController_updateProfile: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateSupplierProfileDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierProfileDto"];
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
    SupplierQualityController_supplierOptions: {
        parameters: {
            query?: {
                organizationId?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
                search?: string;
                selectedId?: string;
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
                    "application/json": components["schemas"]["SupplierReferenceOptionsDto"];
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
    SupplierQualityController_options: {
        parameters: {
            query?: {
                organizationId?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
                search?: string;
                selectedId?: string;
                kind?: "profiles" | "responders";
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
                    "application/json": components["schemas"]["SupplierReferenceOptionsDto"];
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
    SupplierQualityController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
                search?: string;
                severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
                responseForm?: "BRIEF" | "EIGHT_D";
                stage?: "DRAFT" | "ISSUED";
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
                    "application/json": components["schemas"]["SupplierProblemPageDto"];
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
    SupplierQualityController_detail: {
        parameters: {
            query?: {
                organizationId?: string;
                revisionPage?: components["schemas"]["Object"];
                revisionPageSize?: components["schemas"]["Object"];
            };
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
                    "application/json": components["schemas"]["SupplierProblemDto"];
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
    SupplierQualityController_create: {
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
                "application/json": components["schemas"]["SupplierProblemDraftDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierProblemDto"];
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
    SupplierQualityController_update: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateSupplierProblemDraftDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierProblemDto"];
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
    SupplierQualityController_issue: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IssueSupplierProblemDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierProblemDto"];
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
    SupplierQualityController_response: {
        parameters: {
            query?: {
                organizationId?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
                search?: string;
            };
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveSupplierResponseDraftDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierProblemDto"];
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
    SupplierQualityController_action: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubmitSupplierResponseDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierProblemDto"];
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
    SupplierQualityController_workflowAction: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SupplierWorkflowActionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierProblemDto"];
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
    SupplierPortalController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
                search?: string;
                severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
                responseForm?: "BRIEF" | "EIGHT_D";
                stage?: "DRAFT" | "ISSUED";
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
                    "application/json": components["schemas"]["SupplierProblemPageDto"];
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
    SupplierPortalController_detail: {
        parameters: {
            query?: {
                organizationId?: string;
                revisionPage?: components["schemas"]["Object"];
                revisionPageSize?: components["schemas"]["Object"];
            };
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
                    "application/json": components["schemas"]["SupplierProblemDto"];
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
    SupplierPortalController_response: {
        parameters: {
            query?: {
                organizationId?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
                search?: string;
            };
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveSupplierResponseDraftDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierProblemDto"];
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
    SupplierPortalController_action: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubmitSupplierResponseDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierProblemDto"];
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
    SupplierWorkflowBindingController_list: {
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
                    "application/json": components["schemas"]["SupplierWorkflowBindingsDto"];
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
    SupplierWorkflowBindingController_set: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetSupplierWorkflowBindingDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierWorkflowBindingDto"];
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
    ProcessQualityController_types: {
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
                    "application/json": components["schemas"]["ProcessDefectTypeDto"][];
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
    ProcessQualityController_createType: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateProcessDefectTypeDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProcessDefectTypeDto"];
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
    ProcessQualityController_updateType: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateProcessDefectTypeDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProcessDefectTypeDto"];
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
    ProcessQualityController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
                search?: string;
                defectTypeCode?: string;
                batchCode?: string;
                workOrderCode?: string;
                operationCode?: string;
                lineCode?: string;
                projectCode?: string;
                productCode?: string;
                materialCode?: string;
                responsibilityCategory?: "MATERIAL" | "OPERATION" | "EQUIPMENT" | "PROCESS" | "DESIGN";
                includeArchived?: boolean;
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
                    "application/json": components["schemas"]["ProcessDefectPageDto"];
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
    ProcessQualityController_create: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateProcessDefectDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProcessDefectDto"];
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
    ProcessQualityController_detail: {
        parameters: {
            query?: {
                organizationId?: string;
            };
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
                    "application/json": components["schemas"]["ProcessDefectDto"];
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
    ProcessQualityController_update: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateProcessDefectDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProcessDefectDto"];
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
    ProcessQualityController_archive: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ArchiveProcessDefectDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProcessDefectDto"];
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
}
