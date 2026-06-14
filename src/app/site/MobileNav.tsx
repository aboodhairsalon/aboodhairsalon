'use client';

/**
 * MobileNav — hamburger + drawer fullscreen pour la nav mobile du /site.
 *
 * Drawer = surface BLANCHE 100% opaque qui couvre TOUT le viewport quand
 * ouvert. Inclut le logo du salon en haut + liens nav en gros texte + CTA
 * Book + LocaleSwitcher en bas.
 *
 * Fixes vs v1 : structure simple (un seul div fixed avec bg blanc opaque,
 * pas de scrim séparé), z-50 garanti devant tout le reste, body scroll
 * locked quand ouvert.
 */
import { Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { LocaleSwitcher } from '../_components/LocaleSwitcher';

interface NavLink {
  href: string;
  label: string;
}

interface Props {
  links: NavLink[];
  bookUrl: string;
  bookLabel: string;
  tenantName: string;
  logoUrl: string;
}

export function MobileNav({ links, bookUrl, bookLabel, tenantName, logoUrl }: Props) {
  const [open, setOpen] = useState(false);
  const t = useTranslations('site.nav');

  // Bloque le scroll body quand le drawer est ouvert
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      {/* Bouton hamburger — visible < md */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('openMenu')}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-black/5 md:hidden"
        style={{ color: '#18160F' }}
      >
        <Menu className="h-5 w-5" strokeWidth={2} />
      </button>

      {/* Drawer fullscreen — bg blanc opaque garanti */}
      {open && (
        <div
          className="fixed inset-0 z-[100] flex flex-col md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t('mobileNav')}
          style={{ background: '#F4F3F0' }}
        >
          {/* Header drawer : logo gauche + close droite (même structure que Nav) */}
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ borderBottom: '1px solid #E4E2DC' }}
          >
            <div className="flex items-center gap-3">
              <img
                src={logoUrl}
                alt={tenantName}
                width={40}
                height={40}
                className="h-10 w-10 rounded-2xl object-cover"
                style={{ border: '1px solid #E4E2DC' }}
              />
              <span className="text-sm font-semibold tracking-tight" style={{ color: '#18160F' }}>
                {tenantName}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('closeMenu')}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-black/5"
              style={{ color: '#18160F' }}
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          </div>

          {/* Liens nav centrés verticalement */}
          <nav className="flex flex-1 flex-col items-stretch justify-center gap-2 px-6">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-2xl px-5 py-5 text-3xl font-bold tracking-tight transition-colors hover:bg-black/5"
                style={{ color: '#18160F' }}
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Footer drawer : CTA Book + LocaleSwitcher */}
          <div
            className="flex flex-col gap-4 px-6 pb-10 pt-6"
            style={{ borderTop: '1px solid #E4E2DC' }}
          >
            <a
              href={bookUrl}
              onClick={() => setOpen(false)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full px-7 py-4 text-base font-semibold transition-all hover:opacity-90"
              style={{
                background: '#1A1714',
                color: '#FFFFFF',
                boxShadow: '0 12px 32px rgba(26,23,20,0.18)',
              }}
            >
              {bookLabel}
            </a>
            <div className="flex justify-center">
              <LocaleSwitcher variant="auth" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
