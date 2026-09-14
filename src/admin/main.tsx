import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminConsole from './AdminConsole';
import './admin.css';

const root = document.getElementById('admin-root');
if (!root) throw new Error('QQURZ operations root was not found.');

createRoot(root).render(
  <StrictMode>
    <AdminConsole />
  </StrictMode>,
);
