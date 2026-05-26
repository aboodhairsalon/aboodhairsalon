/**
 * Types & constantes partagés du Tableau de bord du Manager.
 *
 * Fichier volontairement SÉPARÉ de `dashboard-actions.ts` : ce dernier porte
 * la directive `'use server'`, et un fichier Server Action ne peut exporter
 * QUE des fonctions async (règle du bundler Next.js). Les valeurs/types non
 * fonctionnels (constante de fenêtre, types de série) vivent donc ici.
 */
import type { Booking, Sale } from '../_data/mock';
import type { ManagerErrorCode, ManagerErrorValues } from './actions';

/** Nb de jours chargés — couvre la vue « Mois » + sa période de comparaison. */
export const DASHBOARD_WINDOW_DAYS = 60;

export type DashboardSeries = { bookings: Booking[]; sales: Sale[] };

export type GetDashboardSeriesResult =
  | { ok: true; series: DashboardSeries }
  | { ok: false; errorKey: ManagerErrorCode; errorValues?: ManagerErrorValues };
