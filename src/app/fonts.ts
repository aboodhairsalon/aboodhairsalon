/**
 * Polices web pour Aboodhairsalon.
 *
 * Trois familles next/font/google :
 *  - Fraunces  → display (titres éditoriaux des pages publiques)
 *  - Manrope   → sans-serif principal (UI manager, cashier, formulaires)
 *  - JetBrains → mono (chiffres caisse, dashboards, sys-diag)
 *
 * En plus, pour les pages d'entrée (login, signup) qui ont adopté la DA
 * "System A One" (noir + vert pomme) :
 *  - Inter Tight     → display sans-serif moderne
 *  - Instrument Serif → italic accents
 *
 * Toutes chargées via next/font/google : les fichiers .woff2 sont auto-hostés
 * dans le bundle Next, pas de FOUT ni de requête vers Google Fonts en prod.
 */
import { Fraunces, Manrope, JetBrains_Mono, Inter_Tight, Instrument_Serif } from 'next/font/google';

export const fraunces = Fraunces({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-fraunces',
  display: 'swap',
  style: ['normal', 'italic'],
  axes: ['opsz', 'SOFT', 'WONK'],
});

export const manrope = Manrope({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-manrope',
  display: 'swap',
  weight: ['300', '400', '500', '600', '700', '800'],
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  weight: ['400', '500', '600'],
});

export const interTight = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-inter-tight',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

export const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  variable: '--font-instrument',
  display: 'swap',
  weight: ['400'],
  style: ['italic'],
});

/** Toutes les variables à appliquer sur `<html>` en root layout. */
export const fontVariables = [
  fraunces.variable,
  manrope.variable,
  jetbrainsMono.variable,
  interTight.variable,
  instrumentSerif.variable,
].join(' ');
