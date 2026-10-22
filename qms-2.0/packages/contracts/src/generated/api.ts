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
    "/api/v1/auth/password-change": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuthController_passwordChangeStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/password-change/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_completePasswordChange"];
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
    "/api/v1/me/avatar": {
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
        patch: operations["AccountController_updateAvatar"];
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
    "/api/v1/me/sessions/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AccountController_sessionHistory"];
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
    "/api/v1/admin/users/batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AdminUserController_createBatch"];
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
    "/api/v1/admin/users/{userId}/mfa-policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminUserController_getMfaPolicy"];
        put: operations["AdminUserController_setMfaPolicy"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
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
    "/api/v1/admin/users/{userId}/temporary-password/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AdminUserController_readTemporaryPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users/{userId}/temporary-password/reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AdminUserController_resetTemporaryPassword"];
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
    "/api/v1/me/mfa/preference": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MfaController_preference"];
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
    "/api/v1/files/{id}/retry-scan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FileController_retryScan"];
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
    "/api/v1/organizations/{organizationId}/positions/{positionId}/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrganizationGovernanceController_positionRoles"];
        /**
         * @deprecated
         * @description Legacy position role mappings are read-only; configure position permissions instead.
         */
        put: operations["OrganizationGovernanceController_replacePositionRoles"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/positions/{positionId}/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrganizationGovernanceController_positionPermissions"];
        put: operations["OrganizationGovernanceController_updatePositionPermissions"];
        post?: never;
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
    "/api/v1/organizations/{organizationId}/position-authorization/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PositionOnboardingController_preview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/system/my-permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PermissionsController_myPermissions"];
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
        /**
         * @deprecated
         * @description Legacy independent role writes are disabled; configure position permissions instead.
         */
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
        /**
         * @deprecated
         * @description Legacy independent role writes are disabled; configure position permissions instead.
         */
        delete: operations["AdminRoleController_remove"];
        options?: never;
        head?: never;
        /**
         * @deprecated
         * @description Legacy independent role writes are disabled; configure position permissions instead.
         */
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
        /**
         * @deprecated
         * @description Legacy independent role writes are disabled; configure position permissions instead.
         */
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
        /**
         * @deprecated
         * @description Legacy independent role assignments are disabled; maintain user positions instead.
         */
        put: operations["AdminRoleController_assign"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AccountOverviewController_overview"];
        put?: never;
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
    "/api/v1/outbox/failures/{id}/attempts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OutboxAdministrationController_attempts"];
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
    "/api/v1/tasks/statistics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TaskInboxController_statistics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/transfer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TaskInboxController_transfer"];
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
    "/api/v1/tasks/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TaskInboxController_retry"];
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
    "/api/v1/supplier-quality/profiles/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierMasterController_import"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/profiles/{id}/accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierMasterController_list"];
        put?: never;
        post: operations["SupplierMasterController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/profiles/{id}/accounts/{userId}/temporary-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierMasterController_temporaryPassword"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/profiles/{id}/accounts/{userId}/temporary-password/reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierMasterController_reset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality/profiles/{id}/accounts/{userId}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierMasterController_setStatus"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/process-quality/production-batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProcessQualityController_productionBatches"];
        put?: never;
        post: operations["ProcessQualityController_createProduction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/process-quality/production-batches/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProcessQualityController_productionSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/process-quality/production-batches/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProcessQualityController_productionDetail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/process-quality/production-batches/{id}/correct": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["ProcessQualityController_correctProduction"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/process-quality/shipment-reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProcessQualityController_shipmentReportList"];
        put?: never;
        post: operations["ProcessQualityController_createShipmentReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/process-quality/shipment-reports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProcessQualityController_shipmentReportDetail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/process-quality/shipment-reports/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["ProcessQualityController_archiveShipmentReport"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/process-quality/shipment-reports/{id}/evidence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["ProcessQualityController_updateShipmentReportEvidence"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/process-quality/shipment-reports/{id}/customer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["ProcessQualityController_associateShipmentReportCustomer"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/process-quality/shipment-reports/{id}/issues": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ProcessQualityController_linkShipmentReportIssue"];
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
    "/api/v1/process-quality/issues": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ProcessQualityController_issue"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/process-quality/defects/{id}/issues": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProcessQualityController_linkedIssues"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/customers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CustomerQualityController_customers"];
        put?: never;
        post: operations["CustomerQualityController_createCustomer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/customers/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CustomerQualityController_importCustomers"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/customers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CustomerQualityController_updateCustomer"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/customers/{id}/relations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CustomerQualityController_customerRelations"];
        put?: never;
        post: operations["CustomerQualityController_createCustomerRelation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/customer-relations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CustomerQualityController_updateCustomerRelation"];
        post?: never;
        delete: operations["CustomerQualityController_deleteCustomerRelation"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CustomerQualityController_complaints"];
        put?: never;
        post: operations["CustomerQualityController_createComplaint"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/assignees": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CustomerQualityController_complaintAssignees"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CustomerQualityController_importComplaints"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CustomerQualityController_complaint"];
        put: operations["CustomerQualityController_updateComplaint"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CustomerQualityController_archive"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CustomerQualityController_complaintEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/8d": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CustomerQualityController_complaintEightD"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/8d/draft": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CustomerQualityController_saveComplaintEightD"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/8d/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CustomerQualityController_submitComplaintEightD"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/8d/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CustomerQualityController_approveComplaintEightD"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/attachments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CustomerQualityController_complaintAttachments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/triage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CustomerQualityController_triageComplaint"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CustomerQualityController_progressComplaint"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CustomerQualityController_resolveComplaint"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CustomerQualityController_closeComplaint"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/reopen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CustomerQualityController_reopenComplaint"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/dispositions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CustomerQualityController_dispositionHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/disposition": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CustomerQualityController_disposition"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/analyses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CustomerQualityController_analysisHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/analysis": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CustomerQualityController_analysis"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/issues": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CustomerQualityController_issue"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/issues": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CustomerQualityController_linkedIssues"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/issues/{id}/sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CustomerQualityController_changeIssueSources"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customer-quality/complaints/{id}/issue-history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CustomerQualityController_linkedIssueHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/material-masters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["MaterialMasterController_list"];
        put?: never;
        post: operations["MaterialMasterController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/material-masters/{id}": {
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
        patch: operations["MaterialMasterController_update"];
        trace?: never;
    };
    "/api/v1/material-masters/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MaterialMasterController_import"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/plans/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuditManagementController_plan"];
        put: operations["AuditManagementController_updatePlan"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuditManagementController_createPlan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/plans/{id}/postponements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuditManagementController_postpone"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/postponements/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["AuditManagementController_decide"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuditManagementController_createTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/templates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["AuditManagementController_updateTemplate"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/templates/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuditManagementController_publishTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/executions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuditManagementController_createExecution"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/executions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuditManagementController_execution"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/executions/{id}/ncs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuditManagementController_executionNcs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/executions/{id}/report": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuditManagementController_executionReport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/plans/{id}/report": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuditManagementController_planReport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/executions/{id}/checklist": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuditManagementController_checklist"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/executions/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuditManagementController_submit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/nc-deadline-policies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuditManagementController_registerDeadlinePolicy"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/executions/{executionId}/checklist/{resultId}/nc": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuditManagementController_createNc"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/ncs/{id}/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["AuditManagementController_assign"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/ncs/{id}/response": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["AuditManagementController_respond"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/ncs/{id}/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["AuditManagementController_verify"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/ncs/{id}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["AuditManagementController_close"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuditManagementController_imports"];
        put?: never;
        post: operations["AuditManagementController_importRow"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/imports/{id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["AuditManagementController_reviewImport"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-management/imports/{id}/issue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuditManagementController_issueImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NewProductQualityController_createProject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/projects/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NewProductQualityController_project"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/projects/{id}/stages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NewProductQualityController_addStage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/stages/{id}/deliverables": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NewProductQualityController_addDeliverable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/deliverables/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["NewProductQualityController_submitDeliverable"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/lessons": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NewProductQualityController_createLesson"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/projects/{projectId}/lessons/{lessonId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NewProductQualityController_attachLesson"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/lesson-checks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["NewProductQualityController_confirmLesson"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/stages/{id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NewProductQualityController_reviewStage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/projects/{id}/trial-batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NewProductQualityController_createTrialBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/trial-batches/{id}/metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NewProductQualityController_recordMetric"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/trial-batches/{id}/report": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NewProductQualityController_trialReport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/trial-batches/{id}/report/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NewProductQualityController_exportTrialReport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/trial-batches/{id}/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NewProductQualityController_trialSummary"];
        put?: never;
        post: operations["NewProductQualityController_createTrialSummary"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/trial-batches/{id}/summary/revisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NewProductQualityController_trialSummaryRevisions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/trial-batches/{id}/summary/export/{format}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NewProductQualityController_exportTrialSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/trial-batches/{id}/summary/revise": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["NewProductQualityController_reviseTrialSummary"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/trial-batches/{id}/summary/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["NewProductQualityController_submitTrialSummary"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/trial-batches/{id}/summary/decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["NewProductQualityController_decideTrialSummary"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/projects/{id}/early-flow": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NewProductQualityController_earlyFlow"];
        put?: never;
        post: operations["NewProductQualityController_createEarlyFlow"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/early-flows/{id}/revise": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["NewProductQualityController_reviseEarlyFlow"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/early-flows/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["NewProductQualityController_submitEarlyFlow"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/early-flows/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["NewProductQualityController_approveEarlyFlow"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/early-flows/{id}/release": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["NewProductQualityController_decideEarlyFlowRelease"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/early-flows/{id}/releases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NewProductQualityController_releases"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/projects/{id}/defect-selections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NewProductQualityController_selectedDefects"];
        put?: never;
        post: operations["NewProductQualityController_selectDefect"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/projects/{id}/issues": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NewProductQualityController_issues"];
        put?: never;
        post: operations["NewProductQualityController_issueDefects"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/issues/{id}/escalate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NewProductQualityController_escalateIssue"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/issues/{id}/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["NewProductQualityController_assignIssue"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/issues/{id}/measure": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["NewProductQualityController_recordIssueMeasure"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/issues/{id}/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["NewProductQualityController_verifyIssue"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/issues/{id}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["NewProductQualityController_closeIssue"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/projects/{id}/legacy-issues": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NewProductQualityController_legacyIssue"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/projects/{id}/mass-production-approval": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NewProductQualityController_massProductionApproval"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/new-product-quality/projects/{id}/handover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NewProductQualityController_handover"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/quality-data/metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["QualityDataController_metrics"];
        put?: never;
        post: operations["QualityDataController_createMetric"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/quality-data/facts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["QualityDataController_recordFact"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/quality-data/snapshots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["QualityDataController_snapshot"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/quality-data/snapshots/internal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["QualityDataController_internalSnapshot"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/quality-data/snapshots/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["QualityDataController_snapshotDetail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/quality-data/facts/{id}/drilldown": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["QualityDataController_factDrilldown"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/quality-data/trend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["QualityDataController_trend"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/quality-data/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["QualityDataController_dashboard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/quality-data/insights": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["QualityDataController_insights"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/quality-data/management-report/export/{format}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["QualityDataController_managementReport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-incoming/inspections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierIncomingController_list"];
        put?: never;
        post: operations["SupplierIncomingController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-incoming/inspections/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierIncomingController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-incoming/inspections/{id}/source": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierIncomingController_source"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-incoming/inspections/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierIncomingController_complete"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-incoming/inspections/{id}/correct": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierIncomingController_correct"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-incoming/inspections/{id}/problem-links": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierIncomingController_linkProblem"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-incoming/inspections/{id}/photos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierIncomingController_attachPhoto"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/coordinate-inspection/requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CoordinateInspectionController_list"];
        put?: never;
        post: operations["CoordinateInspectionController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/coordinate-inspection/requests/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CoordinateInspectionController_detail"];
        put: operations["CoordinateInspectionController_revise"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/coordinate-inspection/requests/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CoordinateInspectionController_submit"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/coordinate-inspection/requests/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CoordinateInspectionController_approve"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/coordinate-inspection/requests/{id}/schedule": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CoordinateInspectionController_schedule"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/coordinate-inspection/requests/{id}/progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CoordinateInspectionController_progress"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-performance/cards": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierPerformanceController_list"];
        put?: never;
        post: operations["SupplierPerformanceController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-performance/cards/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierPerformanceController_publish"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-performance/appeals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierPerformanceAppealController_list"];
        put?: never;
        post: operations["SupplierPerformanceAppealController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-performance/appeals/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierPerformanceAppealController_submit"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-performance/appeals/{id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierPerformanceAppealController_review"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/performance/cards": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierPerformancePortalCardController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/performance/appeals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierPerformancePortalAppealController_list"];
        put?: never;
        post: operations["SupplierPerformancePortalAppealController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/performance/appeals/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierPerformancePortalAppealController_submit"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-concessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierConcessionController_list"];
        put?: never;
        post: operations["SupplierConcessionController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-concessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierConcessionController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-concessions/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierConcessionController_submit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-concessions/{id}/withdraw": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierConcessionController_withdraw"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-concessions/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierConcessionController_approve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-concessions/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierConcessionController_reject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-concessions/{id}/release": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierConcessionController_release"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/announcements/mine": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AnnouncementController_mine"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/announcements/manage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AnnouncementController_manage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/announcements/audience-users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AnnouncementController_audienceUsers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/announcements/{id}/receipts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AnnouncementController_receipts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/announcements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AnnouncementController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/announcements/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["AnnouncementController_update"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/announcements/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AnnouncementController_publish"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/announcements/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AnnouncementController_archive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/announcements/{id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AnnouncementController_read"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-standards/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuditStandardsController_list"];
        put?: never;
        post: operations["AuditStandardsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-standards/templates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuditStandardsController_detail"];
        put: operations["AuditStandardsController_updateDraft"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-standards/templates/{id}/revisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuditStandardsController_revise"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-standards/templates/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuditStandardsController_publish"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-admission/quality-documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierAdmissionController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-admission/quality-documents/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierAdmissionController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-admission/quality-documents/{id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierAdmissionController_review"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/quality-documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierAdmissionPortalController_list"];
        put?: never;
        post: operations["SupplierAdmissionPortalController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/quality-documents/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierAdmissionPortalController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/quality-documents/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierAdmissionPortalController_submit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/e-signatures/mine/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ESignatureController_summary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/e-signatures/mine": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ESignatureController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/e-signatures": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ESignatureController_register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/e-signatures/{id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ESignatureController_revoke"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/e-signatures/approvals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ESignatureController_approvals"];
        put?: never;
        post: operations["ESignatureController_signApproval"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-audit/plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierAuditController_listPlans"];
        put?: never;
        post: operations["SupplierAuditController_createPlan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-audit/plans/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierAuditController_submitPlan"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-audit/records": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierAuditController_listRecords"];
        put?: never;
        post: operations["SupplierAuditController_createRecord"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-audit/records/{id}/checklist": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierAuditController_getChecklist"];
        put: operations["SupplierAuditController_updateChecklist"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-audit/records/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierAuditController_submitRecord"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-audit/records/{id}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierAuditController_closeRecord"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality-targets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierQualityTargetsController_list"];
        put?: never;
        post: operations["SupplierQualityTargetsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality-targets/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierQualityTargetsController_submit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality-targets/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierQualityTargetsController_approve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality-targets/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierQualityTargetsController_publish"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality-targets/{id}/revise": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierQualityTargetsController_revise"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-quality-targets/{id}/actuals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierQualityTargetsController_actualHistory"];
        put?: never;
        post: operations["SupplierQualityTargetsController_recordActual"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-meetings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierMeetingsController_list"];
        put?: never;
        post: operations["SupplierMeetingsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-meetings/{id}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierMeetingsController_start"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-meetings/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierMeetingsController_complete"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-meetings/{id}/topics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierMeetingsController_createTopic"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-meetings/{id}/topics/{topicId}/conclude": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierMeetingsController_concludeTopic"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-meetings/{id}/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierMeetingsController_createAction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-meetings/{id}/actions/{actionId}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SupplierMeetingsController_completeAction"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-ppap": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierPpapController_list"];
        put?: never;
        post: operations["SupplierPpapController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-ppap/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierPpapController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-ppap/{id}/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierPpapController_addItem"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-ppap/{id}/items/{itemId}/evidence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierPpapController_bindEvidence"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-ppap/{id}/items/{itemId}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierPpapController_reviewItem"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-ppap/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierPpapController_submit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-ppap/{id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierPpapController_review"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-ppap/{id}/requalify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierPpapController_requalify"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-inspection-standards": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierInspectionStandardsController_list"];
        put?: never;
        post: operations["SupplierInspectionStandardsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-inspection-standards/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierInspectionStandardsController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-inspection-standards/{id}/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierInspectionStandardsController_addItem"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-inspection-standards/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierInspectionStandardsController_publish"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-barcode": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierBarcodeController_list"];
        put?: never;
        post: operations["SupplierBarcodeController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-barcode/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierBarcodeController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-barcode/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierBarcodeController_publish"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-barcode/scan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierBarcodeController_scan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-asn": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierAsnController_list"];
        put?: never;
        post: operations["SupplierAsnController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-asn/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierAsnController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-asn/{id}/evidence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierAsnController_updateEvidence"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-asn/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierAsnController_submit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-pcn/requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierPcnController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-pcn/requests/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierPcnController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-pcn/requests/{id}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierPcnController_start"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-pcn/requests/{id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierPcnController_review"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/pcns": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierPcnPortalController_list"];
        put?: never;
        post: operations["SupplierPcnPortalController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/pcns/profiles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierPcnPortalController_profiles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/pcns/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SupplierPcnPortalController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/pcns/{id}/update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierPcnPortalController_update"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/pcns/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierPcnPortalController_submit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/supplier-portal/pcns/{id}/advance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupplierPcnPortalController_advance"];
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
            /** @default false */
            rememberMe: boolean;
        };
        LoginResponseDto: {
            /** @enum {string} */
            accountType: "INTERNAL" | "SUPPLIER";
            /** @enum {string} */
            landingPath: "/app/workbench" | "/supplier/inbox" | "/mfa" | "/change-password";
            /** @enum {string} */
            securityState: "AUTHENTICATED" | "MFA_REQUIRED" | "MFA_ENROLLMENT_REQUIRED" | "PASSWORD_CHANGE_REQUIRED";
        };
        CompletePasswordChangeDto: {
            newPassword: string;
        };
        SessionUserDto: {
            id: string;
            organizationId: string;
            /** @enum {string} */
            accountType: "INTERNAL" | "SUPPLIER";
        };
        SessionResponseDto: {
            user: components["schemas"]["SessionUserDto"];
            /** @enum {string} */
            landingPath: "/app/workbench" | "/supplier/inbox";
            /** @enum {string} */
            securityState: "AUTHENTICATED";
            /** @enum {string} */
            lifetimeType: "STANDARD" | "REMEMBERED_ADMIN" | "REMEMBERED_USER";
            /** Format: date-time */
            expiresAt: string;
        };
        CompletePasswordResetDto: {
            temporaryCode: string;
            /** Format: uuid */
            resetId: string;
            newPassword: string;
        };
        UpdateAccountAvatarDto: {
            /** Format: uuid */
            fileId: string | null;
            expectedVersion: number;
        };
        OrganizationSummaryDto: {
            id: string;
            code: string;
            name: string;
        };
        AccountProfileDto: {
            fullName: string | null;
            phone: string | null;
            profileVersion: number;
            /** Format: date-time */
            emailVerifiedAt: string | null;
            id: string;
            username: string;
            email?: string | null;
            /** @enum {string} */
            accountType: "INTERNAL" | "SUPPLIER";
            /** @enum {string} */
            status: "ACTIVE" | "DISABLED";
            mfaEnabled: boolean;
            /** Format: uuid */
            avatarFileId: string | null;
            avatarVersion: number;
            organization: components["schemas"]["OrganizationSummaryDto"];
        };
        UpdateAccountProfileDto: {
            fullName?: string | null;
            phone?: string | null;
            email?: string | null;
            expectedProfileVersion: number;
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
        AccountSessionHistoryItemDto: {
            id: string;
            createdAt: string;
            expiresAt: string;
            revokedAt?: string | null;
            isCurrent: boolean;
            /** @enum {string} */
            lifetimeType: "STANDARD" | "REMEMBERED_ADMIN" | "REMEMBERED_USER";
            /** @enum {string} */
            status: "ACTIVE" | "REVOKED" | "EXPIRED";
        };
        AccountSessionHistoryPageDto: {
            items: components["schemas"]["AccountSessionHistoryItemDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        AdminUserBatchRowDto: {
            rowNumber: number;
            username: string;
            email?: string | null;
            /** @description Raw account type; unsupported values produce a per-row error. */
            accountType: string;
            /** @description Raw positions; invalid or missing internal positions produce a per-row error. */
            positionIds?: string[];
            authorizationBaseline?: string;
        };
        CreateAdminUserBatchDto: {
            /** Format: uuid */
            organizationId: string;
            rows: components["schemas"]["AdminUserBatchRowDto"][];
        };
        TemporaryPasswordDto: {
            /** Format: uuid */
            userId: string;
            /** @enum {string} */
            status: "AVAILABLE" | "EXPIRED" | "UNAVAILABLE";
            credentialVersion?: number;
            /** Format: date-time */
            expiresAt?: string;
            temporaryPassword?: string;
        };
        AdminUserBatchResultRowDto: {
            rowNumber: number;
            username: string;
            /** @enum {string} */
            status: "SUCCESS" | "ERROR";
            code?: string;
            /** Format: uuid */
            userId?: string;
            credentialVersion?: number;
            temporaryPassword?: components["schemas"]["TemporaryPasswordDto"];
        };
        AdminUserBatchResultDto: {
            /** Format: uuid */
            batchId: string;
            rows: components["schemas"]["AdminUserBatchResultRowDto"][];
        };
        PositionAuthorizationDepartmentDto: {
            id: string;
            code: string;
            name: string;
        };
        UserPositionSummaryDto: {
            id: string;
            code: string;
            name: string;
            department: components["schemas"]["PositionAuthorizationDepartmentDto"];
        };
        AdminUserDto: {
            /** @description 最多展示三个有效任职，完整数量见 totalPositions。 */
            positions?: components["schemas"]["UserPositionSummaryDto"][];
            totalPositions?: number;
            fullName: string | null;
            phone: string | null;
            profileVersion: number;
            /** Format: date-time */
            emailVerifiedAt: string | null;
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
        AdminMfaPolicyDto: {
            /** Format: uuid */
            userId: string;
            required: boolean;
            bound: boolean;
            override: boolean | null;
            roleRequired: boolean;
            securityVersion: number;
            selfSessionRevoked: boolean;
        };
        AdminMfaPolicyInputDto: {
            required: boolean;
            expectedSecurityVersion: number;
        };
        CreateAdminUserDto: {
            fullName?: string | null;
            phone?: string | null;
            email?: string | null;
            /** @description 内部账号必填；供应商专用开通不要求内部岗位。 */
            positionIds?: string[];
            /** @description 内部账号必填，使用岗位授权预览返回的完整基线。 */
            authorizationBaseline?: string;
            username: string;
            /** @enum {string} */
            accountType: "INTERNAL" | "SUPPLIER";
            organizationId: string;
            initialPassword: string;
        };
        UpdateAdminUserDto: {
            fullName?: string | null;
            phone?: string | null;
            email?: string | null;
            /** @description 修改姓名、电话或邮箱时必填 */
            expectedProfileVersion?: number;
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
        ResetTemporaryPasswordDto: {
            temporaryPassword?: string;
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
            /** @description Whether an authenticator is bound; independent of the effective login MFA policy. */
            mfaEnabled: boolean;
            /** @description Effective MFA requirement for the current server-side governance identity and preference. */
            mfaRequired: boolean;
            isAdministrator: boolean;
            /** @enum {string} */
            mfaPreference: "DEFAULT" | "ENABLED" | "DISABLED";
            canUnbindMfa: boolean;
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
            landingPath: "/app/workbench" | "/supplier/inbox" | "/mfa" | "/change-password";
            /** @enum {string} */
            securityState: "AUTHENTICATED" | "MFA_REQUIRED" | "MFA_ENROLLMENT_REQUIRED" | "PASSWORD_CHANGE_REQUIRED";
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
        MfaPreferenceDto: {
            /** @enum {string} */
            preference: "ENABLED" | "DISABLED";
            code?: string;
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
        PositionRolesDto: {
            positionId: string;
            roleVersion: number;
            roles: components["schemas"]["AdminRoleDto"][];
            /** @description Distinct users with currently effective appointments */
            effectiveAssigneeCount: number;
            /** @description The committed mutation invalidated the acting session; reauthenticate without resubmitting */
            selfSessionRevoked: boolean;
        };
        ReplacePositionRolesDto: {
            roleIds: string[];
            expectedRoleVersion: number;
        };
        PositionPermissionsDto: {
            positionId: string;
            roleVersion: number;
            permissionCodes: string[];
            mfaRequired: boolean;
            legacyRoles: components["schemas"]["AdminRoleDto"][];
            /** @description Distinct users with currently effective appointments */
            effectiveAssigneeCount: number;
            /** @description The committed mutation invalidated the acting session; reauthenticate without resubmitting */
            selfSessionRevoked: boolean;
        };
        UpdatePositionPermissionsDto: {
            permissionCodes: string[];
            expectedPermissionCodes: string[];
            mfaRequired: boolean;
            expectedMfaRequired: boolean;
            expectedRoleVersion: number;
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
        ReplaceUserPositionsWithPreviewDto: {
            positionIds: string[];
            expectedPositionIds: string[];
            /** @description 岗位授权预览返回的完整基线。 */
            authorizationBaseline: string;
        };
        PositionAuthorizationPreviewInputDto: {
            /** @description 目标组织内的岗位 ID，空数组用于预览撤销全部任职。 */
            positionIds: string[];
            /** Format: uuid */
            targetUserId?: string;
        };
        PositionAuthorizationSourceDto: {
            roleId: string;
            roleCode: string;
            name: string;
            permissionCodes: string[];
            mfaRequired: boolean;
        };
        PositionAuthorizationItemDto: {
            id: string;
            code: string;
            name: string;
            department: components["schemas"]["PositionAuthorizationDepartmentDto"];
            version: number;
            roleVersion: number;
            permissionCodes: string[];
            mfaRequired: boolean;
            historicalSources: components["schemas"]["PositionAuthorizationSourceDto"][];
        };
        PositionAuthorizationPreviewDto: {
            authorizationBaseline: string;
            positions: components["schemas"]["PositionAuthorizationItemDto"][];
            effectivePermissionCodes: string[];
            /** @description 候选岗位及保留直接角色的 MFA 要求并集，不代替账户级 MFA 策略。 */
            effectiveMfaRequired: boolean;
            retainedSources?: components["schemas"]["PositionAuthorizationSourceDto"][];
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
        EffectiveAdminRoleSourceDto: {
            /** @enum {string} */
            kind: "DIRECT" | "POSITION";
            /** Format: uuid */
            positionId?: string;
            /** Format: uuid */
            assignmentId?: string;
        };
        EffectiveAdminRoleDto: {
            mfaRequired: boolean;
            id: string;
            organizationId: string | null;
            code: string;
            name: string;
            permissions: components["schemas"]["AdminPermissionDto"][];
            sources: components["schemas"]["EffectiveAdminRoleSourceDto"][];
        };
        AdminUserRolesDto: {
            userId: string;
            organizationId: string;
            roles: components["schemas"]["AdminRoleDto"][];
            effectiveRoles: components["schemas"]["EffectiveAdminRoleDto"][];
            permissions: string[];
        };
        AssignAdminRolesDto: {
            roleIds: string[];
        };
        AccountAssignmentNameDto: {
            /** Format: uuid */
            id: string;
            code: string;
            name: string;
        };
        AccountAssignmentDto: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            startedAt: string;
            /** Format: date-time */
            endedAt: string | null;
            position: components["schemas"]["AccountAssignmentNameDto"];
            department: components["schemas"]["AccountAssignmentNameDto"];
        };
        AccountRoleSourceDto: {
            /** @enum {string} */
            kind: "DIRECT" | "POSITION";
            /** Format: uuid */
            positionId?: string;
            positionName?: string;
            /** Format: uuid */
            assignmentId?: string;
        };
        AccountEffectiveRoleDto: {
            /** Format: uuid */
            id: string;
            code: string;
            name: string;
            sources: components["schemas"]["AccountRoleSourceDto"][];
        };
        AccountOverviewDto: {
            /** Format: uuid */
            organizationId: string;
            assignments: components["schemas"]["AccountAssignmentDto"][];
            effectiveRoles: components["schemas"]["AccountEffectiveRoleDto"][];
            permissions: string[];
        };
        AuditActorSummaryDto: {
            username: string;
            /** @enum {string} */
            accountType: "INTERNAL" | "SUPPLIER";
            organizationName: string;
        };
        AuditEventDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            actorUserId: string | null;
            action: string;
            actionLabel: string;
            actorSummary: components["schemas"]["AuditActorSummaryDto"] | null;
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
            /** @example OUTBOX_HANDLER_ERROR */
            failureReasonCode: string;
            /** Format: date-time */
            lastFailureAt?: string;
        };
        OutboxFailurePageDto: {
            items: components["schemas"]["OutboxFailureDto"][];
            total: number;
        };
        OutboxAttemptDto: {
            /** Format: uuid */
            id: string;
            attemptNumber: number;
            /** @enum {string} */
            outcome: "FAILED" | "PROCESSED" | "DEFERRED" | "RETRY_REQUESTED";
            /** @example OUTBOX_HANDLER_ERROR */
            reasonCode?: string;
            /** Format: date-time */
            occurredAt: string;
            /** Format: date-time */
            retryAt?: string;
        };
        OutboxAttemptPageDto: {
            items: components["schemas"]["OutboxAttemptDto"][];
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
            status: "PENDING" | "IN_PROGRESS" | "OVERDUE" | "FAILED";
            /** Format: uuid */
            claimedByUserId: string | null;
            /** Format: date-time */
            claimedAt: string | null;
            canAct: boolean;
            canClaim: boolean;
            canRelease: boolean;
            canRetry: boolean;
        };
        TaskPageDto: {
            items: components["schemas"]["TaskDto"][];
            total: number;
        };
        TaskStatisticsDto: {
            total: number;
            pending: number;
            inProgress: number;
            overdue: number;
            unclaimed: number;
            mine: number;
            dueToday: number;
            dueThisWeek: number;
            failed: number;
        };
        TaskTransferItemDto: {
            /** Format: uuid */
            id: string;
            expectedVersion: number;
        };
        TaskTransferDto: {
            /** Format: uuid */
            assigneeUserId: string;
            items: components["schemas"]["TaskTransferItemDto"][];
        };
        TaskTransferResultDto: {
            /** Format: uuid */
            id: string;
            version: number;
            /** Format: uuid */
            assigneeUserId: string;
            /** @enum {string} */
            status: "PENDING" | "IN_PROGRESS" | "OVERDUE";
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
            supplierOrganizationId: string | null;
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
            displayName?: string;
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
            supplierOrganizationId?: string;
            businessCode: string;
            /** @description 未绑定供应商企业时必填；供应商自有名称 */
            displayName?: string;
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
            supplierOrganizationId: string | null;
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
        SupplierProfileImportRowDto: {
            rowNumber: number;
            businessCode: string;
            displayName: string;
            contactName?: string;
            contactEmail?: string;
        };
        SupplierProfileImportDto: {
            /** Format: uuid */
            organizationId?: string;
            rows: components["schemas"]["SupplierProfileImportRowDto"][];
        };
        SupplierProfileImportResultRowDto: {
            rowNumber: number;
            code: string;
            /** @enum {string} */
            status: "CREATED" | "SKIPPED_DUPLICATE" | "FAILED";
            /** Format: uuid */
            profileId?: string;
            errorCode?: string;
        };
        SupplierProfileImportResultDto: {
            items: components["schemas"]["SupplierProfileImportResultRowDto"][];
            created: number;
            skipped: number;
            failed: number;
        };
        SupplierAccountDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            username: string;
            email: string | null;
            /** @enum {string} */
            status: "ACTIVE" | "DISABLED";
            securityVersion: number;
        };
        SupplierAccountPageDto: {
            items: components["schemas"]["SupplierAccountDto"][];
            canCreate: boolean;
            canReset: boolean;
            canSetStatus: boolean;
        };
        CreateSupplierAccountDto: {
            /** Format: uuid */
            organizationId?: string;
            username: string;
            email?: string | null;
            /**
             * Format: uuid
             * @description 仅首次绑定可选，必须具备目标供应商企业的实际账号治理权限
             */
            supplierOrganizationId?: string;
        };
        CreatedSupplierAccountDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            username: string;
            email: string | null;
            /** @enum {string} */
            status: "ACTIVE" | "DISABLED";
            securityVersion: number;
            temporaryPassword: components["schemas"]["TemporaryPasswordDto"];
        };
        SupplierAccountScopeDto: {
            /** Format: uuid */
            organizationId?: string;
        };
        SetSupplierAccountStatusDto: {
            /** Format: uuid */
            organizationId?: string;
            /** @enum {string} */
            status: "ACTIVE" | "DISABLED";
            expectedSecurityVersion: number;
        };
        CreateProcessProductionDto: {
            /** Format: uuid */
            organizationId?: string;
            batchCode: string;
            workOrderCode: string;
            operationCode: string;
            productCode: string;
            lineCode?: string;
            /** Format: date-time */
            periodStart: string;
            /** Format: date-time */
            periodEnd: string;
            totalQuantity: number;
            goodQuantity: number;
            firstPassQuantity: number;
        };
        ProcessProductionDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            batchCode: string;
            workOrderCode: string;
            operationCode: string;
            productCode: string;
            lineCode?: string | null;
            /** Format: date-time */
            periodStart: string;
            /** Format: date-time */
            periodEnd: string;
            totalQuantity: number;
            goodQuantity: number;
            firstPassQuantity: number;
            /** @enum {string} */
            sourceKind: "MANUAL";
            yieldRate: number;
            firstPassRate: number;
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        ProcessProductionPageDto: {
            items: components["schemas"]["ProcessProductionDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        ProcessProductionSummaryDto: {
            batchCount: number;
            totalQuantity: number;
            goodQuantity: number;
            firstPassQuantity: number;
            yieldRate?: number | null;
            firstPassRate?: number | null;
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
        ProcessProductionDetailDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            batchCode: string;
            workOrderCode: string;
            operationCode: string;
            productCode: string;
            lineCode?: string | null;
            /** Format: date-time */
            periodStart: string;
            /** Format: date-time */
            periodEnd: string;
            totalQuantity: number;
            goodQuantity: number;
            firstPassQuantity: number;
            /** @enum {string} */
            sourceKind: "MANUAL";
            yieldRate: number;
            firstPassRate: number;
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            revisions: Record<string, never>[];
            defects: components["schemas"]["ProcessDefectDto"][];
            defectQuantity: number;
        };
        CorrectProcessProductionDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            totalQuantity?: number;
            goodQuantity: number;
            firstPassQuantity: number;
            reason: string;
        };
        CreateProcessShipmentReportDto: {
            /** Format: uuid */
            organizationId?: string;
            reportNumber?: string;
            /** Format: date-time */
            periodStart: string;
            /** Format: date-time */
            periodEnd: string;
            productCode?: string;
            batchIds: string[];
        };
        ProcessShipmentReportEvidenceDto: {
            /** Format: uuid */
            fileId: string;
            fileVersion: number;
            sha256: string;
            /** Format: date-time */
            scannedAt: string;
            position: number;
        };
        ProcessShipmentReportCustomerDto: {
            /** Format: uuid */
            customerId: string;
            customerVersion: number;
            customerCode: string;
            customerName: string;
        };
        ProcessShipmentReportIssueDto: {
            /** Format: uuid */
            id: string;
            reportNumber: string;
            status: string;
            version: number;
        };
        ProcessShipmentReportDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            reportNumber: string;
            /** @enum {string} */
            status: "DRAFT" | "ARCHIVED";
            /** Format: date-time */
            periodStart: string;
            /** Format: date-time */
            periodEnd: string;
            productCode?: string | null;
            batchCount: number;
            totalQuantity: number;
            goodQuantity: number;
            firstPassQuantity: number;
            defectQuantity: number;
            yieldRate?: number | null;
            firstPassRate?: number | null;
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** Format: date-time */
            archivedAt?: Record<string, never> | null;
            snapshot: Record<string, never>;
            evidence: components["schemas"]["ProcessShipmentReportEvidenceDto"][];
            customers: components["schemas"]["ProcessShipmentReportCustomerDto"][];
            issues: components["schemas"]["ProcessShipmentReportIssueDto"][];
        };
        ProcessShipmentReportPageDto: {
            items: components["schemas"]["ProcessShipmentReportDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        ArchiveProcessShipmentReportDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
        };
        UpdateProcessShipmentReportEvidenceDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            fileIds: string[];
        };
        AssociateProcessShipmentReportCustomerDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            /** Format: uuid */
            customerId: string;
        };
        LinkProcessShipmentReportIssueDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            /** Format: uuid */
            problemId: string;
            expectedProblemVersion: number;
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
        ProcessIssueSourceDto: {
            /** Format: uuid */
            defectId: string;
            expectedVersion: number;
        };
        ProcessIssueWorkflowBindingDto: {
            /** Format: uuid */
            workflowDefinitionId: string;
            /** Format: uuid */
            workflowVersionId: string;
            instanceKey: string;
        };
        IssueProcessDefectsDto: {
            /** Format: uuid */
            organizationId?: string;
            sources: components["schemas"]["ProcessIssueSourceDto"][];
            problemType: string;
            /** @enum {string} */
            responseForm: "BRIEF" | "EIGHT_D";
            responsibleScope: string;
            severity: string;
            /** Format: uuid */
            ownerId?: string;
            /** Format: date-time */
            dueAt?: string;
            workflowBinding: components["schemas"]["ProcessIssueWorkflowBindingDto"];
        };
        ProcessIssueProblemDto: {
            /** Format: uuid */
            id: string;
            reportNumber: string;
            /** Format: uuid */
            workflowInstanceId: string;
            version: number;
        };
        ProcessIssueResultDto: {
            problem: components["schemas"]["ProcessIssueProblemDto"];
            replayed: boolean;
        };
        CustomerMasterDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organization_id: string;
            code: string;
            name: string;
            active: boolean;
            version: number;
        };
        CreateCustomerDto: {
            /** Format: uuid */
            organizationId?: string;
            code: string;
            name: string;
        };
        CustomerMasterImportRowDto: {
            rowNumber: number;
            code: string;
            name: string;
        };
        CustomerMasterImportDto: {
            /** Format: uuid */
            organizationId?: string;
            rows: components["schemas"]["CustomerMasterImportRowDto"][];
        };
        CustomerMasterImportResultItemDto: {
            rowNumber: number;
            code: string;
            /** @enum {string} */
            status: "CREATED" | "SKIPPED_DUPLICATE" | "FAILED";
            errorCode?: string;
        };
        CustomerMasterImportResultDto: {
            items: components["schemas"]["CustomerMasterImportResultItemDto"][];
            created: number;
            skipped: number;
            failed: number;
        };
        UpdateCustomerDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            name?: string;
            active?: boolean;
        };
        CustomerRelationDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organization_id: string;
            /** Format: uuid */
            customer_id: string;
            /** @enum {string} */
            relation_type: "CUSTOMER_PARENT" | "VEHICLE_MODEL" | "PROJECT" | "PRODUCT";
            /** Format: uuid */
            related_customer_id?: Record<string, never> | null;
            related_code?: Record<string, never> | null;
            related_name?: Record<string, never> | null;
            version: number;
        };
        CreateCustomerRelationDto: {
            /** Format: uuid */
            organizationId?: string;
            /** @enum {string} */
            relationType: "CUSTOMER_PARENT" | "VEHICLE_MODEL" | "PROJECT" | "PRODUCT";
            /** Format: uuid */
            relatedCustomerId?: string;
            relatedCode?: string;
            relatedName?: string;
        };
        UpdateCustomerRelationDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            /** Format: uuid */
            relatedCustomerId?: string;
            relatedCode?: string;
            relatedName?: string;
        };
        CustomerComplaintDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organization_id: string;
            complaint_number: string;
            /** Format: uuid */
            customer_id: string;
            /** @enum {string} */
            complaint_type: "ZERO_KM" | "AFTER_SALES";
            terminal_customer_name?: string | null;
            product_code?: string | null;
            product_model?: string | null;
            defect_description: string;
            vin?: string | null;
            mileage?: number | null;
            /** Format: date */
            purchase_date?: string | null;
            return_required: boolean;
            physical_analysis_required: boolean;
            severity: string;
            severity_policy_version: string;
            severity_snapshot: Record<string, never>;
            /** @enum {string} */
            status: "OPEN" | "IN_ANALYSIS" | "RESOLVED" | "CLOSED" | "ARCHIVED";
            /** @enum {string|null} */
            category?: "PRODUCT_QUALITY" | "DELIVERY" | "SERVICE" | "OTHER" | null;
            category_note?: Record<string, never> | null;
            /** Format: uuid */
            responsible_department_id?: Record<string, never> | null;
            /** Format: uuid */
            owner_user_id?: Record<string, never> | null;
            resolution_summary?: Record<string, never> | null;
            closure_note?: Record<string, never> | null;
            external_source_system?: string | null;
            external_record_key?: string | null;
            /** Format: date-time */
            source_observed_at?: string | null;
            ingestion_status?: string | null;
            /** Format: uuid */
            problem_index_id?: string | null;
            version: number;
            /** Format: date-time */
            archived_at?: string | null;
            /** Format: date-time */
            created_at: string;
        };
        CustomerComplaintDepartmentDto: {
            /** Format: uuid */
            id: string;
            name: string;
        };
        CustomerComplaintUserDto: {
            /** Format: uuid */
            id: string;
            username: string;
        };
        CustomerComplaintAssigneesDto: {
            departments: components["schemas"]["CustomerComplaintDepartmentDto"][];
            users: components["schemas"]["CustomerComplaintUserDto"][];
        };
        CustomerComplaintImportRowDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            customerId: string;
            /** @enum {string} */
            complaintType: "ZERO_KM" | "AFTER_SALES";
            defectDescription: string;
            terminalCustomerName?: string;
            productCode?: string;
            productModel?: string;
            vin?: string;
            mileage?: number;
            /** Format: date-time */
            purchaseDate?: string;
            returnRequired?: boolean;
            physicalAnalysisRequired?: boolean;
            severity: string;
            severityPolicyVersion: string;
            severitySnapshot: Record<string, never>;
            /** @enum {string} */
            externalSourceSystem?: "ERP" | "SAP" | "IMS";
            externalRecordKey?: string;
            /** Format: date-time */
            sourceObservedAt?: string;
            rowNumber: number;
        };
        ImportCustomerComplaintsDto: {
            /** Format: uuid */
            organizationId?: string;
            rows: components["schemas"]["CustomerComplaintImportRowDto"][];
        };
        CustomerComplaintImportItemDto: {
            rowNumber: number;
            /** @enum {string} */
            status: "CREATED" | "DUPLICATE" | "REJECTED";
            /** Format: uuid */
            complaintId?: Record<string, never> | null;
            complaintNumber?: Record<string, never> | null;
            errorCode?: Record<string, never> | null;
        };
        CustomerComplaintImportResultDto: {
            created: number;
            duplicates: number;
            rejected: number;
            items: components["schemas"]["CustomerComplaintImportItemDto"][];
        };
        CustomerPhysicalDispositionDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            complaint_id: string;
            /** @enum {string} */
            action: "RETURN" | "REPAIR" | "SCRAP" | "NO_RETURN" | "OTHER";
            /** @enum {string} */
            status: "PENDING" | "RECEIVED" | "REPAIRED" | "SCRAPPED" | "CLOSED";
            responsibility?: string | null;
            notes?: string | null;
            version: number;
            /** Format: date-time */
            created_at: string;
        };
        CustomerPhysicalAnalysisDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            complaint_id: string;
            summary: string;
            /** @enum {string} */
            status: "MISSING" | "IN_PROGRESS" | "COMPLETED";
            evidence_summary?: string | null;
            version: number;
            /** Format: date-time */
            created_at: string;
        };
        CustomerComplaintDetailDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organization_id: string;
            complaint_number: string;
            /** Format: uuid */
            customer_id: string;
            /** @enum {string} */
            complaint_type: "ZERO_KM" | "AFTER_SALES";
            terminal_customer_name?: string | null;
            product_code?: string | null;
            product_model?: string | null;
            defect_description: string;
            vin?: string | null;
            mileage?: number | null;
            /** Format: date */
            purchase_date?: string | null;
            return_required: boolean;
            physical_analysis_required: boolean;
            severity: string;
            severity_policy_version: string;
            severity_snapshot: Record<string, never>;
            /** @enum {string} */
            status: "OPEN" | "IN_ANALYSIS" | "RESOLVED" | "CLOSED" | "ARCHIVED";
            /** @enum {string|null} */
            category?: "PRODUCT_QUALITY" | "DELIVERY" | "SERVICE" | "OTHER" | null;
            category_note?: Record<string, never> | null;
            /** Format: uuid */
            responsible_department_id?: Record<string, never> | null;
            /** Format: uuid */
            owner_user_id?: Record<string, never> | null;
            resolution_summary?: Record<string, never> | null;
            closure_note?: Record<string, never> | null;
            external_source_system?: string | null;
            external_record_key?: string | null;
            /** Format: date-time */
            source_observed_at?: string | null;
            ingestion_status?: string | null;
            /** Format: uuid */
            problem_index_id?: string | null;
            version: number;
            /** Format: date-time */
            archived_at?: string | null;
            /** Format: date-time */
            created_at: string;
            currentDisposition?: components["schemas"]["CustomerPhysicalDispositionDto"] | null;
            currentAnalysis?: components["schemas"]["CustomerPhysicalAnalysisDto"] | null;
        };
        CreateComplaintDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            customerId: string;
            /** @enum {string} */
            complaintType: "ZERO_KM" | "AFTER_SALES";
            defectDescription: string;
            terminalCustomerName?: string;
            productCode?: string;
            productModel?: string;
            vin?: string;
            mileage?: number;
            /** Format: date-time */
            purchaseDate?: string;
            returnRequired?: boolean;
            physicalAnalysisRequired?: boolean;
            severity: string;
            severityPolicyVersion: string;
            severitySnapshot: Record<string, never>;
            /** @enum {string} */
            externalSourceSystem?: "ERP" | "SAP" | "IMS";
            externalRecordKey?: string;
            /** Format: date-time */
            sourceObservedAt?: string;
        };
        UpdateComplaintDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            defectDescription?: string;
            severity?: string;
            severityPolicyVersion?: string;
            severitySnapshot?: Record<string, never>;
        };
        ArchiveComplaintDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
        };
        CustomerComplaintEventDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            complaint_id: string;
            seq: number;
            /** @enum {string} */
            event_type: "TRIAGED" | "REASSIGNED" | "PROGRESS_RECORDED" | "RESOLVED" | "CLOSED" | "REOPENED" | "ARCHIVED";
            from_status: string;
            to_status: string;
            note: string;
            /** Format: uuid */
            evidence_file_object_id: string | null;
            /** Format: uuid */
            actor_user_id: string;
            /** Format: date-time */
            created_at: string;
        };
        CustomerComplaintEightDDto: {
            what: string;
            why: string;
            where: string;
            when: string;
            who: string;
            how: string;
            howMuch: string;
            containment: string;
            rootCause: string;
            verification: string;
            preventiveAction: string;
            horizontalDeployment: string;
            lessonsLearned: string;
            verificationEvidenceFileIds: string[];
            archiveChecklist: string[];
            /** Format: uuid */
            complaintId: string;
            version: number;
            /** @enum {string} */
            status: "DRAFT" | "SUBMITTED" | "APPROVED";
            /** @enum {string|null} */
            approvalLevel?: "L1" | "L2" | "L3" | null;
            /** Format: date-time */
            submittedAt?: Record<string, never> | null;
            /** Format: date-time */
            approvedAt?: Record<string, never> | null;
        };
        CustomerComplaintEightDContentDto: {
            what: string;
            why: string;
            where: string;
            when: string;
            who: string;
            how: string;
            howMuch: string;
            containment: string;
            rootCause: string;
            verification: string;
            preventiveAction: string;
            horizontalDeployment: string;
            lessonsLearned: string;
            verificationEvidenceFileIds: string[];
            archiveChecklist: string[];
        };
        SaveCustomerComplaintEightDDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            content: components["schemas"]["CustomerComplaintEightDContentDto"];
        };
        SubmitCustomerComplaintEightDDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            content: components["schemas"]["CustomerComplaintEightDContentDto"];
        };
        ApproveCustomerComplaintEightDDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            note: string;
        };
        TriageCustomerComplaintDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            /** @enum {string} */
            category: "PRODUCT_QUALITY" | "DELIVERY" | "SERVICE" | "OTHER";
            categoryNote?: string;
            /** Format: uuid */
            responsibleDepartmentId: string;
            /** Format: uuid */
            ownerUserId: string;
            note: string;
        };
        ProgressCustomerComplaintDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            note: string;
            /** Format: uuid */
            evidenceFileObjectId?: string;
        };
        ResolveCustomerComplaintDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            resolutionSummary: string;
        };
        NoteCustomerComplaintDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            note: string;
        };
        PhysicalDispositionDto: {
            /** Format: uuid */
            organizationId?: string;
            /** @enum {string} */
            action: "RETURN" | "REPAIR" | "SCRAP" | "NO_RETURN" | "OTHER";
            /** @enum {string} */
            status: "PENDING" | "RECEIVED" | "REPAIRED" | "SCRAPPED" | "CLOSED";
            responsibility?: string;
            notes?: string;
        };
        PhysicalAnalysisDto: {
            /** Format: uuid */
            organizationId?: string;
            summary: string;
            /** @enum {string} */
            status: "MISSING" | "IN_PROGRESS" | "COMPLETED";
            evidenceSummary?: string;
        };
        CustomerIssueSourceDto: {
            /** Format: uuid */
            complaintId: string;
            expectedVersion: number;
        };
        CustomerIssueWorkflowBindingDto: {
            /** Format: uuid */
            workflowDefinitionId: string;
            /** Format: uuid */
            workflowVersionId: string;
            instanceKey: string;
        };
        IssueCustomerComplaintsDto: {
            /** Format: uuid */
            organizationId?: string;
            sources: components["schemas"]["CustomerIssueSourceDto"][];
            problemType: string;
            /** @enum {string} */
            responseForm: "BRIEF" | "EIGHT_D";
            responsibleScope: string;
            /** Format: uuid */
            ownerId?: string;
            /** Format: date-time */
            dueAt?: string;
            workflowBinding: components["schemas"]["CustomerIssueWorkflowBindingDto"];
        };
        CustomerIssueProblemDto: {
            /** Format: uuid */
            id: string;
            reportNumber: string;
            /** Format: uuid */
            workflowInstanceId: string;
            version: number;
        };
        CustomerIssueResultDto: {
            problem: components["schemas"]["CustomerIssueProblemDto"];
            replayed: boolean;
        };
        ChangeCustomerIssueSourcesDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedProblemVersion: number;
            add: components["schemas"]["CustomerIssueSourceDto"][];
            remove: string[];
            /** Format: uuid */
            primaryComplaintId?: string;
        };
        CustomerIssueLinkHistoryDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            problemIndexId: string;
            /** Format: uuid */
            sourceId: string;
            /** @enum {string} */
            action: "LINKED" | "UNLINKED" | "PRIMARY_SELECTED";
            sourceVersion: number;
            sourceSnapshot: Record<string, never>;
            /** Format: uuid */
            actorUserId?: string | null;
            /** Format: date-time */
            changedAt: string;
        };
        MaterialMasterDto: {
            /** Format: uuid */
            id: string;
            materialCode: string;
            materialName: string;
            version: number;
        };
        CreateMaterialMasterDto: {
            /** Format: uuid */
            organizationId?: string;
            materialCode: string;
            materialName: string;
        };
        UpdateMaterialMasterDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            materialName: string;
        };
        MaterialMasterImportRowDto: {
            rowNumber: number;
            materialCode: string;
            materialName: string;
        };
        MaterialMasterImportDto: {
            /** Format: uuid */
            organizationId?: string;
            rows: components["schemas"]["MaterialMasterImportRowDto"][];
        };
        MaterialMasterImportItemDto: {
            rowNumber: number;
            code: string;
            /** @enum {string} */
            status: "CREATED" | "SKIPPED_DUPLICATE" | "FAILED";
            errorCode?: string;
        };
        MaterialMasterImportResultDto: {
            items: components["schemas"]["MaterialMasterImportItemDto"][];
            created: number;
            skipped: number;
            failed: number;
        };
        AuditPlanResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organization_id: string;
            year: number;
            title: string;
            /** @enum {string} */
            audit_type: "SYSTEM" | "PROCESS" | "PRODUCT" | "SECOND_PARTY" | "CUSTOMER";
            /** Format: date-time */
            planned_start: string;
            /** Format: date-time */
            planned_end: string;
            /** @enum {string} */
            status: "PLANNED" | "APPROVED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
            version: number;
        };
        CreateAuditPlanDto: {
            /** Format: uuid */
            organizationId?: string;
            year: number;
            title: string;
            /** @enum {string} */
            auditType: "SYSTEM" | "PROCESS" | "PRODUCT" | "SECOND_PARTY" | "CUSTOMER";
            /** Format: date-time */
            plannedStart: string;
            /** Format: date-time */
            plannedEnd: string;
        };
        UpdateAuditPlanDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            title?: string;
            /** Format: date-time */
            plannedStart?: string;
            /** Format: date-time */
            plannedEnd?: string;
            /** @enum {string} */
            status?: "PLANNED" | "APPROVED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
        };
        PostponementDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            /** Format: date-time */
            proposedStart: string;
            /** Format: date-time */
            proposedEnd: string;
            reason: string;
        };
        AuditPostponementResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            plan_id: string;
            /** @enum {string} */
            status: "PENDING" | "APPROVED" | "REJECTED";
            plan_version: number;
            version: number;
            /** Format: date-time */
            proposed_start: string;
            /** Format: date-time */
            proposed_end: string;
        };
        DecisionDto: {
            /** Format: uuid */
            organizationId?: string;
            approve: boolean;
            expectedVersion: number;
        };
        CreateAuditTemplateDto: {
            /** Format: uuid */
            organizationId?: string;
            name: string;
            /** @enum {string} */
            auditType: "SYSTEM" | "PROCESS" | "PRODUCT" | "SECOND_PARTY" | "CUSTOMER";
            definition: Record<string, never>;
        };
        AuditTemplateResponseDto: {
            /** Format: uuid */
            id: string;
            name: string;
            /** @enum {string} */
            status: "DRAFT" | "PUBLISHED";
            version: number;
            draft_definition: Record<string, never>;
        };
        UpdateAuditTemplateDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            definition: Record<string, never>;
        };
        PublishAuditTemplateDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
        };
        PublishedAuditTemplateResponseDto: {
            /** Format: uuid */
            id: string;
            name: string;
            /** @enum {string} */
            status: "DRAFT" | "PUBLISHED";
            version: number;
            draft_definition: Record<string, never>;
            /** Format: uuid */
            versionId: string;
            publishedVersion: number;
        };
        CreateAuditExecutionDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            planId: string;
            /** Format: uuid */
            templateVersionId: string;
        };
        AuditExecutionResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            plan_id: string;
            /** Format: uuid */
            template_version_id: string;
            /** @enum {string} */
            status: "OPEN" | "SUBMITTED" | "COMPLETED" | "CANCELLED";
            version: number;
        };
        AuditExecutionItemDto: {
            key: string;
            text: string;
        };
        AuditChecklistResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            execution_id: string;
            item_key: string;
            /** @enum {string} */
            result: "OK" | "NG" | "NA";
            note?: string | null;
            version: number;
        };
        AuditExecutionSnapshotDto: {
            execution: components["schemas"]["AuditExecutionResponseDto"];
            items: components["schemas"]["AuditExecutionItemDto"][];
            checklist: components["schemas"]["AuditChecklistResponseDto"][];
        };
        AuditNcResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            execution_id: string;
            /** Format: uuid */
            checklist_result_id: string;
            /** @enum {string} */
            severity: "MINOR" | "MAJOR" | "CRITICAL";
            /** @enum {string} */
            status: "OPEN" | "ASSIGNED" | "RESPONDED" | "VERIFIED" | "REJECTED" | "CLOSED";
            /** Format: date-time */
            due_at: string;
            due_policy_version?: Record<string, never> | null;
            calendar_version?: Record<string, never> | null;
            due_business_days?: Record<string, never> | null;
            /** Format: uuid */
            assignee_user_id?: string | null;
            response?: string | null;
            verification_note?: string | null;
            /** Format: uuid */
            verified_by_id?: string | null;
            /** Format: uuid */
            closed_by_id?: string | null;
            /** Format: uuid */
            problem_index_id?: string | null;
            version: number;
        };
        AuditExecutionReportDto: {
            execution: components["schemas"]["AuditExecutionResponseDto"];
            checklist: components["schemas"]["AuditChecklistResponseDto"][];
            summary: Record<string, never>;
        };
        AuditPlanReportDto: {
            plan: components["schemas"]["AuditPlanResponseDto"];
            executions: components["schemas"]["AuditExecutionResponseDto"][];
            overdueNcCount: number;
        };
        ChecklistResultDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion?: number;
            itemKey: string;
            /** @enum {string} */
            result: "OK" | "NG" | "NA";
            note?: string;
        };
        SubmitAuditExecutionDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
        };
        RegisterAuditDeadlinePolicyDto: {
            /** Format: uuid */
            organizationId?: string;
            policyVersion: string;
            calendarVersion: string;
            timeZone: string;
            workingWeekdays: number[];
            exceptions: Record<string, never>;
            severityDays: Record<string, never>;
        };
        AuditDeadlinePolicyResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organization_id: string;
            policy_version: string;
            calendar_version: string;
            time_zone: string;
            working_weekdays: number[];
            exceptions: Record<string, never>;
            severity_days: Record<string, never>;
            /** Format: date-time */
            created_at: string;
        };
        AuditWorkflowBindingDto: {
            /** Format: uuid */
            workflowDefinitionId: string;
            /** Format: uuid */
            workflowVersionId: string;
            instanceKey: string;
        };
        CreateNcDto: {
            /** Format: uuid */
            organizationId?: string;
            /** @enum {string} */
            severity: "MINOR" | "MAJOR" | "CRITICAL";
            /**
             * Format: date-time
             * @description 可选；如提供，必须等于服务端按登记日历计算的期限
             */
            dueAt?: string;
            /** @description 整改期限政策版本 */
            duePolicyVersion: string;
            /** @description 工作日历版本 */
            calendarVersion: string;
            dueBusinessDays: number;
            workflowBinding: components["schemas"]["AuditWorkflowBindingDto"];
        };
        AssignNcDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            assigneeUserId: string;
            expectedVersion: number;
        };
        RespondNcDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            response: string;
        };
        VerifyNcDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            accepted: boolean;
            verificationNote: string;
        };
        CloseNcDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
        };
        ImportAuditRowDto: {
            /** Format: uuid */
            organizationId?: string;
            /** @enum {string} */
            sourceSystem: "CUSTOMER" | "SECOND_PARTY";
            externalKey: string;
            payload: Record<string, never>;
        };
        AuditImportRowResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organization_id: string;
            /** @enum {string} */
            source_system: "CUSTOMER" | "SECOND_PARTY";
            external_key: string;
            payload: Record<string, never>;
            /** @enum {string} */
            status: "PENDING_REVIEW" | "ACCEPTED" | "REJECTED" | "ISSUED";
            version: number;
            review_note?: Record<string, never> | null;
            /** Format: uuid */
            problem_index_id?: Record<string, never> | null;
            /** Format: date-time */
            created_at: string;
        };
        AuditImportRowPageDto: {
            items: components["schemas"]["AuditImportRowResponseDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        ReviewAuditImportRowDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            /** @enum {string} */
            decision: "ACCEPTED" | "REJECTED";
            note?: string;
        };
        IssueAuditImportRowDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            problemType: string;
            /** @enum {string} */
            responseForm: "BRIEF" | "EIGHT_D";
            responsibleScope: string;
            severity: string;
            /** Format: uuid */
            ownerId?: string;
            /** Format: date-time */
            dueAt?: string;
            workflowBinding: components["schemas"]["AuditWorkflowBindingDto"];
        };
        AuditImportIssueProblemDto: {
            /** Format: uuid */
            id: string;
            reportNumber: string;
            /** Format: uuid */
            workflowInstanceId: string;
            version: number;
        };
        AuditImportIssueSourceDto: {
            /** Format: uuid */
            organizationId: string;
            /** Format: uuid */
            createdBy: string;
            sourceVersion: number;
            sourceSnapshot: Record<string, never>;
            /** Format: date-time */
            archivedAt?: string | null;
        };
        AuditImportIssueResultDto: {
            problem: components["schemas"]["AuditImportIssueProblemDto"];
            source: components["schemas"]["AuditImportIssueSourceDto"];
            sources: components["schemas"]["AuditImportIssueSourceDto"][];
            replayed: boolean;
        };
        CreateNewProductProjectDto: {
            /** Format: uuid */
            organizationId?: string;
            code: string;
            name: string;
            productCode: string;
        };
        NewProductProjectDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organization_id: string;
            code: string;
            name: string;
            product_code: string;
            /** @enum {string} */
            status: "ACTIVE" | "ARCHIVED";
            version: number;
        };
        NewProductStageDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            project_id: string;
            code: string;
            name: string;
            /** @enum {string} */
            status: "OPEN" | "PASSED" | "REJECTED";
            version: number;
        };
        NewProductLessonCheckDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            project_id: string;
            /** Format: uuid */
            lesson_id: string;
            avoided?: boolean | null;
            reason?: string | null;
            /** Format: uuid */
            evidence_object_id?: string | null;
            version: number;
        };
        NewProductTrialBatchDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            project_id: string;
            code: string;
            work_order_code?: string | null;
            version: number;
        };
        NewProductHandoverDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            project_id: string;
            project_version: number;
            risk_statement: string;
            /** Format: uuid */
            mass_production_approval_id?: string | null;
            stage_snapshot: Record<string, never>[];
            trial_snapshot: Record<string, never>[];
            open_issue_count: number;
            /** Format: uuid */
            handed_over_by_id: string;
            /** Format: date-time */
            handed_over_at: string;
        };
        NewProductEarlyFlowReleaseDto: {
            /** @enum {string} */
            decision: "APPROVE" | "REJECT";
            note?: string | null;
            /** Format: uuid */
            evidenceObjectId: string;
            /** Format: uuid */
            decidedById: string;
            /** Format: date-time */
            decidedAt: string;
            flowVersion: number;
        };
        NewProductEarlyFlowDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            /** Format: uuid */
            projectId: string;
            monitoringWindowDays: number;
            monitoringFrequency: string;
            plan: string;
            exitCriteria: string;
            /** @enum {string} */
            status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
            approvalNote?: string | null;
            releaseDecision?: components["schemas"]["NewProductEarlyFlowReleaseDto"] | null;
            version: number;
            /** Format: uuid */
            submittedById?: Record<string, never> | null;
            /** Format: date-time */
            submittedAt?: string | null;
            /** Format: uuid */
            approvedById?: Record<string, never> | null;
            /** Format: date-time */
            approvedAt?: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        NewProductProjectDetailDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organization_id: string;
            code: string;
            name: string;
            product_code: string;
            /** @enum {string} */
            status: "ACTIVE" | "ARCHIVED";
            version: number;
            stages: components["schemas"]["NewProductStageDto"][];
            lessons: components["schemas"]["NewProductLessonCheckDto"][];
            batches: components["schemas"]["NewProductTrialBatchDto"][];
            selected_defects: Record<string, never>[];
            handover?: components["schemas"]["NewProductHandoverDto"] | null;
            early_flow?: components["schemas"]["NewProductEarlyFlowDto"] | null;
            issues?: Record<string, never>;
        };
        CreateNewProductStageDto: {
            /** Format: uuid */
            organizationId?: string;
            code: string;
            name: string;
        };
        CreateNewProductDeliverableDto: {
            /** Format: uuid */
            organizationId?: string;
            code: string;
            name: string;
            required: boolean;
        };
        NewProductDeliverableDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            stage_id: string;
            code: string;
            name: string;
            required: boolean;
            /** Format: uuid */
            evidence_object_id?: string | null;
            version: number;
        };
        SubmitNewProductDeliverableDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            /** Format: uuid */
            evidenceObjectId: string;
        };
        CreateNewProductLessonDto: {
            /** Format: uuid */
            organizationId?: string;
            title: string;
            lesson: string;
            productCode?: string;
        };
        NewProductLessonDto: {
            /** Format: uuid */
            id: string;
            title: string;
            lesson: string;
            product_code?: string | null;
            /** @enum {string} */
            source_kind: "MANUAL";
        };
        NewProductScopeDto: {
            /** Format: uuid */
            organizationId?: string;
        };
        ConfirmNewProductLessonDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            /** Format: uuid */
            evidenceObjectId: string;
            avoided: boolean;
            reason?: string;
        };
        ReviewNewProductStageDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            /** @enum {string} */
            decision: "PASS" | "REJECT";
        };
        CreateNewProductTrialBatchDto: {
            /** Format: uuid */
            organizationId?: string;
            code: string;
            workOrderCode?: string;
        };
        RecordNewProductMetricDto: {
            /** Format: uuid */
            organizationId?: string;
            /** @enum {string} */
            code: "INPUT" | "OUTPUT" | "FIRST_PASS" | "DEFECT" | "CPK" | "DIMENSION_PASS_RATE";
            target: number;
            actual: number;
            /** @enum {string} */
            comparison: "GTE" | "LTE";
            /** @enum {string} */
            source: "MANUAL";
        };
        NewProductTrialMetricDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            batch_id: string;
            /** @enum {string} */
            code: "INPUT" | "OUTPUT" | "FIRST_PASS" | "DEFECT" | "CPK" | "DIMENSION_PASS_RATE";
            target: number;
            actual: number;
            /** @enum {string} */
            comparison: "GTE" | "LTE";
            /** @enum {string} */
            source: "MANUAL";
            /** @enum {string} */
            signal?: "GREEN" | "RED";
        };
        NewProductTrialReportDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            project_id: string;
            code: string;
            work_order_code?: string | null;
            version: number;
            metrics: components["schemas"]["NewProductTrialMetricDto"][];
        };
        CreateNewProductTrialSummaryDto: {
            /** Format: uuid */
            organizationId?: string;
            conclusion: string;
        };
        NewProductTrialSummaryDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            batchId: string;
            /** Format: uuid */
            projectId: string;
            conclusion: string;
            /** @enum {string} */
            status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
            metricSnapshot: Record<string, never>[];
            issueSnapshot: Record<string, never>[];
            sourceSha256?: string | null;
            version: number;
            /** Format: uuid */
            createdById: string;
            /** Format: uuid */
            submittedById?: string | null;
            /** Format: date-time */
            submittedAt?: string | null;
            /** Format: uuid */
            approvedById?: string | null;
            /** Format: date-time */
            approvedAt?: string | null;
            approvalNote?: string | null;
        };
        NewProductTrialSummaryRevisionDto: {
            revision: number;
            conclusion: string;
            metricSnapshot: Record<string, never>[];
            issueSnapshot: Record<string, never>[];
            sourceSha256: string;
            /** Format: uuid */
            submittedById: string;
            /** Format: date-time */
            submittedAt: string;
            /** @enum {string|null} */
            decision?: "APPROVE" | "REJECT" | null;
            /** Format: uuid */
            decidedById?: string | null;
            /** Format: date-time */
            decidedAt?: string | null;
            decisionNote?: string | null;
        };
        ReviseNewProductTrialSummaryDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            conclusion: string;
        };
        SubmitNewProductTrialSummaryDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
        };
        DecideNewProductTrialSummaryDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            /** @enum {string} */
            decision: "APPROVE" | "REJECT";
            note?: string;
        };
        CreateNewProductEarlyFlowDto: {
            /** Format: uuid */
            organizationId?: string;
            monitoringWindowDays: number;
            monitoringFrequency: string;
            plan: string;
            exitCriteria: string;
        };
        ReviseNewProductEarlyFlowDto: {
            /** Format: uuid */
            organizationId?: string;
            monitoringWindowDays: number;
            monitoringFrequency: string;
            plan: string;
            exitCriteria: string;
            expectedVersion: number;
        };
        SubmitNewProductEarlyFlowDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
        };
        ApproveNewProductEarlyFlowDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            /** @enum {string} */
            decision: "APPROVE" | "REJECT";
            note?: string;
        };
        DecideNewProductEarlyFlowReleaseDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            /** @enum {string} */
            decision: "APPROVE" | "REJECT";
            /** Format: uuid */
            evidenceObjectId: string;
            note?: string;
        };
        SelectNewProductDefectDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            defectId: string;
            expectedVersion: number;
            reason?: string;
        };
        NewProductWorkflowBindingDto: {
            /** Format: uuid */
            workflowDefinitionId: string;
            /** Format: uuid */
            workflowVersionId: string;
            instanceKey: string;
        };
        IssueNewProductDefectsDto: {
            /** Format: uuid */
            organizationId?: string;
            selectionIds: string[];
            /** Format: uuid */
            trialBatchId?: string;
            severity: string;
            /** @enum {string} */
            complexity: "SIMPLE" | "COMPLEX";
            workflowBinding: components["schemas"]["NewProductWorkflowBindingDto"];
        };
        EscalateNewProductIssueDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
        };
        NewProductIssueDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            project_id: string;
            /** Format: uuid */
            trial_batch_id?: string | null;
            /** @enum {string} */
            response_form: "BRIEF" | "EIGHT_D";
            /** @enum {string} */
            complexity: "SIMPLE" | "COMPLEX";
            severity: string;
            /** @enum {string} */
            status: "OPEN" | "ESCALATED" | "IN_PROGRESS" | "VERIFIED" | "CLOSED";
            version: number;
            /** Format: uuid */
            owner_user_id?: string | null;
            owner_username?: string | null;
            measure_plan?: string | null;
            /** Format: date-time */
            measure_due_at?: string | null;
            verification_summary?: string | null;
            /** Format: uuid */
            verification_evidence_object_id?: string | null;
            /** Format: uuid */
            verified_by_id?: string | null;
            /** Format: date-time */
            verified_at?: string | null;
            /** Format: date-time */
            closed_at?: string | null;
            closure_note?: string | null;
        };
        NewProductIssueStatsDto: {
            total: number;
            open: number;
            escalated: number;
            in_progress: number;
            verified: number;
            closed: number;
        };
        NewProductIssueListDto: {
            items: components["schemas"]["NewProductIssueDto"][];
            stats: components["schemas"]["NewProductIssueStatsDto"];
        };
        AssignNewProductIssueDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            /** Format: uuid */
            assigneeUserId: string;
        };
        RecordNewProductMeasureDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            measurePlan: string;
            /** Format: date-time */
            measureDueAt?: string;
        };
        VerifyNewProductIssueDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            verificationSummary: string;
            /** Format: uuid */
            evidenceObjectId?: string;
        };
        CloseNewProductIssueDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            closureNote: string;
        };
        CreateNewProductLegacyIssueDto: {
            /** Format: uuid */
            organizationId?: string;
            description: string;
            /** @enum {string} */
            riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
        };
        ApproveNewProductMassProductionDto: {
            /** Format: uuid */
            organizationId?: string;
            /** @enum {string} */
            decision: "APPROVE" | "REJECT";
            riskStatement: string;
            /** Format: uuid */
            evidenceObjectId: string;
        };
        HandoverNewProductProjectDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            riskStatement: string;
        };
        MetricDefinitionDto: {
            /** Format: uuid */
            organizationId?: string;
            /** @enum {string} */
            domain?: "SUPPLIER" | "PROCESS" | "CUSTOMER" | "NEW_PRODUCT";
            code: string;
            name: string;
            unit: string;
            numeratorLabel: string;
            denominatorLabel: string;
            formulaVersion: string;
            /** @description 标准公式编码，如 INCOMING_ACCEPTANCE_RATE、PPM、PROCESS_DEFECT_RATE、FIRST_PASS_YIELD */
            formulaCode?: string;
            /** @enum {string} */
            thresholdDirection?: "GTE" | "LTE";
            greenThreshold?: number;
            yellowThreshold?: number;
            /** @default 1 */
            abnormalPeriodLimit: number;
            /** Format: uuid */
            id: string;
            active: boolean;
            version: number;
            resolvedFormulaCode: string;
            /** @enum {string} */
            resolvedThresholdDirection: "GTE" | "LTE";
            resolvedGreenThreshold: number | null;
            resolvedYellowThreshold: number | null;
            resolvedAbnormalPeriodLimit: number;
        };
        CreateMetricDefinitionDto: {
            /** Format: uuid */
            organizationId?: string;
            /** @enum {string} */
            domain?: "SUPPLIER" | "PROCESS" | "CUSTOMER" | "NEW_PRODUCT";
            code: string;
            name: string;
            unit: string;
            numeratorLabel: string;
            denominatorLabel: string;
            formulaVersion: string;
            /** @description 标准公式编码，如 INCOMING_ACCEPTANCE_RATE、PPM、PROCESS_DEFECT_RATE、FIRST_PASS_YIELD */
            formulaCode?: string;
            /** @enum {string} */
            thresholdDirection?: "GTE" | "LTE";
            greenThreshold?: number;
            yellowThreshold?: number;
            /** @default 1 */
            abnormalPeriodLimit: number;
        };
        RecordMetricFactDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            metricDefinitionId: string;
            /** Format: date-time */
            periodStart: string;
            /** Format: date-time */
            periodEnd: string;
            numerator: number;
            denominator: number;
            /**
             * @default MANUAL
             * @enum {string}
             */
            sourceSystem: "MANUAL" | "INTERNAL" | "IMS" | "MES" | "ERP" | "SAP";
            sourceRecordKey?: string;
            /** Format: uuid */
            sourceSnapshotId?: string;
            dimensions?: Record<string, never>;
        };
        MetricFactDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            metricDefinitionId: string;
            /** Format: date-time */
            periodStart: string;
            /** Format: date-time */
            periodEnd: string;
            numerator: number;
            denominator: number;
            value: number;
            sourceSystem: string;
            sourceRecordKey?: Record<string, never> | null;
        };
        CreateQualitySnapshotDto: {
            /** Format: uuid */
            organizationId?: string;
            /** @enum {string} */
            sourceSystem: "IMS" | "MES" | "ERP" | "SAP";
            externalRecordKey: string;
            /** Format: date-time */
            observedAt: string;
            payload: Record<string, never>;
        };
        QualitySnapshotDto: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            sourceSystem: "MANUAL" | "INTERNAL" | "IMS" | "MES" | "ERP" | "SAP";
            externalRecordKey: string;
            /** Format: date-time */
            observedAt: string;
            status: string;
            /** Format: uuid */
            problemIndexId?: Record<string, never> | null;
            problemVersion?: Record<string, never> | null;
        };
        CreateInternalQualitySnapshotDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            metricDefinitionId: string;
            expectedMetricVersion: number;
            /** Format: uuid */
            problemIndexId: string;
            expectedProblemVersion: number;
            /** Format: date-time */
            observedAt: string;
        };
        QualitySnapshotDetailDto: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            sourceSystem: "MANUAL" | "INTERNAL" | "IMS" | "MES" | "ERP" | "SAP";
            externalRecordKey: string;
            /** Format: date-time */
            observedAt: string;
            status: string;
            /** Format: uuid */
            problemIndexId?: Record<string, never> | null;
            problemVersion?: Record<string, never> | null;
            payload: Record<string, never>;
        };
        QualityInternalSourceDto: {
            /** @enum {string} */
            type: "PROBLEM_INDEX";
            /** Format: uuid */
            id: string;
            version: number;
            domainCode: string;
            domainSourceType: string;
            /** Format: uuid */
            domainSourceId: string;
        };
        QualityFactDrilldownDto: {
            fact: components["schemas"]["MetricFactDto"];
            snapshot: components["schemas"]["QualitySnapshotDto"] | null;
            source: components["schemas"]["QualityInternalSourceDto"] | null;
            reason: string | null;
        };
        QualityDashboardDomainSummaryDto: {
            /** @enum {string} */
            domain: "SUPPLIER" | "PROCESS" | "CUSTOMER" | "NEW_PRODUCT" | "UNSPECIFIED";
            label: string;
            factCount: number;
            metricCount: number;
        };
        QualityDashboardCardDto: {
            /** @enum {string} */
            domain: "SUPPLIER" | "PROCESS" | "CUSTOMER" | "NEW_PRODUCT" | "UNSPECIFIED";
            metricCode: string;
            metricName: string;
            unit: string;
            /** @enum {string} */
            status: "AVAILABLE" | "MANUAL" | "PENDING_REVIEW" | "NO_DATA";
            latestValue: number | null;
            numerator: number | null;
            denominator: number | null;
            sourceSystem: Record<string, never> | null;
            sourceRecordKey: Record<string, never> | null;
            /** Format: date-time */
            periodStart: Record<string, never> | null;
            /** Format: date-time */
            periodEnd: Record<string, never> | null;
            /** @enum {string} */
            signal: "GREEN" | "YELLOW" | "RED" | "NO_DATA";
            abnormalPeriods: number;
            consecutiveRedPeriods: number;
            alert: boolean;
        };
        QualityDashboardDto: {
            metrics: components["schemas"]["MetricDefinitionDto"][];
            latestFacts: components["schemas"]["MetricFactDto"][];
            generatedAt: string;
            /** Format: date-time */
            from?: Record<string, never> | null;
            /** Format: date-time */
            to?: Record<string, never> | null;
            domains: components["schemas"]["QualityDashboardDomainSummaryDto"][];
            cards: components["schemas"]["QualityDashboardCardDto"][];
        };
        QualityInsightDto: {
            /** Format: uuid */
            metricDefinitionId: string;
            metricCode: string;
            metricName: string;
            /** @enum {string} */
            signal: "STABLE" | "RISING" | "FALLING" | "INSUFFICIENT_DATA";
            summary: string;
            evidence: string[];
            /** @enum {string} */
            generatedBy: "RULE_BASED";
        };
        IncomingInspectionItemDto: {
            order: number;
            name: string;
            measuredValue?: string;
            /** @enum {string} */
            result: "PASS" | "NG" | "NA";
            /** Format: uuid */
            id: string;
        };
        IncomingInspectionPhotoDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            file_id: string;
            purpose: string;
            note: string | null;
            /** Format: date-time */
            created_at: string;
        };
        IncomingInspectionProblemLinkDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            problem_id: string;
            /** @enum {string} */
            conclusion_snapshot: "PASS" | "NG";
            /** Format: date-time */
            created_at: string;
        };
        IncomingInspectionDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            /** Format: uuid */
            profileId: string;
            /** Format: uuid */
            supplierOrganizationId: string | null;
            supplierBusinessCode: string;
            supplierName: string;
            materialCode: string;
            incomingBatch: string;
            receivedQuantity: number;
            sampledQuantity: number;
            /** @enum {string} */
            conclusion: "PENDING" | "PASS" | "NG";
            /** @enum {string} */
            status: "DRAFT" | "COMPLETED" | "CORRECTED";
            /** Format: uuid */
            inspectorId: string;
            /** Format: date-time */
            inspectedAt: string | null;
            /** @enum {string} */
            sourceSystem: "MANUAL" | "MES";
            externalRecordKey: string | null;
            externalBatchKey: string | null;
            /** Format: date-time */
            observedAt: string | null;
            sourceSnapshot: {
                [key: string]: unknown;
            };
            correctionReason: string | null;
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            items?: components["schemas"]["IncomingInspectionItemDto"][];
            photos?: components["schemas"]["IncomingInspectionPhotoDto"][];
            problemLinks?: components["schemas"]["IncomingInspectionProblemLinkDto"][];
        };
        IncomingInspectionPageDto: {
            items: components["schemas"]["IncomingInspectionDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        IncomingItemDto: {
            order: number;
            name: string;
            measuredValue?: string;
            /** @enum {string} */
            result: "PASS" | "NG" | "NA";
        };
        CreateIncomingInspectionDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            profileId: string;
            materialCode: string;
            incomingBatch: string;
            receivedQuantity: number;
            sampledQuantity: number;
            /**
             * @default MANUAL
             * @enum {string}
             */
            sourceSystem: "MANUAL" | "MES";
            externalRecordKey?: string;
            externalBatchKey?: string;
            /** Format: date-time */
            observedAt?: string;
            items?: components["schemas"]["IncomingItemDto"][];
        };
        CompleteIncomingInspectionDto: {
            expectedVersion: number;
            /** @enum {string} */
            conclusion: "PASS" | "NG";
        };
        CorrectIncomingInspectionDto: {
            expectedVersion: number;
            /** @enum {string} */
            conclusion: "PASS" | "NG";
            reason: string;
        };
        LinkIncomingProblemDto: {
            expectedVersion: number;
            title: string;
            defectDescription: string;
            defectQuantity: number;
            /** @enum {string} */
            severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
            /** @enum {string} */
            responseForm: "BRIEF" | "EIGHT_D";
            /** @enum {string} */
            replyMode: "SUPPLIER" | "INTERNAL";
            /** Format: uuid */
            internalResponderId?: string;
        };
        AttachIncomingPhotoDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            fileId: string;
            expectedVersion: number;
        };
        CoordinateInspectionRequestDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            requestNumber: string;
            partNumber: string;
            partName: string;
            drawingRevision?: string | null;
            batchNumber?: string | null;
            sampleQuantity: number;
            purpose: string;
            priority: string;
            /** Format: date-time */
            requestedDueAt?: string | null;
            status: string;
            approvalNote?: string | null;
            /** Format: uuid */
            approvedById?: string | null;
            /** Format: date-time */
            approvedAt?: string | null;
            /** Format: date-time */
            scheduledAt?: string | null;
            /** Format: uuid */
            scheduledById?: string | null;
            /** Format: uuid */
            assignedToId?: string | null;
            progressPercent: number;
            progressNote?: string | null;
            version: number;
            /** Format: uuid */
            createdById: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        CoordinateInspectionPageDto: {
            items: components["schemas"]["CoordinateInspectionRequestDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        CreateCoordinateInspectionDto: {
            /** Format: uuid */
            organizationId?: string;
            partNumber: string;
            partName: string;
            drawingRevision?: string;
            batchNumber?: string;
            sampleQuantity: number;
            /** @enum {string} */
            purpose: "INCOMING" | "PROCESS" | "CUSTOMER" | "NEW_PRODUCT" | "OTHER";
            /**
             * @default NORMAL
             * @enum {string}
             */
            priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
            /** Format: date-time */
            requestedDueAt?: string;
        };
        UpdateCoordinateInspectionDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            partNumber?: string;
            partName?: string;
            drawingRevision?: string;
            batchNumber?: string;
            sampleQuantity?: number;
            /** @enum {string} */
            purpose?: "INCOMING" | "PROCESS" | "CUSTOMER" | "NEW_PRODUCT" | "OTHER";
            /** @enum {string} */
            priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
            /** Format: date-time */
            requestedDueAt?: string;
        };
        SubmitCoordinateInspectionDto: {
            expectedVersion: number;
        };
        ApproveCoordinateInspectionDto: {
            /** @enum {string} */
            decision: "APPROVE" | "REJECT";
            expectedVersion: number;
            note?: string;
        };
        ScheduleCoordinateInspectionDto: {
            expectedVersion: number;
            /** Format: date-time */
            scheduledAt: string;
            /** Format: uuid */
            assignedToId: string;
        };
        ProgressCoordinateInspectionDto: {
            /** @enum {string} */
            status: "IN_PROGRESS" | "COMPLETED";
            progressPercent: number;
            expectedVersion: number;
            note?: string;
        };
        SupplierPerformanceSourceDto: {
            /** Format: uuid */
            id: string;
            version: number;
            /** @enum {string} */
            conclusion: "PASS" | "NG";
        };
        SupplierPerformanceCardDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            /** Format: uuid */
            profileId: string;
            /** Format: uuid */
            supplierOrganizationId: string | null;
            supplierName: string;
            /** @example 2026-09 */
            month: string;
            inspectionCount: number;
            passCount: number;
            incomingScore: number;
            cooperationScore: number;
            incomingWeight: number;
            cooperationWeight: number;
            cooperationNote: string;
            totalScore: number;
            sourceInspections: components["schemas"]["SupplierPerformanceSourceDto"][];
            /** @enum {string} */
            status: "DRAFT" | "PUBLISHED";
            version: number;
            /** Format: date-time */
            publishedAt?: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        SupplierPerformancePageDto: {
            items: components["schemas"]["SupplierPerformanceCardDto"][];
            total: number;
        };
        CreateSupplierPerformanceCardDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            profileId: string;
            /** @example 2026-09 */
            month: string;
            cooperationScore: number;
            cooperationNote: string;
            incomingWeight: number;
            cooperationWeight: number;
        };
        PublishSupplierPerformanceCardDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
        };
        SupplierPerformanceAppealDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            cardId: string;
            /** Format: uuid */
            supplierOrganizationId: string;
            /** @enum {string} */
            status: "DRAFT" | "SUBMITTED" | "ACCEPTED" | "REJECTED";
            reason: string;
            decisionNote?: string | null;
            version: number;
            /** Format: date-time */
            createdAt: string;
        };
        SupplierPerformanceAppealPageDto: {
            items: components["schemas"]["SupplierPerformanceAppealDto"][];
            total: number;
        };
        CreateSupplierPerformanceAppealDto: {
            /** Format: uuid */
            cardId: string;
            reason: string;
        };
        SupplierPerformanceAppealTransitionDto: {
            expectedVersion: number;
            /** @enum {string} */
            decision?: "ACCEPTED" | "REJECTED";
            note?: string;
        };
        ConcessionRecordDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            /** Format: uuid */
            inspectionId: string;
            inspectionVersion: number;
            /** Format: uuid */
            profileId: string;
            supplierName: string;
            materialCode: string;
            incomingBatch: string;
            receivedQuantity: number;
            quantity: number;
            reason: string;
            /** Format: date-time */
            expiresAt: string;
            /** @enum {string} */
            status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "RELEASED" | "WITHDRAWN";
            version: number;
            /** Format: uuid */
            requestedById: string;
            /** Format: uuid */
            approvedById?: string | null;
            /** Format: date-time */
            approvedAt?: string | null;
            /** Format: date-time */
            releasedAt?: string | null;
            decisionNote?: string | null;
            releaseNote?: string | null;
            /** Format: date-time */
            createdAt: string;
            canSubmit?: boolean;
            canWithdraw?: boolean;
            canApprove?: boolean;
            canRelease?: boolean;
        };
        ConcessionPageDto: {
            items: components["schemas"]["ConcessionRecordDto"][];
            total: number;
            page: number;
            pageSize: number;
            canCreate: boolean;
        };
        ConcessionEventDto: {
            /** @enum {string} */
            eventType: "CREATED" | "SUBMITTED" | "APPROVED" | "REJECTED" | "RELEASED" | "WITHDRAWN";
            requestVersion: number;
            /** Format: uuid */
            actorUserId: string;
            note?: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        ConcessionDetailDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            /** Format: uuid */
            inspectionId: string;
            inspectionVersion: number;
            /** Format: uuid */
            profileId: string;
            supplierName: string;
            materialCode: string;
            incomingBatch: string;
            receivedQuantity: number;
            quantity: number;
            reason: string;
            /** Format: date-time */
            expiresAt: string;
            /** @enum {string} */
            status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "RELEASED" | "WITHDRAWN";
            version: number;
            /** Format: uuid */
            requestedById: string;
            /** Format: uuid */
            approvedById?: string | null;
            /** Format: date-time */
            approvedAt?: string | null;
            /** Format: date-time */
            releasedAt?: string | null;
            decisionNote?: string | null;
            releaseNote?: string | null;
            /** Format: date-time */
            createdAt: string;
            canSubmit?: boolean;
            canWithdraw?: boolean;
            canApprove?: boolean;
            canRelease?: boolean;
            events: components["schemas"]["ConcessionEventDto"][];
        };
        CreateConcessionDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            inspectionId: string;
            quantity: number;
            reason: string;
            /** Format: date-time */
            expiresAt: string;
        };
        ConcessionVersionDto: {
            expectedVersion: number;
        };
        DecideConcessionDto: {
            expectedVersion: number;
            note: string;
        };
        AnnouncementMineItemDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            title: string;
            content: string;
            /** @enum {string} */
            importance: "NORMAL" | "IMPORTANT";
            mustRead: boolean;
            /** @enum {string} */
            audience: "ALL" | "SELECTED";
            /** @enum {string} */
            status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
            recipientCount: number;
            version: number;
            /** Format: date-time */
            publishedAt?: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** Format: date-time */
            readAt?: string | null;
        };
        AnnouncementMinePageDto: {
            items: components["schemas"]["AnnouncementMineItemDto"][];
            unreadMustReadCount: number;
        };
        AnnouncementManageItemDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            title: string;
            content: string;
            /** @enum {string} */
            importance: "NORMAL" | "IMPORTANT";
            mustRead: boolean;
            /** @enum {string} */
            audience: "ALL" | "SELECTED";
            /** @enum {string} */
            status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
            recipientCount: number;
            version: number;
            /** Format: date-time */
            publishedAt?: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            readCount: number;
            recipientUserIds: string[];
        };
        AnnouncementManagePageDto: {
            items: components["schemas"]["AnnouncementManageItemDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        AnnouncementAudienceUserDto: {
            /** Format: uuid */
            id: string;
            username: string;
        };
        AnnouncementAudienceUsersDto: {
            items: components["schemas"]["AnnouncementAudienceUserDto"][];
            total: number;
        };
        AnnouncementReceiptDto: {
            /** Format: uuid */
            userId: string;
            /** Format: date-time */
            readAt?: string | null;
            /** Format: uuid */
            readSessionId?: string | null;
            readTraceId?: string | null;
        };
        AnnouncementInputDto: {
            /** Format: uuid */
            organizationId?: string;
            title: string;
            content: string;
            /** @enum {string} */
            importance: "NORMAL" | "IMPORTANT";
            mustRead: boolean;
            /** @enum {string} */
            audience: "ALL" | "SELECTED";
            recipientUserIds: string[];
        };
        AnnouncementResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            title: string;
            content: string;
            /** @enum {string} */
            importance: "NORMAL" | "IMPORTANT";
            mustRead: boolean;
            /** @enum {string} */
            audience: "ALL" | "SELECTED";
            /** @enum {string} */
            status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
            recipientCount: number;
            version: number;
            /** Format: date-time */
            publishedAt?: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        UpdateAnnouncementDto: {
            /** Format: uuid */
            organizationId?: string;
            title: string;
            content: string;
            /** @enum {string} */
            importance: "NORMAL" | "IMPORTANT";
            mustRead: boolean;
            /** @enum {string} */
            audience: "ALL" | "SELECTED";
            recipientUserIds: string[];
            expectedVersion: number;
        };
        AnnouncementVersionDto: {
            expectedVersion: number;
        };
        AnnouncementReadDto: {
            /** Format: uuid */
            announcementId: string;
            /** Format: uuid */
            userId: string;
            /** Format: date-time */
            readAt: string;
        };
        AuditStandardItemDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            name: string;
            /** @enum {string} */
            auditType: "SYSTEM" | "PROCESS" | "PRODUCT" | "SECOND_PARTY" | "CUSTOMER";
            /** @enum {string} */
            status: "DRAFT" | "PUBLISHED";
            version: number;
            latestVersion: number;
            /** Format: date-time */
            updatedAt: string;
        };
        AuditStandardPageDto: {
            items: components["schemas"]["AuditStandardItemDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        AuditStandardCheckItemDto: {
            key: string;
            text: string;
        };
        AuditStandardDefinitionDto: {
            items: components["schemas"]["AuditStandardCheckItemDto"][];
        };
        AuditStandardVersionDto: {
            /** Format: uuid */
            id: string;
            version: number;
            definition: components["schemas"]["AuditStandardDefinitionDto"];
            /** Format: date-time */
            publishedAt: string;
            /** Format: uuid */
            publishedById: string;
        };
        AuditStandardDetailDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            name: string;
            /** @enum {string} */
            auditType: "SYSTEM" | "PROCESS" | "PRODUCT" | "SECOND_PARTY" | "CUSTOMER";
            /** @enum {string} */
            status: "DRAFT" | "PUBLISHED";
            version: number;
            latestVersion: number;
            draftDefinition: components["schemas"]["AuditStandardDefinitionDto"];
            versions: components["schemas"]["AuditStandardVersionDto"][];
        };
        CreateAuditStandardDto: {
            /** Format: uuid */
            organizationId?: string;
            name: string;
            /** @enum {string} */
            auditType: "SYSTEM" | "PROCESS" | "PRODUCT" | "SECOND_PARTY" | "CUSTOMER";
            definition: components["schemas"]["AuditStandardDefinitionDto"];
        };
        UpdateAuditStandardDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
            definition: components["schemas"]["AuditStandardDefinitionDto"];
        };
        SupplierAdmissionDocumentDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            profileId: string;
            /** Format: uuid */
            ownerOrganizationId: string;
            /** Format: uuid */
            supplierOrganizationId: string;
            /** @enum {string} */
            documentType: "QUALITY_MANUAL" | "CERTIFICATE" | "PROCESS_CONTROL" | "PPAP" | "OTHER";
            title: string;
            /** @enum {string} */
            status: "DRAFT" | "SUBMITTED" | "NEEDS_CHANGES" | "ACCEPTED";
            version: number;
            /** Format: uuid */
            fileId?: Record<string, never> | null;
            reviewNote?: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        SupplierAdmissionPageDto: {
            items: components["schemas"]["SupplierAdmissionDocumentDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        SupplierAdmissionEventDto: {
            eventType: string;
            documentVersion: number;
            /** Format: uuid */
            actorUserId: string;
            /** Format: uuid */
            fileId?: Record<string, never> | null;
            note?: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
        };
        SupplierAdmissionDetailDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            profileId: string;
            /** Format: uuid */
            ownerOrganizationId: string;
            /** Format: uuid */
            supplierOrganizationId: string;
            /** @enum {string} */
            documentType: "QUALITY_MANUAL" | "CERTIFICATE" | "PROCESS_CONTROL" | "PPAP" | "OTHER";
            title: string;
            /** @enum {string} */
            status: "DRAFT" | "SUBMITTED" | "NEEDS_CHANGES" | "ACCEPTED";
            version: number;
            /** Format: uuid */
            fileId?: Record<string, never> | null;
            reviewNote?: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            events: components["schemas"]["SupplierAdmissionEventDto"][];
        };
        ReviewSupplierAdmissionDocumentDto: {
            expectedVersion: number;
            /** @enum {string} */
            decision: "NEEDS_CHANGES" | "ACCEPTED";
            note: string;
        };
        CreateSupplierAdmissionDocumentDto: {
            /** Format: uuid */
            profileId: string;
            /** @enum {string} */
            documentType: "QUALITY_MANUAL" | "CERTIFICATE" | "PROCESS_CONTROL" | "PPAP" | "OTHER";
            title: string;
        };
        SubmitSupplierAdmissionDocumentDto: {
            expectedVersion: number;
            /** Format: uuid */
            fileId: string;
        };
        ESignatureSummaryDto: {
            /** Format: uuid */
            id: string;
            label: string;
            /** @enum {string} */
            status: "ACTIVE" | "REVOKED";
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            revokedAt: string | null;
        };
        ESignatureDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            /** Format: uuid */
            userId: string;
            label: string;
            fingerprint: string;
            /** @enum {string} */
            status: "ACTIVE" | "REVOKED";
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            revokedAt?: string | null;
        };
        ESignaturePageDto: {
            items: components["schemas"]["ESignatureDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        RegisterESignatureDto: {
            /** Format: uuid */
            organizationId?: string;
            label: string;
            /** @description 签名原文或签名图像编码，仅用于即时生成指纹，不会持久化 */
            signatureData: string;
        };
        RevokeESignatureDto: {
            /** Format: uuid */
            organizationId?: string;
            expectedVersion: number;
        };
        ApprovalSignatureDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            organizationId: string;
            /** Format: uuid */
            signatureId: string;
            /** Format: uuid */
            signerUserId: string;
            resourceType: string;
            resourceId: string;
            resourceVersion: number;
            signatureFingerprint: string;
            signedDigest: string;
            note?: string | null;
            /** Format: date-time */
            signedAt: string;
        };
        SignApprovalDto: {
            /** Format: uuid */
            organizationId?: string;
            /** Format: uuid */
            signatureId: string;
            resourceType: string;
            resourceId: string;
            resourceVersion: number;
            note?: string;
        };
        SupplierAuditPlanDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            ownerOrganizationId: string;
            /** Format: uuid */
            supplierOrganizationId: string | null;
            /** Format: uuid */
            profileId: string;
            auditYear: number;
            /** @enum {string} */
            auditType: "ANNUAL" | "SPECIAL";
            title: string;
            /** Format: date-time */
            plannedStart: string;
            /** Format: date-time */
            plannedEnd: string;
            /** @enum {string} */
            status: "PLANNED" | "SUBMITTED" | "CLOSED" | "CANCELLED";
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        SupplierAuditPlanPageDto: {
            items: components["schemas"]["SupplierAuditPlanDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        CreateSupplierAuditPlanDto: {
            /** Format: uuid */
            profileId: string;
            auditYear: number;
            /** @enum {string} */
            auditType: "ANNUAL" | "SPECIAL";
            title: string;
            /** Format: date-time */
            plannedStart: string;
            /** Format: date-time */
            plannedEnd: string;
        };
        SupplierAuditTransitionDto: {
            expectedVersion: number;
        };
        SupplierAuditRecordDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            ownerOrganizationId: string;
            /** Format: uuid */
            supplierOrganizationId: string | null;
            /** Format: uuid */
            profileId: string;
            /** Format: uuid */
            planId: string;
            /** Format: date */
            auditDate: string;
            auditor: string;
            summary: string;
            findings: Record<string, never>;
            /** @enum {string|null} */
            conclusion?: "PASS" | "CONDITIONAL" | "FAIL" | null;
            closeNote?: Record<string, never> | null;
            /** @enum {string} */
            status: "DRAFT" | "SUBMITTED" | "CLOSED";
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        SupplierAuditRecordPageDto: {
            items: components["schemas"]["SupplierAuditRecordDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        CreateSupplierAuditRecordDto: {
            /** Format: uuid */
            planId: string;
            /** Format: date */
            auditDate: string;
            auditor: string;
            summary: string;
            findings?: Record<string, never>;
        };
        SupplierAuditChecklistItemDto: {
            code: string;
            title: string;
            /** @enum {string} */
            result: "PASS" | "MINOR_NC" | "MAJOR_NC" | "NA";
            note?: Record<string, never> | null;
            evidenceFileIds: string[];
        };
        SupplierAuditChecklistDto: {
            /** Format: uuid */
            recordId: string;
            recordVersion: number;
            items: components["schemas"]["SupplierAuditChecklistItemDto"][];
        };
        SupplierAuditChecklistItemInputDto: {
            code: string;
            title: string;
            /** @enum {string} */
            result: "PASS" | "MINOR_NC" | "MAJOR_NC" | "NA";
            note?: string;
            evidenceFileIds: string[];
        };
        UpdateSupplierAuditChecklistDto: {
            expectedVersion: number;
            items: components["schemas"]["SupplierAuditChecklistItemInputDto"][];
        };
        CloseSupplierAuditRecordDto: {
            expectedVersion: number;
            /** @enum {string} */
            conclusion: "PASS" | "CONDITIONAL" | "FAIL";
            closeNote: string;
        };
        SupplierQualityTargetDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            ownerOrganizationId: string;
            /** Format: uuid */
            supplierOrganizationId: string | null;
            /** Format: uuid */
            profileId: string;
            /** @enum {string} */
            periodType: "ANNUAL" | "MONTHLY";
            targetYear: number;
            targetMonth?: Record<string, never> | null;
            revision: number;
            title: string;
            metrics: Record<string, never>;
            /** @enum {string} */
            status: "DRAFT" | "SUBMITTED" | "APPROVED" | "PUBLISHED" | "RETIRED";
            version: number;
            /** Format: date */
            effectiveFrom?: Record<string, never> | null;
            /** Format: date */
            effectiveTo?: Record<string, never> | null;
            /** Format: uuid */
            approvalSignatureId?: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        SupplierQualityTargetPageDto: {
            items: components["schemas"]["SupplierQualityTargetDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        CreateSupplierQualityTargetDto: {
            /** Format: uuid */
            profileId: string;
            /** @enum {string} */
            periodType: "ANNUAL" | "MONTHLY";
            targetYear: number;
            targetMonth?: number;
            title: string;
            metrics: Record<string, never>;
        };
        SupplierQualityTargetTransitionDto: {
            expectedVersion: number;
        };
        ApproveSupplierQualityTargetDto: {
            expectedVersion: number;
            /**
             * Format: uuid
             * @description 已完成的电子签章记录 ID
             */
            approvalSignatureId?: string;
            note?: string;
        };
        PublishSupplierQualityTargetDto: {
            expectedVersion: number;
            /** Format: date */
            effectiveFrom?: string;
            /** Format: date */
            effectiveTo?: string;
        };
        ReviseSupplierQualityTargetDto: {
            /** Format: uuid */
            profileId: string;
            /** @enum {string} */
            periodType: "ANNUAL" | "MONTHLY";
            targetYear: number;
            targetMonth?: number;
            title: string;
            metrics: Record<string, never>;
            expectedVersion: number;
        };
        SupplierQualityTargetActualDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            targetId: string;
            version: number;
            targetVersion: number;
            metrics: Record<string, never>;
            targetMetrics: Record<string, never>;
            /** @description 实际值减目标值；正负本身不表示达标 */
            deviations: Record<string, never>;
            note?: Record<string, never> | null;
            /** Format: uuid */
            createdById: string;
            /** Format: date-time */
            createdAt: string;
        };
        SupplierQualityTargetActualHistoryDto: {
            /** Format: uuid */
            targetId: string;
            latestVersion: number;
            total: number;
            page: number;
            pageSize: number;
            items: components["schemas"]["SupplierQualityTargetActualDto"][];
        };
        RecordSupplierQualityTargetActualDto: {
            /** @description 当前实际值版本；首次写入为 0 */
            expectedVersion: number;
            /** @description 指标名与实际数值；指标必须已在目标版本中定义为数值 */
            metrics: Record<string, never>;
            note?: string;
        };
        SupplierMeetingDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            ownerOrganizationId: string;
            /** Format: uuid */
            supplierOrganizationId: string | null;
            /** Format: uuid */
            profileId: string;
            title: string;
            /** Format: date-time */
            scheduledStart: string;
            /** Format: date-time */
            scheduledEnd: string;
            location?: Record<string, never> | null;
            /** @enum {string} */
            status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        SupplierMeetingPageDto: {
            items: components["schemas"]["SupplierMeetingDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        CreateSupplierMeetingDto: {
            /** Format: uuid */
            profileId: string;
            title: string;
            /** Format: date-time */
            scheduledStart: string;
            /** Format: date-time */
            scheduledEnd: string;
            location?: string;
        };
        SupplierMeetingTransitionDto: {
            expectedVersion: number;
        };
        CreateSupplierMeetingTopicDto: {
            title: string;
            sequence?: number;
        };
        SupplierMeetingTopicDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            meetingId: string;
            sequence: number;
            title: string;
            conclusion?: Record<string, never> | null;
            /** @enum {string} */
            status: "OPEN" | "CONCLUDED";
            version: number;
        };
        ConcludeSupplierMeetingTopicDto: {
            expectedVersion: number;
            conclusion: string;
        };
        CreateSupplierMeetingActionDto: {
            title: string;
            /** Format: uuid */
            assigneeUserId: string;
            /** Format: date */
            dueDate: string;
        };
        SupplierMeetingActionDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            meetingId: string;
            title: string;
            /** Format: uuid */
            assigneeUserId: string;
            /** Format: date */
            dueDate: string;
            /** @enum {string} */
            status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
            version: number;
        };
        CompleteSupplierMeetingActionDto: {
            expectedVersion: number;
        };
        SupplierPpapItemDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            packageId: string;
            itemCode: string;
            title: string;
            description?: Record<string, never> | null;
            required: boolean;
            /** @enum {string} */
            status: "PENDING" | "PROVIDED" | "ACCEPTED" | "REJECTED";
            content: Record<string, never>;
            evidenceFileIds: string[];
            reviewNote?: string | null;
            /** Format: date-time */
            reviewedAt?: string | null;
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        SupplierPpapDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            ownerOrganizationId: string;
            /** Format: uuid */
            supplierOrganizationId: string | null;
            /** Format: uuid */
            profileId: string;
            level: number;
            title: string;
            partNumber: string;
            /** @enum {string} */
            status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
            version: number;
            reviewNote?: string | null;
            /** Format: date-time */
            requalificationDueAt?: string | null;
            /** Format: date-time */
            lastRequalifiedAt?: string | null;
            requalificationNote?: string | null;
            items: components["schemas"]["SupplierPpapItemDto"][];
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        SupplierPpapPageDto: {
            items: components["schemas"]["SupplierPpapDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        CreateSupplierPpapDto: {
            /** Format: uuid */
            profileId: string;
            level: number;
            title: string;
            partNumber: string;
        };
        CreateSupplierPpapItemDto: {
            itemCode: string;
            title: string;
            description?: string;
            /** @default true */
            required: Record<string, never>;
            /** @default {} */
            content: Record<string, never>;
        };
        SupplierPpapEvidenceDto: {
            expectedVersion: number;
            evidenceFileIds: string[];
        };
        ReviewSupplierPpapItemDto: {
            expectedVersion: number;
            /** @enum {string} */
            decision: "ACCEPTED" | "REJECTED";
            note: string;
        };
        SupplierPpapTransitionDto: {
            expectedVersion: number;
        };
        ReviewSupplierPpapDto: {
            expectedVersion: number;
            /** @enum {string} */
            decision: "APPROVED" | "REJECTED";
            note: string;
        };
        RequalifySupplierPpapDto: {
            expectedVersion: number;
            note: string;
        };
        SupplierInspectionStandardItemDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            standardId: string;
            itemOrder: number;
            itemName: string;
            characteristic?: Record<string, never> | null;
            method?: Record<string, never> | null;
            lowerLimit?: Record<string, never> | null;
            upperLimit?: Record<string, never> | null;
            unit?: Record<string, never> | null;
            required: boolean;
            version: number;
        };
        SupplierInspectionStandardDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            ownerOrganizationId: string;
            /** Format: uuid */
            supplierOrganizationId: string | null;
            /** Format: uuid */
            profileId: string;
            materialCode: string;
            title: string;
            revision: number;
            /** @enum {string} */
            status: "DRAFT" | "PUBLISHED" | "RETIRED";
            version: number;
            effectiveFrom?: Record<string, never> | null;
            effectiveTo?: Record<string, never> | null;
            items: components["schemas"]["SupplierInspectionStandardItemDto"][];
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        SupplierInspectionStandardPageDto: {
            items: components["schemas"]["SupplierInspectionStandardDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        CreateSupplierInspectionStandardDto: {
            /** Format: uuid */
            profileId: string;
            materialCode: string;
            title: string;
            /** @default 1 */
            revision: Record<string, never>;
        };
        CreateSupplierInspectionStandardItemDto: {
            itemOrder: number;
            itemName: string;
            characteristic?: string;
            method?: string;
            lowerLimit?: string;
            upperLimit?: string;
            unit?: string;
            /** @default true */
            required: Record<string, never>;
        };
        SupplierInspectionStandardTransitionDto: {
            expectedVersion: number;
            /** Format: date */
            effectiveFrom?: string;
        };
        SupplierBarcodeRuleDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            ownerOrganizationId: string;
            /** Format: uuid */
            supplierOrganizationId: string | null;
            /** Format: uuid */
            profileId: string;
            materialCode: string;
            title: string;
            prefix: string;
            codeLength: number;
            /** @enum {string} */
            status: "DRAFT" | "PUBLISHED" | "RETIRED";
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        SupplierBarcodeRulePageDto: {
            items: components["schemas"]["SupplierBarcodeRuleDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        CreateSupplierBarcodeRuleDto: {
            /** Format: uuid */
            profileId: string;
            materialCode: string;
            title: string;
            prefix: string;
            codeLength: number;
        };
        SupplierBarcodeTransitionDto: {
            expectedVersion: number;
        };
        ScanSupplierBarcodeDto: {
            /** Format: uuid */
            ruleId: string;
            barcode: string;
            batchCode?: string;
        };
        SupplierBarcodeScanDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            ruleId: string;
            barcode: string;
            batchCode?: Record<string, never> | null;
            /** Format: date-time */
            scannedAt: string;
        };
        SupplierAsnEvidenceDto: {
            /** Format: uuid */
            fileId: string;
            fileVersion: number;
            sha256: string;
            /** Format: date-time */
            scannedAt: string;
        };
        SupplierAsnDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            ownerOrganizationId: string;
            /** Format: uuid */
            supplierOrganizationId: string | null;
            /** Format: uuid */
            profileId: string;
            asnNumber: string;
            materialCode: string;
            /** Format: date */
            plannedArrivalDate: string;
            quantity: number;
            /** @enum {string} */
            status: "DRAFT" | "SUBMITTED" | "RECEIVED" | "CANCELLED";
            version: number;
            evidence: components["schemas"]["SupplierAsnEvidenceDto"][];
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        SupplierAsnPageDto: {
            items: components["schemas"]["SupplierAsnDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        CreateSupplierAsnDto: {
            /** Format: uuid */
            profileId: string;
            asnNumber: string;
            materialCode: string;
            /** Format: date */
            plannedArrivalDate: string;
            quantity: number;
        };
        UpdateSupplierAsnEvidenceDto: {
            expectedVersion: number;
            fileIds: string[];
        };
        SupplierAsnTransitionDto: {
            expectedVersion: number;
        };
        SupplierPcnDto: {
            /** @enum {string} */
            changeType: "MATERIAL" | "PROCESS" | "EQUIPMENT" | "SITE";
            title: string;
            materialCode: string;
            beforeChange: string;
            afterChange: string;
            reason: string;
            riskControl: string;
            /** Format: date */
            plannedDate: string;
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            profileId: string;
            /** Format: uuid */
            ownerOrganizationId: string;
            /** Format: uuid */
            supplierOrganizationId: string;
            supplierName: string;
            /** @enum {string} */
            status: "DRAFT" | "SUBMITTED" | "NEEDS_CHANGES" | "APPROVED" | "CLOSED";
            version: number;
            /** Format: uuid */
            fileId?: string | null;
            /** Format: uuid */
            problemIndexId?: string | null;
            reviewNote?: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        SupplierPcnPageDto: {
            items: components["schemas"]["SupplierPcnDto"][];
            total: number;
            page: number;
            pageSize: number;
        };
        SupplierPcnEventDto: {
            eventType: string;
            pcnVersion: number;
            /** Format: uuid */
            actorUserId: string;
            snapshot: components["schemas"]["SupplierPcnDto"];
            note?: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        SupplierPcnWorkflowDto: {
            /** Format: uuid */
            instanceId: string;
            /** Format: uuid */
            currentNodeId: string;
            /** Format: uuid */
            workflowVersionId: string;
            version: number;
            problemVersion: number;
            status: string;
            nodeType: string;
        };
        SupplierPcnDetailDto: {
            /** @enum {string} */
            changeType: "MATERIAL" | "PROCESS" | "EQUIPMENT" | "SITE";
            title: string;
            materialCode: string;
            beforeChange: string;
            afterChange: string;
            reason: string;
            riskControl: string;
            /** Format: date */
            plannedDate: string;
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            profileId: string;
            /** Format: uuid */
            ownerOrganizationId: string;
            /** Format: uuid */
            supplierOrganizationId: string;
            supplierName: string;
            /** @enum {string} */
            status: "DRAFT" | "SUBMITTED" | "NEEDS_CHANGES" | "APPROVED" | "CLOSED";
            version: number;
            /** Format: uuid */
            fileId?: string | null;
            /** Format: uuid */
            problemIndexId?: string | null;
            reviewNote?: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            events: components["schemas"]["SupplierPcnEventDto"][];
            workflow?: components["schemas"]["SupplierPcnWorkflowDto"] | null;
        };
        StartSupplierPcnWorkflowDto: {
            expectedVersion: number;
            /** Format: uuid */
            workflowDefinitionId: string;
            /** Format: uuid */
            workflowVersionId: string;
        };
        ReviewSupplierPcnDto: {
            expectedVersion: number;
            /** @enum {string} */
            action: "APPROVE" | "RETURN" | "CLOSE";
            note: string;
            expectedWorkflowVersion: number;
            expectedProblemVersion: number;
            /** Format: uuid */
            currentNodeId: string;
        };
        SupplierPcnProfileDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            ownerOrganizationId: string;
            /** Format: uuid */
            supplierOrganizationId: string;
            displayName: string;
        };
        SupplierPcnProfilesDto: {
            items: components["schemas"]["SupplierPcnProfileDto"][];
        };
        CreateSupplierPcnDto: {
            /** @enum {string} */
            changeType: "MATERIAL" | "PROCESS" | "EQUIPMENT" | "SITE";
            title: string;
            materialCode: string;
            beforeChange: string;
            afterChange: string;
            reason: string;
            riskControl: string;
            /** Format: date */
            plannedDate: string;
            /** Format: uuid */
            profileId: string;
        };
        UpdateSupplierPcnDto: {
            /** @enum {string} */
            changeType: "MATERIAL" | "PROCESS" | "EQUIPMENT" | "SITE";
            title: string;
            materialCode: string;
            beforeChange: string;
            afterChange: string;
            reason: string;
            riskControl: string;
            /** Format: date */
            plannedDate: string;
            expectedVersion: number;
        };
        SubmitSupplierPcnDto: {
            expectedVersion: number;
            /** Format: uuid */
            fileId: string;
        };
        AdvanceSupplierPcnDto: {
            expectedVersion: number;
            expectedWorkflowVersion: number;
            expectedProblemVersion: number;
            /** Format: uuid */
            currentNodeId: string;
            /** Format: uuid */
            fileId: string;
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
        PlatformErrorCode: "SUPPLIER_INPUT_INVALID" | "SUPPLIER_WORKFLOW_CONFIGURATION_INVALID" | "SUPPLIER_WORKFLOW_CONFIGURATION_REQUIRED" | "SUPPLIER_RECORD_NOT_FOUND" | "SUPPLIER_DRAFT_LOCKED" | "SUPPLIER_PROFILE_DUPLICATE" | "SUPPLIER_COLLABORATION_NOT_ENABLED" | "SUPPLIER_PPAP_INPUT_INVALID" | "SUPPLIER_PPAP_NOT_FOUND" | "SUPPLIER_PPAP_STATE_INVALID" | "SUPPLIER_PPAP_ITEM_EXISTS" | "SUPPLIER_PPAP_ITEMS_INCOMPLETE" | "SUPPLIER_PPAP_ITEMS_NOT_REVIEWED" | "SUPPLIER_PPAP_ITEM_EVIDENCE_REQUIRED" | "SUPPLIER_INSPECTION_STANDARD_INPUT_INVALID" | "SUPPLIER_INSPECTION_STANDARD_NOT_FOUND" | "SUPPLIER_INSPECTION_STANDARD_STATE_INVALID" | "SUPPLIER_INSPECTION_STANDARD_ITEM_EXISTS" | "SUPPLIER_INSPECTION_STANDARD_ITEMS_REQUIRED" | "SUPPLIER_BARCODE_INPUT_INVALID" | "SUPPLIER_BARCODE_RULE_NOT_FOUND" | "SUPPLIER_BARCODE_RULE_NOT_PUBLISHED" | "SUPPLIER_BARCODE_FORMAT_INVALID" | "SUPPLIER_BARCODE_DUPLICATE" | "SUPPLIER_ASN_INPUT_INVALID" | "SUPPLIER_ASN_NOT_FOUND" | "SUPPLIER_ASN_STANDARD_REQUIRED" | "SUPPLIER_ASN_PPAP_REQUIRED" | "NEW_PRODUCT_INPUT_INVALID" | "NEW_PRODUCT_PROJECT_NOT_FOUND" | "NEW_PRODUCT_PROJECT_ARCHIVED" | "NEW_PRODUCT_TRIAL_BATCH_NOT_FOUND" | "NEW_PRODUCT_ISSUE_NOT_FOUND" | "NEW_PRODUCT_ISSUE_STATE_INVALID" | "NEW_PRODUCT_ISSUE_ASSIGNEE_INVALID" | "AUDIT_NC_WORKFLOW_NOT_CLOSED" | "NEW_PRODUCT_EVIDENCE_UNAVAILABLE" | "WORKFLOW_UPGRADE_DOMAIN_DENIED" | "WORKFLOW_UPGRADE_NOT_ALLOWED" | "WORKFLOW_UPGRADE_MAPPING_INVALID" | "FILE_RESOURCE_DENIED" | "FILE_NOT_FOUND" | "FILE_NOT_AVAILABLE" | "FILE_UPLOAD_EXPIRED" | "FILE_UPLOAD_INVALID" | "FILE_QUOTA_EXCEEDED" | "FILE_OBJECT_UNAVAILABLE" | "FILE_CONTENT_MISMATCH" | "FILE_MIME_NOT_ALLOWED" | "FILE_TOO_LARGE" | "FILE_EMPTY" | "FILE_COUNT_EXCEEDED" | "FILE_SCAN_RETRY_UNAVAILABLE" | "TASK_NOT_FOUND" | "TASK_NOT_CLAIMED" | "TASK_CLAIM_OWNER_REQUIRED" | "TASK_ALREADY_CLAIMED" | "TASK_ASSIGNEE_NOT_ELIGIBLE" | "TASK_RETRY_UNAVAILABLE" | "NOTIFICATION_NOT_FOUND" | "PROBLEM_NOT_FOUND" | "EXPORT_TOO_LARGE" | "EXPORT_NOT_FOUND" | "EXPORT_EXPIRED" | "OUTBOX_EVENT_NOT_FOUND" | "NUMBERING_CONFLICT" | "WORKFLOW_VERSION_IMMUTABLE" | "WORKFLOW_DRAFT_INVALID" | "WORKFLOW_NODE_FORBIDDEN" | "WORKFLOW_INSTANCE_NOT_FOUND" | "WORKFLOW_VERSION_NOT_FOUND" | "WORKFLOW_VERSION_MISMATCH" | "WORKFLOW_ACTION_INVALID" | "WORKFLOW_TRANSITION_AMBIGUOUS" | "WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED" | "WORKFLOW_TRANSACTION_ISOLATION_UNSUPPORTED" | "IDEMPOTENCY_REPLAY" | "CONCURRENCY_CONFLICT" | "AUTH_INVALID_CREDENTIALS" | "AUTH_MFA_REQUIRED" | "AUTH_MFA_CHALLENGE_INVALID" | "AUTH_MFA_CODE_INVALID" | "AUTH_MFA_RATE_LIMITED" | "AUTH_MFA_ALREADY_ENABLED" | "AUTH_MFA_NOT_ENABLED" | "AUTH_MFA_POLICY_REQUIRED" | "AUTH_REAUTHENTICATION_REQUIRED" | "AUTH_SECURITY_KEY_UNAVAILABLE" | "AUTH_MAIL_UNAVAILABLE" | "AUTH_EMAIL_REQUIRED" | "AUTH_RECOVERY_INVALID" | "AUTH_RECOVERY_UNAVAILABLE" | "AUTH_CURRENT_PASSWORD_INVALID" | "AUTH_PASSWORD_POLICY_INVALID" | "AUTH_PASSWORD_CHANGE_INVALID" | "ADMIN_BATCH_ROW_INVALID" | "AUTH_SESSION_NOT_FOUND" | "AUTH_CURRENT_SESSION_REVOKE_FORBIDDEN" | "AUTH_SESSION_REQUIRED" | "AUTH_RATE_LIMITED" | "CSRF_INVALID" | "FEATURE_PERMISSION_DENIED" | "POSITION_GRANT_CEILING_DENIED" | "ORGANIZATION_SCOPE_AMBIGUOUS" | "ORGANIZATION_SCOPE_DENIED" | "ORGANIZATION_DISABLED" | "ORGANIZATION_NOT_FOUND" | "ORGANIZATION_HIERARCHY_INVALID" | "ORGANIZATION_TYPE_MISMATCH" | "STRUCTURE_NOT_FOUND" | "STRUCTURE_DISABLED" | "STRUCTURE_REFERENCE_INVALID" | "STRUCTURE_DUPLICATE" | "WORKFLOW_PERMISSION_REQUIRED" | "ADMIN_USER_NOT_FOUND" | "ADMIN_USER_DUPLICATE" | "ADMIN_USER_ORGANIZATION_IN_USE" | "ADMIN_SELF_DISABLE_FORBIDDEN" | "ADMIN_ACCOUNT_TYPE_ORGANIZATION_MISMATCH" | "ADMIN_ROLE_NOT_FOUND" | "ADMIN_ROLE_DUPLICATE" | "ADMIN_ROLE_IN_USE" | "ADMIN_PERMISSION_NOT_FOUND" | "ADMIN_PERMISSION_BASELINE_REQUIRED" | "ADMIN_SELF_LOCK_FORBIDDEN" | "IDEMPOTENCY_KEY_REQUIRED" | "AUTH_PASSWORD_RESET_INVALID" | "ADMIN_GLOBAL_ROLE_IMMUTABLE";
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
    AuthController_passwordChangeStatus: {
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
    AuthController_completePasswordChange: {
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
                "application/json": components["schemas"]["CompletePasswordChangeDto"];
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
    AccountController_updateAvatar: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "x-csrf-token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateAccountAvatarDto"];
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
                "idempotency-key": string;
                "Idempotency-Key": string;
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
    AccountController_sessionHistory: {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
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
                    "application/json": components["schemas"]["AccountSessionHistoryPageDto"];
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
    AdminUserController_createBatch: {
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
                "application/json": components["schemas"]["CreateAdminUserBatchDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserBatchResultDto"];
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
    AdminUserController_getMfaPolicy: {
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
                    "application/json": components["schemas"]["AdminMfaPolicyDto"];
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
    AdminUserController_setMfaPolicy: {
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
                "application/json": components["schemas"]["AdminMfaPolicyInputDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminMfaPolicyDto"];
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
    AdminUserController_readTemporaryPassword: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
                "x-csrf-token": string;
            };
            path: {
                userId: string;
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
                    "application/json": components["schemas"]["TemporaryPasswordDto"];
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
    AdminUserController_resetTemporaryPassword: {
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
                "application/json": components["schemas"]["ResetTemporaryPasswordDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TemporaryPasswordDto"];
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
    MfaController_preference: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "x-csrf-token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MfaPreferenceDto"];
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
    FileController_retryScan: {
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
    OrganizationGovernanceController_positionRoles: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: string;
                positionId: string;
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
                    "application/json": components["schemas"]["PositionRolesDto"];
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
    OrganizationGovernanceController_replacePositionRoles: {
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
                "application/json": components["schemas"]["ReplacePositionRolesDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PositionRolesDto"];
                };
            };
            /** @description Legacy position role mappings are read-only. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
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
    OrganizationGovernanceController_positionPermissions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: string;
                positionId: string;
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
                    "application/json": components["schemas"]["PositionPermissionsDto"];
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
    OrganizationGovernanceController_updatePositionPermissions: {
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
                "application/json": components["schemas"]["UpdatePositionPermissionsDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PositionPermissionsDto"];
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
                "application/json": components["schemas"]["ReplaceUserPositionsWithPreviewDto"];
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
    PositionOnboardingController_preview: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
            };
            path: {
                organizationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PositionAuthorizationPreviewInputDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PositionAuthorizationPreviewDto"];
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
    PermissionsController_myPermissions: {
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
            /** @description Independent role writes are read-only. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
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
            /** @description Independent role writes are read-only. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
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
            /** @description Independent role writes are read-only. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
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
            /** @description Independent role writes are read-only. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
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
            /** @description Independent role assignments are read-only. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
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
    AccountOverviewController_overview: {
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
                    "application/json": components["schemas"]["AccountOverviewDto"];
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
    OutboxAdministrationController_attempts: {
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
                    "application/json": components["schemas"]["OutboxAttemptPageDto"];
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
                status?: "PENDING" | "IN_PROGRESS" | "OVERDUE" | "FAILED";
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
    TaskInboxController_statistics: {
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
                    "application/json": components["schemas"]["TaskStatisticsDto"];
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
    TaskInboxController_transfer: {
        parameters: {
            query?: {
                organizationId?: string;
            };
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
                "application/json": components["schemas"]["TaskTransferDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskTransferResultDto"][];
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
    TaskInboxController_retry: {
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
    SupplierMasterController_import: {
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
                "application/json": components["schemas"]["SupplierProfileImportDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierProfileImportResultDto"];
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
    SupplierMasterController_list: {
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
                    "application/json": components["schemas"]["SupplierAccountPageDto"];
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
    SupplierMasterController_create: {
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
                "application/json": components["schemas"]["CreateSupplierAccountDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatedSupplierAccountDto"];
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
    SupplierMasterController_temporaryPassword: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header?: never;
            path: {
                id: string;
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
                    "application/json": components["schemas"]["TemporaryPasswordDto"];
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
    SupplierMasterController_reset: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SupplierAccountScopeDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TemporaryPasswordDto"];
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
    SupplierMasterController_setStatus: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetSupplierAccountStatusDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierAccountDto"];
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
    ProcessQualityController_productionBatches: {
        parameters: {
            query: {
                organizationId?: string;
                periodStart: string;
                periodEnd: string;
                productCode?: string;
                batchCode?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["ProcessProductionPageDto"];
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
    ProcessQualityController_createProduction: {
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
                "application/json": components["schemas"]["CreateProcessProductionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProcessProductionDto"];
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
    ProcessQualityController_productionSummary: {
        parameters: {
            query: {
                organizationId?: string;
                periodStart: string;
                periodEnd: string;
                productCode?: string;
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
                    "application/json": components["schemas"]["ProcessProductionSummaryDto"];
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
    ProcessQualityController_productionDetail: {
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
                    "application/json": components["schemas"]["ProcessProductionDetailDto"];
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
    ProcessQualityController_correctProduction: {
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
                "application/json": components["schemas"]["CorrectProcessProductionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProcessProductionDto"];
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
    ProcessQualityController_shipmentReportList: {
        parameters: {
            query?: {
                organizationId?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
                productCode?: string;
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
                    "application/json": components["schemas"]["ProcessShipmentReportPageDto"];
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
    ProcessQualityController_createShipmentReport: {
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
                "application/json": components["schemas"]["CreateProcessShipmentReportDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProcessShipmentReportDto"];
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
    ProcessQualityController_shipmentReportDetail: {
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
                    "application/json": components["schemas"]["ProcessShipmentReportDto"];
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
    ProcessQualityController_archiveShipmentReport: {
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
                "application/json": components["schemas"]["ArchiveProcessShipmentReportDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProcessShipmentReportDto"];
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
    ProcessQualityController_updateShipmentReportEvidence: {
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
                "application/json": components["schemas"]["UpdateProcessShipmentReportEvidenceDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProcessShipmentReportDto"];
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
    ProcessQualityController_associateShipmentReportCustomer: {
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
                "application/json": components["schemas"]["AssociateProcessShipmentReportCustomerDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProcessShipmentReportDto"];
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
    ProcessQualityController_linkShipmentReportIssue: {
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
                "application/json": components["schemas"]["LinkProcessShipmentReportIssueDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProcessShipmentReportDto"];
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
    ProcessQualityController_issue: {
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
                "application/json": components["schemas"]["IssueProcessDefectsDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProcessIssueResultDto"];
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
    ProcessQualityController_linkedIssues: {
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
                    "application/json": components["schemas"]["ProcessIssueProblemDto"][];
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
    CustomerQualityController_customers: {
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
                    "application/json": components["schemas"]["CustomerMasterDto"][];
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
    CustomerQualityController_createCustomer: {
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
                "application/json": components["schemas"]["CreateCustomerDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerMasterDto"];
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
    CustomerQualityController_importCustomers: {
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
                "application/json": components["schemas"]["CustomerMasterImportDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerMasterImportResultDto"];
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
    CustomerQualityController_updateCustomer: {
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
                "application/json": components["schemas"]["UpdateCustomerDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerMasterDto"];
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
    CustomerQualityController_customerRelations: {
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
                    "application/json": components["schemas"]["CustomerRelationDto"][];
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
    CustomerQualityController_createCustomerRelation: {
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
                "application/json": components["schemas"]["CreateCustomerRelationDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerRelationDto"];
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
    CustomerQualityController_updateCustomerRelation: {
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
                "application/json": components["schemas"]["UpdateCustomerRelationDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerRelationDto"];
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
    CustomerQualityController_deleteCustomerRelation: {
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
                "application/json": components["schemas"]["UpdateCustomerRelationDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    CustomerQualityController_complaints: {
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
                    "application/json": components["schemas"]["CustomerComplaintDto"][];
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
    CustomerQualityController_createComplaint: {
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
                "application/json": components["schemas"]["CreateComplaintDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerComplaintDto"];
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
    CustomerQualityController_complaintAssignees: {
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
                    "application/json": components["schemas"]["CustomerComplaintAssigneesDto"];
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
    CustomerQualityController_importComplaints: {
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
                "application/json": components["schemas"]["ImportCustomerComplaintsDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerComplaintImportResultDto"];
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
    CustomerQualityController_complaint: {
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
                    "application/json": components["schemas"]["CustomerComplaintDetailDto"];
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
    CustomerQualityController_updateComplaint: {
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
                "application/json": components["schemas"]["UpdateComplaintDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerComplaintDto"];
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
    CustomerQualityController_archive: {
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
                "application/json": components["schemas"]["ArchiveComplaintDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerComplaintDto"];
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
    CustomerQualityController_complaintEvents: {
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
                    "application/json": components["schemas"]["CustomerComplaintEventDto"][];
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
    CustomerQualityController_complaintEightD: {
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
                    "application/json": components["schemas"]["CustomerComplaintEightDDto"];
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
    CustomerQualityController_saveComplaintEightD: {
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
                "application/json": components["schemas"]["SaveCustomerComplaintEightDDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerComplaintEightDDto"];
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
    CustomerQualityController_submitComplaintEightD: {
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
                "application/json": components["schemas"]["SubmitCustomerComplaintEightDDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerComplaintEightDDto"];
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
    CustomerQualityController_approveComplaintEightD: {
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
                "application/json": components["schemas"]["ApproveCustomerComplaintEightDDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerComplaintEightDDto"];
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
    CustomerQualityController_complaintAttachments: {
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
                    "application/json": components["schemas"]["FileDto"][];
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
    CustomerQualityController_triageComplaint: {
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
                "application/json": components["schemas"]["TriageCustomerComplaintDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerComplaintDto"];
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
    CustomerQualityController_progressComplaint: {
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
                "application/json": components["schemas"]["ProgressCustomerComplaintDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerComplaintDto"];
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
    CustomerQualityController_resolveComplaint: {
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
                "application/json": components["schemas"]["ResolveCustomerComplaintDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerComplaintDto"];
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
    CustomerQualityController_closeComplaint: {
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
                "application/json": components["schemas"]["NoteCustomerComplaintDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerComplaintDto"];
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
    CustomerQualityController_reopenComplaint: {
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
                "application/json": components["schemas"]["NoteCustomerComplaintDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerComplaintDto"];
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
    CustomerQualityController_dispositionHistory: {
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
                    "application/json": components["schemas"]["CustomerPhysicalDispositionDto"][];
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
    CustomerQualityController_disposition: {
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
                "application/json": components["schemas"]["PhysicalDispositionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerPhysicalDispositionDto"];
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
    CustomerQualityController_analysisHistory: {
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
                    "application/json": components["schemas"]["CustomerPhysicalAnalysisDto"][];
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
    CustomerQualityController_analysis: {
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
                "application/json": components["schemas"]["PhysicalAnalysisDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerPhysicalAnalysisDto"];
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
    CustomerQualityController_issue: {
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
                "application/json": components["schemas"]["IssueCustomerComplaintsDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerIssueResultDto"];
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
    CustomerQualityController_linkedIssues: {
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
                    "application/json": components["schemas"]["CustomerIssueProblemDto"][];
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
    CustomerQualityController_changeIssueSources: {
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
                "application/json": components["schemas"]["ChangeCustomerIssueSourcesDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerIssueProblemDto"];
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
    CustomerQualityController_linkedIssueHistory: {
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
                    "application/json": components["schemas"]["CustomerIssueLinkHistoryDto"][];
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
    MaterialMasterController_list: {
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
                    "application/json": components["schemas"]["MaterialMasterDto"][];
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
    MaterialMasterController_create: {
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
                "application/json": components["schemas"]["CreateMaterialMasterDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MaterialMasterDto"];
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
    MaterialMasterController_update: {
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
                "application/json": components["schemas"]["UpdateMaterialMasterDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MaterialMasterDto"];
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
    MaterialMasterController_import: {
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
                "application/json": components["schemas"]["MaterialMasterImportDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MaterialMasterImportResultDto"];
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
    AuditManagementController_plan: {
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
                    "application/json": components["schemas"]["AuditPlanResponseDto"];
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
    AuditManagementController_updatePlan: {
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
                "application/json": components["schemas"]["UpdateAuditPlanDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditPlanResponseDto"];
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
    AuditManagementController_createPlan: {
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
                "application/json": components["schemas"]["CreateAuditPlanDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditPlanResponseDto"];
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
    AuditManagementController_postpone: {
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
                "application/json": components["schemas"]["PostponementDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditPostponementResponseDto"];
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
    AuditManagementController_decide: {
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
                "application/json": components["schemas"]["DecisionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditPostponementResponseDto"];
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
    AuditManagementController_createTemplate: {
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
                "application/json": components["schemas"]["CreateAuditTemplateDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditTemplateResponseDto"];
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
    AuditManagementController_updateTemplate: {
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
                "application/json": components["schemas"]["UpdateAuditTemplateDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditTemplateResponseDto"];
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
    AuditManagementController_publishTemplate: {
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
                "application/json": components["schemas"]["PublishAuditTemplateDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublishedAuditTemplateResponseDto"];
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
    AuditManagementController_createExecution: {
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
                "application/json": components["schemas"]["CreateAuditExecutionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditExecutionResponseDto"];
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
    AuditManagementController_execution: {
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
                    "application/json": components["schemas"]["AuditExecutionSnapshotDto"];
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
    AuditManagementController_executionNcs: {
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
                    "application/json": components["schemas"]["AuditNcResponseDto"][];
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
    AuditManagementController_executionReport: {
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
                    "application/json": components["schemas"]["AuditExecutionReportDto"];
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
    AuditManagementController_planReport: {
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
                    "application/json": components["schemas"]["AuditPlanReportDto"];
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
    AuditManagementController_checklist: {
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
                "application/json": components["schemas"]["ChecklistResultDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditChecklistResponseDto"];
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
    AuditManagementController_submit: {
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
                "application/json": components["schemas"]["SubmitAuditExecutionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditExecutionResponseDto"];
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
    AuditManagementController_registerDeadlinePolicy: {
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
                "application/json": components["schemas"]["RegisterAuditDeadlinePolicyDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditDeadlinePolicyResponseDto"];
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
    AuditManagementController_createNc: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                executionId: string;
                resultId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateNcDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditNcResponseDto"];
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
    AuditManagementController_assign: {
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
                "application/json": components["schemas"]["AssignNcDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditNcResponseDto"];
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
    AuditManagementController_respond: {
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
                "application/json": components["schemas"]["RespondNcDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditNcResponseDto"];
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
    AuditManagementController_verify: {
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
                "application/json": components["schemas"]["VerifyNcDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditNcResponseDto"];
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
    AuditManagementController_close: {
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
                "application/json": components["schemas"]["CloseNcDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditNcResponseDto"];
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
    AuditManagementController_imports: {
        parameters: {
            query?: {
                organizationId?: string;
                sourceSystem?: "CUSTOMER" | "SECOND_PARTY";
                status?: "PENDING_REVIEW" | "ACCEPTED" | "REJECTED" | "ISSUED";
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["AuditImportRowPageDto"];
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
    AuditManagementController_importRow: {
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
                "application/json": components["schemas"]["ImportAuditRowDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditImportRowResponseDto"];
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
    AuditManagementController_reviewImport: {
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
                "application/json": components["schemas"]["ReviewAuditImportRowDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditImportRowResponseDto"];
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
    AuditManagementController_issueImport: {
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
                "application/json": components["schemas"]["IssueAuditImportRowDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditImportIssueResultDto"];
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
    NewProductQualityController_createProject: {
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
                "application/json": components["schemas"]["CreateNewProductProjectDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductProjectDto"];
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
    NewProductQualityController_project: {
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
                    "application/json": components["schemas"]["NewProductProjectDetailDto"];
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
    NewProductQualityController_addStage: {
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
                "application/json": components["schemas"]["CreateNewProductStageDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductStageDto"];
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
    NewProductQualityController_addDeliverable: {
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
                "application/json": components["schemas"]["CreateNewProductDeliverableDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductDeliverableDto"];
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
    NewProductQualityController_submitDeliverable: {
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
                "application/json": components["schemas"]["SubmitNewProductDeliverableDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductDeliverableDto"];
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
    NewProductQualityController_createLesson: {
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
                "application/json": components["schemas"]["CreateNewProductLessonDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductLessonDto"];
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
    NewProductQualityController_attachLesson: {
        parameters: {
            query?: never;
            header: {
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                projectId: string;
                lessonId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewProductScopeDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductLessonCheckDto"];
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
    NewProductQualityController_confirmLesson: {
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
                "application/json": components["schemas"]["ConfirmNewProductLessonDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductLessonCheckDto"];
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
    NewProductQualityController_reviewStage: {
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
                "application/json": components["schemas"]["ReviewNewProductStageDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductStageDto"];
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
    NewProductQualityController_createTrialBatch: {
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
                "application/json": components["schemas"]["CreateNewProductTrialBatchDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductTrialBatchDto"];
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
    NewProductQualityController_recordMetric: {
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
                "application/json": components["schemas"]["RecordNewProductMetricDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductTrialMetricDto"];
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
    NewProductQualityController_trialReport: {
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
                    "application/json": components["schemas"]["NewProductTrialReportDto"];
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
    NewProductQualityController_exportTrialReport: {
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
                    "text/csv": string;
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
    NewProductQualityController_trialSummary: {
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
                    "application/json": components["schemas"]["NewProductTrialSummaryDto"];
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
    NewProductQualityController_createTrialSummary: {
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
                "application/json": components["schemas"]["CreateNewProductTrialSummaryDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductTrialSummaryDto"];
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
    NewProductQualityController_trialSummaryRevisions: {
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
                    "application/json": components["schemas"]["NewProductTrialSummaryRevisionDto"][];
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
    NewProductQualityController_exportTrialSummary: {
        parameters: {
            query: {
                expectedVersion: number;
                organizationId?: string;
            };
            header?: never;
            path: {
                id: string;
                format: "xlsx" | "pdf";
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
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": string;
                    "application/pdf": string;
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
    NewProductQualityController_reviseTrialSummary: {
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
                "application/json": components["schemas"]["ReviseNewProductTrialSummaryDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductTrialSummaryDto"];
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
    NewProductQualityController_submitTrialSummary: {
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
                "application/json": components["schemas"]["SubmitNewProductTrialSummaryDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductTrialSummaryDto"];
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
    NewProductQualityController_decideTrialSummary: {
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
                "application/json": components["schemas"]["DecideNewProductTrialSummaryDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductTrialSummaryDto"];
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
    NewProductQualityController_earlyFlow: {
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
                    "application/json": components["schemas"]["NewProductEarlyFlowDto"];
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
    NewProductQualityController_createEarlyFlow: {
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
                "application/json": components["schemas"]["CreateNewProductEarlyFlowDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductEarlyFlowDto"];
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
    NewProductQualityController_reviseEarlyFlow: {
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
                "application/json": components["schemas"]["ReviseNewProductEarlyFlowDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductEarlyFlowDto"];
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
    NewProductQualityController_submitEarlyFlow: {
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
                "application/json": components["schemas"]["SubmitNewProductEarlyFlowDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductEarlyFlowDto"];
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
    NewProductQualityController_approveEarlyFlow: {
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
                "application/json": components["schemas"]["ApproveNewProductEarlyFlowDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductEarlyFlowDto"];
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
    NewProductQualityController_decideEarlyFlowRelease: {
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
                "application/json": components["schemas"]["DecideNewProductEarlyFlowReleaseDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductEarlyFlowReleaseDto"];
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
    NewProductQualityController_releases: {
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
                    "application/json": components["schemas"]["NewProductEarlyFlowReleaseDto"][];
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
    NewProductQualityController_selectedDefects: {
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
                    "application/json": Record<string, never>[];
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
    NewProductQualityController_selectDefect: {
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
                "application/json": components["schemas"]["SelectNewProductDefectDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
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
    NewProductQualityController_issues: {
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
                    "application/json": components["schemas"]["NewProductIssueListDto"];
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
    NewProductQualityController_issueDefects: {
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
                "application/json": components["schemas"]["IssueNewProductDefectsDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
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
    NewProductQualityController_escalateIssue: {
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
                "application/json": components["schemas"]["EscalateNewProductIssueDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
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
    NewProductQualityController_assignIssue: {
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
                "application/json": components["schemas"]["AssignNewProductIssueDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductIssueDto"];
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
    NewProductQualityController_recordIssueMeasure: {
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
                "application/json": components["schemas"]["RecordNewProductMeasureDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductIssueDto"];
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
    NewProductQualityController_verifyIssue: {
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
                "application/json": components["schemas"]["VerifyNewProductIssueDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductIssueDto"];
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
    NewProductQualityController_closeIssue: {
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
                "application/json": components["schemas"]["CloseNewProductIssueDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductIssueDto"];
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
    NewProductQualityController_legacyIssue: {
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
                "application/json": components["schemas"]["CreateNewProductLegacyIssueDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
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
    NewProductQualityController_massProductionApproval: {
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
                "application/json": components["schemas"]["ApproveNewProductMassProductionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
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
    NewProductQualityController_handover: {
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
                "application/json": components["schemas"]["HandoverNewProductProjectDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NewProductHandoverDto"];
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
    QualityDataController_metrics: {
        parameters: {
            query?: {
                organizationId?: string;
                metricDefinitionId?: string;
                from?: string;
                to?: string;
                limit?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["MetricDefinitionDto"][];
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
    QualityDataController_createMetric: {
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
                "application/json": components["schemas"]["CreateMetricDefinitionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetricDefinitionDto"];
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
    QualityDataController_recordFact: {
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
                "application/json": components["schemas"]["RecordMetricFactDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetricFactDto"];
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
    QualityDataController_snapshot: {
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
                "application/json": components["schemas"]["CreateQualitySnapshotDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QualitySnapshotDto"];
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
    QualityDataController_internalSnapshot: {
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
                "application/json": components["schemas"]["CreateInternalQualitySnapshotDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QualitySnapshotDto"];
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
    QualityDataController_snapshotDetail: {
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
                    "application/json": components["schemas"]["QualitySnapshotDetailDto"];
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
    QualityDataController_factDrilldown: {
        parameters: {
            query?: {
                organizationId?: string;
                expectedMetricVersion?: number;
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
                    "application/json": components["schemas"]["QualityFactDrilldownDto"];
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
    QualityDataController_trend: {
        parameters: {
            query?: {
                organizationId?: string;
                metricDefinitionId?: string;
                from?: string;
                to?: string;
                limit?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["MetricFactDto"][];
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
    QualityDataController_dashboard: {
        parameters: {
            query?: {
                organizationId?: string;
                metricDefinitionId?: string;
                from?: string;
                to?: string;
                limit?: components["schemas"]["Object"];
                domain?: "SUPPLIER" | "PROCESS" | "CUSTOMER" | "NEW_PRODUCT";
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
                    "application/json": components["schemas"]["QualityDashboardDto"];
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
    QualityDataController_insights: {
        parameters: {
            query?: {
                organizationId?: string;
                metricDefinitionId?: string;
                from?: string;
                to?: string;
                limit?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["QualityInsightDto"][];
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
    QualityDataController_managementReport: {
        parameters: {
            query?: {
                organizationId?: string;
                metricDefinitionId?: string;
                from?: string;
                to?: string;
                limit?: components["schemas"]["Object"];
                domain?: "SUPPLIER" | "PROCESS" | "CUSTOMER" | "NEW_PRODUCT";
            };
            header?: never;
            path: {
                format: string;
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
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": string;
                    "application/pdf": string;
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
    SupplierIncomingController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                profileId?: string;
                materialCode?: string;
                status?: "DRAFT" | "COMPLETED" | "CORRECTED";
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["IncomingInspectionPageDto"];
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
    SupplierIncomingController_create: {
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
                "application/json": components["schemas"]["CreateIncomingInspectionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    SupplierIncomingController_detail: {
        parameters: {
            query: {
                organizationId: string;
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
                    "application/json": components["schemas"]["IncomingInspectionDto"];
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
    SupplierIncomingController_source: {
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
    SupplierIncomingController_complete: {
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
                "application/json": components["schemas"]["CompleteIncomingInspectionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    SupplierIncomingController_correct: {
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
                "application/json": components["schemas"]["CorrectIncomingInspectionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    SupplierIncomingController_linkProblem: {
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
                "application/json": components["schemas"]["LinkIncomingProblemDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    SupplierIncomingController_attachPhoto: {
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
                "application/json": components["schemas"]["AttachIncomingPhotoDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    CoordinateInspectionController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                status?: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED";
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["CoordinateInspectionPageDto"];
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
    CoordinateInspectionController_create: {
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
                "application/json": components["schemas"]["CreateCoordinateInspectionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CoordinateInspectionRequestDto"];
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
    CoordinateInspectionController_detail: {
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
                    "application/json": components["schemas"]["CoordinateInspectionRequestDto"];
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
    CoordinateInspectionController_revise: {
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
                "application/json": components["schemas"]["UpdateCoordinateInspectionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CoordinateInspectionRequestDto"];
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
    CoordinateInspectionController_submit: {
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
                "application/json": components["schemas"]["SubmitCoordinateInspectionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CoordinateInspectionRequestDto"];
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
    CoordinateInspectionController_approve: {
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
                "application/json": components["schemas"]["ApproveCoordinateInspectionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CoordinateInspectionRequestDto"];
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
    CoordinateInspectionController_schedule: {
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
                "application/json": components["schemas"]["ScheduleCoordinateInspectionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CoordinateInspectionRequestDto"];
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
    CoordinateInspectionController_progress: {
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
                "application/json": components["schemas"]["ProgressCoordinateInspectionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CoordinateInspectionRequestDto"];
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
    SupplierPerformanceController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                profileId?: string;
                month?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["SupplierPerformancePageDto"];
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
    SupplierPerformanceController_create: {
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
                "application/json": components["schemas"]["CreateSupplierPerformanceCardDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPerformanceCardDto"];
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
    SupplierPerformanceController_publish: {
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
                "application/json": components["schemas"]["PublishSupplierPerformanceCardDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPerformanceCardDto"];
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
    SupplierPerformanceAppealController_list: {
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
                    "application/json": components["schemas"]["SupplierPerformanceAppealPageDto"];
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
    SupplierPerformanceAppealController_create: {
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
                "application/json": components["schemas"]["CreateSupplierPerformanceAppealDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPerformanceAppealDto"];
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
    SupplierPerformanceAppealController_submit: {
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
                "application/json": components["schemas"]["SupplierPerformanceAppealTransitionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPerformanceAppealDto"];
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
    SupplierPerformanceAppealController_review: {
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
                "application/json": components["schemas"]["SupplierPerformanceAppealTransitionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPerformanceAppealDto"];
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
    SupplierPerformancePortalCardController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                profileId?: string;
                month?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["SupplierPerformancePageDto"];
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
    SupplierPerformancePortalAppealController_list: {
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
                    "application/json": components["schemas"]["SupplierPerformanceAppealPageDto"];
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
    SupplierPerformancePortalAppealController_create: {
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
                "application/json": components["schemas"]["CreateSupplierPerformanceAppealDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPerformanceAppealDto"];
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
    SupplierPerformancePortalAppealController_submit: {
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
                "application/json": components["schemas"]["SupplierPerformanceAppealTransitionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPerformanceAppealDto"];
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
    SupplierConcessionController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                inspectionId?: string;
                status?: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "RELEASED" | "WITHDRAWN";
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["ConcessionPageDto"];
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
    SupplierConcessionController_create: {
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
                "application/json": components["schemas"]["CreateConcessionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConcessionRecordDto"];
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
    SupplierConcessionController_detail: {
        parameters: {
            query: {
                organizationId: string;
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
                    "application/json": components["schemas"]["ConcessionDetailDto"];
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
    SupplierConcessionController_submit: {
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
                "application/json": components["schemas"]["ConcessionVersionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConcessionRecordDto"];
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
    SupplierConcessionController_withdraw: {
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
                "application/json": components["schemas"]["ConcessionVersionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConcessionRecordDto"];
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
    SupplierConcessionController_approve: {
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
                "application/json": components["schemas"]["DecideConcessionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConcessionRecordDto"];
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
    SupplierConcessionController_reject: {
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
                "application/json": components["schemas"]["DecideConcessionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConcessionRecordDto"];
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
    SupplierConcessionController_release: {
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
                "application/json": components["schemas"]["DecideConcessionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConcessionRecordDto"];
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
    AnnouncementController_mine: {
        parameters: {
            query?: {
                organizationId?: string;
                unreadOnly?: "true" | "false";
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
                    "application/json": components["schemas"]["AnnouncementMinePageDto"];
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
    AnnouncementController_manage: {
        parameters: {
            query?: {
                organizationId?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["AnnouncementManagePageDto"];
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
    AnnouncementController_audienceUsers: {
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
                    "application/json": components["schemas"]["AnnouncementAudienceUsersDto"];
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
    AnnouncementController_receipts: {
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
                    "application/json": components["schemas"]["AnnouncementReceiptDto"][];
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
    AnnouncementController_create: {
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
                "application/json": components["schemas"]["AnnouncementInputDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnnouncementResponseDto"];
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
    AnnouncementController_update: {
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
                "application/json": components["schemas"]["UpdateAnnouncementDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnnouncementResponseDto"];
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
    AnnouncementController_publish: {
        parameters: {
            query?: {
                organizationId?: string;
            };
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
                "application/json": components["schemas"]["AnnouncementVersionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnnouncementResponseDto"];
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
    AnnouncementController_archive: {
        parameters: {
            query?: {
                organizationId?: string;
            };
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
                "application/json": components["schemas"]["AnnouncementVersionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnnouncementResponseDto"];
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
    AnnouncementController_read: {
        parameters: {
            query?: {
                organizationId?: string;
            };
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
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnnouncementReadDto"];
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
    AuditStandardsController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                auditType?: "SYSTEM" | "PROCESS" | "PRODUCT" | "SECOND_PARTY" | "CUSTOMER";
                search?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["AuditStandardPageDto"];
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
    AuditStandardsController_create: {
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
                "application/json": components["schemas"]["CreateAuditStandardDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditTemplateResponseDto"];
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
    AuditStandardsController_detail: {
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
                    "application/json": components["schemas"]["AuditStandardDetailDto"];
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
    AuditStandardsController_updateDraft: {
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
                "application/json": components["schemas"]["UpdateAuditStandardDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditTemplateResponseDto"];
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
    AuditStandardsController_revise: {
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
                "application/json": components["schemas"]["UpdateAuditStandardDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditTemplateResponseDto"];
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
    AuditStandardsController_publish: {
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
                "application/json": components["schemas"]["PublishAuditTemplateDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublishedAuditTemplateResponseDto"];
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
    SupplierAdmissionController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                profileId?: string;
                status?: "DRAFT" | "SUBMITTED" | "NEEDS_CHANGES" | "ACCEPTED";
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["SupplierAdmissionPageDto"];
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
    SupplierAdmissionController_detail: {
        parameters: {
            query: {
                organizationId: string;
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
                    "application/json": components["schemas"]["SupplierAdmissionDetailDto"];
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
    SupplierAdmissionController_review: {
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
                "application/json": components["schemas"]["ReviewSupplierAdmissionDocumentDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierAdmissionDocumentDto"];
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
    SupplierAdmissionPortalController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                profileId?: string;
                status?: "DRAFT" | "SUBMITTED" | "NEEDS_CHANGES" | "ACCEPTED";
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["SupplierAdmissionPageDto"];
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
    SupplierAdmissionPortalController_create: {
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
                "application/json": components["schemas"]["CreateSupplierAdmissionDocumentDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierAdmissionDocumentDto"];
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
    SupplierAdmissionPortalController_detail: {
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
                    "application/json": components["schemas"]["SupplierAdmissionDetailDto"];
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
    SupplierAdmissionPortalController_submit: {
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
                "application/json": components["schemas"]["SubmitSupplierAdmissionDocumentDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierAdmissionDocumentDto"];
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
    ESignatureController_summary: {
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
                    "application/json": components["schemas"]["ESignatureSummaryDto"][];
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
    ESignatureController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                status?: "ACTIVE" | "REVOKED";
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["ESignaturePageDto"];
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
    ESignatureController_register: {
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
                "application/json": components["schemas"]["RegisterESignatureDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ESignatureDto"];
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
    ESignatureController_revoke: {
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
                "application/json": components["schemas"]["RevokeESignatureDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ESignatureDto"];
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
    ESignatureController_approvals: {
        parameters: {
            query: {
                organizationId?: string;
                resourceType: string;
                resourceId: string;
                resourceVersion: number;
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
                    "application/json": components["schemas"]["ApprovalSignatureDto"][];
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
    ESignatureController_signApproval: {
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
                "application/json": components["schemas"]["SignApprovalDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalSignatureDto"];
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
    SupplierAuditController_listPlans: {
        parameters: {
            query?: {
                organizationId?: string;
                profileId?: string;
                year?: number;
                status?: "PLANNED" | "SUBMITTED" | "CLOSED" | "CANCELLED" | "DRAFT" | "SUBMITTED" | "CLOSED";
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["SupplierAuditPlanPageDto"];
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
    SupplierAuditController_createPlan: {
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
                "application/json": components["schemas"]["CreateSupplierAuditPlanDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierAuditPlanDto"];
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
    SupplierAuditController_submitPlan: {
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
                "application/json": components["schemas"]["SupplierAuditTransitionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierAuditPlanDto"];
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
    SupplierAuditController_listRecords: {
        parameters: {
            query?: {
                organizationId?: string;
                profileId?: string;
                year?: number;
                status?: "PLANNED" | "SUBMITTED" | "CLOSED" | "CANCELLED" | "DRAFT" | "SUBMITTED" | "CLOSED";
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["SupplierAuditRecordPageDto"];
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
    SupplierAuditController_createRecord: {
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
                "application/json": components["schemas"]["CreateSupplierAuditRecordDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierAuditRecordDto"];
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
    SupplierAuditController_getChecklist: {
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
                    "application/json": components["schemas"]["SupplierAuditChecklistDto"];
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
    SupplierAuditController_updateChecklist: {
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
                "application/json": components["schemas"]["UpdateSupplierAuditChecklistDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierAuditChecklistDto"];
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
    SupplierAuditController_submitRecord: {
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
                "application/json": components["schemas"]["SupplierAuditTransitionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierAuditRecordDto"];
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
    SupplierAuditController_closeRecord: {
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
                "application/json": components["schemas"]["CloseSupplierAuditRecordDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierAuditRecordDto"];
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
    SupplierQualityTargetsController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                profileId?: string;
                year?: number;
                periodType?: "ANNUAL" | "MONTHLY";
                status?: "DRAFT" | "SUBMITTED" | "APPROVED" | "PUBLISHED" | "RETIRED";
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["SupplierQualityTargetPageDto"];
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
    SupplierQualityTargetsController_create: {
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
                "application/json": components["schemas"]["CreateSupplierQualityTargetDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierQualityTargetDto"];
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
    SupplierQualityTargetsController_submit: {
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
                "application/json": components["schemas"]["SupplierQualityTargetTransitionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierQualityTargetDto"];
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
    SupplierQualityTargetsController_approve: {
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
                "application/json": components["schemas"]["ApproveSupplierQualityTargetDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierQualityTargetDto"];
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
    SupplierQualityTargetsController_publish: {
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
                "application/json": components["schemas"]["PublishSupplierQualityTargetDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierQualityTargetDto"];
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
    SupplierQualityTargetsController_revise: {
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
                "application/json": components["schemas"]["ReviseSupplierQualityTargetDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierQualityTargetDto"];
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
    SupplierQualityTargetsController_actualHistory: {
        parameters: {
            query?: {
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["SupplierQualityTargetActualHistoryDto"];
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
    SupplierQualityTargetsController_recordActual: {
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
                "application/json": components["schemas"]["RecordSupplierQualityTargetActualDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierQualityTargetActualDto"];
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
    SupplierMeetingsController_list: {
        parameters: {
            query?: {
                profileId?: string;
                status?: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["SupplierMeetingPageDto"];
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
    SupplierMeetingsController_create: {
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
                "application/json": components["schemas"]["CreateSupplierMeetingDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierMeetingDto"];
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
    SupplierMeetingsController_start: {
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
                "application/json": components["schemas"]["SupplierMeetingTransitionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierMeetingDto"];
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
    SupplierMeetingsController_complete: {
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
                "application/json": components["schemas"]["SupplierMeetingTransitionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierMeetingDto"];
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
    SupplierMeetingsController_createTopic: {
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
                "application/json": components["schemas"]["CreateSupplierMeetingTopicDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierMeetingTopicDto"];
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
    SupplierMeetingsController_concludeTopic: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
                topicId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConcludeSupplierMeetingTopicDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierMeetingTopicDto"];
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
    SupplierMeetingsController_createAction: {
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
                "application/json": components["schemas"]["CreateSupplierMeetingActionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierMeetingActionDto"];
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
    SupplierMeetingsController_completeAction: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
                actionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CompleteSupplierMeetingActionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierMeetingActionDto"];
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
    SupplierPpapController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                status?: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
                level?: number;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["SupplierPpapPageDto"];
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
    SupplierPpapController_create: {
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
                "application/json": components["schemas"]["CreateSupplierPpapDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPpapDto"];
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
    SupplierPpapController_detail: {
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
                    "application/json": components["schemas"]["SupplierPpapDto"];
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
    SupplierPpapController_addItem: {
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
                "application/json": components["schemas"]["CreateSupplierPpapItemDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPpapItemDto"];
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
    SupplierPpapController_bindEvidence: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
                itemId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SupplierPpapEvidenceDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPpapItemDto"];
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
    SupplierPpapController_reviewItem: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
                "x-csrf-token": string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
                itemId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReviewSupplierPpapItemDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPpapItemDto"];
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
    SupplierPpapController_submit: {
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
                "application/json": components["schemas"]["SupplierPpapTransitionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPpapDto"];
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
    SupplierPpapController_review: {
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
                "application/json": components["schemas"]["ReviewSupplierPpapDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPpapDto"];
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
    SupplierPpapController_requalify: {
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
                "application/json": components["schemas"]["RequalifySupplierPpapDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPpapDto"];
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
    SupplierInspectionStandardsController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                profileId?: string;
                materialCode?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["SupplierInspectionStandardPageDto"];
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
    SupplierInspectionStandardsController_create: {
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
                "application/json": components["schemas"]["CreateSupplierInspectionStandardDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierInspectionStandardDto"];
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
    SupplierInspectionStandardsController_detail: {
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
                    "application/json": components["schemas"]["SupplierInspectionStandardDto"];
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
    SupplierInspectionStandardsController_addItem: {
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
                "application/json": components["schemas"]["CreateSupplierInspectionStandardItemDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierInspectionStandardItemDto"];
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
    SupplierInspectionStandardsController_publish: {
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
                "application/json": components["schemas"]["SupplierInspectionStandardTransitionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierInspectionStandardDto"];
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
    SupplierBarcodeController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                profileId?: string;
                materialCode?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["SupplierBarcodeRulePageDto"];
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
    SupplierBarcodeController_create: {
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
                "application/json": components["schemas"]["CreateSupplierBarcodeRuleDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierBarcodeRuleDto"];
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
    SupplierBarcodeController_detail: {
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
                    "application/json": components["schemas"]["SupplierBarcodeRuleDto"];
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
    SupplierBarcodeController_publish: {
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
                "application/json": components["schemas"]["SupplierBarcodeTransitionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierBarcodeRuleDto"];
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
    SupplierBarcodeController_scan: {
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
                "application/json": components["schemas"]["ScanSupplierBarcodeDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierBarcodeScanDto"];
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
    SupplierAsnController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                profileId?: string;
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["SupplierAsnPageDto"];
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
    SupplierAsnController_create: {
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
                "application/json": components["schemas"]["CreateSupplierAsnDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierAsnDto"];
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
    SupplierAsnController_detail: {
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
                    "application/json": components["schemas"]["SupplierAsnDto"];
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
    SupplierAsnController_updateEvidence: {
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
                "application/json": components["schemas"]["UpdateSupplierAsnEvidenceDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierAsnDto"];
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
    SupplierAsnController_submit: {
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
                "application/json": components["schemas"]["SupplierAsnTransitionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierAsnDto"];
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
    SupplierPcnController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                status?: "DRAFT" | "SUBMITTED" | "NEEDS_CHANGES" | "APPROVED" | "CLOSED";
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["SupplierPcnPageDto"];
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
    SupplierPcnController_detail: {
        parameters: {
            query: {
                organizationId: string;
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
                    "application/json": components["schemas"]["SupplierPcnDetailDto"];
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
    SupplierPcnController_start: {
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
                "application/json": components["schemas"]["StartSupplierPcnWorkflowDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPcnDetailDto"];
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
    SupplierPcnController_review: {
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
                "application/json": components["schemas"]["ReviewSupplierPcnDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPcnDto"];
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
    SupplierPcnPortalController_list: {
        parameters: {
            query?: {
                organizationId?: string;
                status?: "DRAFT" | "SUBMITTED" | "NEEDS_CHANGES" | "APPROVED" | "CLOSED";
                page?: components["schemas"]["Object"];
                pageSize?: components["schemas"]["Object"];
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
                    "application/json": components["schemas"]["SupplierPcnPageDto"];
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
    SupplierPcnPortalController_create: {
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
                "application/json": components["schemas"]["CreateSupplierPcnDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPcnDto"];
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
    SupplierPcnPortalController_profiles: {
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
                    "application/json": components["schemas"]["SupplierPcnProfilesDto"];
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
    SupplierPcnPortalController_detail: {
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
                    "application/json": components["schemas"]["SupplierPcnDetailDto"];
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
    SupplierPcnPortalController_update: {
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
                "application/json": components["schemas"]["UpdateSupplierPcnDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPcnDto"];
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
    SupplierPcnPortalController_submit: {
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
                "application/json": components["schemas"]["SubmitSupplierPcnDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPcnDto"];
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
    SupplierPcnPortalController_advance: {
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
                "application/json": components["schemas"]["AdvanceSupplierPcnDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplierPcnDto"];
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
