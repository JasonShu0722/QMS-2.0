import type { components } from '@qms/contracts';
import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client';

type MinePage = components['schemas']['AnnouncementMinePageDto'];

export function AnnouncementReminder() {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let current = true;
    let request: AbortController | undefined;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      void apiRequest<MinePage>('/api/v1/announcements/mine', { signal: controller.signal })
        .then((page) => { if (current) setCount(page.unreadMustReadCount); })
        .catch(() => { if (current && !controller.signal.aborted) setCount(0); });
    };
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('qms:announcement-read', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      current = false;
      request?.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('qms:announcement-read', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [pathname]);

  return count > 0 ? <Link className="qms-announcement-reminder" to="/app/announcements" aria-label={`${count} 条必读公告未读`}>必读公告 <strong>{count}</strong></Link> : null;
}
