import React, { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import {
  BANK_QUICK_TAGS,
  COMMON_QUICK_TAGS,
  CurrencyCode,
  CurrencyRates,
  Expense,
  ExpenseCategory,
  FIXED_CATEGORIES,
} from '../types';
import {
  normalizeCategory,
  normalizeTag,
  normalizeTagList,
  parseTurkishAmount,
} from '../utils/expenseLogic';

interface ManualExpenseModalProps {
  isOpen: boolean;
  editingExpense: Expense | null;
  existingTags: string[];
  rates: CurrencyRates | null;
  onClose: () => void;
  onSave: (payload: Omit<Expense, 'id'> & { id?: string }) => Promise<void>;
}

export const ManualExpenseModal: React.FC<ManualExpenseModalProps> = ({
  isOpen,
  editingExpense,
  existingTags,
  rates,
  onClose,
  onSave,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('TRY');
  const [category, setCategory] = useState<ExpenseCategory>('Market');
  const [date, setDate] = useState(today);
  const [tags, setTags] = useState<string[]>(['#saglamkart']);
  const [customTagInput, setCustomTagInput] = useState('');
  const [notes, setNotes] = useState('');
  const [isRefund, setIsRefund] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingExpense) {
      setTitle(editingExpense.title);
      setAmountInput(String(Math.abs(editingExpense.amount)));
      setCurrency(editingExpense.currency);
      setCategory(editingExpense.category);
      setDate(editingExpense.date);
      setTags(editingExpense.tags);
      setNotes(editingExpense.notes || '');
      setIsRefund(editingExpense.amount < 0);
      setError('');
    } else {
      setTitle('');
      setAmountInput('');
      setCurrency('TRY');
      setCategory('Market');
      setDate(new Date().toISOString().slice(0, 10));
      setTags(['#saglamkart']);
      setCustomTagInput('');
      setNotes('');
      setIsRefund(false);
      setError('');
    }
  }, [editingExpense, isOpen]);

  if (!isOpen) return null;

  const toggleTag = (rawTag: string) => {
    const norm = normalizeTag(rawTag);
    if (!norm) return;
    setTags((prev) =>
      prev.includes(norm) ? prev.filter((t) => t !== norm) : [...prev, norm]
    );
  };

  const handleAddCustomTag = () => {
    const norm = normalizeTag(customTagInput);
    if (!norm) return;
    if (!tags.includes(norm)) {
      setTags((prev) => [...prev, norm]);
    }
    setCustomTagInput('');
  };

  const computeAmountInTRY = (amt: number, curr: CurrencyCode): number => {
    if (curr === 'TRY' || !rates || !rates.rates[curr]) return amt;
    const rateFromTRY = rates.rates[curr];
    return rateFromTRY > 0 ? Math.round((amt / rateFromTRY) * 100) / 100 : amt;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    const parsedNum = Math.abs(parseTurkishAmount(amountInput));

    if (!cleanTitle) {
      setError('Lütfen işyeri veya harcama başlığı girin.');
      return;
    }
    if (!parsedNum || parsedNum <= 0) {
      setError('Lütfen geçerli bir harcama tutarı girin (örn: 220 veya 1.250,50).');
      return;
    }

    const signedAmount = isRefund ? -parsedNum : parsedNum;
    const finalTags = normalizeTagList(
      isRefund && !tags.includes('#iade') ? [...tags, '#iade'] : tags
    );
    const amountInTRY = computeAmountInTRY(signedAmount, currency);

    setSaving(true);
    setError('');
    try {
      await onSave({
        id: editingExpense?.id,
        title: cleanTitle,
        amount: signedAmount,
        currency,
        amountInTRY,
        category: normalizeCategory(category),
        tags: finalTags,
        date,
        notes: notes.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  const extraPoolTags = existingTags.filter(
    (t) =>
      !BANK_QUICK_TAGS.some((b) => b.tag === t) &&
      !(COMMON_QUICK_TAGS as readonly string[]).includes(t)
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-expense-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto"
    >
      <div className="w-full max-w-lg bg-[#18181b] border border-[#27272a] rounded-xl p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-[#27272a]">
          <h2 id="manual-expense-title" className="text-base font-semibold text-[#f4f4f5]">
            {editingExpense ? 'Harcama Kaydını Düzenle' : 'Manuel Harcama Ekle'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Modalı kapat"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-[#f43f5e]/10 border border-[#f43f5e]/30 text-xs text-[#f43f5e]">
              {error}
            </div>
          )}

          {/* Başlık / İşyeri */}
          <div>
            <label
              htmlFor="expense-title-input"
              className="block text-xs font-medium text-[#a1a1aa] mb-1.5"
            >
              Başlık / İşyeri
            </label>
            <input
              id="expense-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Örn: Migros, Starbucks, Apple Store..."
              className="w-full px-3.5 py-2.5 text-sm bg-[#09090b] border border-[#27272a] rounded-lg text-[#f4f4f5] placeholder-[#71717a] focus:outline-none focus:border-[#10b981]"
            />
          </div>

          {/* Tutar, Para Birimi ve İade */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label
                htmlFor="expense-amount-input"
                className="block text-xs font-medium text-[#a1a1aa] mb-1.5"
              >
                Tutar (Örn: 1.250,50)
              </label>
              <input
                id="expense-amount-input"
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="0,00"
                className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums bg-[#09090b] border border-[#27272a] rounded-lg text-[#f4f4f5] placeholder-[#71717a] focus:outline-none focus:border-[#10b981]"
              />
            </div>

            <div>
              <label
                htmlFor="expense-currency-select"
                className="block text-xs font-medium text-[#a1a1aa] mb-1.5"
              >
                Para Birimi
              </label>
              <select
                id="expense-currency-select"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="w-full px-3 py-2.5 text-sm font-mono bg-[#09090b] border border-[#27272a] rounded-lg text-[#f4f4f5] focus:outline-none focus:border-[#10b981]"
              >
                <option value="TRY">TRY (₺)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>
          </div>

          {/* Kategori ve Tarih */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="expense-category-select"
                className="block text-xs font-medium text-[#a1a1aa] mb-1.5"
              >
                Kategori
              </label>
              <select
                id="expense-category-select"
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                className="w-full px-3 py-2.5 text-sm bg-[#09090b] border border-[#27272a] rounded-lg text-[#f4f4f5] focus:outline-none focus:border-[#10b981]"
              >
                {FIXED_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="expense-date-input"
                className="block text-xs font-medium text-[#a1a1aa] mb-1.5"
              >
                Tarih
              </label>
              <input
                id="expense-date-input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2.5 text-sm font-mono tabular-nums bg-[#09090b] border border-[#27272a] rounded-lg text-[#f4f4f5] focus:outline-none focus:border-[#10b981]"
              />
            </div>
          </div>

          {/* Banka ve Ödeme Yöntemi Quick-Chips */}
          <div>
            <span className="block text-xs font-medium text-[#a1a1aa] mb-2">
              Kart & Banka Etiketleri (Tek Tıkla Seç)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {BANK_QUICK_TAGS.map(({ tag, label }) => {
                const active = tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer border ${
                      active
                        ? 'bg-[#10b981]/15 border-[#10b981] text-[#10b981] font-semibold'
                        : 'bg-[#09090b] border-[#27272a] text-[#a1a1aa] hover:border-[#3f3f46] hover:text-[#f4f4f5]'
                    }`}
                  >
                    {tag} <span className="font-sans text-[11px] opacity-80">({label})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Yaygın Etiketler ve Özel Etiket Girişi */}
          <div>
            <span className="block text-xs font-medium text-[#a1a1aa] mb-2">
              Harcama Etiketleri (#etiket)
            </span>
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {[...COMMON_QUICK_TAGS, ...extraPoolTags].map((tag) => {
                const active = tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors cursor-pointer border ${
                      active
                        ? 'bg-[#10b981]/15 border-[#10b981] text-[#10b981]'
                        : 'bg-[#09090b] border-[#27272a] text-[#71717a] hover:text-[#f4f4f5]'
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                aria-label="Yeni etiket ekle"
                value={customTagInput}
                onChange={(e) => setCustomTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomTag();
                  }
                }}
                placeholder="Yeni etiket yazın (örn: #migros, #tatil)"
                className="flex-1 px-3 py-2 text-xs font-mono bg-[#09090b] border border-[#27272a] rounded-lg text-[#f4f4f5] placeholder-[#71717a] focus:outline-none focus:border-[#10b981]"
              />
              <button
                type="button"
                onClick={handleAddCustomTag}
                className="px-3 py-2 text-xs font-medium bg-[#121215] border border-[#27272a] rounded-lg text-[#f4f4f5] hover:border-[#3f3f46] flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Etiket Ekle
              </button>
            </div>
          </div>

          {/* Opsiyonel Not & İade Seçeneği */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
            <div>
              <label
                htmlFor="expense-notes-input"
                className="block text-xs font-medium text-[#a1a1aa] mb-1.5"
              >
                Not / Taksit Bilgisi (Opsiyonel)
              </label>
              <input
                id="expense-notes-input"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Örn: 2/6 Taksit"
                className="w-full px-3 py-2 text-xs bg-[#09090b] border border-[#27272a] rounded-lg text-[#f4f4f5] placeholder-[#71717a] focus:outline-none focus:border-[#10b981]"
              />
            </div>

            <div className="pt-4">
              <label className="flex items-center gap-2 text-xs text-[#a1a1aa] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isRefund}
                  onChange={(e) => setIsRefund(e.target.checked)}
                  className="rounded border-[#27272a] bg-[#09090b] text-[#10b981] focus:ring-0"
                />
                <span>Bu işlem bir İade / İptal (-tutar)</span>
              </label>
            </div>
          </div>

          {/* Alt Butonlar */}
          <div className="pt-3 border-t border-[#27272a] flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[#a1a1aa] hover:text-[#f4f4f5] transition-colors cursor-pointer"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-xs font-semibold bg-[#10b981] text-[#09090b] rounded-lg hover:bg-[#10b981]/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Kaydediliyor...' : editingExpense ? 'Değişiklikleri Kaydet' : 'Harcamayı Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
