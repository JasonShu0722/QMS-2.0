export type Preference = 'DEFAULT' | 'ENABLED' | 'DISABLED';

export function effectiveMfa(
  administrator: boolean,
  preference: Preference,
  roleRequired: boolean,
  _bound: boolean,
  override: boolean | null = null,
): boolean {
  if (override !== null) return override;
  if (administrator && preference !== 'DEFAULT') return preference === 'ENABLED';
  return administrator || roleRequired;
}
