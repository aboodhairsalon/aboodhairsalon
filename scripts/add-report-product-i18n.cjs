/* One-shot : ajoute coût/marge + états vides au namespace manager.report. */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'src', 'i18n', 'messages');

const DATA = {
  fr: {
    cols: { cost: 'Coût', margin: 'Marge' },
    byServiceEmpty: 'Aucune prestation vendue sur cette période.',
    byProductEmpty: 'Aucun produit vendu sur cette période.',
    marginTotal: 'Marge totale produits',
  },
  en: {
    cols: { cost: 'Cost', margin: 'Margin' },
    byServiceEmpty: 'No services sold in this period.',
    byProductEmpty: 'No products sold in this period.',
    marginTotal: 'Total product margin',
  },
  ar: {
    cols: { cost: 'التكلفة', margin: 'الهامش' },
    byServiceEmpty: 'لا توجد خدمات مباعة في هذه الفترة.',
    byProductEmpty: 'لا توجد منتجات مباعة في هذه الفترة.',
    marginTotal: 'إجمالي هامش المنتجات',
  },
};

for (const loc of ['fr', 'en', 'ar']) {
  const file = path.join(DIR, `${loc}.json`);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = json.manager.report;
  r.cols.cost = DATA[loc].cols.cost;
  r.cols.margin = DATA[loc].cols.margin;
  r.byService.empty = DATA[loc].byServiceEmpty;
  r.byProduct.empty = DATA[loc].byProductEmpty;
  r.byProduct.marginTotal = DATA[loc].marginTotal;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`✓ ${loc}.json — coût/marge/vides ajoutés`);
}
console.log('Terminé.');
