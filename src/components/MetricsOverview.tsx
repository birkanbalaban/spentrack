import React from 'react';
import { Wallet, TrendingUp, PieChart, CheckCircle2, RefreshCw } from 'lucide-react';
import { CurrencyCode, CurrencyRates, MetricsSummary } from '../types';
import { formatCurrency, getCategoryColor, getTagColor } from '../utils/expenseLogic';

interface MetricsOverviewProps {
  metrics: MetricsSummary;
  displayCurrency: CurrencyCode;
  rates: CurrencyRates | null;
  activeMonthLabel: string;
  onSelectTagFilter: (tag: string) => void;
}

export const MetricsOverview: React.FC<MetricsOverviewProps> = ({
  metrics,
  displayCurrency,
  rates,
  activeMonthLabel,
  onSelectTagFilter,
}) => {
  // 1 USD, 1 EUR, 1 GBP kaç TL hesaplaması (SubTrack alt kur bilgi satırı)
  const usdInTRY = rates?.rates.USD ? (1 / rates.rates.USD).toFixed(2) : '34,50';
  const eurInTRY = rates?.rates.EUR ? (1 / rates.rates.EUR).toFixed(2) : '37,20';
  const gbpInTRY = rates?.rates.GBP ? (1 / rates.rates.GBP).toFixed(2) : '43,80';

  return (
    <div className="space-y-2.5">
      <section
        aria-label="Harcama Özet Metrikleri"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5"
      >
        {/* 1. Bu Ayki Toplam Harcama */}
        <div className="bg-[#111114] border border-[#222226] rounded-xl p-4 flex flex-col justify-between min-h-[116px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs sm:text-sm font-medium text-[#a1a1aa]">
              Bu Ayki Toplam Harcama
            </span>
            <Wallet className="w-4 h-4 text-[#71717a]" />
          </div>
          <div className="mt-2.5">
            <div
              data-testid="metric-monthly-total"
              className="text-2xl sm:text-3xl font-bold tracking-tight text-[#f4f4f5] font-mono tabular-nums"
            >
              {formatCurrency(metrics.monthlyNetTotalTRY, displayCurrency, rates)}
            </div>
            <div className="mt-1.5 text-xs text-[#71717a] flex flex-wrap items-center gap-1.5 font-mono tabular-nums">
              <span>{activeMonthLabel} net toplam</span>
              {metrics.refundTotalTRY > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#10b981] font-medium">
                    -{formatCurrency(metrics.refundTotalTRY, displayCurrency, rates)} iade düşüldü
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 2. Günlük Ortalama Harcama */}
        <div className="bg-[#111114] border border-[#222226] rounded-xl p-4 flex flex-col justify-between min-h-[116px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs sm:text-sm font-medium text-[#a1a1aa]">
              Günlük Ortalama Harcama
            </span>
            <TrendingUp className="w-4 h-4 text-[#71717a]" />
          </div>
          <div className="mt-2.5">
            <div
              data-testid="metric-daily-avg"
              className="text-2xl sm:text-3xl font-bold tracking-tight text-[#f4f4f5] font-mono tabular-nums"
            >
              {formatCurrency(metrics.dailyAverageTRY, displayCurrency, rates)}
            </div>
            <div className="mt-1.5 text-xs text-[#71717a]">
              Günlük net harcama temposu
            </div>
          </div>
        </div>

        {/* 3. En Çok Harcanan Kategori & Etiket */}
        <div className="bg-[#111114] border border-[#222226] rounded-xl p-4 flex flex-col justify-between min-h-[116px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs sm:text-sm font-medium text-[#a1a1aa]">
              En Yoğun Kategori & Etiket
            </span>
            <PieChart className="w-4 h-4 text-[#71717a]" />
          </div>
          <div className="mt-2.5">
            <div className="flex items-center gap-2">
              {metrics.topCategory && (
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: getCategoryColor(metrics.topCategory.name) }}
                />
              )}
              <span className="text-lg sm:text-xl font-bold text-[#f4f4f5] truncate">
                {metrics.topCategory ? metrics.topCategory.name : 'Veri Yok'}
              </span>
              {metrics.topCategory && (
                <span className="text-xs font-mono tabular-nums text-[#a1a1aa] ml-auto">
                  %{metrics.topCategory.percentage.toFixed(0)} pay
                </span>
              )}
            </div>
            <div className="mt-1.5 text-xs text-[#a1a1aa] flex flex-wrap items-center gap-1.5">
              {metrics.topTag ? (
                <>
                  <span className="text-[#71717a]">Lider etiket:</span>
                  <button
                    type="button"
                    onClick={() => onSelectTagFilter(metrics.topTag!.tag)}
                    className="font-mono font-semibold hover:underline cursor-pointer"
                    style={{ color: getTagColor(metrics.topTag.tag) }}
                  >
                    {metrics.topTag.tag}
                  </button>
                  <span aria-hidden="true" className="text-[#71717a]">·</span>
                  <span className="font-mono tabular-nums text-[#a1a1aa]">
                    {formatCurrency(metrics.topTag.amountTRY, displayCurrency, rates)}
                  </span>
                </>
              ) : (
                <span className="text-[#71717a]">Henüz etiketli harcama yok</span>
              )}
            </div>
          </div>
        </div>

        {/* 4. Toplam İşlem Sayısı */}
        <div className="bg-[#111114] border border-[#222226] rounded-xl p-4 flex flex-col justify-between min-h-[116px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs sm:text-sm font-medium text-[#a1a1aa]">
              Toplam İşlem Sayısı
            </span>
            <CheckCircle2 className="w-4 h-4 text-[#71717a]" />
          </div>
          <div className="mt-2.5">
            <div
              data-testid="metric-tx-count"
              className="flex items-baseline gap-2"
            >
              <span className="text-2xl sm:text-3xl font-bold tracking-tight text-[#f4f4f5] font-mono tabular-nums">
                {metrics.totalTransactionCount}
              </span>
              <span className="text-sm font-medium text-[#a1a1aa]">Kayıt</span>
            </div>
            <div className="mt-1.5 text-xs text-[#71717a]">
              Fiş, ekstre ve manuel işlemler etkin
            </div>
          </div>
        </div>
      </section>

      {/* SubTrack Stili Canlı Kur Bilgi Satırı */}
      <div className="px-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#71717a] font-mono tabular-nums">
        <div className="flex flex-wrap items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 text-[#10b981] shrink-0" />
          <span>
            Para birimi dönüşümünde kullanılan kurlar günlük olarak güncellenmektedir.
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-[#a1a1aa]">
            1 USD = ₺{usdInTRY} · 1 EUR = ₺{eurInTRY} · 1 GBP = ₺{gbpInTRY}
          </span>
        </div>
        <span className="text-[#71717a]">
          Canlı Piyasa & Frankfurter API ({rates?.date}) Baz Alınır
        </span>
      </div>
    </div>
  );
};
