export type Preference = 'DEFAULT' | 'ENABLED' | 'DISABLED';

export function effectiveMfa(
  administrator: boolean,
  preference: Preference,
  roleRequired: boolean,
  bound: boolean,
): boolean {
  if (administrator && preference !== 'DEFAULT') return preference === 'ENABLED';
  return administrator || roleRequired || bound;
}
