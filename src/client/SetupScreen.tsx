import type { ComponentDescriptor } from '../shared/component.ts';

/**
 * What a fresh clone shows before anything is configured.
 *
 * The alternative — a black screen, or eight panels each rendering its own error —
 * is a poor first impression for a project people are meant to be able to pick up
 * and run. This says exactly which variable is missing for which component.
 */
export function SetupScreen({ components }: { components: ComponentDescriptor[] }) {
  return (
    <div style={{ padding: '4vh 5vw', height: '100dvh', overflow: 'hidden' }}>
      <h1 style={{ fontSize: 'var(--text-xxl)', fontWeight: 'var(--weight-black)', margin: '0 0 0.4rem' }}>
        Almost there
      </h1>
      <p style={{ fontSize: 'var(--text-md)', color: 'var(--ink-dim)', margin: '0 0 1.6rem', maxWidth: '48rem' }}>
        No components are active yet. Each one needs to be placed in{' '}
        <code style={{ color: 'var(--accent) ' }}>config/public.json</code> under <code>layout</code>, and to have its
        environment variables set in <code>.env</code>. See <code>docs/INSTALL.md</code>.
      </p>

      <div style={{ display: 'grid', gap: '0.5rem', maxWidth: '60rem' }}>
        {components.map((component) => (
          <div
            key={component.id}
            style={{
              display: 'flex',
              gap: '1rem',
              alignItems: 'baseline',
              padding: '0.6rem 0.9rem',
              background: 'var(--panel)',
              border: '1px solid var(--panel-edge)',
              borderRadius: 'var(--radius)',
            }}
          >
            <span
              style={{
                fontSize: 'var(--text-meta)',
                color: component.enabled ? 'var(--accent-good)' : 'var(--accent-warn)',
                minWidth: '5.5rem',
                fontWeight: 'var(--weight-bold)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              {component.enabled ? 'Ready' : 'Waiting'}
            </span>
            <span style={{ minWidth: '11rem', fontWeight: 'var(--weight-medium)' }}>{component.name}</span>
            <span style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-meta)' }}>
              {component.missingEnv?.length
                ? `Set ${component.missingEnv.join(', ')}`
                : component.enabled
                  ? component.description
                  : `Add "${component.id}" to config.layout`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
