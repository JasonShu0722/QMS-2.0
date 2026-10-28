import { describe, expect, it } from 'vitest';
import { dateEditable, initialDemo, transition } from './model';
import type { Actor, Demo, Duty, Risk } from './model';

function released(risk: Risk = 'HIGH', samePerson = false) {
  let s = initialDemo();
  s = transition(s, 'SQE', { type: 'configure', risk, samePerson, portal: true });
  s = transition(s, 'SQE', { type: 'date', stage: 'ANALYSIS', date: '2026-11-02' });
  s = transition(s, 'SQE', { type: 'date', stage: 'CLOSURE', date: '2026-11-16' });
  return transition(s, 'SQE', { type: 'release', confirmed: true });
}
function submitted(risk: Risk = 'HIGH', samePerson = false) {
  let s = released(risk, samePerson);
  s = transition(s, 'SUPPLIER', { type: 'edit', body: '演示完整 D2～D8 摘要 v1', measuresReady: true });
  s = transition(s, 'SUPPLIER', { type: 'date', stage: 'SUBMISSION', date: '2026-11-09' });
  return transition(s, 'SUPPLIER', { type: 'submit' });
}
const review = (s: Demo, actor: Actor, duty: Duty | 'BOTH', result: 'APPROVED' | 'RETURNED' = 'APPROVED', round = s.round, confirmed = false) =>
  transition(s, actor, { type: 'review', duty, result, round, confirmed, reason: result === 'RETURNED' ? '请补充验证记录' : '演示审阅意见' });
function closed() {
  let s = submitted('LOW');
  s = review(s, 'SQE', 'SQE');
  return review(s, 'MANAGER', 'MANAGER');
}

describe('supplier preview lifecycle (memory only)', () => {
  it('requires explicit SQE release, dates and a configured portal, without copying source secrets', () => {
    const start = initialDemo();
    expect(start.disclosure).not.toMatch(/VIN|客户名称|联系方式|内部分析/);
    expect(transition(start, 'SQE', { type: 'release', confirmed: true })).toBe(start);
    const ready = released();
    expect(ready.status).toBe('FILLING');
    expect(transition(ready, 'SQE', { type: 'disclosure', text: '不可改释放快照' })).toBe(ready);
    const draft = { ...ready, status: 'DRAFT' as const };
    expect(transition(draft, 'SQE', { type: 'release', confirmed: false })).toBe(draft);
    expect(transition({ ...draft, portal: false }, 'SQE', { type: 'release', confirmed: true }).status).toBe('DRAFT');
    expect(transition(draft, 'SUPPLIER', { type: 'release', confirmed: true })).toBe(draft);
  });

  it.each(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const)('%s starts SQE only, locks submitted body and opens the correct management duties', risk => {
    let s = submitted(risk);
    expect(s.status).toBe('SQE_PENDING');
    expect(s.round).toBe(1);
    for (const actor of ['SUPPLIER', 'SQE', 'MANAGER'] as const) {
      expect(transition(s, actor, { type: 'edit', body: 'overwrite', measuresReady: true })).toBe(s);
      expect(transition(s, actor, { type: 'date', stage: 'SUBMISSION', date: '2026-12-01' })).toBe(s);
    }
    expect(review(s, 'MANAGER', 'MANAGER')).toBe(s);
    expect(review(s, 'MINISTER', 'MINISTER')).toBe(s);
    s = review(s, 'SQE', 'SQE');
    expect(s.status).toBe('MANAGEMENT_PENDING');
    expect(review(s, 'OTHER_MANAGER', 'MANAGER')).toBe(s);
    if (risk === 'HIGH' || risk === 'CRITICAL') {
      s = review(s, 'MINISTER', 'MINISTER');
      expect(s.status).toBe('MANAGEMENT_PENDING');
    } else expect(review(s, 'MINISTER', 'MINISTER')).toBe(s);
    s = review(s, 'MANAGER', 'MANAGER');
    expect(s.status).toBe('CLOSED');
    expect(s.approved).toBe('演示完整 D2～D8 摘要 v1');
  });

  it('requires both-duty confirmation for the same person and writes two records for one operation/version/round', () => {
    let s = review(submitted('CRITICAL', true), 'SQE', 'SQE');
    expect(review(s, 'MANAGER', 'BOTH')).toBe(s);
    expect(review(s, 'MANAGER', 'MANAGER')).toBe(s);
    expect(review(s, 'MINISTER', 'BOTH', 'APPROVED', s.round, true)).toBe(s);
    s = review(s, 'MANAGER', 'BOTH', 'APPROVED', s.round, true);
    expect(s.status).toBe('CLOSED');
    const management = s.records.filter(r => r.duty !== 'SQE');
    expect(management.map(r => r.duty)).toEqual(['MANAGER', 'MINISTER']);
    expect(new Set(management.map(r => `${r.operation}/${r.round}/${r.body}/${r.actor}`)).size).toBe(1);
    expect(review(s, 'MANAGER', 'BOTH', 'APPROVED', s.round, true)).toBe(s);
  });

  it.each(['SQE', 'MANAGER', 'MINISTER'] as const)('any %s return invalidates the round; resubmission resets SQE and both management duties', duty => {
    let s = submitted();
    if (duty !== 'SQE') s = review(s, 'SQE', 'SQE');
    if (duty === 'MINISTER') s = review(s, 'MANAGER', 'MANAGER');
    s = review(s, duty, duty, 'RETURNED');
    expect(s.status).toBe('RETURNED');
    const oldRecords = s.records;
    expect(review(s, 'MINISTER', 'MINISTER')).toBe(s);
    s = transition(s, 'SUPPLIER', { type: 'edit', body: '重新提交 v2', measuresReady: true });
    s = transition(s, 'SUPPLIER', { type: 'submit' });
    expect(s.status).toBe('SQE_PENDING');
    expect(s.round).toBe(2);
    expect(s.records).toEqual(oldRecords);
    expect(review(s, 'MANAGER', 'MANAGER', 'APPROVED', 1)).toBe(s);
    s = review(s, 'SQE', 'SQE');
    expect(s.status).toBe('MANAGEMENT_PENDING');
    s = review(s, 'MINISTER', 'MINISTER');
    expect(s.status).toBe('MANAGEMENT_PENDING');
    s = review(s, 'MANAGER', 'MANAGER');
    expect(s.status).toBe('CLOSED');
  });

  it('rejects incomplete submission and unconfirmed countermeasures, with no default deadline', () => {
    let s = released();
    expect(s.dates.SUBMISSION).toBe('');
    expect(transition(s, 'SUPPLIER', { type: 'submit' })).toBe(s);
    expect(transition(s, 'SUPPLIER', { type: 'date', stage: 'SUBMISSION', date: '2026-11-09' })).toBe(s);
    s = transition(s, 'SUPPLIER', { type: 'edit', body: '摘要', measuresReady: true });
    expect(transition(s, 'SUPPLIER', { type: 'submit' })).toBe(s);
  });

  it.each(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const)('%s extension is separate, does not pause/change dates until final approval, never uses minister', risk => {
    let s = released(risk, true);
    const original = s.dates.ANALYSIS;
    s = transition(s, 'SUPPLIER', { type: 'extend', stage: 'ANALYSIS', date: '2026-11-05' });
    expect(s.extension?.status).toBe('SQE_PENDING');
    expect(s.dates.ANALYSIS).toBe(original);
    expect(transition(s, 'MANAGER', { type: 'extension-review', result: 'APPROVED' })).toBe(s);
    expect(transition(s, 'MINISTER', { type: 'extension-review', result: 'APPROVED' })).toBe(s);
    s = transition(s, 'SQE', { type: 'extension-review', result: 'APPROVED' });
    if (risk === 'HIGH' || risk === 'CRITICAL') {
      expect(s.extension?.status).toBe('MANAGER_PENDING');
      expect(s.dates.ANALYSIS).toBe(original);
      s = transition(s, 'MANAGER', { type: 'extension-review', result: 'APPROVED' });
    }
    expect(s.extension?.status).toBe('APPROVED');
    expect(s.extension?.original).toBe(original);
    expect(s.dates.ANALYSIS).toBe('2026-11-05');
    expect(s.status).toBe('FILLING');
    expect(s.records).toEqual([]);
  });

  it('preserves original dates for returned/invalid extensions and blocks in-review editing', () => {
    let s = released();
    for (const date of ['2026-02-30', '2026-11-01', '']) expect(transition(s, 'SUPPLIER', { type: 'extend', stage: 'ANALYSIS', date })).toBe(s);
    s = transition(s, 'SUPPLIER', { type: 'extend', stage: 'ANALYSIS', date: '2026-11-05' });
    s = transition(s, 'SQE', { type: 'extension-review', result: 'RETURNED' });
    expect(s.dates.ANALYSIS).toBe('2026-11-02');
    expect(s.extension?.status).toBe('RETURNED');
    const locked = submitted();
    expect(transition(locked, 'SUPPLIER', { type: 'extend', stage: 'SUBMISSION', date: '2026-11-12' })).toBe(locked);
  });

  it('locks ordinary submission-date edits throughout pending extension approval and applies only the approved request', () => {
    let s = released();
    s = transition(s, 'SUPPLIER', { type: 'edit', body: '摘要', measuresReady: true });
    s = transition(s, 'SUPPLIER', { type: 'date', stage: 'SUBMISSION', date: '2026-11-09' });
    s = transition(s, 'SUPPLIER', { type: 'extend', stage: 'SUBMISSION', date: '2026-11-12' });
    expect(s.extension?.status).toBe('SQE_PENDING');
    const managerPending = transition(s, 'SQE', { type: 'extension-review', result: 'APPROVED' });
    expect(managerPending.extension?.status).toBe('MANAGER_PENDING');
    for (const state of [managerPending, s]) {
      for (const date of ['2026-11-20', '2026-11-08', '']) {
        expect(transition(state, 'SUPPLIER', { type: 'date', stage: 'SUBMISSION', date })).toBe(state);
      }
      expect(state.dates.SUBMISSION).toBe('2026-11-09');
    }
    s = transition(managerPending, 'MANAGER', { type: 'extension-review', result: 'APPROVED' });
    expect(s.extension?.status).toBe('APPROVED');
    expect(s.extension?.original).toBe('2026-11-09');
    expect(s.dates.SUBMISSION).toBe('2026-11-12');
  });

  it('never postpones or clears an existing effective date through ordinary edits, even without a pending extension', () => {
    let s = released();
    s = transition(s, 'SUPPLIER', { type: 'edit', body: '摘要', measuresReady: true });
    s = transition(s, 'SUPPLIER', { type: 'date', stage: 'SUBMISSION', date: '2026-11-09' });
    const requested = transition(s, 'SUPPLIER', { type: 'extend', stage: 'SUBMISSION', date: '2026-11-12' });
    const returned = transition(requested, 'SQE', { type: 'extension-review', result: 'RETURNED' });
    const approved = transition(transition(requested, 'SQE', { type: 'extension-review', result: 'APPROVED' }), 'MANAGER', { type: 'extension-review', result: 'APPROVED' });
    for (const state of [s, returned, approved, { ...s, status: 'RETURNED' as const }]) {
      for (const date of ['2026-11-20', '']) {
        expect(transition(state, 'SUPPLIER', { type: 'date', stage: 'SUBMISSION', date })).toBe(state);
      }
      expect(transition(state, 'SUPPLIER', { type: 'date', stage: 'SUBMISSION', date: '2026-11-08' }).dates.SUBMISSION).toBe('2026-11-08');
    }
  });

  it('rejects malformed dates without throwing and lets draft dates be cleared', () => {
    const s = initialDemo();
    expect(transition(s, 'SQE', { type: 'date', stage: 'ANALYSIS', date: '2026-99-99' })).toBe(s);
    const ready = { ...s, dates: { ...s.dates, ANALYSIS: '2026-11-02' } };
    expect(transition(ready, 'SQE', { type: 'date', stage: 'ANALYSIS', date: '' }).dates.ANALYSIS).toBe('');
  });

  it('does not approve an old-stage extension after a new locked submission', () => {
    let s = released();
    s = transition(s, 'SUPPLIER', { type: 'extend', stage: 'ANALYSIS', date: '2026-11-05' });
    s = transition(s, 'SUPPLIER', { type: 'edit', body: '已完成的表单摘要', measuresReady: true });
    s = transition(s, 'SUPPLIER', { type: 'date', stage: 'SUBMISSION', date: '2026-11-09' });
    s = transition(s, 'SUPPLIER', { type: 'submit' });
    expect(s.status).toBe('SQE_PENDING');
    expect(transition(s, 'SQE', { type: 'extension-review', result: 'APPROVED' })).toBe(s);
  });

  it('allows closed supplements only to this SQE/local manager, preserving approval, risk, closure time and duties', () => {
    const s = closed();
    expect(s.status).toBe('CLOSED');
    for (const actor of ['SUPPLIER', 'MINISTER', 'OTHER_MANAGER'] as const) expect(transition(s, actor, { type: 'supplement', text: '资料补充' })).toBe(s);
    for (const actor of ['SQE', 'MANAGER'] as const) {
      const next = transition(s, actor, { type: 'supplement', text: '补充验证记录说明' });
      expect(next.supplements).toEqual([{ actor, text: '补充验证记录说明' }]);
      expect({ ...next, supplements: [] }).toEqual(s);
    }
    expect(transition(submitted(), 'SQE', { type: 'supplement', text: '不得代改' }).supplements).toEqual([]);
  });

  it.each([
    ['ANALYSIS', '2026-11-05', 'SQE_PENDING'],
    ['ANALYSIS', '2026-11-05', 'MANAGER_PENDING'],
    ['SUBMISSION', '2026-11-12', 'SQE_PENDING'],
    ['SUBMISSION', '2026-11-12', 'MANAGER_PENDING'],
    ['CLOSURE', '2026-11-19', 'SQE_PENDING'],
    ['CLOSURE', '2026-11-19', 'MANAGER_PENDING'],
  ] as const)('never reactivates an old-round %s extension (%s, %s) on return or resubmission', (stage, date, pending) => {
    let s = released();
    s = transition(s, 'SUPPLIER', { type: 'edit', body: '完整摘要', measuresReady: true });
    s = transition(s, 'SUPPLIER', { type: 'date', stage: 'SUBMISSION', date: '2026-11-09' });
    s = transition(s, 'SUPPLIER', { type: 'extend', stage, date });
    if (pending === 'MANAGER_PENDING') s = transition(s, 'SQE', { type: 'extension-review', result: 'APPROVED' });
    expect(s.extension?.status).toBe(pending);
    const history = s.extension;
    const dates = s.dates;
    const submittedState = transition(s, 'SUPPLIER', { type: 'submit' });
    expect(submittedState.status).toBe('SQE_PENDING');
    expect(submittedState.extension).toEqual(history);
    for (const duty of ['SQE', 'MANAGER', 'MINISTER'] as const) {
      let returned = submittedState;
      if (duty !== 'SQE') returned = review(returned, 'SQE', 'SQE');
      returned = review(returned, duty, duty, 'RETURNED');
      expect(returned.status).toBe('RETURNED');
      for (const actor of ['SQE', 'MANAGER', 'MINISTER'] as const) {
        for (const result of ['APPROVED', 'RETURNED'] as const) {
          expect(transition(returned, actor, { type: 'extension-review', result })).toBe(returned);
        }
      }
      expect(returned.extension).toEqual(history);
      expect(returned.dates).toEqual(dates);
      expect(dateEditable(returned, 'SUPPLIER', 'SUBMISSION')).toBe(true);
      const earlier = transition(returned, 'SUPPLIER', { type: 'date', stage: 'SUBMISSION', date: '2026-11-08' });
      expect(earlier.dates.SUBMISSION).toBe('2026-11-08');
      const resubmitted = transition(earlier, 'SUPPLIER', { type: 'submit' });
      expect(resubmitted.round).toBe(2);
      const returnedAgain = review(resubmitted, 'SQE', 'SQE', 'RETURNED');
      expect(transition(returnedAgain, 'SQE', { type: 'extension-review', result: 'APPROVED' })).toBe(returnedAgain);
      expect(transition(returnedAgain, 'MANAGER', { type: 'extension-review', result: 'APPROVED' })).toBe(returnedAgain);
      expect(returnedAgain.extension).toEqual(history);
    }
  });
});
