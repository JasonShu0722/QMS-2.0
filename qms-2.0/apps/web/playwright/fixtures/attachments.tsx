import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AttachmentPanel } from '../../src/features/attachments/AttachmentPanel';
import { LanguageProvider, LanguageSwitcher } from '../../src/i18n/Language';
import 'antd/dist/reset.css';

function Fixture() {
  const [fileIds, setFileIds] = useState<string[]>([]);
  const query = new URLSearchParams(location.search);
  const resource = { resourceType: query.get('resourceType') ?? '', resourceId: query.get('resourceId') ?? '' };
  return <LanguageProvider><main style={{ maxWidth: 900, margin: '32px auto', padding: 20 }}>
    <LanguageSwitcher />
    <AttachmentPanel resource={resource} fileIds={fileIds} onReady={(file) => setFileIds((current) => [...new Set([...current, file.id])])} />
  </main></LanguageProvider>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
