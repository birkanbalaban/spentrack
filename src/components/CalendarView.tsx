import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  CheckCircle2,
  Pencil,
  Trash2,
  CalendarClock,
  Repeat,
} from 'lucide-react';
import {
  CurrencyCode,
  CurrencyRates,
  Expense,
  PaymentReminder,
} from '../types';
import { formatCurrency } from '../utils/expenseLogic';
import {
  ReminderFilterMode,
  calculateCalendarProjection,
  filterAndSortReminders,
  formatMonthYearTR,
  formatReminderCountdownTR,
  getRecurrenceLabel,
  getReminderUrgency,
  shiftMonthYear,
} from '../utils/reminderLogic';

interface CalendarViewProps {
  expenses: Expense[];
  allExpenses: Expense[];
  reminders: PaymentReminder[];
  monthYear: string; // 'YYYY-MM' or 'ALL'
  displayCurrency: CurrencyCode;
  rates: CurrencyRates | null;
  isPrivacyMode?: boolean;
  onSelectExpense: (expense: Expense) => void;
  onAddReminder: (prefillDate?: string) => void;
  onEditReminder: (reminder: PaymentReminder) => void;
  onPayReminder: (reminder: PaymentReminder) => Promise<void>;
  onDeleteReminder: (id: string) => Promise<void>;
}

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

export const CalendarView: React.FC<CalendarViewProps> = ({
  expenses,
  allExpenses,
  reminders,
  monthYear,
  displayCurrency,
  rates,
  isPrivacyMode = false,
  onSelectExpense,
  onAddReminder,
  onEditReminder,
  onPayReminder,
  onDeleteReminder,
}) => {
  const todayISO = new Date().toISOString().slice(0, 10);
  const currentMonthYM = todayISO.slice(0, 7);

  const [browseYM, setBrowseYM] = useState<string>(
    monthYear && monthYear !== 'ALL' ? monthYear : currentMonthYM
  );
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(todayISO);
  const [reminderFilter, setReminderFilter] = useState<ReminderFilterMode>('pending');
  const [payingId, setPayingId] = useState<string | null>(null);

  useEffect(() => {
    if (monthYear && monthYear !== 'ALL') {
      setBrowseYM(monthYear);
    }
  }, [monthYear]);

  const [year, month] = browseYM.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayRaw = new Date(year, month - 1, 1).getDay();
  const startOffset = (firstDayRaw + 6) % 7;

  // Gelecek aylara geçildiğinde harcamaları tüm kayıtlardan eşle, aksi halde filtreli harcamaları da kullan
  const calendarExpenses = useMemo(() => {
    const source = allExpenses.length >= expenses.length ? allExpenses : expenses;
    return source.filter((exp) => String(exp.date || '').startsWith(browseYM));
  }, [allExpenses, expenses, browseYM]);

  const projection = useMemo(
    () => calculateCalendarProjection(allExpenses, reminders, browseYM, todayISO),
    [allExpenses, reminders, browseYM, todayISO]
  );

  const dayExpenseMap = useMemo(() => {
    const map = new Map<string, { netTRY: number; items: Expense[] }>();
    for (const exp of calendarExpenses) {
      const d = exp.date.slice(0, 10);
      const curr = map.get(d) || { netTRY: 0, items: [] };
      curr.netTRY += exp.amountInTRY;
      curr.items.push(exp);
      map.set(d, curr);
    }
    return map;
  }, [calendarExpenses]);

  const dayReminderMap = useMemo(() => {
    const map = new Map<
      string,
      {
        pendingTRY: number;
        pendingCount: number;
        overdueCount: number;
        paidCount: number;
        items: PaymentReminder[];
      }
    >();
    for (const rem of reminders) {
      if (!String(rem.dueDate || '').startsWith(browseYM)) continue;
      const d = rem.dueDate.slice(0, 10);
      const curr = map.get(d) || {
        pendingTRY: 0,
        pendingCount: 0,
        overdueCount: 0,
        paidCount: 0,
        items: [],
      };
      if (rem.status === 'pending') {
        curr.pendingTRY += Number(rem.amountInTRY) || 0;
        curr.pendingCount += 1;
        if (d < todayISO) curr.overdueCount += 1;
      } else {
        curr.paidCount += 1;
      }
      curr.items.push(rem);
      map.set(d, curr);
    }
    return map;
  }, [reminders, browseYM, todayISO]);

  const cells: Array<{ day: number | null; dateStr: string | null }> = [];
  for (let i = 0; i < startOffset; i++) {
    cells.push({ day: null, dateStr: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${browseYM}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, dateStr });
  }

  const selectedDayExpense = selectedDayDate ? dayExpenseMap.get(selectedDayDate) : null;
  const selectedDayReminder = selectedDayDate ? dayReminderMap.get(selectedDayDate) : null;

  const filteredReminders = useMemo(
    () => filterAndSortReminders(reminders, reminderFilter, todayISO),
    [reminders, reminderFilter, todayISO]
  );

  const pendingTotalCount = reminders.filter((r) => r.status === 'pending').length;
  const overdueTotalCount = reminders.filter(
    (r) => r.status === 'pending' && r.dueDate.slice(0, 10) < todayISO
  ).length;
  const paidTotalCount = reminders.filter((r) => r.status === 'paid').length;

  const handlePayClick = async (rem: PaymentReminder) => {
    setPayingId(rem.id);
    try {
      await onPayReminder(rem);
    } finally {
      setPayingId(null);
    }
  };

  return (
    <div data-testid="calendar-view" className="space-y-4">
      {/* Üst Başlık & İleri/Geri Ay Navigasyonu */}
      <section className="bg-[#111114] border border-[#222226] rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#f4f4f5]">
                Aylık Harcama & Ödeme Takvimi
              </h2>
              <p className="text-xs text-[#71717a]">
                İleri tarihlere geçerek planlı ödemeleri yönetin; ödendiğinde tek tıkla harcamaya aktarın.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center bg-[#18181c] border border-[#27272a] rounded-lg p-0.5">
              <button
                type="button"
                aria-label="Önceki ay"
                onClick={() => setBrowseYM((prev) => shiftMonthYear(prev, -1))}
                className="p-1.5 text-[#a1a1aa] hover:text-[#f4f4f5] rounded-md cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setBrowseYM(currentMonthYM)}
                className="px-2.5 py-1 text-xs font-medium text-[#f4f4f5] capitalize whitespace-nowrap cursor-pointer"
                title="Bu aya dön"
              >
                {formatMonthYearTR(browseYM)}
              </button>
              <button
                type="button"
                aria-label="Gelecek ay"
                onClick={() => setBrowseYM((prev) => shiftMonthYear(prev, 1))}
                className="p-1.5 text-[#a1a1aa] hover:text-[#f4f4f5] rounded-md cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => onAddReminder(selectedDayDate || todayISO)}
              className="px-3.5 py-2 text-xs font-semibold bg-[#10b981] text-[#09090b] rounded-lg hover:bg-[#10b981]/90 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Ödeme Hatırlatması Ekle</span>
            </button>
          </div>
        </div>

        {/* 4 Tabular Projeksiyon KPI Hücresi */}
        <div className="grid grid-cols-2 lg:grid-cols-4 border border-[#27272a] rounded-xl divide-y lg:divide-y-0 lg:divide-x divide-[#27272a] bg-[#09090b]/50 overflow-hidden">
          <div className="p-3.5">
            <div className="text-[11px] font-medium text-[#a1a1aa]">
              Gerçekleşen Harcama
            </div>
            <div className="mt-1 text-base sm:text-lg font-bold font-mono tabular-nums text-[#f4f4f5]">
              {formatCurrency(projection.realizedTRY, displayCurrency, rates, false, isPrivacyMode)}
            </div>
            <div className="mt-0.5 text-[11px] font-mono tabular-nums text-[#71717a]">
              {projection.realizedCount} işlem · {browseYM}
            </div>
          </div>

          <div className="p-3.5">
            <div className="text-[11px] font-medium text-[#a1a1aa]">
              Bekleyen / Planlanan
            </div>
            <div className="mt-1 text-base sm:text-lg font-bold font-mono tabular-nums text-[#f59e0b]">
              {formatCurrency(projection.pendingMonthTRY, displayCurrency, rates, false, isPrivacyMode)}
            </div>
            <div className="mt-0.5 text-[11px] font-mono tabular-nums text-[#71717a]">
              {projection.pendingMonthCount} bekleyen ödeme
            </div>
          </div>

          <div className="p-3.5">
            <div className="text-[11px] font-medium text-[#a1a1aa]">
              Ay Sonu Projeksiyonu
            </div>
            <div className="mt-1 text-base sm:text-lg font-bold font-mono tabular-nums text-[#10b981]">
              {formatCurrency(projection.projectedMonthEndTRY, displayCurrency, rates, false, isPrivacyMode)}
            </div>
            <div className="mt-0.5 text-[11px] text-[#71717a]">
              Gerçekleşen + Planlı toplam
            </div>
          </div>

          <div className="p-3.5">
            <div className="text-[11px] font-medium text-[#a1a1aa]">
              Gecikmiş Ödemeler
            </div>
            <div
              className={`mt-1 text-base sm:text-lg font-bold font-mono tabular-nums ${
                projection.overdueCount > 0 ? 'text-[#f43f5e]' : 'text-[#a1a1aa]'
              }`}
            >
              {formatCurrency(projection.overdueTRY, displayCurrency, rates, false, isPrivacyMode)}
            </div>
            <div className="mt-0.5 text-[11px] font-mono tabular-nums text-[#71717a]">
              {projection.overdueCount > 0
                ? `${projection.overdueCount} adet vadesi geçmiş`
                : 'Gecikmiş ödeme yok'}
            </div>
          </div>
        </div>

        {/* Haftanın Günleri */}
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((dayName) => (
            <div
              key={dayName}
              className="text-center text-xs font-medium text-[#71717a] py-1"
            >
              {dayName}
            </div>
          ))}
        </div>

        {/* Takvim Hücreleri */}
        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((cell, idx) => {
            if (!cell.day || !cell.dateStr) {
              return (
                <div
                  key={`empty-${idx}`}
                  className="h-22 sm:h-24 rounded-lg bg-[#09090b]/40 border border-transparent"
                />
              );
            }

            const expStat = dayExpenseMap.get(cell.dateStr);
            const remStat = dayReminderMap.get(cell.dateStr);
            const isSelected = selectedDayDate === cell.dateStr;
            const isToday = cell.dateStr === todayISO;
            const hasPending = Boolean(remStat && remStat.pendingCount > 0);
            const hasOverdue = Boolean(remStat && remStat.overdueCount > 0);

            return (
              <div
                key={cell.dateStr}
                onClick={() => setSelectedDayDate(cell.dateStr)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedDayDate(cell.dateStr);
                  }
                }}
                className={`group h-22 sm:h-24 rounded-lg p-2 text-left flex flex-col justify-between border transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[#18181b] border-[#10b981]'
                    : hasOverdue
                    ? 'bg-[#18181b]/80 border-[#f43f5e]/50 hover:border-[#f43f5e]'
                    : hasPending
                    ? 'bg-[#18181b]/80 border-[#f59e0b]/40 hover:border-[#f59e0b]'
                    : expStat
                    ? 'bg-[#18181b]/70 border-[#27272a] hover:border-[#3f3f46]'
                    : 'bg-[#09090b]/60 border-[#27272a]/40 hover:border-[#27272a]'
                }`}
              >
                <div className="flex items-center justify-between w-full gap-1">
                  <span
                    className={`text-xs font-mono tabular-nums font-medium ${
                      isToday
                        ? 'text-[#10b981] font-bold underline underline-offset-4'
                        : 'text-[#a1a1aa]'
                    }`}
                  >
                    {cell.day}
                  </span>

                  <button
                    type="button"
                    aria-label={`${cell.dateStr} için hatırlatma ekle`}
                    title="Bu güne hatırlatma ekle"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDayDate(cell.dateStr);
                      onAddReminder(cell.dateStr || undefined);
                    }}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded text-[#71717a] hover:text-[#10b981] hover:bg-[#27272a]/70 transition-opacity cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                <div className="w-full space-y-0.5 overflow-hidden">
                  {expStat && (
                    <div
                      className={`text-[11px] sm:text-xs font-mono tabular-nums font-semibold truncate ${
                        expStat.netTRY < 0 ? 'text-[#10b981]' : 'text-[#f4f4f5]'
                      }`}
                    >
                      {formatCurrency(expStat.netTRY, displayCurrency, rates, false, isPrivacyMode)}
                    </div>
                  )}

                  {remStat && remStat.pendingCount > 0 && (
                    <div
                      className={`text-[10px] font-mono tabular-nums truncate flex items-center gap-1 ${
                        remStat.overdueCount > 0 ? 'text-[#f43f5e]' : 'text-[#f59e0b]'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          remStat.overdueCount > 0 ? 'bg-[#f43f5e]' : 'bg-[#f59e0b]'
                        }`}
                      />
                      <span className="truncate">
                        {formatCurrency(remStat.pendingTRY, displayCurrency, rates, false, isPrivacyMode)}
                      </span>
                    </div>
                  )}

                  {remStat && remStat.pendingCount === 0 && remStat.paidCount > 0 && (
                    <div className="text-[10px] font-mono tabular-nums text-[#10b981] truncate">
                      ✓ {remStat.paidCount} ödendi
                    </div>
                  )}

                  {!expStat && !remStat && (
                    <span className="text-[11px] text-[#71717a]/40 font-mono">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Seçili Gün Detayları (Hatırlatmalar + Gerçekleşen Harcamalar) */}
      {selectedDayDate && (
        <section className="bg-[#111114] border border-[#222226] rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#27272a]">
            <h3 className="text-sm font-semibold text-[#f4f4f5] font-mono tabular-nums">
              {selectedDayDate} Günü Detayı
            </h3>
            <button
              type="button"
              onClick={() => onAddReminder(selectedDayDate)}
              className="px-3 py-1.5 text-xs font-medium bg-[#18181c] border border-[#27272a] hover:border-[#10b981] text-[#f4f4f5] rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-[#10b981]" />
              <span>Bu Güne Hatırlatma Ekle</span>
            </button>
          </div>

          {/* Planlanan Ödemeler */}
          {selectedDayReminder && selectedDayReminder.items.length > 0 && (
            <div>
              <div className="text-xs font-medium text-[#a1a1aa] mb-2">
                Planlanan Ödemeler ({selectedDayReminder.items.length})
              </div>
              <div className="divide-y divide-[#27272a]/70 border border-[#27272a] rounded-lg bg-[#09090b]/40">
                {selectedDayReminder.items.map((rem) => {
                  const urgency = getReminderUrgency(rem, todayISO);
                  return (
                    <div
                      key={rem.id}
                      className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              urgency === 'paid'
                                ? 'bg-[#10b981]'
                                : urgency === 'overdue'
                                ? 'bg-[#f43f5e]'
                                : 'bg-[#f59e0b]'
                            }`}
                          />
                          <span className="text-sm font-medium text-[#f4f4f5] truncate">
                            {rem.title}
                          </span>
                        </div>
                        <div className="text-xs text-[#71717a] mt-0.5 font-mono tabular-nums">
                          {rem.category} · {getRecurrenceLabel(rem.recurrence)} ·{' '}
                          <span
                            className={
                              urgency === 'overdue'
                                ? 'text-[#f43f5e]'
                                : urgency === 'paid'
                                ? 'text-[#10b981]'
                                : 'text-[#f59e0b]'
                            }
                          >
                            {formatReminderCountdownTR(rem, todayISO)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="font-mono tabular-nums text-sm font-semibold text-[#f4f4f5] mr-1">
                          {formatCurrency(rem.amountInTRY, displayCurrency, rates, false, isPrivacyMode)}
                        </div>
                        {rem.status === 'pending' && (
                          <button
                            type="button"
                            disabled={payingId === rem.id}
                            onClick={() => handlePayClick(rem)}
                            className="px-2.5 py-1.5 text-xs font-semibold bg-[#10b981] text-[#09090b] rounded-lg hover:bg-[#10b981]/90 disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{payingId === rem.id ? 'Aktarılıyor...' : 'Ödendi & Aktar'}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onEditReminder(rem)}
                          aria-label={`Düzenle: ${rem.title}`}
                          className="p-1.5 rounded-lg border border-[#27272a] text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#27272a]/50 cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteReminder(rem.id)}
                          aria-label={`Sil: ${rem.title}`}
                          className="p-1.5 rounded-lg border border-[#27272a] text-[#a1a1aa] hover:text-[#f43f5e] hover:bg-[#f43f5e]/10 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Gerçekleşen Harcamalar */}
          <div>
            <div className="text-xs font-medium text-[#a1a1aa] mb-2">
              Gerçekleşen Harcamalar ({selectedDayExpense ? selectedDayExpense.items.length : 0})
            </div>
            {!selectedDayExpense || selectedDayExpense.items.length === 0 ? (
              <p className="py-4 text-center text-xs text-[#71717a] border border-dashed border-[#27272a] rounded-lg">
                Bu tarihte gerçekleşmiş harcama kaydı bulunmuyor.
              </p>
            ) : (
              <div className="divide-y divide-[#27272a]/60 border border-[#27272a] rounded-lg">
                {selectedDayExpense.items.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => onSelectExpense(item)}
                    className="py-2 px-3 flex items-center justify-between gap-3 hover:bg-[#18181b]/50 cursor-pointer leading-tight"
                  >
                    <div>
                      <div className="text-sm font-medium text-[#f4f4f5]">{item.title}</div>
                      <div className="text-xs text-[#71717a]">
                        {item.category} · {item.tags.join(' ')}
                      </div>
                    </div>
                    <div className="font-mono tabular-nums text-sm font-semibold text-[#f4f4f5]">
                      {formatCurrency(item.amountInTRY, displayCurrency, rates, false, isPrivacyMode)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* İleriye Dönük Ödeme Hatırlatmaları Kontrol Merkezi */}
      <section className="bg-[#111114] border border-[#222226] rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-[#f59e0b]" />
            <div>
              <h3 className="text-sm font-semibold text-[#f4f4f5]">
                Ödeme Hatırlatmaları & İleriye Dönük Kontrol Listesi
              </h3>
              <p className="text-xs text-[#71717a]">
                Ödediklerinizi işaretleyin; harcama ekranınıza işlenir ve tekrarlı planlar otomatik sonraki aya kurulur.
              </p>
            </div>
          </div>

          <div
            role="group"
            aria-label="Hatırlatma Durum Filtresi"
            className="flex items-center gap-1 p-1 bg-[#18181c] border border-[#27272a] rounded-lg self-start"
          >
            {(
              [
                { id: 'pending', label: `Bekleyen (${pendingTotalCount})` },
                { id: 'overdue', label: `Geciken (${overdueTotalCount})` },
                { id: 'paid', label: `Ödenen (${paidTotalCount})` },
                { id: 'all', label: `Tümü (${reminders.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setReminderFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-mono tabular-nums rounded-md transition-colors cursor-pointer ${
                  reminderFilter === tab.id
                    ? 'bg-[#27272e] text-white font-semibold'
                    : 'text-[#a1a1aa] hover:text-[#f4f4f5]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filteredReminders.length === 0 ? (
          <div className="py-8 text-center border border-dashed border-[#27272a] rounded-xl space-y-2">
            <p className="text-xs text-[#71717a]">
              {reminderFilter === 'overdue'
                ? 'Vadesi geçmiş (gecikmiş) ödeme hatırlatmanız bulunmuyor.'
                : reminderFilter === 'paid'
                ? 'Henüz ödenmiş olarak işaretlenen hatırlatma bulunmuyor.'
                : 'Henüz planlanmış ödeme hatırlatması eklenmedi.'}
            </p>
            {reminderFilter === 'pending' && (
              <button
                type="button"
                onClick={() => onAddReminder(todayISO)}
                className="px-3 py-1.5 text-xs font-semibold bg-[#18181c] border border-[#27272a] hover:border-[#10b981] text-[#f4f4f5] rounded-lg cursor-pointer"
              >
                + İlk Ödeme Planını Ekle
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-[#27272a] border border-[#27272a] rounded-xl bg-[#09090b]/40">
            {filteredReminders.map((rem) => {
              const urgency = getReminderUrgency(rem, todayISO);
              return (
                <div
                  key={rem.id}
                  className="px-3.5 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-[#18181b]/40 transition-colors"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          urgency === 'paid'
                            ? 'bg-[#10b981]'
                            : urgency === 'overdue'
                            ? 'bg-[#f43f5e]'
                            : urgency === 'today'
                            ? 'bg-[#f59e0b]'
                            : 'bg-[#0ea5e9]'
                        }`}
                      />
                      <span className="text-sm font-semibold text-[#f4f4f5]">
                        {rem.title}
                      </span>
                      {rem.recurrence !== 'once' && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[#a1a1aa] font-mono">
                          <Repeat className="w-3 h-3 text-[#8b5cf6]" />
                          {getRecurrenceLabel(rem.recurrence)}
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-[#a1a1aa] font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span>Vade: {rem.dueDate}</span>
                      <span>·</span>
                      <span
                        className={
                          urgency === 'overdue'
                            ? 'text-[#f43f5e] font-semibold'
                            : urgency === 'today'
                            ? 'text-[#f59e0b] font-semibold'
                            : urgency === 'paid'
                            ? 'text-[#10b981]'
                            : 'text-[#0ea5e9]'
                        }
                      >
                        {formatReminderCountdownTR(rem, todayISO)}
                      </span>
                      <span>·</span>
                      <span className="font-sans text-[#71717a]">{rem.category}</span>
                      {rem.tags.length > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-[#71717a]">{rem.tags.join(' ')}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between md:justify-end gap-2 shrink-0">
                    <div className="text-right mr-2">
                      <div className="text-sm font-bold font-mono tabular-nums text-[#f4f4f5]">
                        {formatCurrency(rem.amountInTRY, displayCurrency, rates, false, isPrivacyMode)}
                      </div>
                      {rem.paidAt && (
                        <div className="text-[10px] font-mono text-[#10b981]">
                          Ödendi: {rem.paidAt}
                        </div>
                      )}
                    </div>

                    {rem.status === 'pending' && (
                      <button
                        type="button"
                        disabled={payingId === rem.id}
                        onClick={() => handlePayClick(rem)}
                        className="px-3 py-1.5 text-xs font-semibold bg-[#10b981] text-[#09090b] rounded-lg hover:bg-[#10b981]/90 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>
                          {payingId === rem.id
                            ? 'İşleniyor...'
                            : 'Ödendi İşaretle & Harcamaya Aktar'}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onEditReminder(rem)}
                      aria-label={`Hatırlatmayı düzenle: ${rem.title}`}
                      className="p-1.5 rounded-lg border border-[#27272a] text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#27272a]/50 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteReminder(rem.id)}
                      aria-label={`Hatırlatmayı sil: ${rem.title}`}
                      className="p-1.5 rounded-lg border border-[#27272a] text-[#a1a1aa] hover:text-[#f43f5e] hover:bg-[#f43f5e]/10 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
