/* One-shot : libellés de la section Comparaison (exports CSV/PDF). */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'src', 'i18n', 'messages');

const DATA = {
  fr: { title: 'Comparaison vs période précédente', current: 'Période', previous: 'Précédente', change: 'Évolution' },
  en: { title: 'Comparison vs previous period', current: 'Period', previous: 'Previous', change: 'Change' },
  ar: { title: 'مقارنة بالفترة السابقة', current: 'الفترة', previous: 'السابقة', change: 'التغير' },
};

for (const loc of ['fr', 'en', 'ar']) {
  const file = path.join(DIR, `${loc}.json`);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.manager.report.comparison = DATA[loc];
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`✓ ${loc}.json — comparison ajouté`);
}
console.log('Terminé.');
