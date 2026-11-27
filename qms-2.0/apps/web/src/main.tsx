import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { enableNativeDatePicker } from './native-date-picker';
import 'antd/dist/reset.css';
import './styles/global.css';

const queryClient = new QueryClient();
enableNativeDatePicker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
