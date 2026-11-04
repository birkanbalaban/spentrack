export const FIXED_CATEGORIES = [
  'Market',
  'Yeme-İçme',
  'Ulaşım',
  'Fatura & Abonelik',
  'Alışveriş',
  'Eğlence',
  'Sağlık',
  'Diğer',
] as const;

export type ExpenseCategory = (typeof FIXED_CATEGORIES)[number];

export const BANK_QUICK_TAGS = [
  { tag: '#yapikredi', label: 'Yapı Kredi World' },
  { tag: '#saglamkart', label: 'Sağlam Kart' },
  { tag: '#kuveytturk', label: 'Kuveyt Türk' },
  { tag: '#garanti', label: 'Garanti Bonus' },
  { tag: '#enpara', label: 'Enpara' },
  { tag: '#nakit', label: 'Nakit / Banka Kartı' },
] as const;

export const COMMON_QUICK_TAGS = [
  '#market',
  '#kahve',
  '#restoran',
  '#akaryakit',
  '#abonelik',
  '#online',
  '#taksit',
  '#iade',
] as const;

export type CurrencyCode = 'TRY' | 'USD' | 'EUR' | 'GBP';

export interface CurrencyRates {
  base: 'TRY';
  date: string;
  rates: Record<CurrencyCode, number>;
}

export interface Expense {
  id: string;
  userId?: string;
  title: string;
  amount: number;        // Pozitif: harcama, Negatif (-amount): iade/iptal
  currency: CurrencyCode;
  amountInTRY: number;   // TL karşılığı (Negatif ise iade)
  category: ExpenseCategory;
  tags: string[];        // Örn: ["#yapikredi", "#kahve", "#taksit"]
  date: string;          // YYYY-MM-DD
  notes?: string;        // Örn: "2/6 Taksit"
  createdAt?: string;
}

export interface ExtractedExpense {
  title: string;
  amount: number;
  currency: CurrencyCode;
  amountInTRY: number;
  category: ExpenseCategory;
  tags: string[];
  date: string;
  notes?: string;
}

export interface MarkedCandidate extends ExtractedExpense {
  tempId: string;
  isDuplicate: boolean;
  duplicateReason?: string;
  selected: boolean;
}

export interface ExpenseFilters {
  search: string;
  category: ExpenseCategory | 'ALL';
  selectedTags: string[];
  monthYear: string; // 'YYYY-MM' or 'ALL'
}

export interface MetricsSummary {
  monthlyNetTotalTRY: number;
  dailyAverageTRY: number;
  topCategory: { name: string; amountTRY: number; percentage: number } | null;
  topTag: { tag: string; amountTRY: number; count: number } | null;
  totalTransactionCount: number;
  refundTotalTRY: number;
}

export interface DateGroup {
  date: string;
  displayDate: string;
  dayTotalTRY: number;
  items: Expense[];
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  picture?: string;
  mode: 'guest' | 'google';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  attachmentNames?: string[];
  proposedExpenses?: MarkedCandidate[];
  savedSuccess?: boolean;
  analysisHighlight?: {
    label: string;
    totalTRY: number;
    count: number;
  };
}
