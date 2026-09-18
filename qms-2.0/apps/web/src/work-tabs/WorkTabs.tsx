import { Button, Dropdown } from 'antd';
import { MoreHorizontal, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useWorkTabsStore } from './workTabsStore';

export function WorkTabs() {
  const { activeTabId, closeTab, overflowTabs, shouldShowStrip, visibleTabs } = useWorkTabsStore();
  if (!shouldShowStrip) return null;

  return (
    <div className="work-tabs" role="tablist" aria-label="工作标签">
      {visibleTabs.map((tab) => (
        <div className={tab.id === activeTabId ? 'work-tab active' : 'work-tab'} key={tab.id} role="tab">
          <Link to={tab.path}>{tab.title}</Link>
          <Button aria-label={`关闭 ${tab.title}`} icon={<X size={13} />} size="small" type="text" onClick={() => closeTab(tab.id)} />
        </div>
      ))}
      {overflowTabs.length ? (
        <Dropdown
          menu={{ items: overflowTabs.map((tab) => ({ key: tab.id, label: <Link to={tab.path}>{tab.title}</Link> })) }}
        >
          <Button aria-label="全部标签" icon={<MoreHorizontal size={16} />} size="small" />
        </Dropdown>
      ) : null}
    </div>
  );
}

