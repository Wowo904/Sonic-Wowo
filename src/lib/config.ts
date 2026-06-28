// API base URL — auto-detects environment
// Electron: relative /api works (backend is local)
// Capacitor/iOS: needs absolute URL pointing to deployed backend

function isCapacitor(): boolean {
  try {
    return !!(window as any).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

const PROD_BACKEND = import.meta.env.VITE_API_BASE || '';

export function apiUrl(path: string): string {
  if (isCapacitor() && PROD_BACKEND) {
    return `${PROD_BACKEND}${path}`;
  }
  return path; // relative — works for Electron dev/prod
}

export const API_BASE = isCapacitor() && PROD_BACKEND ? PROD_BACKEND : '';
