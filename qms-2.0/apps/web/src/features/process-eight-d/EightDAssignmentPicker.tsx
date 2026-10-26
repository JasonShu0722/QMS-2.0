import { useEffect, useState } from 'react';
import { Alert, Pagination, Spin } from 'antd';
import type { components } from '@qms/contracts';
import { EightDField } from './EightDDocumentEditor';
import { aborted, useEightDText, type EightDRead, type EightDReport } from './eight-d';
import styles from './eight-d.module.css';

type Options = components['schemas']['ProcessEightDAssignmentOptionsDto'];
export function EightDAssignmentPicker({ report, read, collaborators, disabled, section, onSection, selected, onSelect }: {
  report: EightDReport; read: EightDRead; collaborators: boolean; disabled: boolean; section: string; onSection: (id: string) => void; selected: string[]; onSelect: (ids: string[]) => void;
}) {
  const text = useEightDText();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState<{ query: string; data: Options }>();
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const query = new URLSearchParams({ action: collaborators ? 'COLLABORATORS' : 'REASSIGN', problemId: report.problemId, organizationId: report.organizationId, page: String(page), pageSize: '20', search });
  if (section) query.set('sectionDepartmentId', section);
  const queryKey = query.toString();
  const options = state?.query === queryKey ? state.data : undefined;
  useEffect(() => {
    let active = true; setError(false);
    read<Options>(`/api/v1/process-quality/eight-d/assignment-options?${queryKey}`).then(data => {
      if (!active) return;
      setState({ query: queryKey, data });
      setNames(previous => ({ ...previous, ...Object.fromEntries(data.users.map(user => [user.id, user.fullName || user.username])) }));
    }).catch(cause => { if (active && !aborted(cause)) setError(true); });
    return () => { active = false; };
  }, [queryKey, read, retry]);
  return <div className={styles.modal}>
    <EightDField label={text('搜索人员 / 科室', 'Search people / sections')}><input disabled={disabled} value={search} maxLength={200} onChange={event => { setSearch(event.target.value); setPage(1); }} /></EightDField>
    {error ? <Alert type="error" title={text('候选加载失败', 'Options could not be loaded')} action={<button disabled={disabled} onClick={() => setRetry(value => value + 1)}>{text('重试', 'Retry')}</button>} /> : !options ? <Spin aria-label={text('正在加载候选', 'Loading options')} /> : null}
    <EightDField label={text('筛选科室', 'Section filter')}><select disabled={disabled || !options} value={section} onChange={event => { onSection(event.target.value); setPage(1); if (!collaborators) onSelect([]); }}>
      <option value="">{text('全部获权科室', 'All authorized sections')}</option>
      {section && !options?.departments.some(item => item.id === section) ? <option value={section}>{section}</option> : null}
      {options?.departments.map(department => <option key={department.id} value={department.id}>{department.name} · {department.code}</option>)}
    </select></EightDField>
    <EightDField label={collaborators ? text('协作者', 'Collaborators') : text('新负责人', 'New owner')}><select disabled={disabled || !options} multiple={collaborators} size={collaborators ? 5 : undefined} value={collaborators ? selected : selected[0] ?? ''} onChange={event => onSelect(Array.from(event.target.selectedOptions, option => option.value).filter(Boolean))}>
      {!collaborators && <option value="">{text('请选择负责人', 'Select an owner')}</option>}
      {selected.filter(id => !options?.users.some(user => user.id === id)).map(id => <option key={id} value={id}>{names[id] ?? id}</option>)}
      {options?.users.map(user => <option key={user.id} value={user.id}>{user.fullName || user.username} · {user.username}</option>)}
    </select></EightDField>
    <Pagination size="small" current={page} pageSize={20} showSizeChanger={false} total={Math.max(options?.departmentTotal ?? 0, options?.userTotal ?? 0)} disabled={disabled || !options} onChange={setPage} />
  </div>;
}
