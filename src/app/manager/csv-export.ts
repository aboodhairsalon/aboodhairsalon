/**
 * Utilitaires d'export CSV — génération de fichiers + téléchargement client.
 *
 * Le CSV est encodé en UTF-8 avec un BOM pour qu'Excel ouvre correctement les
 * accents. Échappement RFC 4180 (guillemets, virgules, sauts de ligne). Module
 * pur — appelé uniquement depuis des gestionnaires d'événements côté client.
 */
import type { Sale } from '../_data/mock';

/** Marqueur d'ordre des octets UTF-8 (U+FEFF) — fait ouvrir le CSV proprement à Excel. */
const UTF8_BOM = String.fromCharCode(0xfeff);

/** Échappe une valeur pour une cellule CSV (RFC 4180). */
function csvCell(value: string | number): string {
  const s = String(value);
  return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Assemble une grille de cellules en texte CSV (séparateur virgule, CRLF). */
function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/**
 * Construit le CSV des ventes — une ligne par vente.
 *
 * `barberName` résout l'id du barbier en nom lisible. `labels` contient les
 * traductions (headers + libellés méthode de paiement), résolues par
 * l'appelant via next-intl pour ne pas dépendre d'une locale figée côté
 * utilitaire pur. Avant l'audit T5.7, les headers étaient hardcodés en
 * français → CSV illisible pour un manager EN/AR.
 */
export interface SalesCsvLabels {
  date: string;
  time: string;
  barber: string;
  method: string;
  items: string;
  total: string;
  refunded: string;
  net: string;
  methodCard: string;
  methodCash: string;
  methodMobile: string;
}

export function buildSalesCsv(
  sales: Sale[],
  barberName: (id: string) => string,
  labels: SalesCsvLabels,
): string {
  // Le CSV trace 3 colonnes monétaires pour piste comptable :
  //  - Total facturé (gross)
  //  - Remboursé (cumulé sur la vente : 0, partiel, ou total)
  //  - Net = Total − Remboursé (ce qui est resté en caisse)
  const methodLabel = (m: Sale['method']): string => {
    switch (m) {
      case 'card':
        return labels.methodCard;
      case 'cash':
        return labels.methodCash;
      case 'mobile':
        return labels.methodMobile;
    }
  };
  const header = [
    labels.date,
    labels.time,
    labels.barber,
    labels.method,
    labels.items,
    labels.total,
    labels.refunded,
    labels.net,
  ];
  const rows: (string | number)[][] = sales.map((s) => {
    const refunded = s.refundedCents ?? 0;
    return [
      s.date,
      s.time,
      barberName(s.barberId),
      methodLabel(s.method),
      s.items.map((i) => `${i.name} ×${i.qty}`).join(' ; '),
      (s.totalCents / 100).toString(),
      (refunded / 100).toString(),
      (Math.max(0, s.totalCents - refunded) / 100).toString(),
    ];
  });
  return toCsv([header, ...rows]);
}

/** Déclenche le téléchargement d'un fichier CSV dans le navigateur. */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([UTF8_BOM, content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
