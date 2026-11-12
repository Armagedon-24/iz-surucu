'use client';

import { useEffect } from 'react';

/**
 * Service worker kaydı — yalnızca üretim derlemesinde etkin.
 * Yeni sürüm geldiğinde beklemedeki SW otomatik devreye alınır (skipWaiting).
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* kayıt başarısızsa uygulama normal çalışmaya devam eder */
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);
  return null;
}
