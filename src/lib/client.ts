'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot } from './types';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch('/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(response.status, result.error ?? 'Etwas ist schiefgelaufen.');
  return result;
}
export function errorText(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : 'Keine Verbindung. Bitte prüfe dein Internet und versuche es erneut.';
}
export function useLive(path: string, partyId?: string) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const next = await api<Snapshot>(path);
      setData(next);
      setError('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      busy.current = false;
    }
  }, [path]);
  useEffect(() => {
    // Initial fetch synchronizes the component with the external database.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const stream = new EventSource(
      '/api/events' + (partyId ? '?party=' + encodeURIComponent(partyId) : ''),
    );
    stream.onopen = () => {
      setConnected(true);
      void refresh();
    };
    stream.addEventListener('update', () => {
      void refresh();
    });
    stream.onerror = () => setConnected(false);
    const timer = setInterval(() => {
      void refresh();
    }, 8000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    return () => {
      stream.close();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
    };
  }, [partyId, refresh]);
  return { data, error, connected, refresh };
}
