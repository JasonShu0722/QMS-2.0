import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Pagination, Spin, Table } from 'antd';
import type { components } from '@qms/contracts';
import { useEightDText, type EightDRead } from './eight-d';

type Options = components['schemas']['EightDTeamOptionsDto'];
type Person = Options['items'][number];

export function EightDTeamPicker({ path, organizationId, unavailable, read, onSelect, onClose }: {
  path: string; organizationId?: string; unavailable: readonly string[]; read: EightDRead; onSelect: (person: Person) => void; onClose: () => void;
}) {
  const text = useEightDText();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Options>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setResult(undefined); setFailed(false);
    const query = new URLSearchParams({ search: search.trim(), page: String(page), pageSize: '10' });
    if (organizationId) query.set('organizationId', organizationId);
    const timer = window.setTimeout(() => {
      void read<Options>(`${path}?${query}`, { signal: controller.signal }).then(value => {
        if (!controller.signal.aborted) setResult(value);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [path, organizationId, search, page, read]);
  const searchLabel = text('搜索姓名、账号或部门', 'Search name, account or department');
  return <Modal open title={text('选择团队成员', 'Select a team member')} footer={null} width={700} onCancel={onClose}>
    <label>{searchLabel} <input aria-label={searchLabel} maxLength={200} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
    {failed ? <Alert type="error" title={text('人员目录加载失败', 'Personnel directory could not load')} /> : !result ? <Spin /> : <>
      <Table size="small" pagination={false} rowKey={person => `${person.userId}:${person.assignmentId}`} dataSource={result.items} columns={[
        { title: text('姓名', 'Name'), dataIndex: 'name' }, { title: text('部门', 'Department'), dataIndex: 'department' }, { title: text('职务', 'Position'), dataIndex: 'jobTitle' },
        { title: text('操作', 'Actions'), render: (_, person) => <Button disabled={unavailable.includes(person.userId)} onClick={() => onSelect(person)}>{text('选择', 'Select')} · {person.username}</Button> },
      ]} />
      <Pagination current={page} pageSize={result.pageSize} total={result.total} showSizeChanger={false} onChange={setPage} />
    </>}
  </Modal>;
}
