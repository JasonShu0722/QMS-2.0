import { createContext, useCallback, useContext, useEffect, useId } from 'react';

export interface EightDEvidenceScopeValue {
  onAccessDenied: (cause: unknown) => void;
  onPendingChange: (id: string, pending: boolean) => void;
}

export const EightDEvidenceScopeContext = createContext<EightDEvidenceScopeValue | undefined>(undefined);

export function useEightDEvidenceScope() {
  const scope = useContext(EightDEvidenceScopeContext);
  const id = useId();
  const notify = scope?.onPendingChange;
  useEffect(() => () => notify?.(id, false), [id, notify]);
  const onPendingChange = useCallback((pending: boolean) => notify?.(id, pending), [id, notify]);
  return { onAccessDenied: scope?.onAccessDenied, onPendingChange };
}
