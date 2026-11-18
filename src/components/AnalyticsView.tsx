import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  Minus,
  PieChart,
  Tag,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  CurrencyCode,
  CurrencyRates,
  Expense,
  ExpenseCategory,
  FIXED_CATEGORIES,
  PaymentReminder,
} from '../types';
import {
  calculateMonthEndHabitProjection,
  calculateWeeklyCategorySummary,
  formatCurrency,
  getCategoryColor,
  getTagColor,
} from '../utils/expenseLogic';

interface AnalyticsViewProps {
  expenses: Expense[];
  reminders?: PaymentReminder[];
  monthYear?: string;
  displayCurrency: CurrencyCode;
  rates: CurrencyRates | null;
  isPrivacyMode?: boolean;
  mode?: 'full' | 'weekly-summary';
  activeCategory?: ExpenseCategory | 'ALL';
  referenceDateISO?: string;
  onSelectCategory: (cat: ExpenseCategory) => void;
  onSelectTag?: (tag: string) => void;
}

interface DonutSlice {
  id: string;
  label: string;
  sublabel: string;
  totalTRY: number;
  percentage: number;
  donutShare?: number;
  color: string;
}

const DonutChart: React.FC<{
  slices: DonutSlice[];
  totalTRY: number;
  centerSubtitle: string;
  displayCurrency: CurrencyCode;
  rates: CurrencyRates | null;
  isPrivacyMode?: boolean;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onClickSlice: (id: string) => void;
}> = ({
  slices,
  totalTRY,
  centerSubtitle,
  displayCurrency,
  rates,
  isPrivacyMode = false,
  hoveredId,
  onHover,
  onClickSlice,
}) => {
  const size = 240;
  const strokeWidth = 28;
  const center = size / 2;
  const radius = center - strokeWidth;
  const circumference = 2 * Math.PI * radius;

  const activeSlices = slices.filter((s) => s.totalTRY > 0);
  const gapAngleDeg = activeSlices.length > 1 ? 3 : 0;
  const gapLength = (gapAngleDeg / 360) * circumference;

  let accumulatedPercent = 0;

  const hoveredSlice = activeSlices.find((s) => s.id === hoveredId);

  return (
    <div className="relative flex items-center justify-center w-[230px] h-[230px] sm:w-[250px] sm:h-[250px] mx-auto shrink-0">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="w-full h-full -rotate-90 overflow-visible"
        role="img"
        aria-label="Harcama dağılımı halka grafiği"
      >
        {/* Arka plan halkası */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="transparent"
          stroke="#1c1c21"
          strokeWidth={strokeWidth}
        />

        {activeSlices.map((slice) => {
          const rawLen = (slice.percentage / 100) * circumference;
          const visibleLen = Math.max(2, rawLen - gapLength);
          const dashArray = `${visibleLen} ${circumference - visibleLen}`;
          const dashOffset = -((accumulatedPercent / 100) * circumference);
          accumulatedPercent += slice.percentage;

          const isHovered = hoveredId === slice.id;

          return (
            <circle
              key={slice.id}
              cx={center}
              cy={center}
              r={radius}
              fill="transparent"
              stroke={slice.color}
              strokeWidth={isHovered ? strokeWidth + 5 : strokeWidth}
              strokeDasharray={dashArray}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
              className="transition-all duration-200 cursor-pointer"
              style={{
                opacity: hoveredId && !isHovered ? 0.45 : 1,
              }}
              onMouseEnter={() => onHover(slice.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onClickSlice(slice.id)}
            />
          );
        })}
      </svg>

      {/* Merkez Metni (SubTrack Stili) */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-4">
        <span className="text-xs font-medium text-[#a1a1aa]">
          {hoveredSlice ? hoveredSlice.label : 'Toplam'}
        </span>
        <span className="mt-1 text-lg sm:text-xl font-bold font-mono tabular-nums text-[#f4f4f5]">
          {formatCurrency(
            hoveredSlice ? hoveredSlice.totalTRY : totalTRY,
            displayCurrency,
            rates,
            false,
            isPrivacyMode
          )}
        </span>
        <span className="mt-0.5 text-xs text-[#71717a] font-mono tabular-nums">
          {hoveredSlice ? `%${hoveredSlice.percentage.toFixed(1)}` : centerSubtitle}
        </span>
      </div>
    </div>
  );
};

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  expenses,
  reminders = [],
  monthYear,
  displayCurrency,
  rates,
  isPrivacyMode = false,
  mode = 'full',
  activeCategory = 'ALL',
  referenceDateISO,
  onSelectCategory,
  onSelectTag,
}) => {
  const [hoveredCat, setHoveredCat] = useState<string | null>(null);
  const [hoveredTag, setHoveredTag] = useState<string | null>(null);

  const weeklySummary = useMemo(
    () => calculateWeeklyCategorySummary(expenses, referenceDateISO),
    [expenses, referenceDateISO]
  );

  const monthProjection = useMemo(
    () =>
      calculateMonthEndHabitProjection(expenses, {
        monthYear,
        referenceDateISO,
        reminders,
      }),
    [expenses, monthYear, referenceDateISO, reminders]
  );

  if (mode === 'weekly-summary') {
    if (weeklySummary.topCategories.length === 0) {
      return null;
    }

    const {
      dateRangeLabel,
      isAnchoredToToday,
      currentWeekTotalTRY,
      currentWeekCount,
      changePercent,
      trendDirection,
      topCategories,
      otherPercentage,
    } = weeklySummary;

    return (
      <section
        aria-label="Haftalık Özet — En Çok Harcama Yapılan İlk 3 Kategori"
        data-testid="weekly-summary-card"
        className="bg-[#111114] border border-[#222226] rounded-xl p-4 sm:p-5 space-y-3.5"
      >
        {/* Üst Başlık, 7 Günlük Tarih Aralığı, Haftalık Toplam ve Geçen Haftayla Değişim Trendi */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[#18181c] border border-[#27272a] flex items-center justify-center text-[#0ea5e9] shrink-0">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-[#f4f4f5] whitespace-nowrap">
                  Haftalık Özet
                </h2>
                <span aria-hidden="true" className="text-[#52525b]">
                  ·
                </span>
                <span className="text-xs font-mono tabular-nums text-[#a1a1aa] whitespace-nowrap">
                  {isAnchoredToToday ? 'Son 7 Gün' : '7 Günlük Pencere'} ({dateRangeLabel})
                </span>
                <span aria-hidden="true" className="text-[#52525b] hidden sm:inline">
                  ·
                </span>
                <span className="text-xs text-[#71717a] hidden sm:inline whitespace-nowrap">
                  İlk 3 kategori ({currentWeekCount} işlem)
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 ml-auto">
            {/* Geçen Haftaya Göre Artış / Azalış Trend Göstergesi */}
            {changePercent !== null && trendDirection !== 'no-prev' ? (
              <div
                data-testid="weekly-trend-indicator"
                className={`flex items-center gap-1.5 text-xs font-mono tabular-nums whitespace-nowrap ${
                  trendDirection === 'down'
                    ? 'text-[#10b981]'
                    : trendDirection === 'up'
                    ? 'text-[#f59e0b]'
                    : 'text-[#a1a1aa]'
                }`}
              >
                {trendDirection === 'down' ? (
                  <TrendingDown className="w-3.5 h-3.5 shrink-0" />
                ) : trendDirection === 'up' ? (
                  <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <Minus className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>
                  {trendDirection === 'down'
                    ? `Geçen haftaya göre %${Math.abs(changePercent).toFixed(1)} azalış`
                    : trendDirection === 'up'
                    ? `Geçen haftaya göre +%${changePercent.toFixed(1)} artış`
                    : 'Geçen haftayla aynı düzeyde'}
                </span>
              </div>
            ) : (
              <span
                data-testid="weekly-trend-indicator"
                className="text-xs text-[#71717a] font-mono tabular-nums whitespace-nowrap"
              >
                Önceki 7 gün verisi yok
              </span>
            )}

            <span aria-hidden="true" className="text-[#27272a] hidden sm:inline">
              |
            </span>

            <div className="text-right font-mono tabular-nums whitespace-nowrap">
              <span className="text-xs text-[#a1a1aa] mr-1.5">7 Günlük Toplam:</span>
              <span className="text-sm sm:text-base font-bold text-[#f4f4f5]">
                {formatCurrency(
                  currentWeekTotalTRY,
                  displayCurrency,
                  rates,
                  false,
                  isPrivacyMode
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Renkli Orantılı Mini Dağılım Çubuğu */}
        <div
          data-testid="weekly-summary-bar"
          aria-label="Haftalık kategori oran çubuğu"
          className="w-full h-2 bg-[#18181c] rounded-full overflow-hidden flex gap-0.5"
        >
          {topCategories.map((item) => (
            <div
              key={item.category}
              title={`${item.category}: %${item.percentage.toFixed(1)}`}
              className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-200"
              style={{
                width: `${Math.max(4, item.percentage)}%`,
                backgroundColor: item.color,
              }}
            />
          ))}
          {otherPercentage > 0 && (
            <div
              title={`Diğer Kategoriler: %${otherPercentage.toFixed(1)}`}
              className="h-full bg-[#3f3f46] last:rounded-r-full transition-all duration-200"
              style={{
                width: `${Math.max(3, otherPercentage)}%`,
              }}
            />
          )}
        </div>

        {/* İlk 3 Kategori Etkileşimli Kartları (Tıklandığında Listeyi Filtreler) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {topCategories.map((item, idx) => {
            const isSelected = activeCategory === item.category;
            const rankLabel = `0${idx + 1}.`;
            const formattedPrevAmount = formatCurrency(
              item.previousWeekTotalTRY,
              displayCurrency,
              rates,
              false,
              isPrivacyMode
            );
            const trendTooltip =
              item.previousWeekTotalTRY > 0
                ? `Önceki hafta (${formattedPrevAmount}) ile karşılaştırıldığında ${
                    item.trendDirection === 'down'
                      ? `%${Math.abs(item.changePercent).toFixed(1)} azalış`
                      : item.trendDirection === 'up'
                      ? `+%${item.changePercent.toFixed(1)} artış`
                      : 'aynı düzeyde'
                  }`
                : 'Önceki 7 günde bu kategoride harcama yoktu (+%100 artış)';

            return (
              <button
                key={item.category}
                type="button"
                data-testid={`weekly-top-category-${idx + 1}`}
                aria-pressed={isSelected}
                onClick={() => onSelectCategory(item.category)}
                className={`w-full text-left px-3.5 py-2.5 rounded-lg border transition-colors flex items-center justify-between gap-3 cursor-pointer ${
                  isSelected
                    ? 'bg-[#1c1c22] border-[#0ea5e9] ring-1 ring-[#0ea5e9]/40'
                    : 'bg-[#16161a] border-[#242429] hover:border-[#3f3f46]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-xs font-mono tabular-nums text-[#71717a] shrink-0">
                    {rankLabel}
                  </span>
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-semibold text-[#f4f4f5] truncate">
                        {item.category}
                      </span>
                      <span
                        data-testid={`weekly-category-trend-${idx + 1}`}
                        title={trendTooltip}
                        className={`inline-flex items-center gap-0.5 text-xs font-mono tabular-nums font-medium shrink-0 ${
                          item.trendDirection === 'down'
                            ? 'text-[#10b981]'
                            : item.trendDirection === 'up'
                            ? 'text-[#f59e0b]'
                            : 'text-[#a1a1aa]'
                        }`}
                      >
                        {item.trendDirection === 'down' ? (
                          <ArrowDownRight className="w-3.5 h-3.5 shrink-0" />
                        ) : item.trendDirection === 'up' ? (
                          <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <Minus className="w-3 h-3 shrink-0" />
                        )}
                        <span>
                          {item.trendDirection === 'down'
                            ? `-%${Math.abs(item.changePercent).toFixed(1)}`
                            : item.trendDirection === 'up'
                            ? `+%${item.changePercent.toFixed(1)}`
                            : '%0.0'}
                        </span>
                      </span>
                    </div>
                    <div className="text-xs text-[#a1a1aa] flex items-center gap-1.5 mt-0.5 whitespace-nowrap">
                      <span>{item.count} işlem</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">%{item.percentage.toFixed(1)}</span>
                      {isSelected && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#0ea5e9] font-medium">Filtre Aktif</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-right font-mono tabular-nums shrink-0">
                  <div className="text-sm font-bold text-[#f4f4f5]">
                    {formatCurrency(
                      item.totalTRY,
                      displayCurrency,
                      rates,
                      false,
                      isPrivacyMode
                    )}
                  </div>
                  <div className="text-[11px] text-[#71717a] mt-0.5">
                    Önceki hf: {formattedPrevAmount}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  // Pozitif harcamaları dağılım yüzdesinde baz al
  const positiveExpenses = expenses.filter((e) => e.amountInTRY > 0);
  const totalPositiveTRY = positiveExpenses.reduce((s, e) => s + e.amountInTRY, 0);

  const categorySlices: DonutSlice[] = FIXED_CATEGORIES.map((cat) => {
    const items = positiveExpenses.filter((e) => e.category === cat);
    const totalTRY = items.reduce((s, e) => s + e.amountInTRY, 0);
    const percentage = totalPositiveTRY > 0 ? (totalTRY / totalPositiveTRY) * 100 : 0;
    return {
      id: cat,
      label: cat,
      sublabel: `${items.length} aktif işlem`,
      totalTRY,
      percentage,
      color: getCategoryColor(cat),
    };
  })
    .filter((c) => c.totalTRY > 0)
    .sort((a, b) => b.totalTRY - a.totalTRY);

  // Etiket (#tag) bazlı dağılım
  const tagMap = new Map<string, { totalTRY: number; count: number }>();
  for (const exp of positiveExpenses) {
    for (const tag of exp.tags) {
      const prev = tagMap.get(tag) || { totalTRY: 0, count: 0 };
      prev.totalTRY += exp.amountInTRY;
      prev.count += 1;
      tagMap.set(tag, prev);
    }
  }

  // Etiketlerin kendi toplamına göre halka grafik yüzdesi, bütçeye göre harcama oranı
  const totalTagSumTRY = Array.from(tagMap.values()).reduce((s, v) => s + v.totalTRY, 0);

  const tagSlices: DonutSlice[] = Array.from(tagMap.entries())
    .map(([tag, stat]) => ({
      id: tag,
      label: tag,
      sublabel: `${stat.count} işlem`,
      totalTRY: stat.totalTRY,
      percentage: totalPositiveTRY > 0 ? (stat.totalTRY / totalPositiveTRY) * 100 : 0,
      donutShare: totalTagSumTRY > 0 ? (stat.totalTRY / totalTagSumTRY) * 100 : 0,
      color: getTagColor(tag),
    }))
    .sort((a, b) => b.totalTRY - a.totalTRY);

  const tagDonutInput: DonutSlice[] = tagSlices.map((t) => ({
    ...t,
    percentage: t.donutShare ?? t.percentage,
  }));

  return (
    <div data-testid="analytics-view" className="space-y-8">
      {/* 0. BLOK: AY SONU PROJEKSİYONU (Harcama Alışkanlığı ve Günlük Tempo Analizi) */}
      <section
        aria-label="Ay Sonu Projeksiyonu"
        data-testid="month-end-projection-card"
        className="bg-[#111114] border border-[#222226] rounded-2xl p-6 sm:p-8 space-y-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#222226]">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-[#18181c] border border-[#27272a] flex items-center justify-center text-[#0ea5e9] shrink-0">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-[#f4f4f5]">
                  Ay Sonu Projeksiyonu
                </h2>
                <span aria-hidden="true" className="text-[#52525b]">
                  ·
                </span>
                <span className="text-sm font-mono tabular-nums text-[#a1a1aa]">
                  {monthProjection.monthLabel}
                </span>
              </div>
              <p className="text-sm text-[#a1a1aa] mt-0.5">
                Mevcut harcama alışkanlığınız ({monthProjection.elapsedDays}/{monthProjection.totalDaysInMonth} gün) ve kalan {monthProjection.remainingDays} günün temposuna göre tahmini ay sonu kapanışı.
              </p>
            </div>
          </div>

          <div
            data-testid="projection-pace-status"
            className={`flex items-center gap-2 text-xs sm:text-sm font-mono tabular-nums whitespace-nowrap ${
              monthProjection.paceStatus === 'cooling'
                ? 'text-[#10b981]'
                : monthProjection.paceStatus === 'accelerating'
                ? 'text-[#f59e0b]'
                : 'text-[#0ea5e9]'
            }`}
          >
            <Activity className="w-4 h-4 shrink-0" />
            <span>
              {monthProjection.paceStatus === 'cooling'
                ? 'Son günlerde harcama temposu yavaşladı'
                : monthProjection.paceStatus === 'accelerating'
                ? 'Son günlerde harcama temposu hızlandı'
                : 'Dengeli günlük harcama temposu'}
            </span>
          </div>
        </div>

        {/* 4 Sütunlu Ay Sonu Projeksiyon Metrikleri */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* 1. Tahmini Ay Sonu Toplamı */}
          <div className="bg-[#16161a] border border-[#242429] rounded-xl p-4 flex flex-col justify-between">
            <div className="text-xs font-medium text-[#a1a1aa]">
              Tahmini Ay Sonu Toplamı
            </div>
            <div
              data-testid="projected-month-end-total"
              className="mt-2 text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#f4f4f5]"
            >
              {formatCurrency(
                monthProjection.projectedMonthEndTRY,
                displayCurrency,
                rates,
                false,
                isPrivacyMode
              )}
            </div>
            <div className="mt-1.5 text-xs text-[#71717a] font-mono tabular-nums">
              +{formatCurrency(
                monthProjection.projectedHabitRemainingTRY,
                displayCurrency,
                rates,
                false,
                isPrivacyMode
              )}{' '}
              kalan {monthProjection.remainingDays} gün tahmini
            </div>
          </div>

          {/* 2. Şu Ana Kadar Gerçekleşen */}
          <div className="bg-[#16161a] border border-[#242429] rounded-xl p-4 flex flex-col justify-between">
            <div className="text-xs font-medium text-[#a1a1aa]">
              Şu Ana Kadar Gerçekleşen
            </div>
            <div className="mt-2 text-lg sm:text-xl font-bold font-mono tabular-nums text-[#10b981]">
              {formatCurrency(
                monthProjection.currentTotalTRY,
                displayCurrency,
                rates,
                false,
                isPrivacyMode
              )}
            </div>
            <div className="mt-1.5 text-xs text-[#71717a] font-mono tabular-nums">
              {monthProjection.elapsedDays} günde {monthProjection.transactionCount} işlem (%{monthProjection.realizedSharePercent.toFixed(1)})
            </div>
          </div>

          {/* 3. Günlük Harcama Alışkanlığı */}
          <div className="bg-[#16161a] border border-[#242429] rounded-xl p-4 flex flex-col justify-between">
            <div className="text-xs font-medium text-[#a1a1aa]">
              Günlük Ortalama Alışkanlık
            </div>
            <div className="mt-2 text-lg sm:text-xl font-bold font-mono tabular-nums text-[#0ea5e9]">
              {formatCurrency(
                monthProjection.dailyAverageTRY,
                displayCurrency,
                rates,
                false,
                isPrivacyMode
              )}
              <span className="text-xs font-normal text-[#a1a1aa]"> / gün</span>
            </div>
            <div className="mt-1.5 text-xs text-[#71717a] font-mono tabular-nums">
              {monthProjection.activeSpendingDays} aktif harcama günü
              {monthProjection.pendingRemindersCount > 0
                ? ` · +${monthProjection.pendingRemindersCount} planlı ödeme`
                : ''}
            </div>
          </div>

          {/* 4. En Baskın Kategori Tahmini */}
          {monthProjection.topProjectedCategory ? (
            <button
              type="button"
              onClick={() =>
                onSelectCategory(monthProjection.topProjectedCategory!.category)
              }
              className="bg-[#16161a] border border-[#242429] hover:border-[#3f3f46] rounded-xl p-4 flex flex-col justify-between text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#a1a1aa]">
                  En Baskın Kategori Tahmini
                </span>
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: monthProjection.topProjectedCategory.color }}
                />
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span className="text-base font-bold text-[#f4f4f5] truncate">
                  {monthProjection.topProjectedCategory.category}
                </span>
                <span className="text-sm font-bold font-mono tabular-nums text-[#f4f4f5] shrink-0">
                  {formatCurrency(
                    monthProjection.topProjectedCategory.projectedTotalTRY,
                    displayCurrency,
                    rates,
                    false,
                    isPrivacyMode
                  )}
                </span>
              </div>
              <div className="mt-1.5 text-xs text-[#71717a] font-mono tabular-nums">
                Şu an: {formatCurrency(
                  monthProjection.topProjectedCategory.currentTRY,
                  displayCurrency,
                  rates,
                  false,
                  isPrivacyMode
                )}{' '}
                (%{monthProjection.topProjectedCategory.sharePercent.toFixed(1)})
              </div>
            </button>
          ) : (
            <div className="bg-[#16161a] border border-[#242429] rounded-xl p-4 flex flex-col justify-between">
              <div className="text-xs font-medium text-[#a1a1aa]">
                En Baskın Kategori Tahmini
              </div>
              <div className="mt-2 text-sm text-[#71717a]">
                Henüz yeterli kategori verisi yok
              </div>
            </div>
          )}
        </div>

        {/* Gerçekleşen + Kalan Gün Alışkanlık Tahmini + Planlı Ödemeler İlerleme Çubuğu */}
        <div className="space-y-2.5">
          <div
            data-testid="month-end-projection-bar"
            className="w-full h-2.5 bg-[#18181c] rounded-full overflow-hidden flex gap-0.5"
          >
            {monthProjection.realizedSharePercent > 0 && (
              <div
                title={`Gerçekleşen: %${monthProjection.realizedSharePercent.toFixed(1)}`}
                className="h-full bg-[#10b981] first:rounded-l-full last:rounded-r-full transition-all duration-200"
                style={{
                  width: `${Math.max(4, monthProjection.realizedSharePercent)}%`,
                }}
              />
            )}
            {monthProjection.habitRemainingSharePercent > 0 && (
              <div
                title={`Alışkanlık Tahmini (${monthProjection.remainingDays} gün): %${monthProjection.habitRemainingSharePercent.toFixed(1)}`}
                className="h-full bg-[#0ea5e9]/75 first:rounded-l-full last:rounded-r-full transition-all duration-200"
                style={{
                  width: `${Math.max(4, monthProjection.habitRemainingSharePercent)}%`,
                }}
              />
            )}
            {monthProjection.remindersSharePercent > 0 && (
              <div
                title={`Bekleyen Planlı Ödemeler: %${monthProjection.remindersSharePercent.toFixed(1)}`}
                className="h-full bg-[#f59e0b] first:rounded-l-full last:rounded-r-full transition-all duration-200"
                style={{
                  width: `${Math.max(3, monthProjection.remindersSharePercent)}%`,
                }}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#a1a1aa]">
            <div className="flex flex-wrap items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#10b981]" />
                <span>Gerçekleşen (%{monthProjection.realizedSharePercent.toFixed(1)})</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#0ea5e9]" />
                <span>
                  Alışkanlığa Göre Kalan {monthProjection.remainingDays} Gün (%{monthProjection.habitRemainingSharePercent.toFixed(1)})
                </span>
              </span>
              {monthProjection.pendingRemindersTRY > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#f59e0b]" />
                  <span>
                    Planlı Bekleyen Ödemeler:{' '}
                    <strong className="font-mono tabular-nums text-[#f4f4f5]">
                      {formatCurrency(
                        monthProjection.pendingRemindersTRY,
                        displayCurrency,
                        rates,
                        false,
                        isPrivacyMode
                      )}
                    </strong>
                  </span>
                </span>
              )}
            </div>

            <span className="font-mono tabular-nums text-[#71717a]">
              Gün {monthProjection.elapsedDays} / {monthProjection.totalDaysInMonth}
            </span>
          </div>
        </div>
      </section>

      {/* 1. BLOK: KATEGORİ BAZLI HARCAMA DAĞILIMI (SubTrack Referans Düzeni) */}
      <section className="bg-[#111114] border border-[#222226] rounded-2xl p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-[#222226]">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-[#18181c] border border-[#27272a] flex items-center justify-center text-[#a1a1aa]">
              <PieChart className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#f4f4f5]">
                Kategori Bazlı Harcama Dağılımı
              </h2>
              <p className="text-sm text-[#a1a1aa] mt-0.5">
                Harcamalarınızın bütçe içerisindeki yüzdesel ve parasal ağırlığı.
              </p>
            </div>
          </div>

          <div className="px-4 py-2 rounded-xl bg-[#18181c] border border-[#27272a] text-sm font-mono tabular-nums text-[#f4f4f5]">
            Toplam: <span className="font-bold">{formatCurrency(totalPositiveTRY, displayCurrency, rates, false, isPrivacyMode)}</span>
          </div>
        </div>

        {categorySlices.length === 0 ? (
          <div className="py-14 text-center text-base text-[#71717a]">
            Bu dönemde analiz edilecek kategori verisi bulunmuyor.
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            {/* Sol: Oval / Halka (Donut) Grafik */}
            <div className="lg:col-span-5 flex justify-center">
              <DonutChart
                slices={categorySlices}
                totalTRY={totalPositiveTRY}
                centerSubtitle="/ dönem"
                displayCurrency={displayCurrency}
                rates={rates}
                isPrivacyMode={isPrivacyMode}
                hoveredId={hoveredCat}
                onHover={setHoveredCat}
                onClickSlice={(cat) => onSelectCategory(cat as ExpenseCategory)}
              />
            </div>

            {/* Sağ: SubTrack Stili Renkli Kategori Kartları */}
            <div className="lg:col-span-7 space-y-3">
              {categorySlices.map((item) => {
                const isHovered = hoveredCat === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setHoveredCat(item.id)}
                    onMouseLeave={() => setHoveredCat(null)}
                    onClick={() => onSelectCategory(item.id as ExpenseCategory)}
                    className={`w-full text-left px-5 py-4 rounded-xl border transition-all flex items-center justify-between gap-4 cursor-pointer ${
                      isHovered
                        ? 'bg-[#1c1c22] border-[#3f3f46]'
                        : 'bg-[#16161a] border-[#242429] hover:border-[#3f3f46]'
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <div className="min-w-0">
                        <div className="text-base font-semibold text-[#f4f4f5] truncate">
                          {item.label}
                        </div>
                        <div className="text-xs text-[#a1a1aa] mt-0.5">
                          {item.sublabel}
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono tabular-nums shrink-0">
                      <div className="text-base font-bold text-[#f4f4f5]">
                        {formatCurrency(item.totalTRY, displayCurrency, rates, false, isPrivacyMode)}
                      </div>
                      <div className="text-xs text-[#a1a1aa] mt-0.5">
                        %{item.percentage.toFixed(1)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* 2. BLOK: ETİKET & KART DAĞILIMI (#etiket) — Çok Renkli Halka Grafik + Kartlar */}
      <section className="bg-[#111114] border border-[#222226] rounded-2xl p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-[#222226]">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-[#18181c] border border-[#27272a] flex items-center justify-center text-[#a1a1aa]">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#f4f4f5]">
                Etiket & Kart Dağılımı (#etiket)
              </h2>
              <p className="text-sm text-[#a1a1aa] mt-0.5">
                Banka kartları (#yapikredi, #saglamkart vb.) ve özel etiketlerin ayrı renklerle dağılımı.
              </p>
            </div>
          </div>

          <span className="px-3.5 py-1.5 rounded-xl bg-[#18181c] border border-[#27272a] text-sm font-mono tabular-nums text-[#a1a1aa]">
            {tagSlices.length} aktif etiket
          </span>
        </div>

        {tagSlices.length === 0 ? (
          <div className="py-14 text-center text-base text-[#71717a]">
            Bu dönemde analiz edilecek etiketli harcama bulunmuyor.
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            {/* Sol: Etiket Halka Grafiği */}
            <div className="lg:col-span-5 flex justify-center">
              <DonutChart
                slices={tagDonutInput}
                totalTRY={totalPositiveTRY}
                centerSubtitle={`${tagSlices.length} etiket`}
                displayCurrency={displayCurrency}
                rates={rates}
                isPrivacyMode={isPrivacyMode}
                hoveredId={hoveredTag}
                onHover={setHoveredTag}
                onClickSlice={(tag) => onSelectTag?.(tag)}
              />
            </div>

            {/* Sağ: Çok Renkli Etiket Kartları */}
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tagSlices.map((item) => {
                const isHovered = hoveredTag === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setHoveredTag(item.id)}
                    onMouseLeave={() => setHoveredTag(null)}
                    onClick={() => onSelectTag?.(item.id)}
                    className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer ${
                      isHovered
                        ? 'bg-[#1c1c22] border-[#3f3f46]'
                        : 'bg-[#16161a] border-[#242429] hover:border-[#3f3f46]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <span
                          className="text-sm font-mono font-bold truncate"
                          style={{ color: item.color }}
                        >
                          {item.label}
                        </span>
                      </div>
                      <span className="text-xs font-mono tabular-nums text-[#a1a1aa] shrink-0">
                        {item.sublabel}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between gap-2 font-mono tabular-nums mb-2">
                      <span className="text-base font-bold text-[#f4f4f5]">
                        {formatCurrency(item.totalTRY, displayCurrency, rates, false, isPrivacyMode)}
                      </span>
                      <span className="text-xs text-[#a1a1aa]">
                        %{item.percentage.toFixed(1)}
                      </span>
                    </div>

                    <div className="w-full h-2 bg-[#09090b] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-200"
                        style={{
                          width: `${Math.min(100, Math.max(5, item.percentage))}%`,
                          backgroundColor: item.color,
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
