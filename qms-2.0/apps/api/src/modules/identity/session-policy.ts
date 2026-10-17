export function sessionLifetimeMs(rememberMe: boolean, administrator: boolean): number {
  return (rememberMe ? (administrator ? 7 : 30) * 24 : 8) * 3_600_000;
}
