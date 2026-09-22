const labels: Record<string, string> = {
  DRAFT: '草稿', PUBLISHED: '已发布', RETIRED: '已停用版本', ACTION: '处理', APPROVAL: '审批', VERIFICATION: '验证', CC: '抄送确认',
  CLOSE: '关闭', SUBMIT: '提交', APPROVE: '批准', VERIFY: '验证', RETURN: '退回', REJECT: '驳回', REOPEN: '重开',
  status: '状态', severity: '严重度', problemType: '问题类型', domainCode: '业务域', sourceType: '来源类型', responsibleParty: '责任方',
  eq: '等于', ne: '不等于', in: '属于集合', notIn: '不属于集合',
};
export const workflowLabel = (value: string) => labels[value] ?? value;
