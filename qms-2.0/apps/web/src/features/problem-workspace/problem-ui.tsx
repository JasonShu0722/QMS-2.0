import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { ProblemWorkspace } from './problem-workspace-api';

export type ProblemDomainUiProps = { workspace: ProblemWorkspace; refresh: () => void };
export type ProblemDomainUiRegistry = Readonly<Record<string, ComponentType<ProblemDomainUiProps>>>;
const DomainUiContext = createContext<ProblemDomainUiRegistry>({});

export function ProblemDomainUiProvider({ registry, children }: { registry: ProblemDomainUiRegistry; children: ReactNode }) {
  return <DomainUiContext.Provider value={registry}>{children}</DomainUiContext.Provider>;
}
export function useProblemDomainUi(key?: string) {
  const registry = useContext(DomainUiContext);
  return key && Object.hasOwn(registry, key) ? registry[key] : undefined;
}
