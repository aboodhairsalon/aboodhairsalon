'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import {
  EntryButton,
  EntryEyebrow,
  EntryField,
  EntryShell,
  SerifAccent,
} from '../_components/entry-ui';
import { getBrowserClient } from '../_data/supabase';
import { signUp } from './actions';
import { slugify } from './slug';
import type { SignupErrorKey } from './types';

const MONO = 'var(--font-jetbrains), ui-monospace, SFMono-Regular, monospace';

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | {
      kind: 'error';
      errorKey: SignupErrorKey;
      errorValues?: Record<string, string>;
      field?: 'salonName' | 'slug' | 'email' | 'password';
    };

export default function SignupForm() {
  const t = useTranslations('signup');
  const [salonName, setSalonName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [, startTransition] = useTransition();

  const submitting = status.kind === 'submitting';
  const errField = status.kind === 'error' ? status.field : undefined;
  // Le message d'erreur est résolu via `t(`errors.${errorKey}`, errorValues)`
  // pour rester réactif au changement de langue après une erreur.
  const errMsg =
    status.kind === 'error' ? t(`errors.${status.errorKey}`, status.errorValues) : undefined;

  const onNameChange = (v: string) => {
    setSalonName(v);
    if (!slugManual) setSlug(slugify(v));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ kind: 'submitting' });
    startTransition(async () => {
      const result = await signUp({
        salonName,
        slug: slug.trim() || undefined,
        email,
        password,
      });
      if (!result.ok) {
        setStatus({
          kind: 'error',
          errorKey: result.errorKey,
          errorValues: result.errorValues,
          field: result.field,
        });
        return;
      }
      // Compte créé → connexion immédiate avec le mot de passe choisi.
      const supabase = getBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      // En cas d'échec (rare, compte déjà créé) on bascule vers /login.
      window.location.href = error ? '/login' : '/manager';
    });
  };

  return (
    <EntryShell
      eyebrow={t('eyebrow')}
      headline={
        <>
          {t('headlineLine1')}
          <br />
          <SerifAccent>{t('headlineAccent')}</SerifAccent>
        </>
      }
      intro={t('intro')}
    >
      <div className="aone-fade" style={{ animationDelay: '120ms' }}>
        <EntryEyebrow>{t('formEyebrow')}</EntryEyebrow>
        <h2 className="mt-4 text-[27px] font-semibold leading-tight tracking-[-0.035em] text-[#FAFAFA]">
          {t('formTitle')}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[#A1A1AA]">{t('formIntro')}</p>
      </div>

      <form
        onSubmit={submit}
        className="aone-fade mt-8 space-y-5"
        style={{ animationDelay: '210ms' }}
      >
        <EntryField
          label={t('salonNameLabel')}
          name="salonName"
          value={salonName}
          onChange={(e) => onNameChange(e.target.value)}
          required
          maxLength={60}
          autoComplete="organization"
          placeholder={t('salonNamePlaceholder')}
          disabled={submitting}
          error={errField === 'salonName' ? errMsg : undefined}
        />

        {/* ---- Adresse de l'espace — barre d'adresse façon navigateur ---- */}
        <div>
          <div className="flex items-end justify-between gap-3">
            <label
              htmlFor="slug"
              className="block text-[10.5px] font-medium uppercase tracking-[0.18em] text-[#A1A1AA]"
              style={{ fontFamily: MONO }}
            >
              {t('slugLabel')}
            </label>
            {!slugManual && (
              <button
                type="button"
                onClick={() => setSlugManual(true)}
                className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#A3E635] transition-colors hover:text-[#BEF264]"
                style={{ fontFamily: MONO }}
              >
                {t('slugCustomize')}
              </button>
            )}
          </div>
          <div
            className={`mt-2 flex h-12 items-center overflow-hidden rounded-[8px] border bg-white/[0.02] transition-[border-color,background-color,box-shadow] duration-200 focus-within:bg-[#A3E635]/[0.04] focus-within:shadow-[0_0_0_3px_rgba(163,230,53,0.12)] ${
              errField === 'slug'
                ? 'border-[#EF4444]/55'
                : 'border-[rgba(250,250,250,0.12)] focus-within:border-[#A3E635]/55'
            }`}
          >
            <span className="hidden h-full shrink-0 items-center gap-1.5 border-e border-[rgba(250,250,250,0.08)] px-3.5 sm:flex">
              <span className="h-2 w-2 rounded-full bg-[rgba(250,250,250,0.16)]" />
              <span className="h-2 w-2 rounded-full bg-[rgba(250,250,250,0.16)]" />
              <span className="h-2 w-2 rounded-full bg-[rgba(250,250,250,0.16)]" />
            </span>
            <span
              className="shrink-0 ps-3.5 text-[12px] text-[#52525B] sm:ps-3"
              style={{ fontFamily: MONO }}
            >
              app.system-aone.com/t/
            </span>
            <input
              id="slug"
              name="slug"
              value={slug}
              onChange={(e) => {
                setSlugManual(true);
                setSlug(slugify(e.target.value));
              }}
              className="aone-input h-full min-w-0 flex-1 bg-transparent pe-3.5 text-[12px] text-[#A3E635] outline-none placeholder:text-[#52525B]"
              style={{ fontFamily: MONO }}
              placeholder={t('slugPlaceholder')}
              aria-label={t('slugAria')}
              disabled={submitting}
              required
            />
          </div>
          {errField === 'slug' ? (
            <p className="mt-1.5 text-[12px] text-[#F87171]">{errMsg}</p>
          ) : (
            <p className="mt-1.5 text-[12px] leading-relaxed text-[#71717A]">{t('slugHint')}</p>
          )}
        </div>

        <EntryField
          label={t('emailLabel')}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('emailPlaceholder')}
          disabled={submitting}
          error={errField === 'email' ? errMsg : undefined}
        />

        <EntryField
          label={t('passwordLabel')}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('passwordPlaceholder')}
          disabled={submitting}
          error={errField === 'password' ? errMsg : undefined}
          hint={t('passwordHint')}
        />

        {errMsg && !errField && (
          <div className="flex items-start gap-2.5 rounded-[8px] border border-[#EF4444]/30 bg-[#EF4444]/[0.08] px-3.5 py-3 text-[13px] leading-relaxed text-[#F87171]">
            <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#F87171]" />
            <span>{errMsg}</span>
          </div>
        )}

        <EntryButton type="submit" loading={submitting}>
          {submitting ? t('submitting') : t('submit')}
        </EntryButton>

        <p className="text-center text-[12px] leading-relaxed text-[#52525B]">{t('footnote')}</p>
      </form>

      <div
        className="aone-fade mt-8 flex items-center gap-3 border-t border-[rgba(250,250,250,0.07)] pt-6"
        style={{ animationDelay: '300ms' }}
      >
        <span
          className="text-[10.5px] uppercase tracking-[0.18em] text-[#71717A]"
          style={{ fontFamily: MONO }}
        >
          {t('alreadyHaveAccount')}
        </span>
        <Link
          href="/login"
          className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-[#A3E635] transition-colors hover:text-[#BEF264]"
        >
          {t('signIn')}
          <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
        </Link>
      </div>
    </EntryShell>
  );
}
