export interface PpapTemplateItem { code: string; title: string }

// Internal submission checklist. Level 4 is completed with customer specified custom items.
const ALL: PpapTemplateItem[] = [
  { code: 'DESIGN_RECORD', title: '设计记录' },
  { code: 'ENGINEERING_CHANGE', title: '工程变更文件' },
  { code: 'CUSTOMER_APPROVAL', title: '客户工程批准' },
  { code: 'DESIGN_FMEA', title: '设计 FMEA' },
  { code: 'PROCESS_FLOW', title: '过程流程图' },
  { code: 'PROCESS_FMEA', title: '过程 FMEA' },
  { code: 'CONTROL_PLAN', title: '控制计划' },
  { code: 'MSA', title: '测量系统分析' },
  { code: 'DIMENSIONAL', title: '尺寸结果' },
  { code: 'MATERIAL_TEST', title: '材料与性能试验结果' },
  { code: 'INITIAL_STUDY', title: '初始过程研究' },
  { code: 'LAB_DOCUMENT', title: '合格实验室文件' },
  { code: 'APPEARANCE', title: '外观批准报告' },
  { code: 'SAMPLE', title: '生产件样品' },
  { code: 'MASTER_SAMPLE', title: '标准样品' },
  { code: 'CHECKING_AID', title: '检查辅具' },
  { code: 'CUSTOMER_REQUIREMENT', title: '客户特殊要求记录' },
  { code: 'PSW', title: '零件提交保证书' },
];

const LEVEL_TWO = new Set(['DESIGN_RECORD', 'DIMENSIONAL', 'MATERIAL_TEST', 'SAMPLE', 'PSW']);

export function ppapTemplate(level: number): PpapTemplateItem[] {
  if (level === 1 || level === 4) return ALL.filter((item) => item.code === 'PSW');
  if (level === 2) return ALL.filter((item) => LEVEL_TWO.has(item.code));
  if (level === 3 || level === 5) return ALL;
  throw new Error('SUPPLIER_PPAP_LEVEL_INVALID');
}
