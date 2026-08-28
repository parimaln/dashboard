/**
 * Every upstream call goes through here. A LAN service that is powered off will
 * otherwise hang a connection for minutes and stall that component's refresh loop.
 */
export const DEFAULT_TIMEOUT_MS = 12_000;

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);

  // Honour both our timeout and the scheduler's shutdown signal.
  const onCallerAbort = () => controller.abort((callerSignal as AbortSignal).reason);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

/** Throws with the response body included, which is what actually identifies a misconfigured token. */
export async function expectOk(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    /* body already consumed or not readable */
  }
  throw new Error(`${what} failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
}
