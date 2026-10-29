import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './index.css';
import './desktop.css';
import './i18n'; // Initialize i18n
import App from './App';
import { initRendererSentry } from './sentry';

initRendererSentry();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
