import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './styles/index.css';
import AppV14 from './AppV14';
import NotificationCenter from './notifications/NotificationCenter';
import SocialCenter from './social/SocialCenter';
import { motionTokenMs } from './ui/motion';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppV14 />
    <NotificationCenter />
    <SocialCenter />
  </StrictMode>,
);

// Keep refresh seamless: the static activity indicator survives until React
// mounts, then leaves on the same short route-motion timing used by the app.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const boot = document.getElementById('qqurz-boot');
    if (!boot) return;
    boot.classList.add('is-hidden');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    window.setTimeout(() => boot.remove(), reduced ? 0 : motionTokenMs('--q-motion-route', 180));
  });
});