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
  formatCurrency,
  maskMonetaryText,
  calculateWeeklyCategorySummary,
  calculateMonthEndHabitProjection,
  parseInstantAssistantMessage,
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

test('formatCurrency and maskMonetaryText conceal amounts with stars when privacy mode is active', () => {
  assert.equal(formatCurrency(1450.5, 'TRY', null, false, true), '**** ₺');
  assert.equal(formatCurrency(-650, 'USD', null, true, true), '**** $');
  assert.equal(formatCurrency(100, 'EUR', null, false, true), '**** €');
  assert.equal(formatCurrency(100, 'GBP', null, false, true), '**** £');

  const sampleText = '2026-11 döneminde 4 işlem için toplam 5.867,60 ₺ (%42) ve $120.50 harcadınız.';
  assert.equal(
    maskMonetaryText(sampleText, true),
    '2026-11 döneminde 4 işlem için toplam **** ₺ (%42) ve **** $ harcadınız.'
  );
  assert.equal(maskMonetaryText(sampleText, false), sampleText);
});

test('calculateWeeklyCategorySummary computes top 3 categories, WoW trend, and otherPercentage accurately', () => {
  const sample: Expense[] = [
    {
      id: 'w1',
      title: 'Migros',
      amount: 4000,
      currency: 'TRY',
      amountInTRY: 4000,
      category: 'Market',
      tags: ['#market'],
      date: '2026-11-16',
    },
    {
      id: 'w2',
      title: 'Zara',
      amount: 3000,
      currency: 'TRY',
      amountInTRY: 3000,
      category: 'Alışveriş',
      tags: ['#giyim'],
      date: '2026-11-15',
    },
    {
      id: 'w3',
      title: 'Opet',
      amount: 2000,
      currency: 'TRY',
      amountInTRY: 2000,
      category: 'Ulaşım',
      tags: ['#akaryakit'],
      date: '2026-11-14',
    },
    {
      id: 'w4',
      title: 'Kahve',
      amount: 1000,
      currency: 'TRY',
      amountInTRY: 1000,
      category: 'Yeme-İçme',
      tags: ['#kahve'],
      date: '2026-11-12',
    },
    {
      id: 'prev1',
      title: 'Geçen Hafta Market',
      amount: 8000,
      currency: 'TRY',
      amountInTRY: 8000,
      category: 'Market',
      tags: ['#market'],
      date: '2026-11-08',
    },
  ];

  const weekly = calculateWeeklyCategorySummary(sample, '2026-11-17');
  assert.equal(weekly.currentWeekTotalTRY, 10000);
  assert.equal(weekly.previousWeekTotalTRY, 8000);
  assert.equal(weekly.changePercent, 25);
  assert.equal(weekly.trendDirection, 'up');
  assert.equal(weekly.topCategories.length, 3);
  assert.equal(weekly.topCategories[0].category, 'Market');
  assert.equal(weekly.topCategories[0].percentage, 40);
  assert.equal(weekly.topCategories[0].previousWeekTotalTRY, 8000);
  assert.equal(weekly.topCategories[0].changePercent, -50);
  assert.equal(weekly.topCategories[0].trendDirection, 'down');
  assert.equal(weekly.topCategories[1].category, 'Alışveriş');
  assert.equal(weekly.topCategories[1].percentage, 30);
  assert.equal(weekly.topCategories[1].previousWeekTotalTRY, 0);
  assert.equal(weekly.topCategories[1].changePercent, 100);
  assert.equal(weekly.topCategories[1].trendDirection, 'up');
  assert.equal(weekly.topCategories[2].category, 'Ulaşım');
  assert.equal(weekly.topCategories[2].percentage, 20);
  assert.equal(weekly.topCategories[2].previousWeekTotalTRY, 0);
  assert.equal(weekly.topCategories[2].changePercent, 100);
  assert.equal(weekly.topCategories[2].trendDirection, 'up');
  assert.equal(weekly.otherTotalTRY, 1000);
  assert.equal(weekly.otherPercentage, 10);
});

test('calculateMonthEndHabitProjection computes daily habit velocity, remaining days, and month-end total accurately', () => {
  const sample: Expense[] = [
    {
      id: 'm1',
      title: 'Migros',
      amount: 6000,
      currency: 'TRY',
      amountInTRY: 6000,
      category: 'Market',
      tags: ['#market'],
      date: '2026-11-05',
    },
    {
      id: 'm2',
      title: 'Restoran',
      amount: 3000,
      currency: 'TRY',
      amountInTRY: 3000,
      category: 'Yeme-İçme',
      tags: ['#yemek'],
      date: '2026-11-12',
    },
  ];

  // 15th of November (30 days total -> 15 elapsed, 15 remaining)
  const proj = calculateMonthEndHabitProjection(sample, {
    monthYear: '2026-11',
    referenceDateISO: '2026-11-15',
    reminders: [
      {
        id: 'rem-1',
        title: 'İnternet Faturası',
        amount: 1000,
        currency: 'TRY',
        amountInTRY: 1000,
        category: 'Fatura & Abonelik',
        tags: ['#fatura'],
        dueDate: '2026-11-25',
        recurrence: 'monthly',
        status: 'pending',
      },
    ],
  });

  assert.equal(proj.totalDaysInMonth, 30);
  assert.equal(proj.elapsedDays, 15);
  assert.equal(proj.remainingDays, 15);
  assert.equal(proj.currentTotalTRY, 9000);
  assert.equal(proj.dailyAverageTRY, 600);
  assert.equal(proj.projectedHabitRemainingTRY, 9000);
  assert.equal(proj.pendingRemindersTRY, 1000);
  assert.equal(proj.projectedMonthEndTRY, 19000);
  assert.equal(proj.topProjectedCategory?.category, 'Market');
  assert.equal(proj.topProjectedCategory?.projectedTotalTRY, 12000);
});

test('parseInstantAssistantMessage preserves Turkish decimal commas and splits multi-item commas accurately', () => {
  const single = parseInstantAssistantMessage('997,90 TL gıda ekle', [], '2026-11-19');
  assert.equal(single.handled, true);
  assert.equal(single.proposedExpenses.length, 1);
  assert.equal(single.proposedExpenses[0].amount, 997.9);
  assert.equal(single.proposedExpenses[0].amountInTRY, 997.9);
  assert.equal(single.proposedExpenses[0].title, 'Gıda');
  assert.equal(single.proposedExpenses[0].category, 'Market');
  assert.ok(single.proposedExpenses[0].tags.includes('#market'));

  const multi = parseInstantAssistantMessage(
    'Bugün Sağlam Kart ile 220,50 TL kahve, 1.450,75 TL market harcadım',
    [],
    '2026-11-19'
  );
  assert.equal(multi.handled, true);
  assert.equal(multi.proposedExpenses.length, 2);
  assert.equal(multi.proposedExpenses[0].amount, 220.5);
  assert.equal(multi.proposedExpenses[0].category, 'Yeme-İçme');
  assert.equal(multi.proposedExpenses[1].amount, 1450.75);
  assert.equal(multi.proposedExpenses[1].category, 'Market');

  const multiAfterAmount = parseInstantAssistantMessage(
    'kahve 220,50, market 997,90',
    [],
    '2026-11-19'
  );
  assert.equal(multiAfterAmount.handled, true);
  assert.equal(multiAfterAmount.proposedExpenses.length, 2);
  assert.equal(multiAfterAmount.proposedExpenses[0].amount, 220.5);
  assert.equal(multiAfterAmount.proposedExpenses[1].amount, 997.9);
});

