import type { AccountProfile } from '@qms/contracts';
import { useSyncExternalStore } from 'react';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

type AvatarState = Pick<AccountProfile, 'id' | 'avatarFileId' | 'avatarVersion'>;
let state: AvatarState | null = null;
let epoch = 0;
const listeners = new Set<() => void>();
export const accountAvatarEpoch = () => epoch;
export function clearAccountAvatar() {
  epoch += 1;
  state = null;
  listeners.forEach((notify) => notify());
}
export function publishAccountAvatar(profile: AccountProfile, expectedEpoch: number) {
  if (expectedEpoch !== epoch) return;
  if (state?.id === profile.id && state.avatarVersion > profile.avatarVersion) return;
  state = { id: profile.id, avatarFileId: profile.avatarFileId, avatarVersion: profile.avatarVersion };
  listeners.forEach((notify) => notify());
}
export function useAccountAvatar() {
  return useSyncExternalStore((notify) => { listeners.add(notify); return () => { listeners.delete(notify); }; }, () => state);
}
useWorkTabsStore.subscribe((next, previous) => {
  if (next.sessionScope !== previous.sessionScope) clearAccountAvatar();
});
