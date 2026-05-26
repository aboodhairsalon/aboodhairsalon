/**
 * Bascule thème clair des espaces internes (Direction & Caisse).
 *
 * Surcharge scopée des tokens de surface du design system `@/components` :
 * appliquée sur le wrapper de layout, elle se propage par cascade CSS à tous
 * les composants (Card, Btn, Modal, AppHeader…) sans toucher au marketing ni
 * au funnel SaaS (signup / login System A One).
 *
 * Les tokens `--color-brand-*` restent gérés par tenant (white-label).
 */
export const LIGHT_SURFACE_VARS = {
  '--color-bg': '#F4F3F0',
  '--color-bg-soft': '#ECEAE6',
  '--color-surface': '#FFFFFF',
  '--color-surface-elev': '#EFEDEA',
  '--color-surface-hi': '#E4E2DC',
  '--color-ink': '#18160F',
  '--color-ink-mute': '#6B6456',
  '--color-ink-soft': '#8B8474',
  '--color-line': 'rgba(40,35,28,0.10)',
  '--color-line-hi': 'rgba(40,35,28,0.16)',
  '--color-green': '#4F7A3A',
  '--color-red': '#B5402B',
} as const;
