export type ProfileFields = { fullName?: string | null; phone?: string | null; email?: string | null };

export function profileData(input: ProfileFields) {
  return {
    ...(input.fullName !== undefined ? { fullName: input.fullName?.trim() || null } : {}),
    ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
    ...(input.email !== undefined ? { email: input.email?.trim().toLowerCase() || null } : {}),
  };
}
