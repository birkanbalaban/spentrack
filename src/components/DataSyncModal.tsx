import React, { useRef, useState } from 'react';
import {
  X,
  Download,
  Upload,
  Check,
  Smartphone,
  LogOut,
} from 'lucide-react';
import { Expense, ExtractedExpense, UserProfile } from '../types';
import {
  expensesToCSV,
  normalizeCategory,
  normalizeTagList,
  parseCSVToExpenses,
  parseTurkishAmount,
} from '../utils/expenseLogic';
import { usePWAInstall } from '../utils/usePWAInstall';
import { AccountApiKeyBox } from './AccountApiKeyBox';

interface DataSyncModalProps {
  isOpen: boolean;
  user: UserProfile;
  expenses: Expense[];
  guestPendingCount: number;
  savedApiKey: string;
  onSaveApiKey: (apiKey: string) => Promise<void>;
  onClose: () => void;
  onGoogleLogin: () => Promise<void>;
  onGoogleLogout: () => Promise<void>;
  onUpdateProfileName: (name: string) => void;
  onSyncGuestToCloud: () => Promise<number>;
  onImportBatch: (items: ExtractedExpense[]) => Promise<void>;
}

export const DataSyncModal: React.FC<DataSyncModalProps> = ({
  isOpen,
  user,
  expenses,
  savedApiKey,
  onSaveApiKey,
  onClose,
  onGoogleLogin,
  onGoogleLogout,
  onImportBatch,
}) => {
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  if (!isOpen) return null;

  const handleGoogleSignInClick = async () => {
    setLoggingIn(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      await onGoogleLogin();
      setStatusMsg('Google hesabınız ile giriş yapıldı.');
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? `Google girişi tamamlanamadı: ${err.message}`
          : 'Google girişi sırasında bir hata oluştu.'
      );
    } finally {
      setLoggingIn(false);
    }
  };

  const handleGoogleLogoutClick = async () => {
    setErrorMsg('');
    setStatusMsg('');
    try {
      await onGoogleLogout();
      setStatusMsg('Google hesabından çıkış yapıldı.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Çıkış yapılamadı.');
    }
  };

  const handleDownloadJSON = () => {
    const blob = new Blob([JSON.stringify(expenses, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spentrack-yedek-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg(`${expenses.length} kayıt JSON olarak dışa aktarıldı.`);
  };

  const handleDownloadCSV = () => {
    const csv = expensesToCSV(expenses);
    const blob = new Blob([csv], { type: 'text/csv;charset-utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spentrack-yedek-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg(`${expenses.length} kayıt CSV olarak dışa aktarıldı.`);
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    setErrorMsg('');
    setStatusMsg('');
    try {
      const text = await file.text();
      let items: ExtractedExpense[] = [];

      if (file.name.toLowerCase().endsWith('.json')) {
        const raw = JSON.parse(text);
        const arr = Array.isArray(raw) ? raw : raw.expenses || [];
        items = arr.map((r: Record<string, unknown>) => ({
          title: String(r.title || 'Harcama'),
          amount: parseTurkishAmount(r.amount as number | string),
          currency: (['TRY', 'USD', 'EUR', 'GBP'].includes(String(r.currency))
            ? r.currency
            : 'TRY') as ExtractedExpense['currency'],
          amountInTRY: parseTurkishAmount((r.amountInTRY ?? r.amount) as number | string),
          category: normalizeCategory(String(r.category || 'Diğer')),
          tags: normalizeTagList(Array.isArray(r.tags) ? (r.tags as string[]) : []),
          date: String(r.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
          notes: String(r.notes || ''),
        }));
      } else {
        items = parseCSVToExpenses(text);
      }

      if (items.length === 0) {
        setErrorMsg('Dosyada geçerli harcama kaydı bulunamadı.');
        return;
      }

      await onImportBatch(items);
      setStatusMsg(`${items.length} kayıt başarıyla içe aktarıldı.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Dosya içe aktarılamadı.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto"
    >
      <div className="w-full max-w-md bg-[#18181b] border border-[#27272a] rounded-2xl p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between pb-4 border-b border-[#27272a]">
          <div>
            <h2 id="sync-modal-title" className="text-lg font-bold text-[#f4f4f5]">
              Hesap & Veri Yedekleme
            </h2>
            <p className="text-xs sm:text-sm text-[#a1a1aa] mt-0.5">
              Google ile giriş ve JSON / CSV yedekleme
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Yedekleme modalını kapat"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {statusMsg && (
          <div className="p-3.5 rounded-xl bg-[#10b981]/10 border border-[#10b981]/30 text-sm text-[#10b981] flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-[#f43f5e]/10 border border-[#f43f5e]/30 text-sm text-[#f43f5e]">
            {errorMsg}
          </div>
        )}

        {/* 1. Tek Tıkla Google ile Giriş */}
        <div className="bg-[#121215] border border-[#27272a] rounded-xl p-4">
          {user.mode === 'google' ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {user.picture ? (
                  <img
                    src={user.picture}
                    alt={user.name}
                    className="w-10 h-10 rounded-full border border-[#10b981]"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[#10b981]/20 text-[#10b981] flex items-center justify-center font-bold text-sm">
                    {user.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#f4f4f5] truncate">
                    {user.name}
                  </div>
                  <div className="text-xs text-[#a1a1aa] truncate">{user.email}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleGoogleLogoutClick}
                className="px-3 py-2 text-xs font-semibold text-[#f43f5e] bg-[#f43f5e]/10 border border-[#f43f5e]/30 rounded-xl hover:bg-[#f43f5e]/20 flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Çıkış Yap
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleGoogleSignInClick}
              disabled={loggingIn}
              className="w-full py-3 px-4 bg-white hover:bg-zinc-100 text-[#09090b] font-semibold text-sm rounded-xl flex items-center justify-center gap-3 transition-colors shadow-sm cursor-pointer disabled:opacity-60"
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
              <span>{loggingIn ? 'Bağlanılıyor...' : 'Google ile Giriş'}</span>
            </button>
          )}
        </div>

        {/* 2. Hesaba Tanımlı Manuel Gemini API Anahtarı */}
        <AccountApiKeyBox
          savedApiKey={savedApiKey}
          isAuthenticated={user.mode === 'google'}
          onSaveApiKey={onSaveApiKey}
        />

        {/* 3. JSON & CSV Dışa / İçe Aktarım */}
        <div className="bg-[#121215] border border-[#27272a] rounded-xl p-4 space-y-3">
          <div className="text-sm font-semibold text-[#f4f4f5]">
            JSON & CSV Veri Yedekleme
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={handleDownloadJSON}
              className="px-3.5 py-2.5 text-sm font-medium bg-[#18181b] border border-[#27272a] rounded-xl text-[#f4f4f5] hover:border-[#0ea5e9] flex items-center justify-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4 text-[#0ea5e9]" />
              JSON İndir
            </button>
            <button
              type="button"
              onClick={handleDownloadCSV}
              className="px-3.5 py-2.5 text-sm font-medium bg-[#18181b] border border-[#27272a] rounded-xl text-[#f4f4f5] hover:border-[#10b981] flex items-center justify-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4 text-[#10b981]" />
              CSV İndir
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-2.5 text-sm font-medium bg-[#18181b] border border-[#27272a] rounded-xl text-[#f4f4f5] hover:border-[#f97316] flex items-center justify-center gap-2 cursor-pointer"
            >
              <Upload className="w-4 h-4 text-[#f97316]" />
              İçe Aktar
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              onChange={(e) => handleImportFile(e.target.files?.[0])}
              className="hidden"
            />
          </div>
        </div>

        {/* 3. Mobil PWA Kurulum Durumu */}
        {!isInstalled && (
          <div className="bg-[#121215] border border-[#27272a] rounded-xl p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Smartphone className="w-5 h-5 text-[#0ea5e9] shrink-0" />
              <div className="text-xs sm:text-sm">
                <div className="font-semibold text-[#f4f4f5]">Mobil Uygulama</div>
                <div className="text-[#a1a1aa]">
                  {isIOS
                    ? 'Safari Paylaş menüsünden "Ana Ekrana Ekle" seçeneğini kullanın.'
                    : 'SpenTrack uygulamasını cihazınıza kurun.'}
                </div>
              </div>
            </div>
            {isInstallable && (
              <button
                type="button"
                onClick={install}
                className="px-3.5 py-2 text-xs font-semibold bg-white text-[#09090b] rounded-xl whitespace-nowrap cursor-pointer"
              >
                Kur
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
