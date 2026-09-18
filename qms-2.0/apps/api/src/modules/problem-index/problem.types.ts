export const PROBLEM_DOMAIN_CODES = ['GENERAL', 'PROCESS', 'PRODUCT', 'SERVICE', 'COMPLIANCE'] as const;
export type ProblemDomainCode = (typeof PROBLEM_DOMAIN_CODES)[number];

export const PROBLEM_STATUSES = ['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'ARCHIVED'] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

export const RESPONSE_FORMS = ['BRIEF', 'EIGHT_D'] as const;
export type ResponseForm = (typeof RESPONSE_FORMS)[number];
