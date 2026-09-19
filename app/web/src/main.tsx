import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import './styles/tokens.css';
import './styles/components.css';
import './styles/base.css';
import './styles/screens.css';
import { App } from './App';
import { applyTheme, readThemePref } from './theme';

applyTheme(readThemePref());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
