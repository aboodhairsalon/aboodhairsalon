'use client';

import { LogOut, Scissors, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { StripeBar, Tag } from '@/components';
import { useSalonProfile } from '../_data/local-state';
import { signOut } from '../manager/actions';
import { InstallPWA } from './InstallPWA';
import { LocaleSwitcher } from './LocaleSwitcher';
import { useTenantOrNull } from './TenantProvider';

export interface TabDef {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Si true, affiche un badge "BÊTA" sur l'onglet. */
  preview?: boolean;
}

interface AppHeaderProps {
  role: 'client' | 'cashier' | 'manager';
  name: string;
  tabs: TabDef[];
  active: string;
  setActive: (key: string) => void;
  /** Nom de marque affiché à gauche — surcharge le profil détecté (espace Caisse). */
  brandName?: string;
  /** Masque la pastille logo à gauche. */
  hideLogo?: boolean;
  /** Slug du tenant — fallback explicite quand TenantProvider absent (cashier).
   *  Utilisé pour rediriger après logout vers `/{slug}/(cashier/)login`. */
  slug?: string;
}

// Plus de constantes FR codées en dur — voir `header.roleLabels.*` dans
// les catalogues de messages (résolution dynamique via `tHeader` ci-dessous).

/**
 * Lit le profil affiché dans le header :
 *  - Si on est dans un layout authentifié (TenantProvider présent) → DB
 *  - Sinon (mode démo public, /, /signup, /login) → localStorage profile démo
 */
function useDisplayProfile() {
  const tenantSession = useTenantOrNull();
  const localProfile = useSalonProfile();
  if (tenantSession) {
    return {
      name: tenantSession.tenant.name,
      logoUrl: tenantSession.branding.logo_url,
      brandPrimary: tenantSession.branding.brand_primary,
    };
  }
  return {
    name: localProfile.name,
    logoUrl: localProfile.logoDataUrl,
    brandPrimary: localProfile.brandPrimary,
  };
}

export function AppHeader({
  role,
  name,
  tabs,
  active,
  setActive,
  brandName,
  hideLogo,
  slug: slugProp,
}: AppHeaderProps) {
  const tHeader = useTranslations('header');
  const tAuth = useTranslations('auth.common');
  const profile = useDisplayProfile();
  const displayName = brandName?.trim() || profile.name;
  const tenantSession = useTenantOrNull();
  // Résolution du slug pour la redirection logout :
  //   1. TenantProvider si présent (manager)
  //   2. Prop explicite (cashier — pas de TenantProvider dans son layout)
  //   3. Vide → fallback `/login` ou `/cashier/login` sans préfixe tenant
  const effectiveSlug = tenantSession?.tenant.slug ?? slugProp ?? '';
  const [, startLogoutTransition] = useTransition();
  return (
    <header className="border-line bg-bg/85 sticky top-0 z-30 border-b backdrop-blur-md">
      <StripeBar h={3} />
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4 md:px-10">
        <Link href="/" className="flex shrink-0 items-center gap-3">
          {!hideLogo &&
            (profile.logoUrl ? (
              <img
                src={profile.logoUrl}
                alt={displayName}
                className="border-line h-9 w-9 rounded-full border object-cover"
              />
            ) : (
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full border"
                style={{ borderColor: profile.brandPrimary }}
              >
                <Scissors
                  className="h-3.5 w-3.5"
                  style={{ color: profile.brandPrimary }}
                  strokeWidth={2}
                />
              </div>
            ))}
          <div>
            <div className="display text-base leading-none">{displayName}</div>
            <div className="mono text-ink-soft mt-0.5 text-[9px] uppercase tracking-[0.25em]">
              {tHeader(`roleLabels.${role}`)}
            </div>
          </div>
        </Link>

        {tabs.length > 0 && (
          <nav className="bg-surface border-line scrollbar hidden min-w-0 items-center gap-1 overflow-x-auto rounded-sm border p-1 md:flex">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActive(t.key)}
                className={`btn-press flex shrink-0 items-center gap-2 whitespace-nowrap rounded-sm px-3 py-2 text-xs font-semibold transition ${
                  active === t.key
                    ? 'bg-brand-primary text-[#1A140C]'
                    : 'text-ink-mute hover:text-ink'
                }`}
              >
                <t.icon className="h-3.5 w-3.5" strokeWidth={2} />
                {t.label}
                {t.preview && (
                  <span className="mono bg-brand-primary/15 text-brand-glow rounded-sm px-1 py-px text-[8px] uppercase tracking-wider">
                    {tHeader('betaBadge')}
                  </span>
                )}
              </button>
            ))}
          </nav>
        )}

        <div className="flex shrink-0 items-center gap-3">
          {role !== 'client' && (
            <div className="hidden items-center gap-2 sm:flex">
              <span className="text-ink text-xs font-semibold leading-none">{name}</span>
              <Tag tone="copper">{tHeader('connected')}</Tag>
            </div>
          )}
          <LocaleSwitcher variant="header" />
          <InstallPWA />
          {role !== 'client' && (
            <button
              type="button"
              onClick={() =>
                startLogoutTransition(async () => {
                  // Avant de signer out : purger la souscription push de CE
                  // device. Sinon l'endpoint reste en DB et le prochain user
                  // qui se logue sur la même tablette/PC reçoit les notifs
                  // de l'ancien user (jusqu'à ce qu'il opt-in lui-même, qui
                  // override via upsert sur endpoint).
                  try {
                    if (
                      typeof navigator !== 'undefined' &&
                      'serviceWorker' in navigator &&
                      'PushManager' in window
                    ) {
                      const reg = await navigator.serviceWorker.ready;
                      const existing = await reg.pushManager.getSubscription();
                      if (existing) {
                        // Server-side delete (avant le signOut qui invalide la session)
                        const { unsubscribePush } = await import('../manager/push-actions');
                        await unsubscribePush(existing.endpoint).catch(() => {});
                        // Browser-side unsubscribe (libère le slot PushManager)
                        await existing.unsubscribe().catch(() => {});
                      }
                    }
                  } catch {
                    // best-effort — on ne bloque pas le logout si la purge échoue
                  }

                  // signOut() est appelée systématiquement — la session Supabase
                  // doit être invalidée même quand TenantProvider est absent
                  // (espace caisse). Avant, l'absence de TenantProvider faisait
                  // sauter le signOut et le bouton « ne faisait rien ».
                  await signOut();
                  const loginPath = role === 'cashier' ? '/cashier/login' : '/login';
                  // window.location.href pour forcer un refresh complet — sinon
                  // les Server Components peuvent re-render avec la session
                  // mémorisée côté Edge le temps que les cookies refresh.
                  window.location.href = effectiveSlug
                    ? `/${effectiveSlug}${loginPath}`
                    : loginPath;
                })
              }
              aria-label={tAuth('logoutAria')}
              className="btn-press text-ink-mute hover:text-red hover:bg-surface rounded-sm p-2"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {tabs.length > 0 && (
        <nav className="border-line scrollbar flex overflow-x-auto border-t md:hidden">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={`btn-press flex items-center gap-2 whitespace-nowrap px-4 py-3 text-xs font-semibold ${
                active === t.key
                  ? 'text-brand-primary border-brand-primary border-b-2'
                  : 'text-ink-mute'
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              {t.preview && (
                <span className="mono bg-brand-primary/15 text-brand-glow rounded-sm px-1 py-px text-[8px] uppercase tracking-wider">
                  Bêta
                </span>
              )}
            </button>
          ))}
        </nav>
      )}
    </header>
  );
}
