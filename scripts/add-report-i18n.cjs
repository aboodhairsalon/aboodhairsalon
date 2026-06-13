/* One-shot : ajoute le namespace manager.report + l'onglet tabs.report. */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'i18n', 'messages');

const DATA = {
  fr: {
    tab: 'Rapport',
    report: {
      title: 'Rapport comptable',
      subtitle: 'Synthèse comptable détaillée par période',
      period: { day: 'Jour', week: 'Semaine', month: 'Mois' },
      refreshing: 'Actualisation…',
      kpi: {
        revenueNet: 'Chiffre d’affaires net',
        sales: 'Ventes',
        avgTicket: 'Ticket moyen',
        bookingsDone: 'RDV réalisés',
      },
      payments: {
        title: 'Moyens de paiement',
        visa: 'Visa',
        cash: 'Cash',
        instapay: 'InstaPay',
        other: 'Autre',
        share: 'Part',
      },
      byService: { title: 'Ventes par prestation', topBadge: 'Top vente' },
      byProduct: { title: 'Ventes par produit' },
      cols: { name: 'Désignation', qty: 'Qté', revenue: 'CA', amount: 'Montant' },
      accounting: {
        title: 'Détail comptable',
        gross: 'Chiffre d’affaires brut',
        discount: 'Remises accordées',
        surplus: 'Suppléments',
        cashback: 'Cashback utilisé',
        refunded: 'Remboursements',
        net: 'Chiffre d’affaires net',
        tips: 'Pourboires',
        tax: 'Taxes',
        tipsNote: 'Reversés aux coiffeurs (hors CA)',
      },
      bookings: {
        title: 'Rendez-vous',
        done: 'Réalisés',
        noShow: 'Absents',
        cancelled: 'Annulés',
        upcoming: 'À venir',
        total: 'Total',
      },
      exportCsv: 'Exporter CSV',
      exportPdf: 'Exporter PDF',
      empty: 'Aucune vente sur cette période.',
      error: 'Impossible de charger le rapport.',
      pdf: { generatedOn: 'Généré le', period: 'Période' },
    },
  },
  en: {
    tab: 'Report',
    report: {
      title: 'Accounting report',
      subtitle: 'Detailed accounting summary by period',
      period: { day: 'Day', week: 'Week', month: 'Month' },
      refreshing: 'Refreshing…',
      kpi: {
        revenueNet: 'Net revenue',
        sales: 'Sales',
        avgTicket: 'Average ticket',
        bookingsDone: 'Appointments done',
      },
      payments: {
        title: 'Payment methods',
        visa: 'Visa',
        cash: 'Cash',
        instapay: 'InstaPay',
        other: 'Other',
        share: 'Share',
      },
      byService: { title: 'Sales by service', topBadge: 'Top seller' },
      byProduct: { title: 'Sales by product' },
      cols: { name: 'Item', qty: 'Qty', revenue: 'Revenue', amount: 'Amount' },
      accounting: {
        title: 'Accounting detail',
        gross: 'Gross revenue',
        discount: 'Discounts',
        surplus: 'Surcharges',
        cashback: 'Cashback used',
        refunded: 'Refunds',
        net: 'Net revenue',
        tips: 'Tips',
        tax: 'Taxes',
        tipsNote: 'Paid to staff (excluded from revenue)',
      },
      bookings: {
        title: 'Appointments',
        done: 'Completed',
        noShow: 'No-shows',
        cancelled: 'Cancelled',
        upcoming: 'Upcoming',
        total: 'Total',
      },
      exportCsv: 'Export CSV',
      exportPdf: 'Export PDF',
      empty: 'No sales in this period.',
      error: 'Could not load the report.',
      pdf: { generatedOn: 'Generated on', period: 'Period' },
    },
  },
  ar: {
    tab: 'التقرير',
    report: {
      title: 'التقرير المحاسبي',
      subtitle: 'ملخص محاسبي مفصل حسب الفترة',
      period: { day: 'اليوم', week: 'الأسبوع', month: 'الشهر' },
      refreshing: 'جارٍ التحديث…',
      kpi: {
        revenueNet: 'صافي الإيرادات',
        sales: 'المبيعات',
        avgTicket: 'متوسط الفاتورة',
        bookingsDone: 'المواعيد المنجزة',
      },
      payments: {
        title: 'طرق الدفع',
        visa: 'فيزا',
        cash: 'كاش',
        instapay: 'إنستاباي',
        other: 'أخرى',
        share: 'النسبة',
      },
      byService: { title: 'المبيعات حسب الخدمة', topBadge: 'الأكثر مبيعًا' },
      byProduct: { title: 'المبيعات حسب المنتج' },
      cols: { name: 'البيان', qty: 'الكمية', revenue: 'الإيراد', amount: 'المبلغ' },
      accounting: {
        title: 'التفاصيل المحاسبية',
        gross: 'إجمالي الإيرادات',
        discount: 'الخصومات',
        surplus: 'الإضافات',
        cashback: 'الكاش باك المستخدم',
        refunded: 'المبالغ المستردة',
        net: 'صافي الإيرادات',
        tips: 'الإكراميات',
        tax: 'الضرائب',
        tipsNote: 'تُدفع للموظفين (خارج الإيراد)',
      },
      bookings: {
        title: 'المواعيد',
        done: 'منجزة',
        noShow: 'الغياب',
        cancelled: 'ملغاة',
        upcoming: 'قادمة',
        total: 'الإجمالي',
      },
      exportCsv: 'تصدير CSV',
      exportPdf: 'تصدير PDF',
      empty: 'لا توجد مبيعات في هذه الفترة.',
      error: 'تعذّر تحميل التقرير.',
      pdf: { generatedOn: 'Generated on', period: 'Period' },
    },
  },
};

for (const loc of ['fr', 'en', 'ar']) {
  const file = path.join(DIR, `${loc}.json`);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!json.manager) throw new Error(`no manager namespace in ${loc}.json`);
  // Onglet
  json.manager.tabs = json.manager.tabs || {};
  json.manager.tabs.report = DATA[loc].tab;
  // Namespace report
  json.manager.report = DATA[loc].report;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`✓ ${loc}.json — tabs.report + manager.report ajoutés`);
}
console.log('Terminé.');
