import React, { useState } from 'react';
import { CurrencyCode, CurrencyRates, Expense } from '../types';
import { formatCurrency } from '../utils/expenseLogic';

interface CalendarViewProps {
  expenses: Expense[];
  monthYear: string; // 'YYYY-MM' veya 'ALL'
  displayCurrency: CurrencyCode;
  rates: CurrencyRates | null;
  onSelectExpense: (expense: Expense) => void;
}

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

export const CalendarView: React.FC<CalendarViewProps> = ({
  expenses,
  monthYear,
  displayCurrency,
  rates,
  onSelectExpense,
}) => {
  const now = new Date();
  const effectiveYM =
    monthYear && monthYear !== 'ALL'
      ? monthYear
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [year, month] = effectiveYM.split('-').map(Number);
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(null);

  const daysInMonth = new Date(year, month, 0).getDate();
  // Pazartesi = 0 ... Pazar = 6
  const firstDayRaw = new Date(year, month - 1, 1).getDay();
  const startOffset = (firstDayRaw + 6) % 7;

  const dayMap = new Map<string, { netTRY: number; items: Expense[] }>();
  for (const exp of expenses) {
    if (exp.date.startsWith(effectiveYM)) {
      const d = exp.date.slice(0, 10);
      const curr = dayMap.get(d) || { netTRY: 0, items: [] };
      curr.netTRY += exp.amountInTRY;
      curr.items.push(exp);
      dayMap.set(d, curr);
    }
  }

  const cells: Array<{ day: number | null; dateStr: string | null }> = [];
  for (let i = 0; i < startOffset; i++) {
    cells.push({ day: null, dateStr: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${effectiveYM}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, dateStr });
  }

  const selectedDayData = selectedDayDate ? dayMap.get(selectedDayDate) : null;

  return (
    <div data-testid="calendar-view" className="space-y-6">
      <section className="bg-[#121215] border border-[#27272a] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[#f4f4f5]">
            Aylık Harcama Takvimi ({effectiveYM})
          </h2>
          <span className="text-xs text-[#71717a]">
            Detayları görmek için bir güne tıklayın
          </span>
        </div>

        {/* Haftanın Günleri */}
        <div className="grid grid-cols-7 gap-1.5 mb-2">
          {WEEKDAYS.map((dayName) => (
            <div
              key={dayName}
              className="text-center text-xs font-medium text-[#71717a] py-1.5"
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
                  className="h-20 sm:h-24 rounded-lg bg-[#09090b]/40 border border-transparent"
                />
              );
            }

            const stat = dayMap.get(cell.dateStr);
            const isSelected = selectedDayDate === cell.dateStr;

            return (
              <button
                key={cell.dateStr}
                type="button"
                onClick={() => setSelectedDayDate(cell.dateStr)}
                className={`h-20 sm:h-24 rounded-lg p-2 text-left flex flex-col justify-between border transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[#18181b] border-[#10b981]'
                    : stat
                    ? 'bg-[#18181b]/70 border-[#27272a] hover:border-[#3f3f46]'
                    : 'bg-[#09090b]/60 border-[#27272a]/40 hover:border-[#27272a]'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs font-mono tabular-nums font-medium text-[#a1a1aa]">
                    {cell.day}
                  </span>
                  {stat && (
                    <span className="text-[10px] font-mono tabular-nums text-[#71717a]">
                      {stat.items.length} işlem
                    </span>
                  )}
                </div>

                {stat ? (
                  <div className="w-full truncate">
                    <div
                      className={`text-xs font-mono tabular-nums font-semibold truncate ${
                        stat.netTRY < 0 ? 'text-[#10b981]' : 'text-[#f4f4f5]'
                      }`}
                    >
                      {formatCurrency(stat.netTRY, displayCurrency, rates)}
                    </div>
                  </div>
                ) : (
                  <span className="text-[11px] text-[#71717a]/40 font-mono">—</span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Seçili Gün Detayları */}
      {selectedDayDate && (
        <section className="bg-[#121215] border border-[#27272a] rounded-xl p-5">
          <div className="flex items-center justify-between pb-3 border-b border-[#27272a]">
            <h3 className="text-sm font-semibold text-[#f4f4f5] font-mono tabular-nums">
              {selectedDayDate} Günü İşlemleri
            </h3>
            <span className="text-xs font-mono tabular-nums text-[#a1a1aa]">
              {selectedDayData ? `${selectedDayData.items.length} kayıt` : '0 kayıt'}
            </span>
          </div>

          {!selectedDayData || selectedDayData.items.length === 0 ? (
            <p className="py-6 text-center text-xs text-[#71717a]">
              Bu tarihte kayıtlı harcama bulunmuyor.
            </p>
          ) : (
            <div className="divide-y divide-[#27272a]/60 mt-1.5">
              {selectedDayData.items.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onSelectExpense(item)}
                  className="py-1.5 flex items-center justify-between gap-3 hover:bg-[#18181b]/40 px-2 rounded-lg cursor-pointer leading-tight"
                >
                  <div>
                    <div className="text-sm font-medium text-[#f4f4f5]">{item.title}</div>
                    <div className="text-xs text-[#71717a]">
                      {item.category} · {item.tags.join(' ')}
                    </div>
                  </div>
                  <div className="font-mono tabular-nums text-sm font-semibold text-[#f4f4f5]">
                    {formatCurrency(item.amountInTRY, displayCurrency, rates)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
