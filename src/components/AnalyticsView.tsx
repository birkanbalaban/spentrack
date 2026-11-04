import React, { useState } from 'react';
import { PieChart, Tag } from 'lucide-react';
import {
  CurrencyCode,
  CurrencyRates,
  Expense,
  ExpenseCategory,
  FIXED_CATEGORIES,
} from '../types';
import {
  formatCurrency,
  getCategoryColor,
  getTagColor,
} from '../utils/expenseLogic';

interface AnalyticsViewProps {
  expenses: Expense[];
  displayCurrency: CurrencyCode;
  rates: CurrencyRates | null;
  onSelectCategory: (cat: ExpenseCategory) => void;
  onSelectTag: (tag: string) => void;
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
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onClickSlice: (id: string) => void;
}> = ({
  slices,
  totalTRY,
  centerSubtitle,
  displayCurrency,
  rates,
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
            rates
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
  displayCurrency,
  rates,
  onSelectCategory,
  onSelectTag,
}) => {
  const [hoveredCat, setHoveredCat] = useState<string | null>(null);
  const [hoveredTag, setHoveredTag] = useState<string | null>(null);

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
            Toplam: <span className="font-bold">{formatCurrency(totalPositiveTRY, displayCurrency, rates)}</span>
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
                        {formatCurrency(item.totalTRY, displayCurrency, rates)}
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
                hoveredId={hoveredTag}
                onHover={setHoveredTag}
                onClickSlice={(tag) => onSelectTag(tag)}
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
                    onClick={() => onSelectTag(item.id)}
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
                        {formatCurrency(item.totalTRY, displayCurrency, rates)}
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
