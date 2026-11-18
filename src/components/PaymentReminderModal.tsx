import React, { useEffect, useState } from 'react';
import { X, Plus, CalendarClock } from 'lucide-react';
import {
  BANK_QUICK_TAGS,
  COMMON_QUICK_TAGS,
  CurrencyCode,
  CurrencyRates,
  ExpenseCategory,
  FIXED_CATEGORIES,
  PaymentReminder,
  ReminderRecurrence,
} from '../types';
import {
  normalizeCategory,
  normalizeTag,
  normalizeTagList,
  parseTurkishAmount,
} from '../utils/expenseLogic';
import { addDaysISO } from '../utils/reminderLogic';

interface PaymentReminderModalProps {
  isOpen: boolean;
  editingReminder: PaymentReminder | null;
  initialDate?: string | null;
  existingTags: string[];
  rates: CurrencyRates | null;
  onClose: () => void;
  onSave: (
    payload: Omit<PaymentReminder, 'id' | 'status'> & {
      id?: string;
      status?: PaymentReminder['status'];
    }
  ) => Promise<void>;
}

const REMINDER_QUICK_TAGS = ['#kira', '#aidat', '#fatura', '#kredikarti', '#taksit', '#abonelik'];

export const PaymentReminderModal: React.FC<PaymentReminderModalProps> = ({
  isOpen,
  editingReminder,
  initialDate,
  existingTags,
  rates,
  onClose,
  onSave,
}) => {
  const defaultFutureDate = addDaysISO(new Date().toISOString().slice(0, 10), 7);
  const [title, setTitle] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('TRY');
  const [category, setCategory] = useState<ExpenseCategory>('Fatura & Abonelik');
  const [dueDate, setDueDate] = useState(defaultFutureDate);
  const [recurrence, setRecurrence] = useState<ReminderRecurrence>('monthly');
  const [tags, setTags] = useState<string[]>(['#fatura']);
  const [customTagInput, setCustomTagInput] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingReminder) {
      setTitle(editingReminder.title);
      setAmountInput(String(Math.abs(editingReminder.amount)));
      setCurrency(editingReminder.currency);
      setCategory(editingReminder.category);
      setDueDate(editingReminder.dueDate);
      setRecurrence(editingReminder.recurrence);
      setTags(editingReminder.tags);
      setNotes(editingReminder.notes || '');
      setError('');
    } else {
      setTitle('');
      setAmountInput('');
      setCurrency('TRY');
      setCategory('Fatura & Abonelik');
      setDueDate(initialDate || addDaysISO(new Date().toISOString().slice(0, 10), 7));
      setRecurrence('monthly');
      setTags(['#fatura']);
      setCustomTagInput('');
      setNotes('');
      setError('');
    }
  }, [editingReminder, initialDate, isOpen]);

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
      setError('Lütfen ödeme başlığı girin (örn: Ev Kirası, Elektrik Faturası).');
      return;
    }
    if (!parsedNum || parsedNum <= 0) {
      setError('Lütfen geçerli bir ödeme tutarı girin.');
      return;
    }
    if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      setError('Lütfen geçerli bir son ödeme / hatırlatma tarihi seçin.');
      return;
    }

    const finalTags = normalizeTagList(tags);
    const amountInTRY = computeAmountInTRY(parsedNum, currency);

    setSaving(true);
    setError('');
    try {
      await onSave({
        id: editingReminder?.id,
        title: cleanTitle,
        amount: parsedNum,
        currency,
        amountInTRY,
        category: normalizeCategory(category),
        tags: finalTags.length > 0 ? finalTags : ['#planli'],
        dueDate,
        recurrence,
        status: editingReminder?.status || 'pending',
        notes: notes.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hatırlatma kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  const extraPoolTags = existingTags.filter(
    (t) =>
      !BANK_QUICK_TAGS.some((b) => b.tag === t) &&
      !REMINDER_QUICK_TAGS.includes(t) &&
      !(COMMON_QUICK_TAGS as readonly string[]).includes(t)
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-reminder-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto"
    >
      <div className="w-full max-w-lg bg-[#18181b] border border-[#27272a] rounded-xl p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-[#27272a]">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-[#f59e0b]" />
            <h2 id="payment-reminder-modal-title" className="text-base font-semibold text-[#f4f4f5]">
              {editingReminder ? 'Ödeme Hatırlatmasını Düzenle' : 'İleriye Dönük Ödeme Hatırlatması'}
            </h2>
          </div>
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

          <div>
            <label
              htmlFor="reminder-title-input"
              className="block text-xs font-medium text-[#a1a1aa] mb-1.5"
            >
              Ödeme Başlığı / Kurum
            </label>
            <input
              id="reminder-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Örn: Ev Kirası, Site Aidatı, Enerjisa Faturası..."
              className="w-full px-3.5 py-2.5 text-sm bg-[#09090b] border border-[#27272a] rounded-lg text-[#f4f4f5] placeholder-[#71717a] focus:outline-none focus:border-[#10b981]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label
                htmlFor="reminder-amount-input"
                className="block text-xs font-medium text-[#a1a1aa] mb-1.5"
              >
                Planlanan Tutar
              </label>
              <input
                id="reminder-amount-input"
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
                htmlFor="reminder-currency-select"
                className="block text-xs font-medium text-[#a1a1aa] mb-1.5"
              >
                Para Birimi
              </label>
              <select
                id="reminder-currency-select"
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="reminder-date-input"
                className="block text-xs font-medium text-[#a1a1aa] mb-1.5"
              >
                Son Ödeme Tarihi
              </label>
              <input
                id="reminder-date-input"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2.5 text-sm font-mono tabular-nums bg-[#09090b] border border-[#27272a] rounded-lg text-[#f4f4f5] focus:outline-none focus:border-[#10b981]"
              />
            </div>

            <div>
              <label
                htmlFor="reminder-recurrence-select"
                className="block text-xs font-medium text-[#a1a1aa] mb-1.5"
              >
                Tekrarlama
              </label>
              <select
                id="reminder-recurrence-select"
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value as ReminderRecurrence)}
                className="w-full px-3 py-2.5 text-sm bg-[#09090b] border border-[#27272a] rounded-lg text-[#f4f4f5] focus:outline-none focus:border-[#10b981]"
              >
                <option value="once">Tek Seferlik</option>
                <option value="monthly">Aylık Tekrar</option>
                <option value="yearly">Yıllık Tekrar</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="reminder-category-select"
                className="block text-xs font-medium text-[#a1a1aa] mb-1.5"
              >
                Kategori
              </label>
              <select
                id="reminder-category-select"
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
          </div>

          <div>
            <span className="block text-xs font-medium text-[#a1a1aa] mb-2">
              Plan Etiketleri (#etiket)
            </span>
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {[...REMINDER_QUICK_TAGS, ...BANK_QUICK_TAGS.map((b) => b.tag), ...extraPoolTags.slice(0, 6)].map(
                (tag) => {
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
                }
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                aria-label="Yeni hatırlatma etiketi ekle"
                value={customTagInput}
                onChange={(e) => setCustomTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomTag();
                  }
                }}
                placeholder="Örn: #elektrik, #kira"
                className="flex-1 px-3 py-2 text-xs font-mono bg-[#09090b] border border-[#27272a] rounded-lg text-[#f4f4f5] placeholder-[#71717a] focus:outline-none focus:border-[#10b981]"
              />
              <button
                type="button"
                onClick={handleAddCustomTag}
                className="px-3 py-2 text-xs font-medium bg-[#121215] border border-[#27272a] rounded-lg text-[#f4f4f5] hover:border-[#3f3f46] flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Ekle
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="reminder-notes-input"
              className="block text-xs font-medium text-[#a1a1aa] mb-1.5"
            >
              Not / Abone No (Opsiyonel)
            </label>
            <input
              id="reminder-notes-input"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Örn: Otomatik talimat yok, IBAN'a gönderilecek"
              className="w-full px-3 py-2 text-xs bg-[#09090b] border border-[#27272a] rounded-lg text-[#f4f4f5] placeholder-[#71717a] focus:outline-none focus:border-[#10b981]"
            />
          </div>

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
              {saving
                ? 'Kaydediliyor...'
                : editingReminder
                ? 'Hatırlatmayı Güncelle'
                : 'Takvime Planla'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
