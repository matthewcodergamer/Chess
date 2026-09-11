import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './styles/index.css';
import AppV14 from './AppV14';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppV14 />
  </StrictMode>,
);

// Keep the refresh experience seamless: the tiny static loader in index.html
// stays visible until React has actually mounted, then fades rather than popping.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const boot = document.getElementById('qqurz-boot');
    if (!boot) return;
    boot.classList.add('is-hidden');
    window.setTimeout(() => boot.remove(), 260);
  });
});
