import React from 'react';
import { Edit2, Trash2, Plus, FileSpreadsheet } from 'lucide-react';
import { CurrencyCode, CurrencyRates, DateGroup, Expense } from '../types';
import {
  formatCurrency,
  getCategoryColor,
  getTagColor,
} from '../utils/expenseLogic';

interface ExpenseListViewProps {
  groups: DateGroup[];
  displayCurrency: CurrencyCode;
  rates: CurrencyRates | null;
  onEdit: (expense: Expense) => void;
  onDelete: (id: string) => void;
  onTagClick: (tag: string) => void;
  onOpenManualAdd: () => void;
  onOpenScanner: () => void;
}

export const ExpenseListView: React.FC<ExpenseListViewProps> = ({
  groups,
  displayCurrency,
  rates,
  onEdit,
  onDelete,
  onTagClick,
  onOpenManualAdd,
  onOpenScanner,
}) => {
  if (groups.length === 0) {
    return (
      <div className="bg-[#111114] border border-[#222226] rounded-2xl p-12 text-center">
        <p className="text-lg font-bold text-[#f4f4f5]">
          Seçili filtrelerde harcama kaydı bulunamadı
        </p>
        <p className="mt-2 text-sm text-[#a1a1aa] max-w-md mx-auto">
          Yeni bir harcama ekleyebilir veya fiş fotoğrafı, mobil bankacılık ekran görüntüsü ya da PDF kredi kartı ekstresi yükleyebilirsiniz.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onOpenManualAdd}
            className="px-5 py-2.5 text-sm font-semibold bg-white text-[#09090b] rounded-xl hover:bg-zinc-200 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Yeni Harcama Ekle
          </button>
          <button
            type="button"
            onClick={onOpenScanner}
            className="px-5 py-2.5 text-sm font-medium bg-[#18181c] text-[#f4f4f5] border border-[#27272a] rounded-xl hover:border-[#3f3f46] transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#0ea5e9]" />
            Fiş / PDF Ekstre Yükle
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="expense-list-view">
      {groups.map((group) => (
        <section
          key={group.date}
          aria-label={`${group.displayDate} Harcamaları`}
          className="bg-[#111114] border border-[#222226] rounded-2xl overflow-hidden"
        >
          {/* Gün Başlığı */}
          <div className="px-6 py-4 bg-[#16161a] border-b border-[#222226] flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-bold text-[#f4f4f5]">
                {group.displayDate}
              </span>
              <span className="text-[#71717a]" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-[#a1a1aa]">
                {group.date}
              </span>
            </div>
            <div className="text-sm font-mono tabular-nums font-semibold text-[#a1a1aa]">
              Gün Toplamı:{' '}
              <span className={group.dayTotalTRY < 0 ? 'text-[#10b981]' : 'text-[#f4f4f5]'}>
                {formatCurrency(group.dayTotalTRY, displayCurrency, rates)}
              </span>
            </div>
          </div>

          {/* İşlem Satırları */}
          <div className="divide-y divide-[#222226]">
            {group.items.map((item) => {
              const isRefund = item.amountInTRY < 0;
              const catColor = getCategoryColor(item.category);

              return (
                <div
                  key={item.id}
                  data-testid="expense-row"
                  className="px-6 py-4 hover:bg-[#16161a]/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
                    {/* Renkli Kategori Noktası (SubTrack Stili) */}
                    <span
                      className="w-3 h-3 rounded-full shrink-0 mt-1.5 sm:mt-0"
                      style={{ backgroundColor: catColor }}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <span className="text-base font-semibold text-[#f4f4f5] truncate">
                          {item.title}
                        </span>
                        {isRefund && (
                          <span className="text-xs font-mono font-semibold text-[#10b981] shrink-0">
                            (İade / İptal)
                          </span>
                        )}
                      </div>

                      {/* Zero-Pill Metadata Discipline: Clean unboxed inline text with · separators and distinct tag colors */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-[#a1a1aa]">
                        <span
                          className="font-medium"
                          style={{ color: catColor }}
                        >
                          {item.category}
                        </span>

                        {item.tags.length > 0 && (
                          <>
                            <span className="text-[#71717a]" aria-hidden="true">·</span>
                            <div className="flex flex-wrap items-center gap-2 font-mono">
                              {item.tags.map((tag) => (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => onTagClick(tag)}
                                  className="hover:underline font-medium cursor-pointer"
                                  style={{ color: getTagColor(tag) }}
                                  title={`${tag} etiketine göre filtrele`}
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>
                          </>
                        )}

                        {item.notes && (
                          <>
                            <span className="text-[#71717a]" aria-hidden="true">·</span>
                            <span className="text-[#a1a1aa] italic">
                              {item.notes}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Sağ: Tutar ve Aksiyonlar */}
                  <div className="flex items-center justify-between sm:justify-end gap-5 shrink-0 pl-6 sm:pl-0">
                    <div className="text-right font-mono tabular-nums">
                      <div
                        className={`text-base sm:text-lg font-bold ${
                          isRefund ? 'text-[#10b981]' : 'text-[#f4f4f5]'
                        }`}
                      >
                        {isRefund
                          ? `+${formatCurrency(Math.abs(item.amountInTRY), displayCurrency, rates)}`
                          : `-${formatCurrency(item.amountInTRY, displayCurrency, rates)}`}
                      </div>
                      {item.currency !== displayCurrency && (
                        <div className="text-xs text-[#71717a]">
                          Orijinal: {item.amount.toFixed(2)} {item.currency}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onEdit(item)}
                        aria-label={`Düzenle ${item.title}`}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#27272a]/70 transition-colors cursor-pointer"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(item.id)}
                        aria-label={`Sil ${item.title}`}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-[#a1a1aa] hover:text-[#f43f5e] hover:bg-[#f43f5e]/10 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};
