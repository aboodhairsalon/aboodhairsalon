'use client';

/**
 * OpeningHoursEditor — sélecteur visuel des horaires semaine.
 *
 * Inspiré de Google Business Profile / Fresha / Booksy :
 *  - Toggle Ouvert/Fermé par jour
 *  - 1 à 3 créneaux par jour (pour la pause déjeuner)
 *  - Bouton « Copier » pour dupliquer un planning journalier
 *  - Résumé automatique en bas
 *
 * Données stockées en JSON dans `tenant_settings.hours_text`.
 * Fonctions utilitaires exportées : parseWeekSchedule, generateHoursSummary.
 */
import { Check, Copy, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

// =============================================================================
// Types & constantes
// =============================================================================

/** Ordre des jours — clés stables, les libellés sont résolus via les
 *  catalogues `days.short.*` / `days.long.*` côté i18n. Cette liste
 *  reste exportée car d'autres composants (manager/client) en ont
 *  besoin pour ordonner leur rendu. Le nom `DAYS_FR` est historique
 *  (avant l'i18n) — il ne contient plus rien de FR. */
export const DAYS_FR = [
  { key: 'lun' },
  { key: 'mar' },
  { key: 'mer' },
  { key: 'jeu' },
  { key: 'ven' },
  { key: 'sam' },
  { key: 'dim' },
] as const;

export type DayKey = (typeof DAYS_FR)[number]['key'];

export interface DaySlot {
  from: string; // "09:00"
  to: string; // "19:00"
}

export interface DaySchedule {
  open: boolean;
  slots: DaySlot[];
}

export type WeekSchedule = Record<DayKey, DaySchedule>;

export const DEFAULT_WEEK_SCHEDULE: WeekSchedule = {
  lun: { open: false, slots: [] },
  mar: { open: true, slots: [{ from: '09:00', to: '19:00' }] },
  mer: { open: true, slots: [{ from: '09:00', to: '19:00' }] },
  jeu: { open: true, slots: [{ from: '09:00', to: '19:00' }] },
  ven: { open: true, slots: [{ from: '09:00', to: '19:00' }] },
  sam: { open: true, slots: [{ from: '09:00', to: '18:00' }] },
  dim: { open: false, slots: [] },
};

// =============================================================================
// Helpers exportés
// =============================================================================

/** Tente de parser le champ hours_text (JSON). Retourne null si invalide/vide. */
export function parseWeekSchedule(raw: string | null | undefined): WeekSchedule | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'lun' in parsed &&
      typeof (parsed as Record<string, unknown>)['lun'] === 'object'
    ) {
      return parsed as WeekSchedule;
    }
    return null;
  } catch {
    return null;
  }
}

function fmtT(t: string): string {
  // "09:00" → "09h" | "09:30" → "09h30"
  const [h, m] = t.split(':');
  return m === '00' ? `${h}h` : `${h}h${m}`;
}

/** Labels jour fournis par l'appelant (qui les résout via i18n côté React).
 *  Évite de coupler la fonction utilitaire à un système de translations
 *  particulier — `generateHoursSummary` reste pure et testable. */
export interface DayLabels {
  /** Libellés courts (« Lun », « Mar »…). Indexés par clé jour. */
  short: Record<DayKey, string>;
  /** Texte affiché quand aucun jour n'est ouvert (« Fermé »). */
  closed: string;
}

/** Génère le résumé textuel depuis un WeekSchedule. Ex : "Mar–Ven · 09h–19h · Sam · 09h–18h" */
export function generateHoursSummary(schedule: WeekSchedule, labels: DayLabels): string {
  const open = DAYS_FR.filter((d) => schedule[d.key].open && schedule[d.key].slots.length > 0);
  if (open.length === 0) return labels.closed;

  // Regrouper les jours consécutifs avec les mêmes créneaux
  type Group = { days: { key: DayKey; short: string }[]; timeStr: string };
  const groups: Group[] = [];

  for (const d of open) {
    const timeStr = schedule[d.key].slots.map((s) => `${fmtT(s.from)}–${fmtT(s.to)}`).join(', ');
    const last = groups[groups.length - 1];
    const prevIdx = DAYS_FR.findIndex((x) => x.key === d.key) - 1;
    const prevKey = DAYS_FR[prevIdx]?.key;
    const isConsecutive = last && prevKey && last.days[last.days.length - 1]?.key === prevKey;
    const entry = { key: d.key, short: labels.short[d.key] };

    if (last && last.timeStr === timeStr && isConsecutive) {
      last.days.push(entry);
    } else {
      groups.push({ days: [entry], timeStr });
    }
  }

  return groups
    .map(({ days, timeStr }) => {
      const dayStr =
        days.length >= 3
          ? `${days[0]!.short}–${days[days.length - 1]!.short}`
          : days.map((d) => d.short).join(', ');
      return `${dayStr} · ${timeStr}`;
    })
    .join('   ');
}

/** Hook React — résout les labels jour depuis le catalogue i18n actif.
 *  À utiliser avec generateHoursSummary() ou tout composant qui itère
 *  sur DAYS_FR et affiche le libellé court/long. */
export function useDayLabels(): DayLabels {
  const tShort = useTranslations('days.short');
  const tDays = useTranslations('days');
  return {
    short: {
      lun: tShort('lun'),
      mar: tShort('mar'),
      mer: tShort('mer'),
      jeu: tShort('jeu'),
      ven: tShort('ven'),
      sam: tShort('sam'),
      dim: tShort('dim'),
    },
    closed: tDays('closed'),
  };
}

// =============================================================================
// Sous-composant : saisie de l'heure
// =============================================================================

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ colorScheme: 'dark' }}
      className="border-line bg-bg-soft text-ink focus:border-brand-primary mono w-[100px] rounded-sm border px-2.5 py-2 text-sm outline-none transition-colors"
    />
  );
}

// =============================================================================
// Composant principal
// =============================================================================

interface OpeningHoursEditorProps {
  value: WeekSchedule;
  onChange: (schedule: WeekSchedule) => void;
}

export function OpeningHoursEditor({ value, onChange }: OpeningHoursEditorProps) {
  const t = useTranslations('openingHours');
  const tLong = useTranslations('days.long');
  const tShort = useTranslations('days.short');
  const dayLabels = useDayLabels();
  // Panneau « copier vers » — la source est la clé du jour sélectionné.
  const [copySource, setCopySource] = useState<DayKey | null>(null);
  const [copyTargets, setCopyTargets] = useState<Set<DayKey>>(new Set());

  // ── mutations ──────────────────────────────────────────────────────────────

  const updateDay = (key: DayKey, day: DaySchedule) => onChange({ ...value, [key]: day });

  const toggleOpen = (key: DayKey) => {
    const day = value[key];
    if (day.open) {
      updateDay(key, { open: false, slots: [] });
    } else {
      updateDay(key, {
        open: true,
        slots: day.slots.length > 0 ? day.slots : [{ from: '09:00', to: '19:00' }],
      });
    }
  };

  const addSlot = (key: DayKey) => {
    const day = value[key];
    const last = day.slots[day.slots.length - 1];
    updateDay(key, {
      ...day,
      slots: [...day.slots, { from: last?.to ?? '14:00', to: '19:00' }],
    });
  };

  const removeSlot = (key: DayKey, idx: number) => {
    const day = value[key];
    const slots = day.slots.filter((_, i) => i !== idx);
    updateDay(key, { ...day, slots, open: slots.length > 0 });
  };

  const updateSlot = (key: DayKey, idx: number, field: 'from' | 'to', val: string) => {
    const day = value[key];
    updateDay(key, {
      ...day,
      slots: day.slots.map((s, i) => (i === idx ? { ...s, [field]: val } : s)),
    });
  };

  const applyCopy = () => {
    if (!copySource) return;
    const src = value[copySource];
    const next = { ...value };
    for (const k of copyTargets) next[k] = { ...src, slots: src.slots.map((s) => ({ ...s })) };
    onChange(next);
    setCopySource(null);
    setCopyTargets(new Set());
  };

  const summary = generateHoursSummary(value, dayLabels);

  // ── rendu ──────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="border-line divide-line divide-y overflow-hidden rounded-sm border">
        {DAYS_FR.map((d) => {
          const day = value[d.key];
          const isCopySrc = copySource === d.key;

          return (
            <div key={d.key}>
              {/* ── Ligne du jour ─────────────────────────────────────────── */}
              <div
                className={`flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3 transition-colors ${
                  !day.open ? 'opacity-55 hover:opacity-80' : ''
                }`}
              >
                {/* Nom */}
                <span
                  className={`mono w-[88px] shrink-0 pt-[9px] text-[10px] uppercase tracking-[0.2em] ${
                    day.open ? 'text-ink' : 'text-ink-mute'
                  }`}
                >
                  {tLong(d.key)}
                </span>

                {/* Toggle Ouvert / Fermé */}
                <button
                  type="button"
                  onClick={() => toggleOpen(d.key)}
                  className={`mono mt-[5px] shrink-0 rounded-full border px-3 py-1 text-[9px] uppercase tracking-[0.15em] transition-all ${
                    day.open
                      ? 'border-brand-primary/40 bg-brand-primary/12 text-brand-primary'
                      : 'border-line bg-surface-elev text-ink-mute hover:border-line-hi'
                  }`}
                >
                  {day.open ? t('open') : t('closed')}
                </button>

                {/* Créneaux */}
                {day.open && (
                  <div className="flex flex-1 flex-col gap-2">
                    {day.slots.map((slot, idx) => (
                      <div key={idx} className="flex flex-wrap items-center gap-2">
                        <TimeInput
                          value={slot.from}
                          onChange={(v) => updateSlot(d.key, idx, 'from', v)}
                        />
                        <span className="mono text-ink-soft text-xs">—</span>
                        <TimeInput
                          value={slot.to}
                          onChange={(v) => updateSlot(d.key, idx, 'to', v)}
                        />
                        {day.slots.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeSlot(d.key, idx)}
                            className="btn-press text-ink-mute hover:text-red p-1 transition-colors"
                            title={t('removeSlot')}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}

                    {/* Ajouter un créneau (pause déjeuner) */}
                    {day.slots.length < 3 && (
                      <button
                        type="button"
                        onClick={() => addSlot(d.key)}
                        className="mono text-brand-primary/60 hover:text-brand-primary flex items-center gap-1 text-[9px] uppercase tracking-wider transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                        {day.slots.length === 0 ? t('addFirstSlot') : t('addBreak')}
                      </button>
                    )}
                  </div>
                )}

                {/* Bouton copier (visible seulement si le jour est ouvert) */}
                {day.open && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isCopySrc) {
                        setCopySource(null);
                        setCopyTargets(new Set());
                      } else {
                        setCopySource(d.key);
                        setCopyTargets(new Set());
                      }
                    }}
                    title={t('copyTitle')}
                    className={`btn-press mt-[5px] rounded-sm p-1.5 transition-colors ${
                      isCopySrc
                        ? 'bg-brand-primary/15 text-brand-primary'
                        : 'text-ink-mute hover:bg-surface-hi hover:text-ink'
                    }`}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* ── Panneau « Copier vers » (inline, sous la ligne) ───────── */}
              {isCopySrc && (
                <div className="border-line bg-bg-soft border-b px-4 py-3">
                  <p className="mono text-ink-soft mb-2.5 text-[9px] uppercase tracking-[0.2em]">
                    {t('copyHeader')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS_FR.filter((x) => x.key !== copySource).map((x) => {
                      const sel = copyTargets.has(x.key);
                      return (
                        <button
                          key={x.key}
                          type="button"
                          onClick={() => {
                            const next = new Set(copyTargets);
                            if (sel) next.delete(x.key);
                            else next.add(x.key);
                            setCopyTargets(next);
                          }}
                          className={`mono btn-press rounded-sm border px-3 py-1.5 text-[9px] uppercase tracking-wider transition-all ${
                            sel
                              ? 'border-brand-primary bg-brand-primary/12 text-brand-primary'
                              : 'border-line text-ink-mute hover:border-line-hi'
                          }`}
                        >
                          {tShort(x.key)}
                        </button>
                      );
                    })}
                    {/* Raccourci "Tous" */}
                    <button
                      type="button"
                      onClick={() =>
                        setCopyTargets(
                          new Set(DAYS_FR.filter((x) => x.key !== copySource).map((x) => x.key)),
                        )
                      }
                      className="mono btn-press border-line text-ink-mute hover:border-line-hi rounded-sm border px-3 py-1.5 text-[9px] uppercase tracking-wider"
                    >
                      {t('shortcutAll')}
                    </button>
                    {/* Raccourci "Lun–Ven" */}
                    <button
                      type="button"
                      onClick={() =>
                        setCopyTargets(
                          new Set(
                            (['lun', 'mar', 'mer', 'jeu', 'ven'] as DayKey[]).filter(
                              (k) => k !== copySource,
                            ),
                          ),
                        )
                      }
                      className="mono btn-press border-line text-ink-mute hover:border-line-hi rounded-sm border px-3 py-1.5 text-[9px] uppercase tracking-wider"
                    >
                      {t('shortcutWeekdays')}
                    </button>
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      disabled={copyTargets.size === 0}
                      onClick={applyCopy}
                      className="mono btn-press bg-brand-primary text-bg flex items-center gap-1.5 rounded-sm px-4 py-1.5 text-[9px] uppercase tracking-wider disabled:opacity-40"
                    >
                      <Check className="h-3 w-3" />
                      {copyTargets.size > 1
                        ? t('applyMany', { count: copyTargets.size })
                        : t('applyOne', { count: copyTargets.size })}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCopySource(null);
                        setCopyTargets(new Set());
                      }}
                      className="mono text-ink-mute hover:text-ink text-[9px] uppercase tracking-wider"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Résumé auto-généré */}
      <div className="mt-3 flex items-baseline gap-2">
        <span className="mono text-ink-soft text-[9px] uppercase tracking-[0.2em]">
          {t('summaryLabel')}
        </span>
        <span className="mono text-ink text-[11px]">{summary}</span>
      </div>
    </div>
  );
}
