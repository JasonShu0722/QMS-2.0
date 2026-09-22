export type Page = 'workbench' | 'analytics' | 'ledger' | 'workspace';
export type WorkTab = { id: string; page: Page; title: string; recordId?: string };
export type Draft = { cause: string; escape: string; saved: boolean; submitted: boolean; dirty: boolean; node: number | null; workspaceTab: string };
export type PageProps = {
  page: Page;
  recordId?: string;
  navigate: (page: Page, recordId?: string) => void;
  focusMode: boolean;
  setFocusMode: (enabled: boolean) => void;
  initialDraft?: Draft;
  onDraftChange: (draft: Draft) => void;
};

export const records = [
  { id: 'Q-2026-0842', title: '前端盖装配间隙超差', source: '客户反馈', owner: '陈明', due: '今天 17:00', status: '根因分析', urgent: true },
  { id: 'Q-2026-0836', title: '来料连接器端子氧化', source: '来料检验', owner: '李晓', due: '明天 12:00', status: '根因分析', urgent: false },
  { id: 'Q-2026-0831', title: '总成耐压测试异常', source: '过程检验', owner: '王磊', due: '09/23', status: '根因分析', urgent: false },
  { id: 'Q-2026-0825', title: '包装标签批次信息缺失', source: '出货检验', owner: '赵悦', due: '09/24', status: '根因分析', urgent: false },
  { id: 'Q-2026-0819', title: '壳体表面防护不良', source: '过程检验', owner: '孙宁', due: '09/25', status: '根因分析', urgent: false },
  { id: 'Q-2026-0812', title: '供应商检验报告缺项', source: '来料检验', owner: '李晓', due: '09/26', status: '根因分析', urgent: false },
];

export const pageTitles: Record<Page, string> = { workbench: '综合工作台', analytics: '质量分析中心', ledger: '问题台账', workspace: '问题处理空间' };
export const homeTab: WorkTab = { id: 'workbench', page: 'workbench', title: pageTitles.workbench };

export function makeTab(page: Page, recordId?: string): WorkTab {
  if (page !== 'workspace') return { id: page, page, title: pageTitles[page] };
  const record = records.find(item => item.id === recordId) ?? records[0];
  return { id: `workspace:${record.id}`, page, recordId: record.id, title: record.title };
}

export function pageUrl(tab: WorkTab) {
  const url = new URL(window.location.href);
  const params = new URLSearchParams({ page: tab.page });
  if (tab.recordId) params.set('record', tab.recordId);
  if (url.protocol === 'file:') { url.search = ''; url.hash = params.toString(); }
  else { url.search = params.toString(); url.hash = ''; }
  return url.href;
}

export function tabFromUrl(): WorkTab | undefined {
  const params = new URLSearchParams(window.location.protocol === 'file:' ? window.location.hash.slice(1) : window.location.search);
  const page = params.get('page');
  if (!page || !Object.hasOwn(pageTitles, page)) return undefined;
  return makeTab(page as Page, params.get('record') ?? undefined);
}

export function readStorage(storage: 'localStorage' | 'sessionStorage', key: string): unknown {
  try { return JSON.parse(window[storage].getItem(key) ?? 'null'); } catch { return null; }
}

export function writeStorage(storage: 'localStorage' | 'sessionStorage', key: string, value: unknown) {
  try { window[storage].setItem(key, JSON.stringify(value)); } catch { }
}
