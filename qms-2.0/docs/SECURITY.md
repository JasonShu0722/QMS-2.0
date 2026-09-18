# QMS 2.0 Security Notes

## Authorization scope semantics

Phase 1 evaluates feature permissions against the authenticated user's home organization from the server-side session. A client-supplied `organizationId` cannot grant more feature permissions than the session user already has in that home organization.

Data scope is evaluated separately after the feature permission check. Suppliers can only resolve their own home organization. Internal users can resolve only organizations assigned to them on the server through `userRole`; client `organizationId` values can narrow to an assigned organization, but cannot expand the accessible set.

Requests with repeated organization scope parameters are rejected as ambiguous instead of choosing one value.

## Verification

Allowed path:

```bash
pnpm --dir qms-2.0 --filter @qms/api test -- test/authorization/supplier-isolation.e2e-spec.ts
```

Rejected paths covered by the same command:

- supplier requests for another supplier organization return `ORGANIZATION_SCOPE_DENIED`
- internal users missing the home-organization feature permission return `FEATURE_PERMISSION_DENIED` before target organization scope is evaluated
- repeated `organizationId` parameters return `ORGANIZATION_SCOPE_AMBIGUOUS`
