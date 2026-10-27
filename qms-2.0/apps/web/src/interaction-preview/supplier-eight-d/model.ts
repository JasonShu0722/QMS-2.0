// Preview-only state; never a production permission policy or API contract.
export type Risk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Actor = 'SQE' | 'SUPPLIER' | 'MANAGER' | 'MINISTER' | 'OTHER_MANAGER';
export type Stage = 'ANALYSIS' | 'SUBMISSION' | 'CLOSURE';
export type Duty = 'SQE' | 'MANAGER' | 'MINISTER';
export type RecordEntry = { duty: Duty; result: 'APPROVED' | 'RETURNED'; round: number; operation: number; body: string; actor: Actor; reason: string };
export type Demo = {
  status: 'DRAFT' | 'FILLING' | 'SQE_PENDING' | 'MANAGEMENT_PENDING' | 'RETURNED' | 'CLOSED';
  risk: Risk; samePerson: boolean; portal: boolean; disclosure: string; body: string; measuresReady: boolean;
  dates: Record<Stage, string>; round: number; records: RecordEntry[];
  approved: string; closedAt: string; supplements: { actor: Actor; text: string }[];
  extension: null | { stage: Stage; original: string; requested: string; status: 'SQE_PENDING' | 'MANAGER_PENDING' | 'APPROVED' | 'RETURNED' };
};
export type Action =
  | { type: 'configure'; risk: Risk; samePerson: boolean; portal: boolean }
  | { type: 'disclosure'; text: string }
  | { type: 'release'; confirmed: boolean }
  | { type: 'edit'; body: string; measuresReady: boolean }
  | { type: 'date'; stage: Stage; date: string }
  | { type: 'submit' }
  | { type: 'review'; duty: Duty | 'BOTH'; result: 'APPROVED' | 'RETURNED'; confirmed?: boolean; reason: string; round: number }
  | { type: 'extend'; stage: Stage; date: string }
  | { type: 'extension-review'; result: 'APPROVED' | 'RETURNED' }
  | { type: 'supplement'; text: string };

export function initialDemo(): Demo {
  return {
    status: 'DRAFT', risk: 'HIGH', samePerson: false, portal: true,
    disclosure: '演示物料：连接端子；批次 DEMO-S01；现象：连接松动。请核对批次并提出围堵措施。',
    body: '', measuresReady: false, dates: { ANALYSIS: '', SUBMISSION: '', CLOSURE: '' },
    round: 0, records: [], approved: '', closedAt: '', supplements: [], extension: null,
  };
}

const high = (risk: Risk) => risk === 'HIGH' || risk === 'CRITICAL';
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
export const editable = (s: Demo) => s.status === 'FILLING' || s.status === 'RETURNED';
export const managementDuties = (s: Demo): Duty[] => high(s.risk) ? ['MANAGER', 'MINISTER'] : ['MANAGER'];
export const currentRecord = (s: Demo, duty: Duty) => s.records.find(r => r.round === s.round && r.duty === duty);

export function transition(s: Demo, actor: Actor, a: Action): Demo {
  switch (a.type) {
    case 'configure':
      return s.status === 'DRAFT' && actor === 'SQE' ? { ...s, risk: a.risk, samePerson: a.samePerson, portal: a.portal } : s;
    case 'disclosure':
      return s.status === 'DRAFT' && actor === 'SQE' ? { ...s, disclosure: a.text } : s;
    case 'release':
      return s.status === 'DRAFT' && actor === 'SQE' && a.confirmed && s.portal && s.disclosure.trim() && s.dates.ANALYSIS && s.dates.CLOSURE
        ? { ...s, status: 'FILLING' } : s;
    case 'edit':
      return editable(s) && actor === 'SUPPLIER' ? { ...s, body: a.body, measuresReady: a.measuresReady } : s;
    case 'date': {
      const allowed = a.stage === 'SUBMISSION'
        ? actor === 'SUPPLIER' && editable(s) && s.measuresReady
        : actor === 'SQE' && s.status === 'DRAFT';
      return allowed && (!a.date || validDate(a.date)) ? { ...s, dates: { ...s.dates, [a.stage]: a.date } } : s;
    }
    case 'submit':
      return actor === 'SUPPLIER' && editable(s) && s.body.trim() && s.measuresReady && s.dates.SUBMISSION
        ? { ...s, status: 'SQE_PENDING', round: s.round + 1 } : s;
    case 'review': {
      if (a.round !== s.round || !a.reason.trim()) return s;
      const sqe = s.status === 'SQE_PENDING' && actor === 'SQE' && a.duty === 'SQE';
      const management = s.status === 'MANAGEMENT_PENDING';
      const both = management && high(s.risk) && s.samePerson && actor === 'MANAGER' && a.duty === 'BOTH' && a.confirmed;
      const single = management && !(s.samePerson && high(s.risk)) && a.duty !== 'BOTH' && actor === a.duty && managementDuties(s).includes(a.duty);
      if (!(sqe || both || single)) return s;
      const duties: Duty[] = both ? ['MANAGER', 'MINISTER'] : [a.duty as Duty];
      if (duties.some(d => currentRecord(s, d))) return s;
      const records = [...s.records, ...duties.map(duty => ({ duty, actor, result: a.result, round: s.round, operation: s.records.length + 1, body: s.body, reason: a.reason }))];
      if (a.result === 'RETURNED') return { ...s, status: 'RETURNED', records };
      if (sqe) return { ...s, status: 'MANAGEMENT_PENDING', records };
      const complete = managementDuties(s).every(d => records.some(r => r.round === s.round && r.duty === d && r.result === 'APPROVED'));
      return { ...s, records, ...(complete ? { status: 'CLOSED', approved: s.body, closedAt: new Date().toISOString() } as const : {}) };
    }
    case 'extend':
      return actor === 'SUPPLIER' && editable(s) && !s.extension && validDate(a.date) && s.dates[a.stage] && a.date > s.dates[a.stage]
        ? { ...s, extension: { stage: a.stage, original: s.dates[a.stage], requested: a.date, status: 'SQE_PENDING' } } : s;
    case 'extension-review': {
      const e = s.extension;
      if (!e || !editable(s) || !((e.status === 'SQE_PENDING' && actor === 'SQE') || (e.status === 'MANAGER_PENDING' && actor === 'MANAGER'))) return s;
      const status = a.result === 'RETURNED' ? 'RETURNED' : e.status === 'SQE_PENDING' && high(s.risk) ? 'MANAGER_PENDING' : 'APPROVED';
      return { ...s, extension: { ...e, status }, dates: status === 'APPROVED' ? { ...s.dates, [e.stage]: e.requested } : s.dates };
    }
    case 'supplement':
      return s.status === 'CLOSED' && (actor === 'SQE' || actor === 'MANAGER') && a.text.trim()
        ? { ...s, supplements: [...s.supplements, { actor, text: a.text.trim() }] } : s;
  }
}
