import {
  CurrencyCode,
  Expense,
  ExpenseCategory,
  ExtractedReminder,
  PaymentReminder,
  ReminderRecurrence,
  ReminderStatus,
  ReminderUrgency,
} from '../types';
import {
  normalizeCategory,
  normalizeTagList,
  parseTurkishAmount,
} from './expenseLogic';

export function normalizeRecurrence(raw?: string): ReminderRecurrence {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'monthly' || val === 'aylık' || val === 'aylik') return 'monthly';
  if (val === 'yearly' || val === 'yıllık' || val === 'yillik') return 'yearly';
  return 'once';
}

export function normalizeReminderStatus(raw?: string): ReminderStatus {
  const val = String(raw || '').trim().toLowerCase();
  return val === 'paid' || val === 'odendi' || val === 'ödendi' ? 'paid' : 'pending';
}

export function getRecurrenceLabel(recurrence: ReminderRecurrence): string {
  if (recurrence === 'monthly') return 'Aylık Tekrar';
  if (recurrence === 'yearly') return 'Yıllık Tekrar';
  return 'Tek Seferlik';
}

/**
 * Aylık veya yıllık tekrarlı hatırlatmalarda ay sonu taşmalarını güvenli şekilde kırpar.
 * Örn: 2026-01-31 + monthly -> 2026-02-28
 */
export function computeNextDueDate(
  dueDate: string,
  recurrence: ReminderRecurrence
): string {
  const clean = String(dueDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || recurrence === 'once') {
    return clean;
  }
  const [y, m, d] = clean.split('-').map(Number);
  if (recurrence === 'monthly') {
    const nextMonthIdx = m; // 0-indexed next month (1..12)
    const targetYear = y + Math.floor(nextMonthIdx / 12);
    const targetMonth = (nextMonthIdx % 12) + 1;
    const maxDay = new Date(targetYear, targetMonth, 0).getDate();
    const clampedDay = Math.min(d, maxDay);
    return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
  }

  // yearly
  const targetYear = y + 1;
  const maxDay = new Date(targetYear, m, 0).getDate();
  const clampedDay = Math.min(d, maxDay);
  return `${targetYear}-${String(m).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

export function addDaysISO(dateISO: string, days: number): string {
  const clean = String(dateISO || '').slice(0, 10);
  const [y, m, d] = /^\d{4}-\d{2}-\d{2}$/.test(clean)
    ? clean.split('-').map(Number)
    : (() => {
        const now = new Date();
        return [now.getFullYear(), now.getMonth() + 1, now.getDate()];
      })();
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function shiftMonthYear(ym: string, deltaMonths: number): string {
  const [y, m] = /^\d{4}-\d{2}$/.test(ym)
    ? ym.split('-').map(Number)
    : (() => {
        const now = new Date();
        return [now.getFullYear(), now.getMonth() + 1];
      })();
  const dt = new Date(y, m - 1 + deltaMonths, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

export function formatMonthYearTR(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return ym;
  const [y, m] = ym.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      month: 'long',
      year: 'numeric',
    }).format(new Date(y, m - 1, 1));
  } catch {
    return ym;
  }
}

export function getDaysDiffFromToday(dueDate: string, todayISO?: string): number {
  const today = (todayISO || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const due = String(dueDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return 0;
  }
  const [ty, tm, td] = today.split('-').map(Number);
  const [dy, dm, dd] = due.split('-').map(Number);
  const msToday = Date.UTC(ty, tm - 1, td);
  const msDue = Date.UTC(dy, dm - 1, dd);
  return Math.round((msDue - msToday) / 86400000);
}

export function getReminderUrgency(
  reminder: Pick<PaymentReminder, 'dueDate' | 'status'>,
  todayISO?: string
): ReminderUrgency {
  if (reminder.status === 'paid') return 'paid';
  const diff = getDaysDiffFromToday(reminder.dueDate, todayISO);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  return 'upcoming';
}

export function formatReminderCountdownTR(
  reminder: Pick<PaymentReminder, 'dueDate' | 'status'>,
  todayISO?: string
): string {
  if (reminder.status === 'paid') return 'Ödendi';
  const diff = getDaysDiffFromToday(reminder.dueDate, todayISO);
  if (diff < 0) return `${Math.abs(diff)} gün gecikti`;
  if (diff === 0) return 'Bugün son gün';
  if (diff === 1) return 'Yarın';
  return `${diff} gün kaldı`;
}

export interface CalendarProjectionMetrics {
  realizedTRY: number;
  realizedCount: number;
  pendingMonthTRY: number;
  pendingMonthCount: number;
  projectedMonthEndTRY: number;
  overdueCount: number;
  overdueTRY: number;
  paidMonthCount: number;
}

export function calculateCalendarProjection(
  expenses: Expense[],
  reminders: PaymentReminder[],
  targetYM: string,
  todayISO?: string
): CalendarProjectionMetrics {
  const today = (todayISO || new Date().toISOString().slice(0, 10)).slice(0, 10);

  let realizedTRY = 0;
  let realizedCount = 0;
  for (const exp of expenses) {
    if (String(exp.date || '').startsWith(targetYM)) {
      realizedTRY += Number(exp.amountInTRY) || 0;
      realizedCount += 1;
    }
  }

  let pendingMonthTRY = 0;
  let pendingMonthCount = 0;
  let overdueCount = 0;
  let overdueTRY = 0;
  let paidMonthCount = 0;

  for (const rem of reminders) {
    const amt = Number(rem.amountInTRY) || 0;
    const isInMonth = String(rem.dueDate || '').startsWith(targetYM);
    if (rem.status === 'pending') {
      if (isInMonth) {
        pendingMonthTRY += amt;
        pendingMonthCount += 1;
      }
      if (String(rem.dueDate || '').slice(0, 10) < today) {
        overdueCount += 1;
        overdueTRY += amt;
      }
    } else if (isInMonth) {
      paidMonthCount += 1;
    }
  }

  return {
    realizedTRY: Math.round(realizedTRY * 100) / 100,
    realizedCount,
    pendingMonthTRY: Math.round(pendingMonthTRY * 100) / 100,
    pendingMonthCount,
    projectedMonthEndTRY: Math.round((realizedTRY + pendingMonthTRY) * 100) / 100,
    overdueCount,
    overdueTRY: Math.round(overdueTRY * 100) / 100,
    paidMonthCount,
  };
}

export type ReminderFilterMode = 'all' | 'pending' | 'overdue' | 'paid';

export function filterAndSortReminders(
  reminders: PaymentReminder[],
  mode: ReminderFilterMode,
  todayISO?: string
): PaymentReminder[] {
  const today = (todayISO || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const filtered = reminders.filter((rem) => {
    if (mode === 'all') return true;
    if (mode === 'paid') return rem.status === 'paid';
    if (mode === 'overdue') {
      return rem.status === 'pending' && String(rem.dueDate || '').slice(0, 10) < today;
    }
    // pending
    return rem.status === 'pending';
  });

  return filtered.sort((a, b) => {
    // Bekleyenler önce, ödenmişler sonra
    if (a.status !== b.status) {
      return a.status === 'pending' ? -1 : 1;
    }
    if (a.status === 'pending') {
      return String(a.dueDate || '').localeCompare(String(b.dueDate || ''));
    }
    return String(b.dueDate || '').localeCompare(String(a.dueDate || ''));
  });
}

export interface DueAlertSummary {
  items: PaymentReminder[];
  overdueCount: number;
  todayCount: number;
  tomorrowCount: number;
  totalAmountTRY: number;
  highestUrgency: 'overdue' | 'today' | 'tomorrow' | null;
}

export interface DismissedAlertRecord {
  date: string;
  ids: string[];
}

/**
 * Vadesi geçmiş (< bugün), bugün (T+0) ve yarın (T+1) olan bekleyen ödemeleri
 * en acilden en yakına sıralayarak kompakt uyarı şeridi özeti üretir.
 */
export function getDueAlertSummary(
  reminders: PaymentReminder[],
  todayISO?: string
): DueAlertSummary {
  const today = (todayISO || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const urgentItems: PaymentReminder[] = [];
  let overdueCount = 0;
  let todayCount = 0;
  let tomorrowCount = 0;
  let totalAmountTRY = 0;

  for (const rem of reminders || []) {
    if (rem.status !== 'pending') continue;
    const diff = getDaysDiffFromToday(rem.dueDate, today);
    if (diff > 1) continue;

    urgentItems.push(rem);
    totalAmountTRY += Number(rem.amountInTRY) || 0;
    if (diff < 0) overdueCount += 1;
    else if (diff === 0) todayCount += 1;
    else tomorrowCount += 1;
  }

  urgentItems.sort((a, b) =>
    String(a.dueDate || '').localeCompare(String(b.dueDate || ''))
  );

  const highestUrgency: DueAlertSummary['highestUrgency'] =
    overdueCount > 0
      ? 'overdue'
      : todayCount > 0
      ? 'today'
      : tomorrowCount > 0
      ? 'tomorrow'
      : null;

  return {
    items: urgentItems,
    overdueCount,
    todayCount,
    tomorrowCount,
    totalAmountTRY: Math.round(totalAmountTRY * 100) / 100,
    highestUrgency,
  };
}

/**
 * Aynı gün kapatılan uyarı şeridinin gizli kalıp kalmayacağını belirler;
 * gün değiştiğinde veya aynı gün yeni bir acil ödeme eklendiğinde tekrar görünür.
 */
export function shouldShowDueAlert(
  summary: DueAlertSummary,
  dismissed: DismissedAlertRecord | null,
  todayISO?: string
): boolean {
  if (summary.items.length === 0) return false;
  const today = (todayISO || new Date().toISOString().slice(0, 10)).slice(0, 10);
  if (!dismissed || dismissed.date !== today) return true;
  const dismissedSet = new Set(dismissed.ids || []);
  return summary.items.some((item) => !dismissedSet.has(item.id));
}

const TURKISH_MONTHS: Record<string, number> = {
  ocak: 1,
  subat: 2,
  mart: 3,
  nisan: 4,
  mayis: 5,
  haziran: 6,
  temmuz: 7,
  agustos: 8,
  eylul: 9,
  ekim: 10,
  kasim: 11,
  aralik: 12,
};

function toAsciiLowerTR(str: string): string {
  return String(str || '')
    .replace(/[İI]/g, 'i')
    .replace(/Ç/g, 'c')
    .replace(/ç/g, 'c')
    .replace(/Ğ/g, 'g')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/Ö/g, 'o')
    .replace(/ö/g, 'o')
    .replace(/Ş/g, 's')
    .replace(/ş/g, 's')
    .replace(/Ü/g, 'u')
    .replace(/ü/g, 'u')
    .toLowerCase();
}

function extractTurkishDateFromPrompt(
  rawText: string,
  todayISO: string
): { dueDate: string; recurrence: ReminderRecurrence; matchedSpan?: string } {
  const ascii = toAsciiLowerTR(rawText);
  const [ty, tm, td] = todayISO.split('-').map(Number);

  let recurrence: ReminderRecurrence = 'once';
  if (/her\s*ay|aylik|her\s+ayin/.test(ascii)) {
    recurrence = 'monthly';
  } else if (/her\s*yil|yillik|senelik/.test(ascii)) {
    recurrence = 'yearly';
  }

  // 1. ISO YYYY-MM-DD
  const isoMatch = rawText.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return { dueDate: isoMatch[1], recurrence, matchedSpan: isoMatch[1] };
  }

  // 2. DD.MM.YYYY or DD/MM/YYYY
  const trFullMatch = rawText.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
  if (trFullMatch) {
    const day = Math.min(Math.max(Number(trFullMatch[1]), 1), 31);
    const month = Math.min(Math.max(Number(trFullMatch[2]), 1), 12);
    const year = Number(trFullMatch[3]);
    const maxD = new Date(year, month, 0).getDate();
    const formatted = `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, maxD)).padStart(2, '0')}`;
    return { dueDate: formatted, recurrence, matchedSpan: trFullMatch[0] };
  }

  // 3. "25 Kasım", "5 Aralık 2026"
  const monthNamesPattern = Object.keys(TURKISH_MONTHS).join('|');
  const namedDateRegex = new RegExp(
    `\\b(\\d{1,2})\\s*(${monthNamesPattern})(?:\\s*(\\d{4}))?(?:'?(?:da|de|ta|te|nda|nde))?\\b`,
    'i'
  );
  const namedMatch = ascii.match(namedDateRegex);
  if (namedMatch) {
    const day = Math.min(Math.max(Number(namedMatch[1]), 1), 31);
    const monthNum = TURKISH_MONTHS[namedMatch[2]] || tm;
    let year = namedMatch[3] ? Number(namedMatch[3]) : ty;
    if (!namedMatch[3]) {
      const candidateMax = new Date(year, monthNum, 0).getDate();
      const candidateISO = `${year}-${String(monthNum).padStart(2, '0')}-${String(Math.min(day, candidateMax)).padStart(2, '0')}`;
      if (candidateISO < todayISO) {
        year += 1;
      }
    }
    const maxD = new Date(year, monthNum, 0).getDate();
    const formatted = `${year}-${String(monthNum).padStart(2, '0')}-${String(Math.min(day, maxD)).padStart(2, '0')}`;
    return { dueDate: formatted, recurrence, matchedSpan: namedMatch[0] };
  }

  // 4. "her ayın 5'inde" / "gelecek ayın 15'i" / "ayın 20'sinde"
  const dayOfMonthMatch = ascii.match(
    /(?:her\s+ayin|gelecek\s+ayin|onumuzdeki\s+ayin|ayin)\s*(\d{1,2})(?:'?(?:i|u|si|su|inda|inde|sinda|sinde))?/
  );
  if (dayOfMonthMatch) {
    const day = Math.min(Math.max(Number(dayOfMonthMatch[1]), 1), 31);
    let targetYear = ty;
    let targetMonth = tm;
    if (/gelecek\s+ayin|onumuzdeki\s+ayin/.test(dayOfMonthMatch[0])) {
      targetMonth += 1;
      if (targetMonth > 12) {
        targetMonth = 1;
        targetYear += 1;
      }
    } else if (day < td) {
      targetMonth += 1;
      if (targetMonth > 12) {
        targetMonth = 1;
        targetYear += 1;
      }
    }
    const maxD = new Date(targetYear, targetMonth, 0).getDate();
    const formatted = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(day, maxD)).padStart(2, '0')}`;
    return { dueDate: formatted, recurrence, matchedSpan: dayOfMonthMatch[0] };
  }

  // 5. "yarın" / "bugün" / "gelecek ay" / "X gün sonra"
  if (/\byarin\b/.test(ascii)) {
    return { dueDate: addDaysISO(todayISO, 1), recurrence, matchedSpan: 'yarın' };
  }
  const daysLaterMatch = ascii.match(/(\d{1,3})\s*gun\s*sonra/);
  if (daysLaterMatch) {
    const offset = Math.min(Math.max(Number(daysLaterMatch[1]), 1), 365);
    return {
      dueDate: addDaysISO(todayISO, offset),
      recurrence,
      matchedSpan: daysLaterMatch[0],
    };
  }
  if (/gelecek\s+ay|onumuzdeki\s+ay/.test(ascii)) {
    const nextYM = shiftMonthYear(todayISO.slice(0, 7), 1);
    const [ny, nm] = nextYM.split('-').map(Number);
    const maxD = new Date(ny, nm, 0).getDate();
    return {
      dueDate: `${nextYM}-${String(Math.min(td, maxD)).padStart(2, '0')}`,
      recurrence,
      matchedSpan: 'gelecek ay',
    };
  }

  return { dueDate: addDaysISO(todayISO, 7), recurrence };
}

export interface InstantReminderAssistantResult {
  handled: boolean;
  reply: string;
  proposedReminders: ExtractedReminder[];
  analysisHighlight?: {
    label: string;
    totalTRY: number;
    count: number;
  };
}

/**
 * Doğal dilde yazılan ödeme hatırlatma ekleme ve yaklaşan/geciken ödeme sorgularını
 * 0ms gecikmeyle anlık olarak çözümler.
 */
export function parseInstantReminderMessage(
  message: string,
  existingReminders: PaymentReminder[] = [],
  todayISO?: string
): InstantReminderAssistantResult {
  const raw = String(message || '').trim();
  const today = (todayISO || new Date().toISOString().slice(0, 10)).slice(0, 10);
  if (!raw) {
    return { handled: false, reply: '', proposedReminders: [] };
  }

  const ascii = toAsciiLowerTR(raw);

  // A) Sorgu / Kontrol: "Yaklaşan ödemelerim neler?", "Geciken ödeme var mı?", "Bekleyen faturalar"
  const isReminderQuery =
    /(yaklasan|gelecek|bekleyen|geciken|gecmis|vadesi|planlanan|odenecek).*(odeme|fatura|hatirlatma|kira|aidat|borc|taksit|neler|var\s*mi|ne\s*kadar)/.test(
      ascii
    ) ||
    /hatirlatmalarim|odemelerimi\s+listele|odeme\s+takvimi/.test(ascii);

  const hasAddVerb = /(hatirlat|ekle|planla|olustur|kur|kaydet|yaz)/.test(ascii);
  const hasExplicitAmount = /\b\d+(?:[.,]\d{1,2})?\s*(?:tl|try|₺|usd|\$|eur|€|gbp|£)?\b/i.test(
    raw
  ) && !/\b\d{1,2}\s*(?:ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\b/.test(ascii.replace(/\d+(?:[.,]\d+)?\s*(?:tl|try|₺|usd|\$|eur|€|gbp|£)/gi, ''));

  if (isReminderQuery && !hasAddVerb) {
    const wantsOverdue = /geciken|vadesi\s+gecmis/.test(ascii);
    const scoped = existingReminders.filter((r) => {
      if (r.status !== 'pending') return false;
      if (wantsOverdue) return r.dueDate.slice(0, 10) < today;
      return true;
    });

    const sorted = [...scoped].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const totalTRY = Math.round(sorted.reduce((s, r) => s + (Number(r.amountInTRY) || 0), 0) * 100) / 100;

    if (sorted.length === 0) {
      return {
        handled: true,
        reply: wantsOverdue
          ? 'Harika! Şu anda vadesi geçmiş (gecikmiş) bekleyen ödeme hatırlatmanız bulunmuyor.'
          : 'Şu anda takvimde bekleyen ileriye dönük bir ödeme hatırlatmanız bulunmuyor. Örneğin "Her ayın 5\'inde 18.000 TL kira hatırlat" yazarak ekleyebilirsiniz.',
        proposedReminders: [],
        analysisHighlight: {
          label: wantsOverdue ? 'Gecikmiş Ödemeler' : 'Bekleyen Ödemeler',
          totalTRY: 0,
          count: 0,
        },
      };
    }

    const previewLines = sorted
      .slice(0, 5)
      .map(
        (r) =>
          `• ${r.title} (${r.dueDate} — ${formatReminderCountdownTR(r, today)}): ${Number(
            r.amountInTRY
          ).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`
      )
      .join('\n');

    return {
      handled: true,
      reply: `${wantsOverdue ? 'Vadesi geçmiş' : 'Planlanmış bekleyen'} ${sorted.length} adet ödemeniz var (Toplam ${totalTRY.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺):\n${previewLines}`,
      proposedReminders: [],
      analysisHighlight: {
        label: wantsOverdue ? 'Gecikmiş Ödeme Toplamı' : 'Planlanan Bekleyen Ödemeler',
        totalTRY,
        count: sorted.length,
      },
    };
  }

  // B) Hatırlatma Oluşturma Niyeti:
  const hasReminderIntent =
    /(hatirlat|hatirlatma|planla|vadesi|son\s+odeme|odeme\s+takvimi|takvime\s+ekle|her\s+ayin|gelecek\s+ay)/.test(
      ascii
    );

  if (!hasReminderIntent) {
    return { handled: false, reply: '', proposedReminders: [] };
  }

  // Tutar yakalama (tarih rakamlarıyla karışmaması için para birimli veya en makul sayıyı al)
  let detectedAmount = 0;
  let detectedCurrency: CurrencyCode = 'TRY';
  const currMatch = raw.match(
    /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(tl|try|₺|usd|\$|eur|€|gbp|£)/i
  );
  if (currMatch) {
    detectedAmount = Math.abs(parseTurkishAmount(currMatch[1]));
    const sym = currMatch[2].toLowerCase();
    if (sym === 'usd' || sym === '$') detectedCurrency = 'USD';
    else if (sym === 'eur' || sym === '€') detectedCurrency = 'EUR';
    else if (sym === 'gbp' || sym === '£') detectedCurrency = 'GBP';
  } else {
    // Tarih gün numarası olmayan ilk bağımsız sayıyı bul
    const strippedDates = raw
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
      .replace(/\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/g, ' ')
      .replace(
        new RegExp(
          `\\b\\d{1,2}\\s*(?:${Object.keys(TURKISH_MONTHS).join('|')})(?:\\s*\\d{4})?(?:'?(?:da|de|ta|te|nda|nde))?\\b`,
          'gi'
        ),
        ' '
      )
      .replace(/(?:her\s+ay[ıi]n|gelecek\s+ay[ıi]n|ayın)\s*\d{1,2}(?:'?(?:i|u|si|su|ında|inde|sında|sinde))?/gi, ' ');
    const numMatch = strippedDates.match(/\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+)\b/);
    if (numMatch) {
      detectedAmount = Math.abs(parseTurkishAmount(numMatch[1]));
    }
  }

  const { dueDate, recurrence } = extractTurkishDateFromPrompt(raw, today);

  // Etiketler
  const explicitTags = raw.match(/#[a-zA-Z0-9_çğıöşüÇĞİÖŞÜ-]+/g) || [];
  const tags = [...explicitTags];
  if (/yapikredi|yapı\s*kredi|world/.test(ascii)) tags.push('#yapikredi');
  if (/saglam\s*kart|sağlam\s*kart|kuveyt/.test(ascii)) tags.push('#saglamkart');
  if (/enpara/.test(ascii)) tags.push('#enpara');
  if (/garanti|bonus/.test(ascii)) tags.push('#garanti');
  if (/kira/.test(ascii)) tags.push('#kira');
  if (/aidat/.test(ascii)) tags.push('#aidat');
  if (/elektrik|su\b|dogalgaz|doğalgaz|internet|fatura/.test(ascii)) tags.push('#fatura');

  // Başlığı temizle
  let cleanTitle = raw
    .replace(/#[a-zA-Z0-9_çğıöşüÇĞİÖŞÜ-]+/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/g, ' ')
    .replace(
      /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+)\s*(tl|try|₺|usd|\$|eur|€|gbp|£)?/gi,
      (m, _num, unit) => (unit ? ' ' : m)
    )
    .replace(
      /(?:her\s+ay[ıi]n|gelecek\s+ay[ıi]n|önümüzdeki\s+ay[ıi]n|ayın)\s*\d{1,2}(?:'?(?:i|ı|u|ü|si|sı|su|sü|ında|inde|sında|sinde))?/gi,
      ' '
    )
    .replace(
      new RegExp(
        `\\b\\d{1,2}\\s*(?:${Object.keys(TURKISH_MONTHS).join('|')}|ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)(?:\\s*\\d{4})?(?:'?(?:da|de|ta|te|nda|nde))?\\b`,
        'gi'
      ),
      ' '
    )
    .replace(/\b(bugün|yarın|gelecek ay|önümüzdeki ay|her ay|aylık|yıllık|hatırlat|hatırlatma|planla|takvime|ekle|oluştur|kur|kaydet|için|olarak|ödeme|ödemesi|ödemesini|faturası|faturasını|lütfen)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanTitle || cleanTitle.length < 2) {
    if (/kira/.test(ascii)) cleanTitle = 'Kira Ödemesi';
    else if (/aidat/.test(ascii)) cleanTitle = 'Site Aidatı';
    else if (/elektrik/.test(ascii)) cleanTitle = 'Elektrik Faturası';
    else if (/dogalgaz|doğalgaz/.test(ascii)) cleanTitle = 'Doğalgaz Faturası';
    else if (/internet/.test(ascii)) cleanTitle = 'İnternet Faturası';
    else if (/su\b/.test(ascii)) cleanTitle = 'Su Faturası';
    else if (/kredi\s*kart/.test(ascii)) cleanTitle = 'Kredi Kartı Ödemesi';
    else cleanTitle = 'Planlanan Ödeme';
  } else {
    // Baş harfleri büyüt
    cleanTitle = cleanTitle
      .split(' ')
      .map((w) => (w ? w[0].toLocaleUpperCase('tr-TR') + w.slice(1) : ''))
      .join(' ');
  }

  const category: ExpenseCategory = normalizeCategory(
    `${cleanTitle} ${raw}`
  ) === 'Diğer' && /kira|aidat|vergi|kredi\s*kart/.test(ascii)
    ? 'Fatura & Abonelik'
    : normalizeCategory(`${cleanTitle} ${raw}`);

  const normalizedTags = normalizeTagList(tags);
  const finalTags = normalizedTags.length > 0 ? normalizedTags : ['#planli'];

  if (detectedAmount <= 0 && !hasExplicitAmount && !hasAddVerb) {
    return { handled: false, reply: '', proposedReminders: [] };
  }

  const proposal: ExtractedReminder = {
    title: cleanTitle,
    amount: detectedAmount,
    currency: detectedCurrency,
    amountInTRY: detectedAmount,
    category,
    tags: finalTags,
    dueDate,
    recurrence,
    notes: recurrence === 'monthly' ? 'Her ay otomatik yinelenir' : recurrence === 'yearly' ? 'Her yıl yinelenir' : '',
  };

  return {
    handled: true,
    reply:
      detectedAmount > 0
        ? `Takvime eklenecek ödeme hatırlatmasını hazırladım: **${cleanTitle}** (${dueDate} · ${getRecurrenceLabel(recurrence)} · ${detectedAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${detectedCurrency}). Onaylayarak takvime kaydedebilirsiniz:`
        : `Takvim için "${cleanTitle}" (${dueDate}) hatırlatmasını hazırladım; aşağıdaki kutudan tutarı yazıp kaydedebilirsiniz:`,
    proposedReminders: [proposal],
  };
}
