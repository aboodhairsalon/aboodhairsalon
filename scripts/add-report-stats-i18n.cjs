/* One-shot : clés des 4 nouvelles stats (coiffeur, comparaison, affluence, clients). */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'src', 'i18n', 'messages');

const DATA = {
  fr: {
    vsPrev: 'vs préc.',
    barber: {
      title: 'Performance par coiffeur',
      services: 'Prestations',
      tips: 'Pourboires',
      empty: 'Aucune vente attribuée à un coiffeur sur cette période.',
    },
    peak: {
      title: 'Affluence',
      byHour: 'Par heure',
      byDay: 'Par jour',
      empty: 'Pas encore de données d’affluence.',
    },
    clients: {
      title: 'Clients',
      new: 'Nouveaux',
      returning: 'Fidèles',
      anonymous: 'Sans compte',
      distinct: 'Clients distincts',
      noShowRate: 'Taux d’absence',
    },
  },
  en: {
    vsPrev: 'vs prev.',
    barber: {
      title: 'Performance by barber',
      services: 'Services',
      tips: 'Tips',
      empty: 'No sales attributed to a barber in this period.',
    },
    peak: {
      title: 'Busy times',
      byHour: 'By hour',
      byDay: 'By day',
      empty: 'No traffic data yet.',
    },
    clients: {
      title: 'Clients',
      new: 'New',
      returning: 'Returning',
      anonymous: 'No account',
      distinct: 'Unique clients',
      noShowRate: 'No-show rate',
    },
  },
  ar: {
    vsPrev: 'مقابل السابقة',
    barber: {
      title: 'أداء الحلاقين',
      services: 'الخدمات',
      tips: 'الإكراميات',
      empty: 'لا توجد مبيعات منسوبة إلى حلاق في هذه الفترة.',
    },
    peak: {
      title: 'أوقات الذروة',
      byHour: 'حسب الساعة',
      byDay: 'حسب اليوم',
      empty: 'لا توجد بيانات إقبال بعد.',
    },
    clients: {
      title: 'العملاء',
      new: 'جدد',
      returning: 'مخلصون',
      anonymous: 'بدون حساب',
      distinct: 'عملاء مختلفون',
      noShowRate: 'نسبة الغياب',
    },
  },
};

for (const loc of ['fr', 'en', 'ar']) {
  const file = path.join(DIR, `${loc}.json`);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = json.manager.report;
  r.kpi.vsPrev = DATA[loc].vsPrev;
  r.barber = DATA[loc].barber;
  r.peak = DATA[loc].peak;
  // clients : on FUSIONNE (le namespace clients n'existe pas encore au niveau report)
  r.clients = DATA[loc].clients;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`✓ ${loc}.json — stats coiffeur/affluence/clients/comparaison ajoutées`);
}
console.log('Terminé.');
