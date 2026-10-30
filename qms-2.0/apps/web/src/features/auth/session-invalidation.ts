export type SessionSignal = 'invalidate' | 'revalidate';
const storageKey = 'qms:session-signal:v1';
const listeners = new Set<(signal: SessionSignal) => void>();
let channel: BroadcastChannel | undefined;
let version = 0;
export const sessionSignalVersion = () => version;
const isSignal = (value: unknown): value is SessionSignal => value === 'invalidate' || value === 'revalidate';
function receive(signal: SessionSignal) {
  if (signal === 'invalidate') version++;
  listeners.forEach(listener => listener(signal));
}
function openChannel() {
  try { return typeof BroadcastChannel === 'function' ? new BroadcastChannel(storageKey) : undefined; } catch { return undefined; }
}
function storage(event: StorageEvent) {
  if (event.key !== storageKey || !event.newValue) return;
  try {
    const value = JSON.parse(event.newValue);
    if (isSignal(value?.signal) && typeof value.nonce === 'string' && value.nonce.length <= 100 && Object.keys(value).length === 2) receive(value.signal);
  } catch { /* Malformed notifications are not authorization evidence. */ }
}
function focus() { receive('revalidate'); }
function visibility() { if (document.visibilityState === 'visible') focus(); }

export function publishSessionSignal(signal: SessionSignal): void {
  receive(signal);
  const transport = channel ?? openChannel();
  try {
    if (!transport) throw new Error('Broadcast unavailable');
    transport.postMessage(signal);
  } catch {
    try { localStorage.setItem(storageKey, JSON.stringify({ signal, nonce: crypto.randomUUID() })); } catch { /* Focus revalidation and server refusal remain authoritative. */ }
  } finally { if (transport && transport !== channel) { try { transport.close(); } catch { /* Notification cleanup cannot change the server result. */ } } }
}
export function subscribeSessionSignals(listener: (signal: SessionSignal) => void): () => void {
  if (!listeners.size) {
    channel = openChannel();
    if (channel) channel.onmessage = event => { if (isSignal(event.data)) receive(event.data); };
    window.addEventListener('storage', storage);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    if (channel) { channel.onmessage = null; try { channel.close(); } catch { /* Continue removing listeners if the platform is unavailable. */ } channel = undefined; }
    window.removeEventListener('storage', storage);
    window.removeEventListener('focus', focus);
    document.removeEventListener('visibilitychange', visibility);
  };
}
