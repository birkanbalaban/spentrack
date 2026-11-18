import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCalendarProjection,
  computeNextDueDate,
  filterAndSortReminders,
  getDueAlertSummary,
  getReminderUrgency,
  parseInstantReminderMessage,
  shouldShowDueAlert,
} from './reminderLogic';
import { Expense, PaymentReminder } from '../types';

test('computeNextDueDate handles monthly rollover, year boundary, and month-end clamping', () => {
  assert.equal(computeNextDueDate('2026-11-05', 'monthly'), '2026-12-05');
  assert.equal(computeNextDueDate('2026-12-15', 'monthly'), '2027-01-15');
  assert.equal(computeNextDueDate('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(computeNextDueDate('2024-02-29', 'yearly'), '2025-02-28');
  assert.equal(computeNextDueDate('2026-11-16', 'once'), '2026-11-16');
});

test('getReminderUrgency classifies overdue, today, upcoming, and paid accurately', () => {
  const today = '2026-11-16';
  assert.equal(getReminderUrgency({ dueDate: '2026-11-14', status: 'pending' }, today), 'overdue');
  assert.equal(getReminderUrgency({ dueDate: '2026-11-16', status: 'pending' }, today), 'today');
  assert.equal(getReminderUrgency({ dueDate: '2026-11-25', status: 'pending' }, today), 'upcoming');
  assert.equal(getReminderUrgency({ dueDate: '2026-11-10', status: 'paid' }, today), 'paid');
});

test('calculateCalendarProjection separates realized expenses from pending reminders and sums month-end projection', () => {
  const expenses: Expense[] = [
    {
      id: 'e1',
      title: 'Migros',
      amount: 1500,
      currency: 'TRY',
      amountInTRY: 1500,
      category: 'Market',
      tags: ['#market'],
      date: '2026-11-10',
    },
    {
      id: 'e2',
      title: 'İade',
      amount: -200,
      currency: 'TRY',
      amountInTRY: -200,
      category: 'Alışveriş',
      tags: ['#iade'],
      date: '2026-11-12',
    },
  ];
  const reminders: PaymentReminder[] = [
    {
      id: 'r1',
      title: 'Elektrik',
      amount: 560,
      currency: 'TRY',
      amountInTRY: 560,
      category: 'Fatura & Abonelik',
      tags: ['#fatura'],
      dueDate: '2026-11-25',
      recurrence: 'monthly',
      status: 'pending',
    },
    {
      id: 'r2',
      title: 'Geciken Aidat',
      amount: 2000,
      currency: 'TRY',
      amountInTRY: 2000,
      category: 'Fatura & Abonelik',
      tags: ['#aidat'],
      dueDate: '2026-11-10',
      recurrence: 'monthly',
      status: 'pending',
    },
    {
      id: 'r3',
      title: 'Ödenmiş Su',
      amount: 300,
      currency: 'TRY',
      amountInTRY: 300,
      category: 'Fatura & Abonelik',
      tags: ['#fatura'],
      dueDate: '2026-11-05',
      recurrence: 'monthly',
      status: 'paid',
    },
  ];

  const stats = calculateCalendarProjection(expenses, reminders, '2026-11', '2026-11-16');
  assert.equal(stats.realizedTRY, 1300);
  assert.equal(stats.pendingMonthTRY, 2560);
  assert.equal(stats.projectedMonthEndTRY, 3860);
  assert.equal(stats.overdueCount, 1);
  assert.equal(stats.overdueTRY, 2000);
  assert.equal(stats.paidMonthCount, 1);

  const overdueOnly = filterAndSortReminders(reminders, 'overdue', '2026-11-16');
  assert.equal(overdueOnly.length, 1);
  assert.equal(overdueOnly[0].id, 'r2');
});

test('parseInstantReminderMessage handles Turkish scheduling and status queries at 0ms', () => {
  const today = '2026-11-16';
  const scheduleRes = parseInstantReminderMessage(
    "Her ayın 5'inde 18.000 TL kira hatırlat #kira",
    [],
    today
  );
  assert.equal(scheduleRes.handled, true);
  assert.equal(scheduleRes.proposedReminders.length, 1);
  assert.equal(scheduleRes.proposedReminders[0].amount, 18000);
  assert.equal(scheduleRes.proposedReminders[0].dueDate, '2026-12-05');
  assert.equal(scheduleRes.proposedReminders[0].recurrence, 'monthly');
  assert.equal(scheduleRes.proposedReminders[0].category, 'Fatura & Abonelik');

  const datedRes = parseInstantReminderMessage(
    '25 Kasım 560 TL Enerjisa elektrik faturası planla',
    [],
    today
  );
  assert.equal(datedRes.handled, true);
  assert.equal(datedRes.proposedReminders[0].dueDate, '2026-11-25');
  assert.equal(datedRes.proposedReminders[0].amount, 560);

  const queryRes = parseInstantReminderMessage(
    'Yaklaşan ödemelerim neler?',
    [
      {
        id: 'rem-1',
        title: 'Kira',
        amount: 18000,
        currency: 'TRY',
        amountInTRY: 18000,
        category: 'Fatura & Abonelik',
        tags: ['#kira'],
        dueDate: '2026-12-05',
        recurrence: 'monthly',
        status: 'pending',
      },
    ],
    today
  );
  assert.equal(queryRes.handled, true);
  assert.equal(queryRes.analysisHighlight?.totalTRY, 18000);
  assert.equal(queryRes.analysisHighlight?.count, 1);
});

test('getDueAlertSummary and shouldShowDueAlert filter overdue/today/tomorrow and handle daily dismiss cleanly', () => {
  const today = '2026-11-16';
  const reminders: PaymentReminder[] = [
    {
      id: 'rem-tomorrow',
      title: 'İnternet Faturası',
      amount: 450,
      currency: 'TRY',
      amountInTRY: 450,
      category: 'Fatura & Abonelik',
      tags: ['#fatura'],
      dueDate: '2026-11-17',
      recurrence: 'monthly',
      status: 'pending',
    },
    {
      id: 'rem-overdue',
      title: 'Kredi Kartı Ekstresi',
      amount: 3200,
      currency: 'TRY',
      amountInTRY: 3200,
      category: 'Diğer',
      tags: ['#yapikredi'],
      dueDate: '2026-11-14',
      recurrence: 'monthly',
      status: 'pending',
    },
    {
      id: 'rem-today',
      title: 'Doğalgaz',
      amount: 780,
      currency: 'TRY',
      amountInTRY: 780,
      category: 'Fatura & Abonelik',
      tags: ['#fatura'],
      dueDate: '2026-11-16',
      recurrence: 'monthly',
      status: 'pending',
    },
    {
      id: 'rem-future',
      title: 'Kira (Uzak)',
      amount: 18000,
      currency: 'TRY',
      amountInTRY: 18000,
      category: 'Fatura & Abonelik',
      tags: ['#kira'],
      dueDate: '2026-11-20',
      recurrence: 'monthly',
      status: 'pending',
    },
    {
      id: 'rem-paid-today',
      title: 'Ödenmiş Su',
      amount: 210,
      currency: 'TRY',
      amountInTRY: 210,
      category: 'Fatura & Abonelik',
      tags: ['#fatura'],
      dueDate: '2026-11-16',
      recurrence: 'monthly',
      status: 'paid',
    },
  ];

  const summary = getDueAlertSummary(reminders, today);
  assert.equal(summary.items.length, 3);
  assert.deepEqual(
    summary.items.map((i) => i.id),
    ['rem-overdue', 'rem-today', 'rem-tomorrow']
  );
  assert.equal(summary.overdueCount, 1);
  assert.equal(summary.todayCount, 1);
  assert.equal(summary.tomorrowCount, 1);
  assert.equal(summary.totalAmountTRY, 4430);
  assert.equal(summary.highestUrgency, 'overdue');

  assert.equal(shouldShowDueAlert(summary, null, today), true);

  const dismissedSameDay = {
    date: today,
    ids: ['rem-overdue', 'rem-today', 'rem-tomorrow'],
  };
  assert.equal(shouldShowDueAlert(summary, dismissedSameDay, today), false);

  // Ertesi gün tekrar görünür
  assert.equal(shouldShowDueAlert(summary, dismissedSameDay, '2026-11-17'), true);

  // Aynı gün yepyeni bir acil ödeme eklenirse tekrar uyanır
  const summaryWithNew = getDueAlertSummary(
    [
      ...reminders,
      {
        id: 'rem-new-today',
        title: 'Su Faturası',
        amount: 310,
        currency: 'TRY',
        amountInTRY: 310,
        category: 'Fatura & Abonelik',
        tags: ['#fatura'],
        dueDate: '2026-11-16',
        recurrence: 'once',
        status: 'pending',
      },
    ],
    today
  );
  assert.equal(shouldShowDueAlert(summaryWithNew, dismissedSameDay, today), true);
});
