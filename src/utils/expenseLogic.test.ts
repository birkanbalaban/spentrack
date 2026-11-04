import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTurkishAmount,
  normalizeTag,
  normalizeCategory,
  detectDuplicates,
  calculateMetrics,
  filterExpenses,
  expensesToCSV,
  parseCSVToExpenses,
  getCategoryColor,
  getTagColor,
} from './expenseLogic';
import { Expense, ExtractedExpense } from '../types';

test('getCategoryColor and getTagColor return distinct hex colors', () => {
  assert.equal(getCategoryColor('Market'), '#f97316');
  assert.equal(getCategoryColor('Yeme-İçme'), '#10b981');
  assert.equal(getCategoryColor('Ulaşım'), '#0ea5e9');
  assert.notEqual(getTagColor('#yapikredi'), getTagColor('#saglamkart'));
  assert.notEqual(getTagColor('#market'), getTagColor('#kahve'));
});

test('parseTurkishAmount handles standard TR currency strings and refunds', () => {
  assert.equal(parseTurkishAmount('1.250,50'), 1250.5);
  assert.equal(parseTurkishAmount('1.250,50 TL'), 1250.5);
  assert.equal(parseTurkishAmount('220,00'), 220);
  assert.equal(parseTurkishAmount('-340,75 TL'), -340.75);
  assert.equal(parseTurkishAmount('14.500'), 14500);
});

test('normalizeTag formats tags with leading hash and ASCII lowercase', () => {
  assert.equal(normalizeTag('YapıKredi'), '#yapikredi');
  assert.equal(normalizeTag('#SağlamKart'), '#saglamkart');
  assert.equal(normalizeTag('  Kahve '), '#kahve');
});

test('normalizeCategory maps arbitrary input to fixed 8 categories', () => {
  assert.equal(normalizeCategory('Market'), 'Market');
  assert.equal(normalizeCategory('Starbucks Kahve'), 'Yeme-İçme');
  assert.equal(normalizeCategory('Opet Akaryakıt'), 'Ulaşım');
  assert.equal(normalizeCategory('Bilinmeyen Harcama'), 'Diğer');
});

test('detectDuplicates marks date+amount matches as duplicate and unchecks them by default', () => {
  const existing: Expense[] = [
    {
      id: 'exp-1',
      title: 'Migros Ticaret A.Ş.',
      amount: 1450.5,
      currency: 'TRY',
      amountInTRY: 1450.5,
      category: 'Market',
      tags: ['#saglamkart', '#migros'],
      date: '2026-11-02',
    },
  ];

  const candidates: ExtractedExpense[] = [
    {
      title: 'MİGROS JET İSTANBUL',
      amount: 1450.5,
      currency: 'TRY',
      amountInTRY: 1450.5,
      category: 'Market',
      tags: ['#saglamkart'],
      date: '2026-11-02',
    },
    {
      title: 'Espressolab',
      amount: 195,
      currency: 'TRY',
      amountInTRY: 195,
      category: 'Yeme-İçme',
      tags: ['#saglamkart', '#kahve'],
      date: '2026-11-03',
    },
  ];

  const marked = detectDuplicates(candidates, existing);
  assert.equal(marked.length, 2);
  assert.equal(marked[0].isDuplicate, true);
  assert.equal(marked[0].selected, false);
  assert.equal(marked[1].isDuplicate, false);
  assert.equal(marked[1].selected, true);
});

test('calculateMetrics subtracts refunds from net monthly total and finds top category & tag', () => {
  const sample: Expense[] = [
    {
      id: '1',
      title: 'Migros',
      amount: 2000,
      currency: 'TRY',
      amountInTRY: 2000,
      category: 'Market',
      tags: ['#yapikredi', '#market'],
      date: '2026-11-01',
    },
    {
      id: '2',
      title: 'Zara Online',
      amount: 1500,
      currency: 'TRY',
      amountInTRY: 1500,
      category: 'Alışveriş',
      tags: ['#yapikredi', '#giyim'],
      date: '2026-11-02',
    },
    {
      id: '3',
      title: 'Zara İade',
      amount: -500,
      currency: 'TRY',
      amountInTRY: -500,
      category: 'Alışveriş',
      tags: ['#yapikredi', '#iade'],
      date: '2026-11-03',
    },
  ];

  const metrics = calculateMetrics(sample, '2026-11');
  assert.equal(metrics.monthlyNetTotalTRY, 3000);
  assert.equal(metrics.refundTotalTRY, 500);
  assert.equal(metrics.totalTransactionCount, 3);
  assert.equal(metrics.topCategory?.name, 'Market');
  assert.equal(metrics.topTag?.tag, '#yapikredi');
});

test('filterExpenses filters by search, category, and multiple tags', () => {
  const sample: Expense[] = [
    {
      id: '1',
      title: 'Starbucks Kadıköy',
      amount: 220,
      currency: 'TRY',
      amountInTRY: 220,
      category: 'Yeme-İçme',
      tags: ['#saglamkart', '#kahve'],
      date: '2026-11-03',
    },
    {
      id: '2',
      title: 'Migros Market',
      amount: 1450,
      currency: 'TRY',
      amountInTRY: 1450,
      category: 'Market',
      tags: ['#yapikredi', '#market'],
      date: '2026-11-03',
    },
  ];

  const filtered = filterExpenses(sample, {
    search: '',
    category: 'ALL',
    selectedTags: ['#saglamkart'],
    monthYear: '2026-11',
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].title, 'Starbucks Kadıköy');
});

test('CSV export and import round-trip preserves expense fields', () => {
  const sample: Expense[] = [
    {
      id: 'exp-csv-1',
      title: 'Apple Store Taksit',
      amount: 4500,
      currency: 'TRY',
      amountInTRY: 4500,
      category: 'Alışveriş',
      tags: ['#yapikredi', '#taksit'],
      date: '2026-11-01',
      notes: '2/6 Taksit',
    },
  ];

  const csv = expensesToCSV(sample);
  const parsed = parseCSVToExpenses(csv);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, 'Apple Store Taksit');
  assert.equal(parsed[0].amount, 4500);
  assert.deepEqual(parsed[0].tags, ['#yapikredi', '#taksit']);
  assert.equal(parsed[0].notes, '2/6 Taksit');
});
