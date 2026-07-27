import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
const storedTheme = localStorage.getItem('usman-garments-theme');
document.documentElement.setAttribute(
  'data-theme',
  storedTheme === 'dark' ? 'dark' : 'light',
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);