import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const storedTheme = localStorage.getItem('usman-garments-theme');
document.documentElement.setAttribute(
  'data-theme',
  storedTheme === 'dark' ? 'dark' : 'light',
);

// Stop mouse-wheel from silently nudging focused number inputs (qty, price, cash, etc.).
document.addEventListener(
  'wheel',
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'number') return;
    if (document.activeElement !== target) return;
    target.blur();
    event.preventDefault();
  },
  { passive: false, capture: true },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
