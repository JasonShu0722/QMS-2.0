export interface paths {
    "/api/v1/test/neutral-problems/{id}/process": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NeutralProblemProcessController_process"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/test/neutral-problems/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NeutralProblemProcessController_approve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/test/neutral-problems/{id}/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NeutralProblemProcessController_verify"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/test/neutral-problems/{id}/projection-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NeutralProblemProjectionController_status"];
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
        NeutralProblemProcessRequestDto: {
            /** Format: uuid */
            instanceId: string;
            /** Format: uuid */
            workflowVersionId: string;
            /** Format: uuid */
            currentNodeId: string;
            expectedProblemVersion: number;
            expectedInstanceVersion: number;
            expectedDomainVersion: number;
            resolution: string;
            evidenceFileIds: string[];
        };
        NeutralProblemProcessResponseDto: {
            /** Format: uuid */
            problemId: string;
            /** Format: uuid */
            instanceId: string;
            /** Format: uuid */
            workflowVersionId: string;
            /** Format: uuid */
            currentNodeId: string;
            /** Format: uuid */
            revisionId: string;
            problemVersion: number;
            instanceVersion: number;
            domainVersion: number;
        };
        NeutralProblemReviewRequestDto: {
            /** Format: uuid */
            instanceId: string;
            /** Format: uuid */
            workflowVersionId: string;
            /** Format: uuid */
            currentNodeId: string;
            expectedProblemVersion: number;
            expectedInstanceVersion: number;
            expectedDomainVersion: number;
            note: string;
        };
        NeutralProblemProjectionStatusDto: {
            /** Format: uuid */
            outboxEventId: string;
            /** @enum {string} */
            outboxStatus: "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED";
            taskCount: number;
            notificationCount: number;
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
    NeutralProblemProcessController_process: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
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
                "application/json": components["schemas"]["NeutralProblemProcessRequestDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NeutralProblemProcessResponseDto"];
                };
            };
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    NeutralProblemProcessController_approve: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
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
                "application/json": components["schemas"]["NeutralProblemReviewRequestDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NeutralProblemProcessResponseDto"];
                };
            };
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    NeutralProblemProcessController_verify: {
        parameters: {
            query?: {
                organizationId?: string;
            };
            header: {
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
                "application/json": components["schemas"]["NeutralProblemReviewRequestDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NeutralProblemProcessResponseDto"];
                };
            };
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    NeutralProblemProjectionController_status: {
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
                    "application/json": components["schemas"]["NeutralProblemProjectionStatusDto"];
                };
            };
            default: {
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
