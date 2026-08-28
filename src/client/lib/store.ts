import { useEffect, useRef, useState } from 'react';
import type { ComponentState } from '../../shared/component.ts';
import type { ClientBootstrap } from '../../shared/config.ts';

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting';

export interface DashboardStore {
  bootstrap: ClientBootstrap | null;
  states: Map<string, ComponentState>;
  status: ConnectionStatus;
  /** Set when the bootstrap request itself failed — the server is down or not built. */
  fatal: string | null;
}

/**
 * One EventSource carries every component's updates.
 *
 * This replaces per-panel polling: the browser opens a single connection, receives
 * the current snapshot immediately, then a `state` event whenever any component
 * refreshes. EventSource reconnects on its own, which is also how the board
 * notices the container was replaced by a newer image.
 */
export function useDashboard(): DashboardStore {
  const [bootstrap, setBootstrap] = useState<ClientBootstrap | null>(null);
  const [states, setStates] = useState<Map<string, ComponentState>>(new Map());
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [fatal, setFatal] = useState<string | null>(null);
  const buildSha = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/config')
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<ClientBootstrap>;
      })
      .then((data) => {
        if (cancelled) return;
        setBootstrap(data);
        buildSha.current = data.version.sha;
      })
      .catch((err: unknown) => {
        if (!cancelled) setFatal(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Catch up whenever the page becomes visible again.
   *
   * The kiosk spends hours with the television switched off or the input
   * elsewhere. Browsers throttle background tabs aggressively and may drop the
   * event stream entirely, so the first thing anyone sees on switching back could
   * otherwise be hours-old data presented as current. Re-pulling the snapshot on
   * wake makes the board correct by the time it is actually looked at.
   */
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState !== 'visible') return;
      fetch('/api/data')
        .then((res) => (res.ok ? (res.json() as Promise<ComponentState[]>) : Promise.reject(new Error(String(res.status)))))
        .then((snapshot) => {
          setStates(new Map(snapshot.map((state) => [state.id, state])));
          setStatus('live');
        })
        .catch(() => setStatus('reconnecting'));
    };

    document.addEventListener('visibilitychange', resync);
    window.addEventListener('online', resync);
    return () => {
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('online', resync);
    };
  }, []);

  useEffect(() => {
    const source = new EventSource('/api/stream');

    source.addEventListener('open', () => setStatus('live'));

    source.addEventListener('state', (event) => {
      const state = JSON.parse((event as MessageEvent<string>).data) as ComponentState;
      setStates((previous) => new Map(previous).set(state.id, state));
      setStatus('live');
    });

    source.addEventListener('version', (event) => {
      const version = JSON.parse((event as MessageEvent<string>).data) as { sha: string };
      // A different build sha on a reconnect means the container was replaced —
      // Watchtower pulled a new image after a merge. Reload into the new build.
      if (buildSha.current && version.sha !== buildSha.current && version.sha !== 'dev') {
        window.location.reload();
        return;
      }
      buildSha.current ??= version.sha;
      setStatus('live');
    });

    // EventSource retries on its own; surface the gap without tearing anything down.
    source.addEventListener('error', () => setStatus('reconnecting'));

    return () => source.close();
  }, []);

  return { bootstrap, states, status, fatal };
}

/** Re-renders on a fixed cadence. Used by panels that must tick without server data. */
export function useNow(intervalMs = 1_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
