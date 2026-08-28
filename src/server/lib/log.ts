const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof LEVELS;

const configured = (process.env.LOG_LEVEL ?? 'info') as Level;
const threshold = LEVELS[configured] ?? LEVELS.info;

function emit(level: Level, scope: string, message: string, extra?: Record<string, unknown>) {
  if (LEVELS[level] > threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const payload = extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : '';
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line + payload);
}

export function logger(scope: string) {
  return {
    error: (m: string, e?: Record<string, unknown>) => emit('error', scope, m, e),
    warn: (m: string, e?: Record<string, unknown>) => emit('warn', scope, m, e),
    info: (m: string, e?: Record<string, unknown>) => emit('info', scope, m, e),
    debug: (m: string, e?: Record<string, unknown>) => emit('debug', scope, m, e),
  };
}
