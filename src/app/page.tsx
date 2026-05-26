/**
 * Page d'accueil racine — sera remplacée par la vitrine + booking client.
 *
 * Pour l'instant : placeholder qui confirme que le projet boot.
 * À remplacer Phase B après bulk-copy des composants tenant.
 */
import { getTranslations } from 'next-intl/server';
import { SALON } from '@/config/salon';

export default async function HomePage() {
  const t = await getTranslations('app');
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px',
        textAlign: 'center',
      }}
    >
      <h1
        className="display"
        style={{ fontSize: '48px', marginBottom: '16px', color: 'var(--color-brand-primary)' }}
      >
        {SALON.name}
      </h1>
      <p style={{ color: 'var(--color-ink-mute)', fontSize: '18px', marginBottom: '32px' }}>
        {t('description')}
      </p>
      <p style={{ color: 'var(--color-ink-soft)', fontSize: '14px' }}>
        Scaffolding en cours — la vitrine et le booking arrivent.
      </p>
    </main>
  );
}
