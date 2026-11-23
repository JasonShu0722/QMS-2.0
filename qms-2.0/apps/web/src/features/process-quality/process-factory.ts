import type { components } from '@qms/contracts';

type FactoryCode = components['schemas']['CreateProcessDefectDto']['factoryCode'];

export const factoryFieldLabel = ['工厂', 'Factory'] as const;
export const factoryChoices: [code: FactoryCode, zh: string, en: string][] = [
  ['FACTORY_1', '一工厂', 'Factory 1'], ['FACTORY_2', '二工厂', 'Factory 2'],
];

export function factoryLabel(value: string | null | undefined, english: boolean) {
  return factoryChoices.find(([code]) => code === value)?.[english ? 2 : 1] ?? '/';
}

export function factoryIssue(code: string, english: boolean) {
  if (code === 'factory:EMPTY') return english ? 'Factory source value is missing' : '工厂来源值为空';
  if (code === 'factory:INVALID') return english ? 'Factory source value is invalid' : '工厂来源值无效';
}
