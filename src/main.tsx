import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './styles.css';
import './v1.1.css';
import './v1.2.css';
import './v1.3.css';
import './v1.4.css';
import './v1.5.css';
import './v1.6.css';
import './v1.7.css';
import './v1.8.css';
import './v1.9.css';
import './v2.0.css';
import './v2.1.css';
import './v2.2.css';
import './v2.3.css';
import './v2.4.css';
import './v2.5.css';
import './v2.6.css';
import './v2.7.css';
import AppV14 from './AppV14';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppV14 />
  </StrictMode>,
);
