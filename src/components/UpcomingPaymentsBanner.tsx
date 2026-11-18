import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import { CurrencyCode, CurrencyRates, PaymentReminder } from '../types';
import { formatCurrency } from '../utils/expenseLogic';
import {
  DueAlertSummary,
  formatReminderCountdownTR,
  getReminderUrgency,
} from '../utils/reminderLogic';

interface UpcomingPaymentsBannerProps {
  summary: DueAlertSummary;
  displayCurrency: CurrencyCode;
  rates: CurrencyRates | null;
  isPrivacyMode?: boolean;
  todayISO: string;
  onPayReminder: (reminder: PaymentReminder) => Promise<void>;
  onOpenCalendar: () => void;
  onDismissToday: () => void;
}

export const UpcomingPaymentsBanner: React.FC<UpcomingPaymentsBannerProps> = ({
  summary,
  displayCurrency,
  rates,
  isPrivacyMode = false,
  todayISO,
  onPayReminder,
  onOpenCalendar,
  onDismissToday,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);

  if (summary.items.length === 0) return null;

  const primaryItem = summary.items[0];
  const hasMultiple = summary.items.length > 1;
  const isOverdue = summary.highestUrgency === 'overdue';

  const handlePayClick = async (rem: PaymentReminder) => {
    setPayingId(rem.id);
    try {
      await onPayReminder(rem);
    } finally {
      setPayingId(null);
    }
  };

  const countParts: string[] = [];
  if (summary.overdueCount > 0) countParts.push(`${summary.overdueCount} gecikmiş`);
  if (summary.todayCount > 0) countParts.push(`${summary.todayCount} bugün`);
  if (summary.tomorrowCount > 0) countParts.push(`${summary.tomorrowCount} yarın`);

  return (
    <section
      aria-label="Yaklaşan ve Gecikmiş Ödemeler Uyarısı"
      data-testid="upcoming-payments-banner"
      className={`rounded-xl border transition-colors ${
        isOverdue
          ? 'bg-[#f43f5e]/[0.06] border-[#f43f5e]/35'
          : 'bg-[#f59e0b]/[0.06] border-[#f59e0b]/35'
      }`}
    >
      <div className="px-3.5 py-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        {/* Sol: Aciliyet İkonu + Öncelikli Ödeme Bilgisi */}
        <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 sm:mt-0 border ${
              isOverdue
                ? 'bg-[#f43f5e]/15 border-[#f43f5e]/30 text-[#f43f5e]'
                : 'bg-[#f59e0b]/15 border-[#f59e0b]/30 text-[#f59e0b]'
            }`}
          >
            {isOverdue ? (
              <AlertTriangle className="w-3.5 h-3.5" />
            ) : (
              <CalendarClock className="w-3.5 h-3.5" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span
                className={`font-semibold ${
                  isOverdue ? 'text-[#fda4af]' : 'text-[#fcd34d]'
                }`}
              >
                {isOverdue
                  ? 'Vadesi Geciken ve Yaklaşan Ödemeler'
                  : 'Yaklaşan Ödemeler'}
              </span>
              <span className="text-[#71717a]" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-[#d4d4d8]">
                {countParts.join(' · ')}
              </span>
              {hasMultiple && (
                <>
                  <span className="text-[#71717a]" aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums font-semibold text-[#f4f4f5]">
                    Toplam {formatCurrency(summary.totalAmountTRY, displayCurrency, rates, false, isPrivacyMode)}
                  </span>
                </>
              )}
            </div>

            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs sm:text-sm">
              <span className="font-semibold text-[#f4f4f5] truncate max-w-[260px] sm:max-w-[360px]">
                {primaryItem.title}
              </span>
              <span className="text-[#71717a]" aria-hidden="true">·</span>
              <span
                className={`font-mono tabular-nums text-xs font-medium ${
                  getReminderUrgency(primaryItem, todayISO) === 'overdue'
                    ? 'text-[#f43f5e]'
                    : 'text-[#f59e0b]'
                }`}
              >
                {formatReminderCountdownTR(primaryItem, todayISO)}
              </span>
              <span className="text-[#71717a]" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums font-bold text-[#f4f4f5]">
                {formatCurrency(primaryItem.amountInTRY, displayCurrency, rates, false, isPrivacyMode)}
              </span>

              {hasMultiple && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="ml-1 inline-flex items-center gap-1 text-xs font-medium text-[#a1a1aa] hover:text-[#f4f4f5] underline underline-offset-2 cursor-pointer whitespace-nowrap"
                >
                  <span>
                    {expanded
                      ? 'Listeyi daralt'
                      : `Tümünü gör (${summary.items.length})`}
                  </span>
                  {expanded ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Sağ: Tek Tıkla Ödendi & Aktar, Takvime Git ve Bugünlük Gizle */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0 pl-9 lg:pl-0">
          <button
            type="button"
            disabled={payingId === primaryItem.id}
            onClick={() => handlePayClick(primaryItem)}
            data-testid="banner-pay-primary"
            className="h-8 px-3 text-xs font-semibold bg-[#10b981] text-[#09090b] rounded-lg hover:bg-[#10b981]/90 disabled:opacity-50 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>
              {payingId === primaryItem.id ? 'Aktarılıyor...' : 'Ödendi & Aktar'}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenCalendar}
            data-testid="banner-go-calendar"
            className="h-8 px-3 text-xs font-medium bg-[#18181c] border border-[#27272a] hover:border-[#3f3f46] text-[#f4f4f5] rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Takvime Git</span>
            <ArrowRight className="w-3.5 h-3.5 text-[#a1a1aa]" />
          </button>

          <button
            type="button"
            onClick={onDismissToday}
            aria-label="Uyarıyı bugünlük gizle"
            title="Bugünlük gizle"
            data-testid="banner-dismiss-today"
            className="h-8 w-8 flex items-center justify-center rounded-lg text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#18181c] border border-transparent hover:border-[#27272a] transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Genişletilmiş Çoklu Ödeme Listesi */}
      {expanded && hasMultiple && (
        <div className="border-t border-[#27272a]/70 divide-y divide-[#27272a]/60 bg-[#09090b]/45 px-3.5">
          {summary.items.slice(1).map((rem) => {
            const remOverdue = getReminderUrgency(rem, todayISO) === 'overdue';
            return (
              <div
                key={rem.id}
                className="py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                  <span className="font-medium text-[#f4f4f5] truncate">
                    {rem.title}
                  </span>
                  <span className="text-[#71717a]" aria-hidden="true">·</span>
                  <span
                    className={`font-mono tabular-nums ${
                      remOverdue ? 'text-[#f43f5e]' : 'text-[#f59e0b]'
                    }`}
                  >
                    {formatReminderCountdownTR(rem, todayISO)}
                  </span>
                  <span className="text-[#71717a]" aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-[#71717a]">
                    {rem.dueDate}
                  </span>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
                  <span className="font-mono tabular-nums font-bold text-[#f4f4f5]">
                    {formatCurrency(rem.amountInTRY, displayCurrency, rates, false, isPrivacyMode)}
                  </span>
                  <button
                    type="button"
                    disabled={payingId === rem.id}
                    onClick={() => handlePayClick(rem)}
                    className="h-7 px-2.5 text-xs font-semibold bg-[#10b981]/15 border border-[#10b981]/40 text-[#10b981] hover:bg-[#10b981] hover:text-[#09090b] rounded-md disabled:opacity-50 transition-colors flex items-center gap-1 whitespace-nowrap cursor-pointer"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    <span>
                      {payingId === rem.id ? 'Aktarılıyor...' : 'Ödendi & Aktar'}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
