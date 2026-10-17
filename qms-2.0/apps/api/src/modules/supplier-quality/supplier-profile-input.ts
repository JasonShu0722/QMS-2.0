import { isEmail } from 'class-validator';
import { adminError } from '../../common/security/admin-mutation.service.js';

export function supplierProfileInput(input: { businessCode?: unknown; displayName?: unknown; contactName?: unknown; contactEmail?: unknown }, fallbackName?: string) {
  const name = input.displayName === undefined ? fallbackName : input.displayName;
  if (typeof input.businessCode !== 'string' || !input.businessCode.trim() || input.businessCode.trim().length > 100
    || typeof name !== 'string' || !name.trim() || name.trim().length > 200
    || (input.contactName != null && (typeof input.contactName !== 'string' || input.contactName.trim().length > 100))
    || (input.contactEmail != null && (typeof input.contactEmail !== 'string' || input.contactEmail.trim().length > 254 || (input.contactEmail.trim() && !isEmail(input.contactEmail.trim()))))) adminError('SUPPLIER_INPUT_INVALID', 400);
  return { businessCode: input.businessCode.trim(), displayName: name.trim(), contactName: typeof input.contactName === 'string' ? input.contactName.trim() || null : null, contactEmail: typeof input.contactEmail === 'string' ? input.contactEmail.trim() || null : null };
}
