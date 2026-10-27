import React from 'react';
import ReactDOM from 'react-dom/client';
import './mobile.css';
import i18n from '@/renderer/i18n';
import { applyMobileTranslations } from './i18nOverrides';
import { MobileApp } from './MobileApp';

export function renderApp(): void {
  applyMobileTranslations(i18n);
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <MobileApp />
    </React.StrictMode>,
  );
}
