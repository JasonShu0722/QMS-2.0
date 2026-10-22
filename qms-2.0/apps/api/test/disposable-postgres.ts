export function isDisposableLoopbackPostgres(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && url.port !== '55440' && !url.search && !url.hash;
  } catch {
    return false;
  }
}
