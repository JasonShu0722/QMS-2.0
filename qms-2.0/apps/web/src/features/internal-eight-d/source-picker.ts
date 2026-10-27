import type { components } from '@qms/contracts';
import type { ReactNode } from 'react';
import type { EightDRead } from '../process-eight-d/eight-d';

export type InternalEightDReport = components['schemas']['CustomerEightDReportDto'] | components['schemas']['NewProductEightDReportDto'];
export type InternalEightDSourceChange = Pick<components['schemas']['CustomerEightDSourcesDto'], 'add' | 'removeSourceIds' | 'primarySourceId' | 'sourceConfirmations'>
  | Pick<components['schemas']['NewProductEightDSourcesDto'], 'add' | 'removeSourceIds' | 'primarySourceId' | 'sourceConfirmations'>;

// The caller owns the real customer ledger / new-product selection, including preview confirmations.
export type InternalEightDSourcePickerProps = {
  domain: 'customer' | 'new-product'; report: InternalEightDReport; read: EightDRead; disabled: boolean;
  onChange: (change?: InternalEightDSourceChange) => void;
};
export type RenderInternalEightDSourcePicker = (props: InternalEightDSourcePickerProps) => ReactNode;
