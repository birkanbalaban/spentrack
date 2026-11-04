import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  FileSpreadsheet,
  Sparkles,
  Download,
  ListFilter,
  BarChart3,
  Calendar as CalendarIcon,
  RotateCcw,
  User,
  Eye,
  LogOut,
  KeyRound,
} from 'lucide-react';
import {
  CurrencyCode,
  CurrencyRates,
  Expense,
  ExpenseCategory,
  ExpenseFilters,
  ExtractedExpense,
  FIXED_CATEGORIES,
  UserProfile,
} from './types';
import {
  calculateMetrics,
  filterExpenses,
  getTagColor,
  groupExpensesByDate,
  normalizeTag,
} from './utils/expenseLogic';
import { MetricsOverview } from './components/MetricsOverview';
import { ExpenseListView } from './components/ExpenseListView';
import { AnalyticsView } from './components/AnalyticsView';
import { CalendarView } from './components/CalendarView';
import { ManualExpenseModal } from './components/ManualExpenseModal';
import { StatementScannerModal } from './components/StatementScannerModal';
import { AssistantDrawer } from './components/AssistantDrawer';
import { DataSyncModal } from './components/DataSyncModal';
import { LandingAuthView } from './components/LandingAuthView';
import { AccountApiKeyBox } from './components/AccountApiKeyBox';
import { triggerDirectGoogleLogin } from './lib/googleAuth';

const LOCAL_STORAGE_EXPENSES_KEY = 'spentrack_guest_expenses_v1';
const LOCAL_STORAGE_AUTH_USER_KEY = 'spentrack_auth_user_v2';
const LOCAL_STORAGE_AUTH_TOKEN_KEY = 'spentrack_auth_token_v2';
const LEGACY_LOCAL_STORAGE_GEMINI_KEY = 'spentrack_custom_gemini_key_v1';

const FALLBACK_RATES: CurrencyRates = {
  base: 'TRY',
  date: new Date().toISOString().slice(0, 10),
  rates: {
    TRY: 1,
    USD: 0.029,
    EUR: 0.027,
    GBP: 0.023,
  },
};

function buildDemoExpenses(ym: string): Expense[] {
  const d = (day: number) => `${ym}-${String(Math.min(day, 28)).padStart(2, '0')}`;
  return [
    {
      id: 'demo-1',
      title: 'Migros Jet Alışverişi',
      amount: 1450.5,
      currency: 'TRY',
      amountInTRY: 1450.5,
      category: 'Market',
      tags: ['#saglamkart', '#migros', '#market'],
      date: d(4),
      notes: 'Haftalık mutfak ve gıda alışverişi',
    },
    {
      id: 'demo-2',
      title: 'Starbucks Reserve Moda',
      amount: 245.0,
      currency: 'TRY',
      amountInTRY: 245.0,
      category: 'Yeme-İçme',
      tags: ['#enpara', '#kahve'],
      date: d(4),
      notes: 'Filtre kahve & kruvasan',
    },
    {
      id: 'demo-3',
      title: 'Apple Store Türkiye',
      amount: 4250.0,
      currency: 'TRY',
      amountInTRY: 4250.0,
      category: 'Alışveriş',
      tags: ['#yapikredi', '#taksit', '#elektronik'],
      date: d(3),
      notes: '2/6 Taksit',
    },
    {
      id: 'demo-4',
      title: 'Shell Akaryakıt İstasyonu',
      amount: 1890.0,
      currency: 'TRY',
      amountInTRY: 1890.0,
      category: 'Ulaşım',
      tags: ['#yapikredi', '#akaryakit'],
      date: d(3),
      notes: 'Tam depo yakıt',
    },
    {
      id: 'demo-5',
      title: 'Zara Online İade',
      amount: -650.0,
      currency: 'TRY',
      amountInTRY: -650.0,
      category: 'Alışveriş',
      tags: ['#yapikredi', '#iade', '#giyim'],
      date: d(2),
      notes: 'Beden değişimi iadesi',
    },
    {
      id: 'demo-6',
      title: 'Netflix & Spotify Aylık',
      amount: 389.9,
      currency: 'TRY',
      amountInTRY: 389.9,
      category: 'Fatura & Abonelik',
      tags: ['#enpara', '#abonelik'],
      date: d(2),
      notes: 'Otomatik ödeme',
    },
    {
      id: 'demo-7',
      title: 'Acıbadem Eczanesi',
      amount: 410.0,
      currency: 'TRY',
      amountInTRY: 410.0,
      category: 'Sağlık',
      tags: ['#garanti', '#saglik'],
      date: d(1),
      notes: 'Vitamin takviyesi',
    },
    {
      id: 'demo-8',
      title: 'Amazon TR Ev Gereçleri',
      amount: 1290.0,
      currency: 'TRY',
      amountInTRY: 1290.0,
      category: 'Alışveriş',
      tags: ['#garanti', '#ev'],
      date: d(1),
      notes: 'Mutfak düzenleyici seti',
    },
    {
      id: 'demo-9',
      title: 'Biletix Konser Bileti',
      amount: 950.0,
      currency: 'TRY',
      amountInTRY: 950.0,
      category: 'Eğlence',
      tags: ['#saglamkart', '#etkinlik'],
      date: d(1),
      notes: 'Hafta sonu etkinliği',
    },
  ];
}

export type ActiveViewMode = 'list' | 'analytics' | 'calendar';

export default function App() {
  const currentMonthYear = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const [authUser, setAuthUser] = useState<UserProfile | null>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_AUTH_USER_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.id && parsed.mode === 'google') {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return null;
  });

  const [authToken, setAuthToken] = useState<string>(() => {
    try {
      return localStorage.getItem(LOCAL_STORAGE_AUTH_TOKEN_KEY) || '';
    } catch {
      return '';
    }
  });

  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState<CurrencyCode>('TRY');
  const [rates, setRates] = useState<CurrencyRates>(FALLBACK_RATES);
  const [activeView, setActiveView] = useState<ActiveViewMode>('list');

  const [filters, setFilters] = useState<ExpenseFilters>({
    search: '',
    category: 'ALL',
    selectedTags: [],
    monthYear: currentMonthYear,
  });

  // Modals & Drawers
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [showApiKeyBar, setShowApiKeyBar] = useState(false);

  // Hesaba tanımlı Gemini API anahtarı (Tarayıcı localStorage yerine bulut kullanıcı hesabında tutulur)
  const [customApiKey, setCustomApiKey] = useState<string>('');

  // Canlı Döviz Kuru: Frankfurter API
  useEffect(() => {
    let active = true;
    fetch('https://api.frankfurter.dev/v1/latest?base=TRY')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data || !data.rates) return;
        setRates({
          base: 'TRY',
          date: data.date || new Date().toISOString().slice(0, 10),
          rates: {
            TRY: 1,
            USD: Number(data.rates.USD) || FALLBACK_RATES.rates.USD,
            EUR: Number(data.rates.EUR) || FALLBACK_RATES.rates.EUR,
            GBP: Number(data.rates.GBP) || FALLBACK_RATES.rates.GBP,
          },
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const buildAuthHeaders = useCallback(
    (activeUserId: string, token: string): Record<string, string> => {
      const headers: Record<string, string> = {
        'x-user-id': activeUserId,
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      return headers;
    },
    []
  );

  // Harcamaları Yükle (Authenticated kullanıcı için bulut veritabanından)
  const fetchExpenses = useCallback(
    async (activeUserId: string, token: string) => {
      setLoading(true);
      try {
        const res = await fetch('/api/expenses', {
          headers: buildAuthHeaders(activeUserId, token),
        });
        if (res.ok) {
          const data = await res.json();
          const list: Expense[] = data.expenses || [];
          setExpenses(list);
          try {
            localStorage.setItem(LOCAL_STORAGE_EXPENSES_KEY, JSON.stringify(list));
          } catch {
            // ignore
          }
        }
      } catch {
        try {
          const cached = localStorage.getItem(LOCAL_STORAGE_EXPENSES_KEY);
          if (cached) {
            setExpenses(JSON.parse(cached));
          }
        } catch {
          // ignore
        }
      } finally {
        setLoading(false);
      }
    },
    [buildAuthHeaders]
  );

  // Giriş yapılan kullanıcının hesabına tanımlı Gemini API anahtarını sunucudan çek
  const fetchAccountApiKey = useCallback(
    async (activeUserId: string, token: string) => {
      try {
        const res = await fetch('/api/user/apikey', {
          headers: buildAuthHeaders(activeUserId, token),
        });
        if (res.ok) {
          const data = await res.json();
          const serverKey = String(data.apiKey || '').trim();
          if (serverKey) {
            setCustomApiKey(serverKey);
            try {
              localStorage.removeItem(LEGACY_LOCAL_STORAGE_GEMINI_KEY);
            } catch {
              // ignore
            }
            return;
          }
        }
        // Eski tarayıcı anahtarı varsa tek seferlik hesaba taşı ve tarayıcıdan sil
        try {
          const legacyKey = localStorage.getItem(LEGACY_LOCAL_STORAGE_GEMINI_KEY);
          if (legacyKey && legacyKey.trim().length > 10) {
            const migrated = legacyKey.trim();
            await fetch('/api/user/apikey', {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                ...buildAuthHeaders(activeUserId, token),
              },
              body: JSON.stringify({ apiKey: migrated }),
            });
            setCustomApiKey(migrated);
            localStorage.removeItem(LEGACY_LOCAL_STORAGE_GEMINI_KEY);
          }
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    },
    [buildAuthHeaders]
  );

  // Manuel girilen Gemini API anahtarını doğrudan giriş yapılan hesaba kaydet / kaldır
  const handleSaveAccountApiKey = useCallback(
    async (newKey: string): Promise<void> => {
      const trimmed = newKey.trim();
      if (!authUser || isDemoMode) {
        setCustomApiKey(trimmed);
        return;
      }

      const res = await fetch('/api/user/apikey', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(authUser.id, authToken),
        },
        body: JSON.stringify({ apiKey: trimmed }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'API anahtarı hesaba kaydedilemedi.');
      }

      setCustomApiKey(trimmed);
      try {
        localStorage.removeItem(LEGACY_LOCAL_STORAGE_GEMINI_KEY);
      } catch {
        // ignore
      }
    },
    [authUser, authToken, isDemoMode, buildAuthHeaders]
  );

  useEffect(() => {
    if (authUser && !isDemoMode) {
      fetchExpenses(authUser.id, authToken);
      fetchAccountApiKey(authUser.id, authToken);
    }
  }, [authUser, authToken, isDemoMode, fetchExpenses, fetchAccountApiKey]);

  // Global Ctrl+V ile ekrana fiş / ekran görüntüsü yapıştırma desteği
  useEffect(() => {
    if (!authUser && !isDemoMode) return;
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (isScannerOpen) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          setIsScannerOpen(true);
          break;
        }
      }
    };
    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [authUser, isDemoMode, isScannerOpen]);

  // Zero-Config Google ile Giriş
  const handleTriggerGoogleLogin = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      setAuthError(null);
      setIsLoggingIn(true);

      triggerDirectGoogleLogin(
        async ({ token, user: gUser }) => {
          const profile: UserProfile = {
            id: gUser.id,
            name: gUser.name,
            email: gUser.email,
            picture: gUser.avatarUrl,
            mode: 'google',
          };
          setAuthToken(token);
          setAuthUser(profile);
          if (gUser.geminiApiKey) {
            setCustomApiKey(gUser.geminiApiKey);
          }
          setIsDemoMode(false);
          setIsLoggingIn(false);

          try {
            localStorage.setItem(LOCAL_STORAGE_AUTH_USER_KEY, JSON.stringify(profile));
            localStorage.setItem(LOCAL_STORAGE_AUTH_TOKEN_KEY, token);
          } catch {
            // ignore
          }

          await Promise.all([
            fetchExpenses(profile.id, token),
            fetchAccountApiKey(profile.id, token),
          ]);
          resolve();
        },
        (errMsg) => {
          setIsLoggingIn(false);
          setAuthError(errMsg);
          reject(new Error(errMsg));
        }
      );
    });
  };

  // Çıkış Yap
  const handleLogout = async () => {
    setAuthUser(null);
    setAuthToken('');
    setCustomApiKey('');
    setIsDemoMode(false);
    setIsSyncModalOpen(false);
    setExpenses([]);
    try {
      localStorage.removeItem(LOCAL_STORAGE_AUTH_USER_KEY);
      localStorage.removeItem(LOCAL_STORAGE_AUTH_TOKEN_KEY);
      localStorage.removeItem(LEGACY_LOCAL_STORAGE_GEMINI_KEY);
    } catch {
      // ignore
    }
  };

  // Tek Tıkla Canlı Demo Başlat
  const handleStartDemoMode = () => {
    setAuthError(null);
    setExpenses(buildDemoExpenses(currentMonthYear));
    setIsDemoMode(true);
    setActiveView('list');
  };

  // Demodan Çık
  const handleExitDemoMode = () => {
    setIsDemoMode(false);
    setExpenses([]);
  };

  // Tekil Harcama Kaydet / Güncelle
  const handleSaveManualExpense = async (payload: Omit<Expense, 'id'> & { id?: string }) => {
    if (isDemoMode || !authUser) {
      const id = payload.id || `demo-${Date.now()}`;
      const newExp: Expense = {
        ...payload,
        id,
      };
      setExpenses((prev) => {
        if (payload.id) {
          return prev.map((e) => (e.id === payload.id ? newExp : e));
        }
        return [newExp, ...prev];
      });
      return;
    }

    const isEdit = Boolean(payload.id);
    const url = isEdit ? `/api/expenses/${payload.id}` : '/api/expenses';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(authUser.id, authToken),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Harcama kaydedilemedi.');
    }

    await fetchExpenses(authUser.id, authToken);
  };

  // Toplu Harcama Kaydet
  const handleBatchSaveExpenses = async (items: ExtractedExpense[]) => {
    if (isDemoMode || !authUser) {
      const created: Expense[] = items.map((item, idx) => ({
        ...item,
        id: `demo-batch-${Date.now()}-${idx}`,
      }));
      setExpenses((prev) => [...created, ...prev]);
      return;
    }

    const res = await fetch('/api/expenses/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(authUser.id, authToken),
      },
      body: JSON.stringify({ expenses: items }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Toplu kayıt başarısız.');
    }

    await fetchExpenses(authUser.id, authToken);
  };

  // Harcama Sil
  const handleDeleteExpense = async (id: string) => {
    if (!isDemoMode && authUser) {
      await fetch(`/api/expenses/${id}`, {
        method: 'DELETE',
        headers: buildAuthHeaders(authUser.id, authToken),
      });
    }
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  };

  const handleSyncGuestToCloud = async (): Promise<number> => {
    if (expenses.length === 0) return 0;
    await handleBatchSaveExpenses(expenses);
    return expenses.length;
  };

  // Mevcut tüm #etiket havuzu
  const allExistingTags = useMemo(() => {
    const map = new Map<string, number>();
    for (const exp of expenses) {
      for (const t of exp.tags) {
        const norm = normalizeTag(t);
        if (norm) {
          map.set(norm, (map.get(norm) || 0) + 1);
        }
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }, [expenses]);

  // Mevcut Ay/Yıl seçenekleri
  const availableMonths = useMemo(() => {
    const set = new Set<string>([currentMonthYear]);
    for (const exp of expenses) {
      if (exp.date && exp.date.length >= 7) {
        set.add(exp.date.slice(0, 7));
      }
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [expenses, currentMonthYear]);

  // Filtrelenmiş Harcamalar ve Günlük Gruplar
  const filteredExpenses = useMemo(
    () => filterExpenses(expenses, filters),
    [expenses, filters]
  );

  const dateGroups = useMemo(
    () => groupExpensesByDate(filteredExpenses),
    [filteredExpenses]
  );

  const metrics = useMemo(
    () => calculateMetrics(filteredExpenses, filters.monthYear),
    [filteredExpenses, filters.monthYear]
  );

  const toggleTagFilter = (tag: string) => {
    const norm = normalizeTag(tag);
    setFilters((prev) => {
      const exists = prev.selectedTags.includes(norm);
      return {
        ...prev,
        selectedTags: exists
          ? prev.selectedTags.filter((t) => t !== norm)
          : [...prev.selectedTags, norm],
      };
    });
  };

  const resetFilters = () => {
    setFilters({
      search: '',
      category: 'ALL',
      selectedTags: [],
      monthYear: currentMonthYear,
    });
  };

  const hasActiveFilters =
    Boolean(filters.search) ||
    filters.category !== 'ALL' ||
    filters.selectedTags.length > 0 ||
    filters.monthYear !== currentMonthYear;

  const currencySymbols: Record<CurrencyCode, string> = {
    TRY: '₺',
    USD: '$',
    EUR: '€',
    GBP: '£',
  };

  // Giriş yapılmamışsa ve Canlı Demo modunda değilse -> Mini Landing Page göster
  if (!authUser && !isDemoMode) {
    return (
      <LandingAuthView
        onGoogleLogin={() => {
          handleTriggerGoogleLogin().catch(() => {});
        }}
        onStartDemo={handleStartDemoMode}
        authError={authError}
        isLoggingIn={isLoggingIn}
      />
    );
  }

  const activeProfile: UserProfile = authUser || {
    id: 'demo_user',
    name: 'Demo Kullanıcı',
    email: 'demo@spentrack.app',
    mode: 'guest',
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-[#f4f4f5] pb-24 md:pb-14">
      {/* 4. Canlı Demo Modu Üst Bilgi Çubuğu (Demo Banner) */}
      {isDemoMode && (
        <div className="bg-[#121215] border-b border-[#27272a] px-4 sm:px-8 py-2.5">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs sm:text-sm">
            <div className="flex items-center gap-2.5 text-[#d4d4d8] text-center sm:text-left">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-[#10b981]/15 border border-[#10b981]/30 text-[#10b981] font-semibold text-xs shrink-0">
                <Eye className="w-3.5 h-3.5" />
                Canlı Demo Modu
              </span>
              <span>
                Canlı Demo Modu — Şu anda örnek harcama verilerini inceliyorsunuz. Kendi
                verilerinizi bulutta güvenle saklamak için giriş yapın.
              </span>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  handleTriggerGoogleLogin().catch(() => {});
                }}
                className="px-3.5 py-1.5 text-xs font-bold bg-[#f4f4f5] hover:bg-white text-[#09090b] rounded-lg flex items-center gap-2 transition-colors cursor-pointer"
              >
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 48 48">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
                <span>Google ile Giriş Yap</span>
              </button>
              <button
                type="button"
                onClick={handleExitDemoMode}
                className="px-3 py-1.5 text-xs font-medium bg-[#18181b] hover:bg-[#27272a] text-[#a1a1aa] hover:text-[#f4f4f5] border border-[#27272a] rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Demodan Çık</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SubTrack Stili Üst Bar */}
      <header className="sticky top-0 z-30 bg-[#0d0d10]/95 backdrop-blur-md border-b border-[#222226] px-4 sm:px-8 py-4 flex items-center justify-between gap-8">
        {/* Zone 1: ST Brand Wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('list');
          }}
          className="flex items-center gap-3 text-xl font-bold tracking-tight text-[#f4f4f5] whitespace-nowrap shrink-0"
        >
          <span className="w-8 h-8 rounded-xl bg-[#18181b] border border-[#27272a] flex items-center justify-center font-mono text-xs font-bold tracking-wider text-[#f4f4f5]">
            ST
          </span>
          <span>SpenTrack</span>
        </a>

        {/* Zone 2: 5 concise single-line navigation links */}
        <nav
          aria-label="Ana Navigasyon"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-[#a1a1aa]"
        >
          <button
            type="button"
            onClick={() => setActiveView('list')}
            className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'list'
                ? 'bg-[#1c1c21] text-[#f4f4f5] font-semibold border border-[#2c2c34]'
                : 'hover:text-[#f4f4f5]'
            }`}
          >
            Harcama Listesi
          </button>
          <button
            type="button"
            onClick={() => setActiveView('analytics')}
            className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'analytics'
                ? 'bg-[#1c1c21] text-[#f4f4f5] font-semibold border border-[#2c2c34]'
                : 'hover:text-[#f4f4f5]'
            }`}
          >
            Analiz & Grafikler
          </button>
          <button
            type="button"
            onClick={() => setActiveView('calendar')}
            className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'calendar'
                ? 'bg-[#1c1c21] text-[#f4f4f5] font-semibold border border-[#2c2c34]'
                : 'hover:text-[#f4f4f5]'
            }`}
          >
            Aylık Takvim
          </button>
          <button
            type="button"
            onClick={() => setIsScannerOpen(true)}
            className="hover:text-[#f4f4f5] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Fiş / Ekstre Tara
          </button>
          <button
            type="button"
            onClick={() => setIsAssistantOpen(true)}
            className="hover:text-[#f4f4f5] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Gemini Asistanı
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action (SubTrack White CTA Button) */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              setEditingExpense(null);
              setIsManualModalOpen(true);
            }}
            className="px-4 py-2.5 text-sm font-bold bg-white text-[#09090b] rounded-xl hover:bg-zinc-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            + Yeni Ekle
          </button>
        </div>
      </header>

      {/* Ana İçerik Konteyneri */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 pt-6 space-y-6">
        {/* SubTrack Stili Hızlı Aksiyon, Döviz Kuru ve Aktif Profil Çubuğu */}
        <div className="bg-[#111114] border border-[#222226] rounded-2xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="px-4 py-2.5 text-sm font-medium bg-[#18181c] text-[#f4f4f5] border border-[#27272a] rounded-xl hover:border-[#0ea5e9] transition-colors flex items-center gap-2 cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-[#0ea5e9] shrink-0" />
              <span className="sm:hidden">Fiş / PDF Ekstre Yükle</span>
              <span className="hidden sm:inline">
                Fiş / Ekran Görüntüsü / PDF Ekstre Yükle (Ctrl+V)
              </span>
            </button>

            <button
              type="button"
              onClick={() => setIsAssistantOpen(true)}
              className="px-4 py-2.5 text-sm font-medium bg-[#18181c] text-[#f4f4f5] border border-[#27272a] rounded-xl hover:border-[#8b5cf6] transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-[#8b5cf6]" />
              <span>SpenTrack Gemini Asistanı</span>
            </button>

            <button
              type="button"
              onClick={() => setShowApiKeyBar((v) => !v)}
              className={`px-3.5 py-2.5 text-sm font-medium rounded-xl border transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                showApiKeyBar || customApiKey
                  ? 'bg-[#10b981]/10 border-[#10b981]/40 text-[#10b981]'
                  : 'bg-[#18181c] border-[#27272a] text-[#a1a1aa] hover:text-[#f4f4f5] hover:border-[#3f3f46]'
              }`}
            >
              <KeyRound className="w-4 h-4 shrink-0" />
              <span>{customApiKey ? 'API Anahtarı Tanımlı' : 'Gemini API Anahtarı'}</span>
            </button>
          </div>

          {/* Sağ: SubTrack Stili Döviz Seçici (₺ $ € £), Yedekleme ve Aktif Profil */}
          <div className="flex flex-wrap items-center gap-3">
            <div
              role="group"
              aria-label="Para Birimi Seçici"
              className="flex items-center gap-1 p-1 bg-[#18181c] border border-[#27272a] rounded-xl"
            >
              {(['TRY', 'USD', 'EUR', 'GBP'] as CurrencyCode[]).map((curr) => (
                <button
                  key={curr}
                  type="button"
                  title={curr}
                  onClick={() => setDisplayCurrency(curr)}
                  className={`px-3 py-1.5 text-sm font-mono font-semibold rounded-lg transition-colors cursor-pointer ${
                    displayCurrency === curr
                      ? 'bg-[#27272e] text-white'
                      : 'text-[#a1a1aa] hover:text-[#f4f4f5]'
                  }`}
                >
                  {currencySymbols[curr]} {curr}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setIsSyncModalOpen(true)}
              aria-label="Hesap ve Veri Yedekleme"
              title="Hesap ve Veri Yedekleme"
              className="min-h-[42px] min-w-[42px] flex items-center justify-center bg-[#18181c] border border-[#27272a] hover:border-[#3f3f46] rounded-xl text-[#a1a1aa] hover:text-[#f4f4f5] transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
            </button>

            {/* Tek Tıkla Google ile Giriş veya Aktif Google Profili */}
            {authUser ? (
              <button
                type="button"
                onClick={() => setIsSyncModalOpen(true)}
                className="px-3.5 py-1.5 bg-[#18181c] border border-[#27272a] hover:border-[#3f3f46] rounded-xl flex items-center gap-2.5 text-left transition-colors cursor-pointer"
              >
                {authUser.picture ? (
                  <img
                    src={authUser.picture}
                    alt={authUser.name}
                    className="w-7 h-7 rounded-full border border-[#10b981]"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-[#27272e] flex items-center justify-center text-xs font-bold text-[#f4f4f5]">
                    <User className="w-3.5 h-3.5 text-[#10b981]" />
                  </div>
                )}
                <div className="leading-tight pr-1">
                  <div className="text-xs font-bold text-[#f4f4f5]">{authUser.name}</div>
                  <div className="text-[11px] font-medium text-[#10b981]">Aktif</div>
                </div>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  handleTriggerGoogleLogin().catch(() => {
                    setIsSyncModalOpen(true);
                  });
                }}
                className="px-4 py-2 bg-[#f4f4f5] hover:bg-white text-[#09090b] font-semibold text-sm rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer shadow-sm"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
                <span>Google ile Giriş</span>
              </button>
            )}
          </div>
        </div>

        {/* Hesaba Tanımlı Manuel Gemini API Anahtarı Alanı (Aksiyon barından açılır veya anahtar henüz tanımlanmamışsa gösterilir) */}
        {(showApiKeyBar || !customApiKey) && (
          <AccountApiKeyBox
            savedApiKey={customApiKey}
            isAuthenticated={Boolean(authUser && !isDemoMode)}
            onSaveApiKey={handleSaveAccountApiKey}
          />
        )}

        {/* 4 Üst Özet Kartı + Canlı Kur Satırı */}
        <MetricsOverview
          metrics={metrics}
          displayCurrency={displayCurrency}
          rates={rates}
          activeMonthLabel={filters.monthYear === 'ALL' ? 'Tüm Dönemler' : filters.monthYear}
          onSelectTagFilter={toggleTagFilter}
        />

        {/* Arama, Kategori, Ay/Yıl, Görünüm Seçici ve Çok Renkli #etiket Filtre Barı */}
        <section
          aria-label="Filtreler ve Görünüm Seçimi"
          className="bg-[#111114] border border-[#222226] rounded-2xl p-5 space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-center">
            {/* Arama Çubuğu */}
            <div className="md:col-span-4 relative">
              <Search className="w-4 h-4 text-[#71717a] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                aria-label="Harcamalarda ara"
                value={filters.search}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, search: e.target.value }))
                }
                placeholder="İşyeri, #etiket, not veya tutar ara..."
                className="w-full pl-10 pr-4 py-2.5 text-sm bg-[#18181c] border border-[#27272a] rounded-xl text-[#f4f4f5] placeholder-[#71717a] focus:outline-none focus:border-[#0ea5e9]"
              />
            </div>

            {/* Kategori Seçici */}
            <div className="md:col-span-3">
              <select
                aria-label="Kategori filtresi"
                value={filters.category}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    category: e.target.value as ExpenseCategory | 'ALL',
                  }))
                }
                className="w-full px-3.5 py-2.5 text-sm bg-[#18181c] border border-[#27272a] rounded-xl text-[#f4f4f5] focus:outline-none focus:border-[#0ea5e9]"
              >
                <option value="ALL">Tüm Kategoriler (8 Kategori)</option>
                {FIXED_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Ay/Yıl Seçici */}
            <div className="md:col-span-2">
              <select
                aria-label="Dönem filtresi"
                value={filters.monthYear}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, monthYear: e.target.value }))
                }
                className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums bg-[#18181c] border border-[#27272a] rounded-xl text-[#f4f4f5] focus:outline-none focus:border-[#0ea5e9]"
              >
                <option value="ALL">Tüm Zamanlar</option>
                {availableMonths.map((ym) => (
                  <option key={ym} value={ym}>
                    {ym} Dönemi
                  </option>
                ))}
              </select>
            </div>

            {/* Görünüm Değiştirici */}
            <div className="md:col-span-3 flex items-center justify-end gap-1 p-1 bg-[#18181c] border border-[#27272a] rounded-xl">
              <button
                type="button"
                onClick={() => setActiveView('list')}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                  activeView === 'list'
                    ? 'bg-[#27272e] text-white font-semibold'
                    : 'text-[#a1a1aa] hover:text-[#f4f4f5]'
                }`}
              >
                <ListFilter className="w-4 h-4" />
                <span>Liste</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveView('analytics')}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                  activeView === 'analytics'
                    ? 'bg-[#27272e] text-white font-semibold'
                    : 'text-[#a1a1aa] hover:text-[#f4f4f5]'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span>Grafik</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveView('calendar')}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                  activeView === 'calendar'
                    ? 'bg-[#27272e] text-white font-semibold'
                    : 'text-[#a1a1aa] hover:text-[#f4f4f5]'
                }`}
              >
                <CalendarIcon className="w-4 h-4" />
                <span>Takvim</span>
              </button>
            </div>
          </div>

          {/* Çok Renkli Tıklanabilir #etiket Filtreleri */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-[#222226]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs sm:text-sm font-medium text-[#a1a1aa] mr-1">
                Etiket Filtreleri:
              </span>
              {allExistingTags.map((tag) => {
                const isSelected = filters.selectedTags.includes(tag);
                const tagColor = getTagColor(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTagFilter(tag)}
                    style={{
                      borderColor: isSelected ? tagColor : undefined,
                      backgroundColor: isSelected ? `${tagColor}22` : undefined,
                      color: isSelected ? tagColor : undefined,
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-mono transition-colors whitespace-nowrap cursor-pointer border flex items-center gap-1.5 ${
                      isSelected
                        ? 'font-bold'
                        : 'bg-[#18181c] text-[#d4d4d8] border-[#27272a] hover:border-[#3f3f46] hover:text-white'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: tagColor }}
                    />
                    <span>{tag}</span>
                  </button>
                );
              })}
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="px-3 py-1.5 text-xs sm:text-sm font-medium text-[#f59e0b] hover:underline flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Filtreleri Sıfırla</span>
              </button>
            )}
          </div>
        </section>

        {/* Ana Görünüm Alanı */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-24 bg-[#111114] border border-[#222226] rounded-2xl animate-pulse"
              />
            ))}
          </div>
        ) : activeView === 'list' ? (
          <ExpenseListView
            groups={dateGroups}
            displayCurrency={displayCurrency}
            rates={rates}
            onEdit={(exp) => {
              setEditingExpense(exp);
              setIsManualModalOpen(true);
            }}
            onDelete={handleDeleteExpense}
            onTagClick={toggleTagFilter}
            onOpenManualAdd={() => {
              setEditingExpense(null);
              setIsManualModalOpen(true);
            }}
            onOpenScanner={() => setIsScannerOpen(true)}
          />
        ) : activeView === 'analytics' ? (
          <AnalyticsView
            expenses={filteredExpenses}
            displayCurrency={displayCurrency}
            rates={rates}
            onSelectCategory={(cat) => {
              setFilters((prev) => ({ ...prev, category: cat }));
              setActiveView('list');
            }}
            onSelectTag={(tag) => {
              toggleTagFilter(tag);
              setActiveView('list');
            }}
          />
        ) : (
          <CalendarView
            expenses={filteredExpenses}
            monthYear={filters.monthYear}
            displayCurrency={displayCurrency}
            rates={rates}
            onSelectExpense={(exp) => {
              setEditingExpense(exp);
              setIsManualModalOpen(true);
            }}
          />
        )}
      </main>

      {/* Mobil Alt Navigasyon Barı */}
      <nav
        aria-label="Mobil Alt Navigasyon"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#111114]/95 backdrop-blur-md border-t border-[#222226] grid grid-cols-5 items-center h-15 px-1"
      >
        <button
          type="button"
          onClick={() => setActiveView('list')}
          className={`min-h-[44px] flex flex-col items-center justify-center text-xs font-medium cursor-pointer ${
            activeView === 'list' ? 'text-white font-bold' : 'text-[#a1a1aa]'
          }`}
        >
          <ListFilter className="w-4 h-4" />
          <span className="mt-0.5">Liste</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveView('analytics')}
          className={`min-h-[44px] flex flex-col items-center justify-center text-xs font-medium cursor-pointer ${
            activeView === 'analytics' ? 'text-white font-bold' : 'text-[#a1a1aa]'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span className="mt-0.5">Analiz</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setEditingExpense(null);
            setIsManualModalOpen(true);
          }}
          aria-label="Mobil Yeni Harcama Ekle"
          className="min-h-[44px] flex flex-col items-center justify-center text-xs font-bold text-[#10b981] cursor-pointer"
        >
          <Plus className="w-5 h-5" />
          <span>Ekle</span>
        </button>

        <button
          type="button"
          onClick={() => setIsScannerOpen(true)}
          className="min-h-[44px] flex flex-col items-center justify-center text-xs font-medium text-[#a1a1aa] cursor-pointer"
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span className="mt-0.5">Ekstre</span>
        </button>

        <button
          type="button"
          onClick={() => setIsAssistantOpen(true)}
          className="min-h-[44px] flex flex-col items-center justify-center text-xs font-medium text-[#a1a1aa] cursor-pointer"
        >
          <Sparkles className="w-4 h-4" />
          <span className="mt-0.5">Asistan</span>
        </button>
      </nav>

      {/* Modallar ve Paneller */}
      <ManualExpenseModal
        isOpen={isManualModalOpen}
        editingExpense={editingExpense}
        existingTags={allExistingTags}
        rates={rates}
        onClose={() => {
          setIsManualModalOpen(false);
          setEditingExpense(null);
        }}
        onSave={handleSaveManualExpense}
      />

      <StatementScannerModal
        isOpen={isScannerOpen}
        existingExpenses={expenses}
        existingTags={allExistingTags}
        customApiKey={customApiKey}
        isAuthenticated={Boolean(authUser && !isDemoMode)}
        authHeaders={authUser ? buildAuthHeaders(authUser.id, authToken) : {}}
        onSaveApiKey={handleSaveAccountApiKey}
        onClose={() => setIsScannerOpen(false)}
        onBatchSave={handleBatchSaveExpenses}
      />

      <AssistantDrawer
        isOpen={isAssistantOpen}
        expenses={expenses}
        existingTags={allExistingTags}
        displayCurrency={displayCurrency}
        rates={rates}
        customApiKey={customApiKey}
        isAuthenticated={Boolean(authUser && !isDemoMode)}
        authHeaders={authUser ? buildAuthHeaders(authUser.id, authToken) : {}}
        onSaveApiKey={handleSaveAccountApiKey}
        onClose={() => setIsAssistantOpen(false)}
        onBatchSave={handleBatchSaveExpenses}
      />

      <DataSyncModal
        isOpen={isSyncModalOpen}
        user={activeProfile}
        expenses={expenses}
        guestPendingCount={expenses.length}
        savedApiKey={customApiKey}
        onSaveApiKey={handleSaveAccountApiKey}
        onClose={() => setIsSyncModalOpen(false)}
        onGoogleLogin={handleTriggerGoogleLogin}
        onGoogleLogout={handleLogout}
        onUpdateProfileName={() => {}}
        onSyncGuestToCloud={handleSyncGuestToCloud}
        onImportBatch={handleBatchSaveExpenses}
      />
    </div>
  );
}
