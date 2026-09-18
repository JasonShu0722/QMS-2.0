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
        PermissionsResponseDto: {
            organizationId: string;
            permissions: string[];
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
        /** @enum {string} */
        ProblemStatus: "OPEN" | "IN_PROGRESS" | "PENDING" | "RESOLVED" | "CLOSED" | "ARCHIVED";
        /** @enum {string} */
        ResponseForm: "BRIEF" | "EIGHT_D";
        /** @enum {string} */
        WorkflowNodeType: "ACTION" | "APPROVAL" | "VERIFICATION" | "CC" | "REJECT" | "RETURN" | "REOPEN" | "CLOSE";
        /** @enum {string} */
        WorkflowVersionStatus: "DRAFT" | "PUBLISHED" | "RETIRED";
        /** @enum {string} */
        TaskStatus: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "OVERDUE";
        /** @enum {string} */
        NotificationStatus: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";
        /** @enum {string} */
        PlatformErrorCode: "PROBLEM_NOT_FOUND" | "NUMBERING_CONFLICT" | "WORKFLOW_VERSION_IMMUTABLE" | "WORKFLOW_NODE_FORBIDDEN" | "IDEMPOTENCY_REPLAY" | "CONCURRENCY_CONFLICT" | "AUTH_INVALID_CREDENTIALS" | "AUTH_SESSION_REQUIRED" | "AUTH_RATE_LIMITED" | "CSRF_INVALID" | "FEATURE_PERMISSION_DENIED" | "ORGANIZATION_SCOPE_AMBIGUOUS" | "ORGANIZATION_SCOPE_DENIED" | "WORKFLOW_PERMISSION_REQUIRED";
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
}
