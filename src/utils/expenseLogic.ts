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
  if (/fatura|abonelik|aidat|site\s*y[oö]netim|apartman|kira|netflix|spotify|youtube|icloud|elektrik|su|dogalgaz|internet|turkcell|vodafone|telekom/.test(lower)) return 'Fatura & Abonelik';
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

export interface InstantAssistantResult {
  handled: boolean;
  reply: string;
  proposedExpenses: ExtractedExpense[];
  analysisHighlight?: {
    label: string;
    totalTRY: number;
    count: number;
  };
}

const TURKISH_LOWER_MAP: Record<string, string> = {
  İ: 'i',
  I: 'ı',
  Ç: 'ç',
  Ğ: 'ğ',
  Ö: 'ö',
  Ş: 'ş',
  Ü: 'ü',
};

function toTurkishLower(str: string): string {
  return String(str || '')
    .replace(/[İIÇĞÖŞÜ]/g, (ch) => TURKISH_LOWER_MAP[ch] || ch)
    .toLowerCase();
}

function toAsciiLower(str: string): string {
  return toTurkishLower(str)
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u');
}

function capitalizeTurkishWords(str: string): string {
  return str
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const first = word.charAt(0);
      const upperFirst = first === 'i' ? 'İ' : first === 'ı' ? 'I' : first.toUpperCase();
      return upperFirst + toTurkishLower(word.slice(1));
    })
    .join(' ');
}

function extractBankTagsFromText(text: string): string[] {
  const ascii = toAsciiLower(text);
  const tags: string[] = [];
  if (/saglam\s*kart|saglamkart/.test(ascii)) tags.push('#saglamkart');
  if (/kuveyt\s*turk|kuveytturk/.test(ascii)) tags.push('#kuveytturk');
  if (/yapi\s*kredi|yapikredi|world\s*kart|worldcard|\bworld\b/.test(ascii)) tags.push('#yapikredi');
  if (/garanti|bonus/.test(ascii)) tags.push('#garanti');
  if (/is\s*bankasi|isbankasi|maximum/.test(ascii)) tags.push('#isbankasi');
  if (/akbank|axess/.test(ascii)) tags.push('#akbank');
  if (/ziraat|bankkart/.test(ascii)) tags.push('#ziraat');
  if (/qnb|finansbank|cardfinans/.test(ascii)) tags.push('#qnb');
  if (/enpara/.test(ascii)) tags.push('#enpara');
  if (/vakifbank/.test(ascii)) tags.push('#vakifbank');
  if (/halkbank|paraf/.test(ascii)) tags.push('#halkbank');
  if (/denizbank/.test(ascii)) tags.push('#denizbank');
  if (/teb\b/.test(ascii)) tags.push('#teb');
  if (/papara/.test(ascii)) tags.push('#papara');
  if (/nakit/.test(ascii)) tags.push('#nakit');
  return tags;
}

/**
 * Doğal dilde yazılan harcama ekleme komutlarını ("420 tl yemeksepeti yapıkredi kredi kartı ekle",
 * "Bugün Sağlam Kart ile 220 TL kahve, 1450 TL market harcadım") ve harcama analiz sorularını
 * ("#yapikredi veya dışarıda yemeye ne kadar harcadım?") sıfır gecikmeyle (anlık) çözümler.
 */
export function parseInstantAssistantMessage(
  message: string,
  existingExpenses: Array<{
    title: string;
    amount: number;
    amountInTRY: number;
    category: string;
    tags: string[];
    date: string;
  }>,
  todayISO?: string
): InstantAssistantResult {
  const rawMessage = String(message || '').trim().replace(/^[\s+?"'“”]+|[\s"'“”]+$/g, '');
  const today = todayISO || new Date().toISOString().slice(0, 10);

  if (!rawMessage) {
    return {
      handled: false,
      reply: '',
      proposedExpenses: [],
    };
  }

  const lower = toTurkishLower(rawMessage);
  const ascii = toAsciiLower(rawMessage);

  const hasAddVerb = /\b(ekle|kaydet|yaz|harcadim|odedim|aldim|verdim|yaptim|tuttu|cekildi)\b/.test(ascii);
  const isQuestion =
    !hasAddVerb &&
    (/ne\s*kadar|kac\s*tl|kac\s*lira|toplam|analiz|ozet|en\s*cok|neler|listele/.test(ascii) ||
      rawMessage.includes('?'));

  const detectedBankTags = extractBankTagsFromText(rawMessage);
  const explicitHashTags = (rawMessage.match(/#[a-zA-Z0-9_çğıöşüÇĞİÖŞÜ-]+/g) || []).map((t) =>
    normalizeTag(t)
  );

  if (isQuestion) {
    const normalizedQueryTags = Array.from(
      new Set([...explicitHashTags, ...detectedBankTags].filter(Boolean))
    );

    let matchedCategory: ExpenseCategory | null = null;
    if (/disarida\s*yeme|yeme|icme|kahve|restoran|kafe|yemek/.test(ascii)) matchedCategory = 'Yeme-İçme';
    else if (/market|gida|mutfak|migros|bim|a101/.test(ascii)) matchedCategory = 'Market';
    else if (/ulasim|akaryakit|benzin|taksi|otobus|metro/.test(ascii)) matchedCategory = 'Ulaşım';
    else if (/fatura|abonelik|netflix|internet|elektrik|su|dogalgaz/.test(ascii))
      matchedCategory = 'Fatura & Abonelik';
    else if (/alisveris|giyim|elektronik/.test(ascii)) matchedCategory = 'Alışveriş';
    else if (/eglence|sinema|oyun|konser/.test(ascii)) matchedCategory = 'Eğlence';
    else if (/saglik|eczane|hastane|ilac/.test(ascii)) matchedCategory = 'Sağlık';

    const filtered = existingExpenses.filter((e) => {
      const itemTags = (e.tags || []).map((x) => normalizeTag(x));
      const tagHit =
        normalizedQueryTags.length > 0 &&
        normalizedQueryTags.some((qt) => itemTags.includes(qt));
      const catHit = matchedCategory && e.category === matchedCategory;
      if (normalizedQueryTags.length > 0 && matchedCategory) return tagHit || catHit;
      if (normalizedQueryTags.length > 0) return tagHit;
      if (matchedCategory) return Boolean(catHit);
      return true;
    });

    const totalTRY =
      Math.round(filtered.reduce((sum, item) => sum + Number(item.amountInTRY || 0), 0) * 100) / 100;
    const labelParts: string[] = [];
    if (normalizedQueryTags.length > 0) labelParts.push(normalizedQueryTags.join(', '));
    if (matchedCategory) labelParts.push(matchedCategory);
    const label = labelParts.length > 0 ? labelParts.join(' / ') : 'Tüm Harcamalar';

    const formattedTotal = new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(totalTRY);

    return {
      handled: true,
      reply: `${label} kapsamında toplam ${filtered.length} işlem bulundu. İadeler düşüldükten sonra net harcama tutarınız ${formattedTotal} ₺'dir.`,
      proposedExpenses: [],
      analysisHighlight: {
        label,
        totalTRY,
        count: filtered.length,
      },
    };
  }

  // Harcama ekleme ifadelerini virgül, noktalı virgül veya "ve" bağlacına göre ayır
  const clauses = rawMessage
    .split(/\s*(?:[,;]+|\bve\b)\s*/i)
    .map((c) => c.trim())
    .filter(Boolean);

  const proposed: ExtractedExpense[] = [];

  let messageDate = today;
  if (/\bdün\b|\bdun\b/i.test(lower)) {
    const d = new Date(`${today}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCDate(d.getUTCDate() - 1);
      messageDate = d.toISOString().slice(0, 10);
    }
  }

  for (const clause of clauses) {
    const clauseAscii = toAsciiLower(clause);

    // Taksit tespiti (örn: "3 taksit", "2/6 taksit") — tutar eşleşmesiyle karışmaması için önce ayıkla
    let installmentNote = '';
    let clauseWithoutInstallment = clause;
    const slashInstallment = clause.match(/\b(\d{1,2}\s*\/\s*\d{1,2})\s*(?:taksit(?:li|le)?)?\b/i);
    const countInstallment = clause.match(/\b(\d{1,2})\s*taksit(?:li|le)?\b/i);
    if (slashInstallment) {
      installmentNote = `${slashInstallment[1].replace(/\s+/g, '')} Taksit`;
      clauseWithoutInstallment = clauseWithoutInstallment.replace(slashInstallment[0], ' ');
    } else if (countInstallment) {
      installmentNote = `1/${countInstallment[1]} Taksit`;
      clauseWithoutInstallment = clauseWithoutInstallment.replace(countInstallment[0], ' ');
    }

    // Tutar ve para birimi tespiti
    const amountRegex =
      /(?:^|\s)(-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|-?\d+(?:[.,]\d{1,2})?)\s*(tl|₺|try|lira|türk\s*lirası|turk\s*lirasi|usd|\$|dolar|eur|€|euro|gbp|£|sterlin)?(?=\s|$)/i;
    const amountMatch = clauseWithoutInstallment.match(amountRegex);
    if (!amountMatch) continue;

    const rawNum = parseTurkishAmount(amountMatch[1]);
    if (!rawNum || rawNum === 0) continue;

    const unitRaw = toAsciiLower(amountMatch[2] || '');
    let currency: CurrencyCode = 'TRY';
    let rate = 1;
    if (unitRaw === 'usd' || unitRaw === '$' || unitRaw === 'dolar') {
      currency = 'USD';
      rate = 36.25;
    } else if (unitRaw === 'eur' || unitRaw === '€' || unitRaw === 'euro') {
      currency = 'EUR';
      rate = 37.85;
    } else if (unitRaw === 'gbp' || unitRaw === '£' || unitRaw === 'sterlin') {
      currency = 'GBP';
      rate = 45.5;
    }

    const isRefund = /\b(iade|iptal|geri\s*odeme)\b/i.test(clauseAscii) || rawNum < 0;
    const finalAmount = isRefund ? -Math.abs(rawNum) : Math.abs(rawNum);
    const finalAmountTRY = Math.round(finalAmount * rate * 100) / 100;

    const clauseHashtags = (clause.match(/#[a-zA-Z0-9_çğıöşüÇĞİÖŞÜ-]+/g) || []).map((t) =>
      normalizeTag(t)
    );
    const clauseBankTags = extractBankTagsFromText(clause);
    const combinedBankTags = Array.from(new Set([...detectedBankTags, ...clauseBankTags]));

    // Başlıktan tutarı, etiketleri, banka/kart isimlerini ve eylem kelimelerini temizle
    let cleanDesc = toTurkishLower(clauseWithoutInstallment)
      .replace(toTurkishLower(amountMatch[0]), ' ')
      .replace(/#[a-zA-Z0-9_çğıöşüÇĞİÖŞÜ-]+/g, ' ');

    const stripPhrases = [
      'kuveyt türk',
      'kuveyt turk',
      'kuveyttürk',
      'kuveytturk',
      'sağlam kart',
      'saglam kart',
      'sağlamkart',
      'saglamkart',
      'yapı kredi',
      'yapi kredi',
      'yapıkredi',
      'yapikredi',
      'world kart',
      'worldcard',
      'world',
      'garanti bbva',
      'garanti bonus',
      'garanti',
      'bonus kart',
      'bonus',
      'iş bankası',
      'is bankasi',
      'işbankası',
      'isbankasi',
      'maximum kart',
      'maximum',
      'ziraat bankası',
      'ziraat bankasi',
      'ziraat',
      'bankkart',
      'qnb finansbank',
      'finansbank',
      'qnb',
      'cardfinans',
      'akbank',
      'axess',
      'enpara',
      'vakıfbank',
      'vakifbank',
      'halkbank',
      'paraf',
      'denizbank',
      'teb',
      'papara',
      'nakit',
      'kredi kartıyla',
      'kredi kartiyla',
      'kredi kartı',
      'kredi karti',
      'kredikartı',
      'kredikarti',
      'banka kartı',
      'banka karti',
      'kartıyla',
      'kartiyla',
      'kartla',
      'kartı',
      'karti',
      'karttan',
      'kart',
      'kredi',
      'bugün',
      'bugun',
      'dün',
      'dun',
      'az önce',
      'az once',
      'bu sabah',
      'bu akşam',
      'bu aksam',
      'ekler misin',
      'kaydeder misin',
      'ekleyelim',
      'kaydedelim',
      'yazalım',
      'yazalim',
      'ekle',
      'kaydet',
      'yaz',
      'gir',
      'işle',
      'isle',
      'harcadım',
      'harcadim',
      'harcaması',
      'harcamasi',
      'harcama',
      'ödedim',
      'odedim',
      'ödeme',
      'odeme',
      'aldım',
      'aldim',
      'yaptım',
      'yaptim',
      'verdim',
      'tuttu',
      'çekildi',
      'cekildi',
      'iade',
      'iptal',
      'türk lirası',
      'turk lirasi',
      'tl',
      'try',
      'lira',
      'usd',
      'dolar',
      'eur',
      'euro',
      'gbp',
      'sterlin',
      'ile',
      'için',
      'icin',
      'üzerinden',
      'uzerinden',
      'olarak',
      'lütfen',
      'lutfen',
    ];

    for (const phrase of stripPhrases) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      const regex = new RegExp(`(?<=^|[\\s.,;!?])${escaped}(?=$|[\\s.,;!?])`, 'giu');
      cleanDesc = cleanDesc.replace(regex, ' ');
    }

    cleanDesc = cleanDesc
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

    const title = cleanDesc ? capitalizeTurkishWords(cleanDesc) : isRefund ? 'Harcama İadesi' : 'Harcama';
    const category = normalizeCategory(`${title} ${clause}`);

    const itemTags: string[] = [...combinedBankTags, ...clauseHashtags];
    const titleAscii = toAsciiLower(`${title} ${clause}`);
    if (/yemeksepeti|getiryemek|trendyolyemek|yemek|restoran|lokanta|kebap|burger|pizza|doner/.test(titleAscii)) {
      itemTags.push('#yemek');
    }
    if (/kahve|starbucks|espresso|kafe|cafe/.test(titleAscii)) {
      itemTags.push('#kahve');
    }
    if (/market|migros|bim|a101|sok|carrefour|file|gida/.test(titleAscii)) {
      itemTags.push('#market');
    }
    if (/migros/.test(titleAscii)) {
      itemTags.push('#migros');
    }
    if (/benzin|mazot|akaryakit|opet|shell|petrol|bp\b/.test(titleAscii)) {
      itemTags.push('#akaryakit');
    }
    if (/netflix|spotify|youtube|icloud|abonelik|fatura/.test(titleAscii)) {
      itemTags.push('#abonelik');
    }
    if (/aidat|site\s*yonetimi|apartman/.test(titleAscii)) {
      itemTags.push('#aidat');
    }
    if (/zara|mango|hm|lcw|boyner|giyim|kiyafet/.test(titleAscii)) {
      itemTags.push('#giyim');
    }
    if (/teknosa|mediamarkt|vatan|apple|elektronik/.test(titleAscii)) {
      itemTags.push('#elektronik');
    }
    if (installmentNote) {
      itemTags.push('#taksit');
    }
    if (isRefund) {
      itemTags.push('#iade');
    }

    proposed.push({
      title,
      amount: finalAmount,
      currency,
      amountInTRY: finalAmountTRY,
      category,
      tags: normalizeTagList(itemTags.length > 0 ? itemTags : ['#genel']),
      date: messageDate,
      notes: installmentNote,
    });
  }

  if (proposed.length > 0) {
    const summaryText =
      proposed.length === 1
        ? `"${proposed[0].title}" (${formatCurrency(proposed[0].amountInTRY, 'TRY')}) işlemini hazırladım ve etiketlerini (${proposed[0].tags.join(' ')}) otomatik atadım. Aşağıdaki onay kartından tek tıkla kaydedebilirsiniz:`
        : `Mesajınızdan ${proposed.length} adet harcama tespit ettim ve ilgili etiketleri otomatik ekledim. Aşağıdaki onay kartından kontrol edip tek tıkla kaydedebilirsiniz:`;

    return {
      handled: true,
      reply: summaryText,
      proposedExpenses: proposed,
    };
  }

  return {
    handled: false,
    reply:
      'Harcama eklemek için "Bugün Sağlam Kart ile 220 TL kahve, 1450 TL market harcadım" gibi yazabilir veya harcamalarınız hakkında soru sorabilirsiniz.',
    proposedExpenses: [],
  };
}

/**
 * Kullanıcının görsel eklerken yazdığı metinden (örn: "AC YAPI MOMENT ISTANBUL SITE YÖNETIMi #aidat olarak ekleyelim")
 * başlık, kategori, etiket ve varsa tutar bilgisini anında ayrıştırır.
 * Hem görsel analizi sonuçlarını zenginleştirmek hem de API gecikmesinde anında onay kartı sunmak için kullanılır.
 */
export function buildDraftExpenseFromPrompt(
  message: string,
  todayISO?: string
): ExtractedExpense {
  const today = todayISO || new Date().toISOString().slice(0, 10);
  const raw = String(message || '').trim();
  if (!raw) {
    return {
      title: 'Görsel Harcaması',
      amount: 0,
      currency: 'TRY',
      amountInTRY: 0,
      category: 'Diğer',
      tags: ['#genel'],
      date: today,
      notes: '',
    };
  }

  const instant = parseInstantAssistantMessage(raw, [], today);
  if (instant.handled && instant.proposedExpenses.length > 0) {
    return instant.proposedExpenses[0];
  }

  const explicitTags = (raw.match(/#[a-zA-Z0-9_çğıöşüÇĞİÖŞÜ-]+/g) || []).map((t) =>
    normalizeTag(t)
  );
  const bankTags = extractBankTagsFromText(raw);

  let cleanDesc = toTurkishLower(raw).replace(/#[a-zA-Z0-9_çğıöşüÇĞİÖŞÜ-]+/g, ' ');
  const removeWords = [
    'olarak',
    'ekleyelim',
    'kaydedelim',
    'yazalım',
    'yazalim',
    'ekle',
    'kaydet',
    'yaz',
    'gir',
    'lütfen',
    'lutfen',
    'bunu',
    'şunu',
    'sunu',
  ];
  for (const w of removeWords) {
    const regex = new RegExp(`(?<=^|[\\s.,;!?])${w}(?=$|[\\s.,;!?])`, 'giu');
    cleanDesc = cleanDesc.replace(regex, ' ');
  }
  cleanDesc = cleanDesc
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  const title = cleanDesc ? capitalizeTurkishWords(cleanDesc) : 'Görsel Harcaması';
  const category = normalizeCategory(`${title} ${raw} ${explicitTags.join(' ')}`);
  const mergedTags = normalizeTagList([
    ...bankTags,
    ...explicitTags,
    ...(toAsciiLower(`${title} ${raw}`).includes('aidat') ? ['#aidat'] : []),
  ]);

  return {
    title,
    amount: 0,
    currency: 'TRY',
    amountInTRY: 0,
    category,
    tags: mergedTags.length > 0 ? mergedTags : ['#genel'],
    date: today,
    notes: '',
  };
}


