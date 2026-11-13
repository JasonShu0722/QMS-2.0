export function personLabel(person: { fullName?: string | null; username?: string | null; departmentName?: string | null; positionName?: string | null }, includePosition = false, locale = 'zh-CN') {
  const english = locale === 'en-US';
  const name = person.fullName?.trim() || (english ? 'Name not provided' : '姓名未填写');
  const department = person.departmentName?.trim() || (english ? 'Department not provided' : '部门未填写');
  const account = person.username?.trim() || (english ? 'Account unavailable' : '账号不可用');
  const label = english ? `${name} / ${department} (${account})` : `${name} / ${department}（${account}）`;
  return includePosition && person.positionName ? `${label} · ${person.positionName}` : label;
}
