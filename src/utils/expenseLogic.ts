import {
  CurrencyCode,
  CurrencyRates,
  DateGroup,
  Expense,
  ExpenseCategory,
  ExpenseFilters,
  ExtractedExpense,
  FIXED_CATEGORIES,
  MarkedCandidate,
  MetricsSummary,
} from '../types';

/**
 * Türkiye para formatını (örn: "1.250,50 TL", "-340,00", "1250.5") sayıya dönüştürür.
 */
export function parseTurkishAmount(raw: string | number): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? Math.round(raw * 100) / 100 : 0;
  }
  const str = String(raw || '').trim();
  if (!str) return 0;

  const isNegative = str.includes('-') || /iade|iptal/i.test(str);
  const cleaned = str.replace(/[^0-9.,]/g, '');
  if (!cleaned) return 0;

  let normalized = cleaned;
  // Hem nokta hem virgül varsa: "1.250,50" -> "1250.50" veya "1,250.50" -> "1250.50"
  if (cleaned.includes('.') && cleaned.includes(',')) {
    const lastDot = cleaned.lastIndexOf('.');
    const lastComma = cleaned.lastIndexOf(',');
    if (lastComma > lastDot) {
      // TR format: 1.250,50
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: 1,250.50
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    // Sadece virgül varsa: "220,50" -> "220.50"
    const parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      normalized = `${parts[0]}.${parts[1]}`;
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes('.')) {
    // Sadece nokta varsa: "1.250" (binlik) mi yoksa "12.50" (kuruş) mu?
    const parts = cleaned.split('.');
    if (parts.length > 2) {
      normalized = cleaned.replace(/\./g, '');
    } else if (parts.length === 2 && parts[1].length === 3 && parts[0].length >= 1) {
      // "1.250" -> 1250
      normalized = cleaned.replace(/\./g, '');
    }
  }

  const val = parseFloat(normalized);
  if (!Number.isFinite(val)) return 0;
  const rounded = Math.round(Math.abs(val) * 100) / 100;
  return isNegative ? -rounded : rounded;
}

/**
 * Etiketi standart '#kucukharf' formatına normalize eder.
 */
export function normalizeTag(raw: string): string {
  const trimmed = String(raw || '').trim().toLowerCase();
  if (!trimmed) return '';
  const map: Record<string, string> = {
    ç: 'c',
    ğ: 'g',
    ı: 'i',
    ö: 'o',
    ş: 's',
    ü: 'u',
  };
  const ascii = trimmed
    .replace(/[çğıöşü]/g, (ch) => map[ch] || ch)
    .replace(/[^a-z0-9_#-]/g, '');
  if (!ascii || ascii === '#') return '';
  return ascii.startsWith('#') ? ascii : `#${ascii}`;
}

export function normalizeTagList(tags: string[]): string[] {
  const set = new Set<string>();
  for (const t of tags || []) {
    const norm = normalizeTag(t);
    if (norm) set.add(norm);
  }
  return Array.from(set);
}

/**
 * Kategori değerini sabit 8 kategoriden birine eşler.
 */
export function normalizeCategory(raw: string): ExpenseCategory {
  const clean = String(raw || '').trim();
  if ((FIXED_CATEGORIES as readonly string[]).includes(clean)) {
    return clean as ExpenseCategory;
  }
  const lower = clean.toLowerCase();
  if (/market|gida|migros|bim|a101|sok|carrefour|file|kasap|manav/.test(lower)) return 'Market';
  if (/yeme|icme|kahve|restoran|kafe|cafe|starbucks|yemek|getiryemek|trendyolyemek/.test(lower)) return 'Yeme-İçme';
  if (/ulasim|taksi|uber|marti|benzin|akaryakit|opet|shell|petrol|bilet|ucak|otobus|metro|istanbulkart/.test(lower)) return 'Ulaşım';
  if (/fatura|abonelik|netflix|spotify|youtube|icloud|elektrik|su|dogalgaz|internet|turkcell|vodafone|telekom/.test(lower)) return 'Fatura & Abonelik';
  if (/alisveris|giyim|elektronik|amazon|hepsiburada|trendyol|zara|ikea|boyner/.test(lower)) return 'Alışveriş';
  if (/eglence|sinema|konser|oyun|steam|playstation|tiyatro|etkinlik/.test(lower)) return 'Eğlence';
  if (/saglik|eczane|hastane|doktor|ilac|dis|optik/.test(lower)) return 'Sağlık';
  return 'Diğer';
}

export const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  Market: '#f97316',             // Canlı Turuncu
  'Yeme-İçme': '#10b981',        // Zümrüt Yeşili
  Ulaşım: '#0ea5e9',             // Gökyüzü Mavisi
  'Fatura & Abonelik': '#8b5cf6',// Mor / Violet
  Alışveriş: '#f43f5e',          // Mercan Pembe
  Eğlence: '#14b8a6',            // Turkuaz
  Sağlık: '#eab308',             // Kehribar Sarı
  Diğer: '#6366f1',              // İndigo
};

const TAG_COLOR_PALETTE = [
  '#f97316', // Orange
  '#10b981', // Emerald
  '#0ea5e9', // Sky Blue
  '#f43f5e', // Rose
  '#8b5cf6', // Violet
  '#eab308', // Amber
  '#14b8a6', // Teal
  '#ec4899', // Pink
  '#6366f1', // Indigo
  '#84cc16', // Lime
];

export function getCategoryColor(category: ExpenseCategory | string): string {
  return CATEGORY_COLORS[category as ExpenseCategory] || '#0ea5e9';
}

export function getTagColor(tag: string): string {
  const clean = normalizeTag(tag);
  const preset: Record<string, string> = {
    '#yapikredi': '#0ea5e9',
    '#saglamkart': '#10b981',
    '#kuveytturk': '#14b8a6',
    '#garanti': '#22c55e',
    '#enpara': '#8b5cf6',
    '#nakit': '#eab308',
    '#market': '#f97316',
    '#migros': '#f97316',
    '#kahve': '#ec4899',
    '#restoran': '#f43f5e',
    '#taksit': '#6366f1',
    '#elektronik': '#38bdf8',
    '#akaryakit': '#06b6d4',
    '#abonelik': '#a855f7',
    '#giyim': '#fb7185',
    '#saglik': '#facc15',
    '#iade': '#10b981',
  };
  if (preset[clean]) return preset[clean];

  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  }
  return TAG_COLOR_PALETTE[hash % TAG_COLOR_PALETTE.length];
}

/**
 * Mükerrer Kayıt (Duplicate) Kontrolü:
 * Tespit edilen bir satırın `date` ve `amount` (veya `amountInTRY`) bilgisi mevcut veritabanındaki
 * bir kayıtla eşleşiyorsa `isDuplicate: true` ve `selected: false` olarak işaretler.
 */
export function detectDuplicates(
  candidates: ExtractedExpense[],
  existingExpenses: Expense[]
): MarkedCandidate[] {
  return candidates.map((cand, index) => {
    const candDate = (cand.date || '').slice(0, 10);
    const candAmount = Math.round(Number(cand.amount) * 100) / 100;
    const candTRY = Math.round(Number(cand.amountInTRY || cand.amount) * 100) / 100;

    const matched = existingExpenses.find((ex) => {
      const exDate = (ex.date || '').slice(0, 10);
      if (exDate !== candDate) return false;
      const exAmount = Math.round(Number(ex.amount) * 100) / 100;
      const exTRY = Math.round(Number(ex.amountInTRY) * 100) / 100;
      return Math.abs(exAmount - candAmount) < 0.01 || Math.abs(exTRY - candTRY) < 0.01;
    });

    const isDuplicate = Boolean(matched);
    return {
      ...cand,
      category: normalizeCategory(cand.category),
      tags: normalizeTagList(cand.tags),
      tempId: `cand_${Date.now()}_${index}`,
      isDuplicate,
      duplicateReason: matched
        ? `${matched.date} tarihinde ${matched.amount.toFixed(2)} ${matched.currency} (${matched.title}) ile eşleşiyor`
        : undefined,
      selected: !isDuplicate,
    };
  });
}

/**
 * Harcama filtreleme (Arama, Kategori, Çoklu #etiket, Ay/Yıl)
 */
export function filterExpenses(expenses: Expense[], filters: ExpenseFilters): Expense[] {
  const q = (filters.search || '').trim().toLowerCase();

  return expenses
    .filter((item) => {
      if (filters.monthYear && filters.monthYear !== 'ALL') {
        if (!item.date.startsWith(filters.monthYear)) return false;
      }
      if (filters.category && filters.category !== 'ALL') {
        if (item.category !== filters.category) return false;
      }
      if (filters.selectedTags && filters.selectedTags.length > 0) {
        const itemTagsLower = item.tags.map((t) => t.toLowerCase());
        const hasAllSelected = filters.selectedTags.every((t) =>
          itemTagsLower.includes(t.toLowerCase())
        );
        if (!hasAllSelected) return false;
      }
      if (q) {
        const haystack = [
          item.title,
          item.category,
          item.notes || '',
          item.date,
          ...item.tags,
          String(item.amount),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
}

/**
 * Üst Özet Kartları (MetricsOverview) hesaplaması
 */
export function calculateMetrics(
  expenses: Expense[],
  targetMonthYear: string // 'YYYY-MM' veya 'ALL'
): MetricsSummary {
  const scoped =
    targetMonthYear && targetMonthYear !== 'ALL'
      ? expenses.filter((e) => e.date.startsWith(targetMonthYear))
      : expenses;

  let monthlyNetTotalTRY = 0;
  let refundTotalTRY = 0;
  const categoryTotals: Record<string, number> = {};
  const tagStats: Record<string, { amountTRY: number; count: number }> = {};

  for (const exp of scoped) {
    const val = Number(exp.amountInTRY) || 0;
    monthlyNetTotalTRY += val;
    if (val < 0) {
      refundTotalTRY += Math.abs(val);
    }

    if (val > 0) {
      categoryTotals[exp.category] = (categoryTotals[exp.category] || 0) + val;
      for (const tag of exp.tags) {
        if (!tagStats[tag]) {
          tagStats[tag] = { amountTRY: 0, count: 0 };
        }
        tagStats[tag].amountTRY += val;
        tagStats[tag].count += 1;
      }
    }
  }

  // Günlük ortalama: Ay içindeki benzersiz harcama günü veya ayın geçen gün sayısı
  let daysCount = 1;
  if (targetMonthYear && targetMonthYear !== 'ALL') {
    const [yStr, mStr] = targetMonthYear.split('-');
    const year = Number(yStr);
    const month = Number(mStr);
    const now = new Date();
    if (year === now.getFullYear() && month === now.getMonth() + 1) {
      daysCount = Math.max(1, now.getDate());
    } else if (year && month) {
      daysCount = new Date(year, month, 0).getDate();
    }
  } else if (scoped.length > 0) {
    const uniqueDays = new Set(scoped.map((e) => e.date.slice(0, 10)));
    daysCount = Math.max(1, uniqueDays.size);
  }

  const dailyAverageTRY = monthlyNetTotalTRY / daysCount;

  const positiveSpendTotal = Object.values(categoryTotals).reduce((a, b) => a + b, 0);
  let topCategory: MetricsSummary['topCategory'] = null;
  for (const [name, amountTRY] of Object.entries(categoryTotals)) {
    if (!topCategory || amountTRY > topCategory.amountTRY) {
      topCategory = {
        name,
        amountTRY,
        percentage: positiveSpendTotal > 0 ? (amountTRY / positiveSpendTotal) * 100 : 0,
      };
    }
  }

  let topTag: MetricsSummary['topTag'] = null;
  for (const [tag, stat] of Object.entries(tagStats)) {
    if (!topTag || stat.amountTRY > topTag.amountTRY) {
      topTag = { tag, amountTRY: stat.amountTRY, count: stat.count };
    }
  }

  return {
    monthlyNetTotalTRY: Math.round(monthlyNetTotalTRY * 100) / 100,
    dailyAverageTRY: Math.round(dailyAverageTRY * 100) / 100,
    topCategory,
    topTag,
    totalTransactionCount: scoped.length,
    refundTotalTRY: Math.round(refundTotalTRY * 100) / 100,
  };
}

/**
 * Harcamaları gün bazında gruplar
 */
export function groupExpensesByDate(expenses: Expense[]): DateGroup[] {
  const map = new Map<string, Expense[]>();
  for (const exp of expenses) {
    const d = exp.date.slice(0, 10);
    const list = map.get(d) || [];
    list.push(exp);
    map.set(d, list);
  }

  const sortedDates = Array.from(map.keys()).sort((a, b) => b.localeCompare(a));
  const formatter = new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
  });

  return sortedDates.map((date) => {
    const items = map.get(date) || [];
    const dayTotalTRY = items.reduce((acc, item) => acc + (Number(item.amountInTRY) || 0), 0);
    let displayDate = date;
    try {
      const [y, m, d] = date.split('-').map(Number);
      displayDate = formatter.format(new Date(y, m - 1, d));
    } catch {
      displayDate = date;
    }
    return {
      date,
      displayDate,
      dayTotalTRY: Math.round(dayTotalTRY * 100) / 100,
      items,
    };
  });
}

/**
 * TRY tutarını seçili döviz kuruna çevirir ve formatlar
 */
export function convertFromTRY(
  amountInTRY: number,
  targetCurrency: CurrencyCode,
  rates?: CurrencyRates | null
): number {
  if (targetCurrency === 'TRY' || !rates || !rates.rates[targetCurrency]) {
    return amountInTRY;
  }
  const rate = rates.rates[targetCurrency];
  return amountInTRY * rate;
}

export function formatCurrency(
  amountInTRY: number,
  displayCurrency: CurrencyCode = 'TRY',
  rates?: CurrencyRates | null,
  showExplicitSign = false
): string {
  const converted = convertFromTRY(amountInTRY, displayCurrency, rates);
  const symbols: Record<CurrencyCode, string> = {
    TRY: '₺',
    USD: '$',
    EUR: '€',
    GBP: '£',
  };
  const absFormatted = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(converted));

  const symbol = symbols[displayCurrency] || '₺';
  if (converted < 0) {
    return `-${absFormatted} ${symbol}`;
  }
  if (showExplicitSign && converted > 0) {
    return `+${absFormatted} ${symbol}`;
  }
  return `${absFormatted} ${symbol}`;
}

/**
 * CSV Dışa / İçe Aktarım Yardımcıları
 */
export function expensesToCSV(expenses: Expense[]): string {
  const headers = ['id', 'date', 'title', 'amount', 'currency', 'amountInTRY', 'category', 'tags', 'notes'];
  const escapeCell = (val: unknown) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const rows = expenses.map((e) =>
    [
      e.id,
      e.date,
      e.title,
      e.amount,
      e.currency,
      e.amountInTRY,
      e.category,
      e.tags.join(' '),
      e.notes || '',
    ]
      .map(escapeCell)
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

export function parseCSVToExpenses(csvText: string): ExtractedExpense[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const results: ExtractedExpense[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols: string[] = [];
    let current = '';
    let inQuotes = false;
    const line = lines[i];

    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '"') {
        if (inQuotes && line[c + 1] === '"') {
          current += '"';
          c++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cols.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    cols.push(current);

    if (cols.length >= 6) {
      const date = cols[1] || new Date().toISOString().slice(0, 10);
      const title = cols[2] || 'Harcama';
      const amount = parseTurkishAmount(cols[3]);
      const currency = (['TRY', 'USD', 'EUR', 'GBP'].includes(cols[4]) ? cols[4] : 'TRY') as CurrencyCode;
      const amountInTRY = parseTurkishAmount(cols[5]) || amount;
      const category = normalizeCategory(cols[6] || 'Diğer');
      const rawTags = (cols[7] || '').split(/[\s,]+/).filter(Boolean);
      const notes = cols[8] || '';

      if (amount !== 0) {
        results.push({
          date,
          title,
          amount,
          currency,
          amountInTRY,
          category,
          tags: normalizeTagList(rawTags),
          notes,
        });
      }
    }
  }
  return results;
}
