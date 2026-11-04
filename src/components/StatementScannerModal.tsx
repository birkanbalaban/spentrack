import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Upload,
  FileText,
  AlertTriangle,
  Check,
  Loader2,
  Sparkles,
} from 'lucide-react';
import {
  Expense,
  ExpenseCategory,
  ExtractedExpense,
  FIXED_CATEGORIES,
  MarkedCandidate,
} from '../types';
import {
  detectDuplicates,
  normalizeCategory,
  normalizeTagList,
  parseTurkishAmount,
} from '../utils/expenseLogic';
import { prepareFileForGemini, PreparedAttachment } from '../utils/imageCompressor';

interface StatementScannerModalProps {
  isOpen: boolean;
  existingExpenses: Expense[];
  existingTags: string[];
  customApiKey?: string;
  onClose: () => void;
  onBatchSave: (items: ExtractedExpense[]) => Promise<void>;
}

export const StatementScannerModal: React.FC<StatementScannerModalProps> = ({
  isOpen,
  existingExpenses,
  existingTags,
  customApiKey,
  onClose,
  onBatchSave,
}) => {
  const [attachments, setAttachments] = useState<PreparedAttachment[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [detectedBank, setDetectedBank] = useState('');
  const [summaryNote, setSummaryNote] = useState('');
  const [candidates, setCandidates] = useState<MarkedCandidate[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const filesToProcess: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f && (f.type.startsWith('image/') || f.type === 'application/pdf')) {
            filesToProcess.push(f);
          }
        }
      }
      if (filesToProcess.length > 0) {
        e.preventDefault();
        await handleFilesSelected(filesToProcess);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen, existingExpenses]);

  if (!isOpen) return null;

  const handleFilesSelected = async (fileList: FileList | File[]) => {
    setError('');
    const arr = Array.from(fileList);
    if (arr.length === 0) return;

    try {
      const prepared = await Promise.all(arr.map((f) => prepareFileForGemini(f)));
      setAttachments((prev) => [...prev, ...prepared]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dosya hazırlanamadı.');
    }
  };

  const handleAnalyzeWithGemini = async () => {
    if (attachments.length === 0) {
      setError('Lütfen önce bir fiş fotoğrafı, ekran görüntüsü veya PDF ekstre seçin.');
      return;
    }

    setAnalyzing(true);
    setError('');
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (customApiKey) {
        headers['x-custom-gemini-key'] = customApiKey;
      }

      const res = await fetch('/api/ai/extract', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          files: attachments.map((a) => ({
            name: a.name,
            mimeType: a.mimeType,
            data: a.data,
          })),
          existingTags,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Ekstre analiz edilemedi.');
      }

      const rawExpenses: ExtractedExpense[] = data.expenses || [];
      const marked = detectDuplicates(rawExpenses, existingExpenses);
      setDetectedBank(data.detectedBank || '');
      setSummaryNote(data.summaryNote || `${marked.length} harcama satırı ayrıştırıldı.`);
      setCandidates(marked);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analiz sırasında bir hata oluştu.');
    } finally {
      setAnalyzing(false);
    }
  };

  /**
   * Kullanıcının Türkiye bankacılık ekstre kurallarını (Tuzak satır eleme, Taksit 2/6, İade -amount ve
   * Mükerrer Kayıt kontrolü) tek tıkla test edebilmesi için örnek ekstre simülasyonu.
   */
  const handleLoadSampleStatement = () => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const d = (day: number) => `${ym}-${String(Math.min(day, 28)).padStart(2, '0')}`;

    // Mevcut ilk kayıt ile aynı tarih & tutarda bir satır ekleyerek "Mükerrer Olabilir" kontrolünü de canlı gösteriyoruz
    const firstExisting = existingExpenses[0];

    const sampleExtracted: ExtractedExpense[] = [
      ...(firstExisting
        ? [
            {
              title: `${firstExisting.title} (Ekstre Satırı)`,
              amount: firstExisting.amount,
              currency: firstExisting.currency,
              amountInTRY: firstExisting.amountInTRY,
              category: firstExisting.category,
              tags: firstExisting.tags,
              date: firstExisting.date,
              notes: 'Mevcut kayıt ile aynı tarih ve tutarda',
            },
          ]
        : []),
      {
        title: 'Teknosa İç ve Dış Tic. A.Ş.',
        amount: 3250.0,
        currency: 'TRY',
        amountInTRY: 3250.0,
        category: 'Alışveriş',
        tags: ['#yapikredi', '#taksit', '#elektronik'],
        date: d(5),
        notes: '2/6 Taksit (Toplam: 19.500 TL - Sadece dönem taksiti baz alındı)',
      },
      {
        title: 'Kahve Dünyası Beşiktaş',
        amount: 265.0,
        currency: 'TRY',
        amountInTRY: 265.0,
        category: 'Yeme-İçme',
        tags: ['#yapikredi', '#kahve'],
        date: d(5),
        notes: '',
      },
      {
        title: 'Boyner Büyük Mağazacılık İade',
        amount: -890.0,
        currency: 'TRY',
        amountInTRY: -890.0,
        category: 'Alışveriş',
        tags: ['#yapikredi', '#iade', '#giyim'],
        date: d(4),
        notes: 'İade işlemi (-amount)',
      },
      {
        title: 'CarrefourSA Süpermarket',
        amount: 1120.75,
        currency: 'TRY',
        amountInTRY: 1120.75,
        category: 'Market',
        tags: ['#yapikredi', '#market'],
        date: d(3),
        notes: '',
      },
    ];

    const marked = detectDuplicates(sampleExtracted, existingExpenses);
    setDetectedBank('Yapı Kredi World (PDF Ekstre Analizi)');
    setSummaryNote(
      'Önceki Dönem Bakiyesi, Dönem Borcu Ödemesi ve Kazanılan Worldpuan tuzak satırları otomatik elendi.'
    );
    setCandidates(marked);
    setError('');
  };

  const updateCandidate = (tempId: string, patch: Partial<MarkedCandidate>) => {
    setCandidates((prev) =>
      prev.map((c) => (c.tempId === tempId ? { ...c, ...patch } : c))
    );
  };

  const handleConfirmSelected = async () => {
    const selectedItems = candidates.filter((c) => c.selected);
    if (selectedItems.length === 0) {
      setError('Kaydetmek için en az bir harcama satırı seçmelisiniz.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onBatchSave(
        selectedItems.map((c) => ({
          title: c.title.trim() || 'Harcama',
          amount: Number(c.amount),
          currency: c.currency,
          amountInTRY: Number(c.amountInTRY ?? c.amount),
          category: normalizeCategory(c.category),
          tags: normalizeTagList(c.tags),
          date: c.date,
          notes: c.notes || '',
        }))
      );
      setAttachments([]);
      setCandidates([]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toplu kayıt başarısız oldu.');
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = candidates.filter((c) => c.selected).length;
  const duplicateCount = candidates.filter((c) => c.isDuplicate).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scanner-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto"
    >
      <div className="w-full max-w-5xl bg-[#18181b] border border-[#27272a] rounded-xl p-6 shadow-2xl max-h-[90vh] flex flex-col">
        {/* Başlık */}
        <div className="flex items-center justify-between pb-4 border-b border-[#27272a] shrink-0">
          <div>
            <h2 id="scanner-modal-title" className="text-base font-semibold text-[#f4f4f5]">
              Fiş, Ekran Görüntüsü & PDF Kredi Kartı Ekstresi Çıkarımı
            </h2>
            <p className="text-xs text-[#a1a1aa] mt-0.5">
              Görseller otomatik max 1600px JPEG (0.8) olarak sıkıştırılır; PDF ekstreler çoklu satır olarak taranır. Ctrl+V ile doğrudan yapıştırabilirsiniz.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Ekstre tarayıcıyı kapat"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto space-y-5 pr-1">
          {error && (
            <div className="p-3 rounded-lg bg-[#f43f5e]/10 border border-[#f43f5e]/30 text-xs text-[#f43f5e]">
              {error}
            </div>
          )}

          {/* Dosya Yükleme Alanı */}
          <div className="bg-[#121215] border border-dashed border-[#27272a] hover:border-[#10b981]/60 rounded-xl p-5 text-center transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
              className="hidden"
            />
            <div className="flex flex-col items-center justify-center gap-2">
              <Upload className="w-6 h-6 text-[#10b981]" />
              <div className="text-sm font-medium text-[#f4f4f5]">
                Fiş Fotoğrafı, Mobil Bankacılık Ekran Görüntüsü veya PDF Ekstre Yükleyin
              </div>
              <p className="text-xs text-[#71717a] max-w-lg">
                Yapı Kredi World, Sağlam Kart, Garanti Bonus, Enpara ekstrelerini otomatik tanır; ödeme/puan tuzak satırlarını eler ve taksit/iadeleri ayrıştırır.
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 text-xs font-semibold bg-[#10b981] text-[#09090b] rounded-lg hover:bg-[#10b981]/90 transition-colors cursor-pointer"
                >
                  Dosya Seç (Görsel / PDF)
                </button>
                <button
                  type="button"
                  onClick={handleLoadSampleStatement}
                  className="px-3.5 py-2 text-xs font-medium bg-[#18181b] text-[#f4f4f5] border border-[#27272a] rounded-lg hover:border-[#10b981] transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#10b981]" />
                  Örnek Kredi Kartı Ekstresi Dene
                </button>
              </div>
            </div>

            {attachments.length > 0 && (
              <div className="mt-4 pt-4 border-t border-[#27272a] flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {attachments.map((att, idx) => (
                    <div
                      key={idx}
                      className="px-3 py-1.5 bg-[#18181b] border border-[#27272a] rounded-lg text-xs text-[#f4f4f5] flex items-center gap-2"
                    >
                      <FileText className="w-3.5 h-3.5 text-[#10b981]" />
                      <span className="truncate max-w-[180px]">{att.name}</span>
                      <span className="font-mono text-[#71717a]">{att.sizeKB} KB</span>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleAnalyzeWithGemini}
                  disabled={analyzing}
                  className="px-4 py-2 text-xs font-semibold bg-[#10b981] text-[#09090b] rounded-lg hover:bg-[#10b981]/90 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Gemini Analiz Ediyor...
                    </>
                  ) : (
                    'Belgeyi Tara ve Ayıkla'
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Tespit Edilen Harcamalar Onay Tablosu */}
          {candidates.length > 0 && (
            <div className="space-y-3" data-testid="extracted-candidates-table">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-[#121215] border border-[#27272a] rounded-xl p-3.5">
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold text-[#f4f4f5]">
                    Tespit Edilen Harcamalar ({candidates.length} satır)
                    {detectedBank && (
                      <span className="ml-2 text-[#10b981] font-mono">
                        · {detectedBank}
                      </span>
                    )}
                  </div>
                  {summaryNote && <div className="text-[#a1a1aa]">{summaryNote}</div>}
                </div>

                {duplicateCount > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-[#f59e0b] font-medium">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      {duplicateCount} satır mevcut kayıtlarla eşleştiği için varsayılan olarak işaretsiz bırakıldı
                    </span>
                  </div>
                )}
              </div>

              <div className="bg-[#121215] border border-[#27272a] rounded-xl overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#27272a] text-[11px] font-medium text-[#71717a]">
                      <th className="py-2.5 px-3 w-10">Seç</th>
                      <th className="py-2.5 px-3">Durum / Tarih</th>
                      <th className="py-2.5 px-3">İşyeri / Başlık</th>
                      <th className="py-2.5 px-3">Kategori</th>
                      <th className="py-2.5 px-3">Etiketler (#tag)</th>
                      <th className="py-2.5 px-3">Not / Taksit</th>
                      <th className="py-2.5 px-3 text-right">Tutar (TL)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#27272a]/60 text-xs">
                    {candidates.map((row) => (
                      <tr
                        key={row.tempId}
                        className={
                          row.isDuplicate
                            ? 'bg-[#f59e0b]/5 hover:bg-[#f59e0b]/10'
                            : 'hover:bg-[#18181b]/60'
                        }
                      >
                        <td className="py-2.5 px-3">
                          <input
                            type="checkbox"
                            aria-label={`Seç ${row.title}`}
                            checked={row.selected}
                            onChange={(e) =>
                              updateCandidate(row.tempId, { selected: e.target.checked })
                            }
                            className="rounded border-[#27272a] bg-[#09090b] text-[#10b981] cursor-pointer"
                          />
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <input
                            type="date"
                            aria-label="İşlem tarihi"
                            value={row.date}
                            onChange={(e) =>
                              updateCandidate(row.tempId, { date: e.target.value })
                            }
                            className="bg-[#09090b] border border-[#27272a] rounded px-1.5 py-1 text-xs font-mono tabular-nums text-[#f4f4f5]"
                          />
                          {row.isDuplicate && (
                            <div
                              title={row.duplicateReason}
                              className="mt-1 text-[11px] font-medium text-[#f59e0b] flex items-center gap-1"
                            >
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              <span>Mükerrer Olabilir</span>
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2.5">
                          <input
                            type="text"
                            aria-label="İşyeri başlığı"
                            value={row.title}
                            onChange={(e) =>
                              updateCandidate(row.tempId, { title: e.target.value })
                            }
                            className="w-full min-w-[120px] bg-[#09090b] border border-[#27272a] rounded px-2 py-1 text-xs text-[#f4f4f5]"
                          />
                        </td>
                        <td className="py-2.5 px-2.5">
                          <select
                            aria-label="Kategori"
                            value={row.category}
                            onChange={(e) =>
                              updateCandidate(row.tempId, {
                                category: e.target.value as ExpenseCategory,
                              })
                            }
                            className="bg-[#09090b] border border-[#27272a] rounded px-2 py-1 text-xs text-[#f4f4f5]"
                          >
                            {FIXED_CATEGORIES.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-2.5">
                          <input
                            type="text"
                            aria-label="Etiketler"
                            value={row.tags.join(' ')}
                            onChange={(e) =>
                              updateCandidate(row.tempId, {
                                tags: e.target.value.split(/[\s,]+/).filter(Boolean),
                              })
                            }
                            className="w-full min-w-[110px] bg-[#09090b] border border-[#27272a] rounded px-2 py-1 text-xs font-mono text-[#10b981]"
                          />
                        </td>
                        <td className="py-2.5 px-2.5">
                          <input
                            type="text"
                            aria-label="Not veya taksit"
                            value={row.notes || ''}
                            onChange={(e) =>
                              updateCandidate(row.tempId, { notes: e.target.value })
                            }
                            placeholder="Örn: 2/6 Taksit"
                            className="w-full min-w-[95px] bg-[#09090b] border border-[#27272a] rounded px-2 py-1 text-xs text-[#a1a1aa]"
                          />
                        </td>
                        <td className="py-2.5 px-2.5 text-right">
                          <input
                            type="number"
                            step="0.01"
                            aria-label="Tutar"
                            value={row.amount}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              updateCandidate(row.tempId, {
                                amount: val,
                                amountInTRY: val,
                              });
                            }}
                            className={`w-24 text-right bg-[#09090b] border border-[#27272a] rounded px-2 py-1 text-xs font-mono tabular-nums font-semibold ${
                              row.amount < 0 ? 'text-[#10b981]' : 'text-[#f4f4f5]'
                            }`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Alt Bar */}
        <div className="pt-4 mt-4 border-t border-[#27272a] flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-[#a1a1aa] font-mono tabular-nums">
            {candidates.length > 0
              ? `${selectedCount} / ${candidates.length} satır eklenecek`
              : 'Henüz satır ayrıştırılmadı'}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[#a1a1aa] hover:text-[#f4f4f5] cursor-pointer"
            >
              Kapat
            </button>
            {candidates.length > 0 && (
              <button
                type="button"
                onClick={handleConfirmSelected}
                disabled={saving || selectedCount === 0}
                className="px-5 py-2 text-xs font-semibold bg-[#10b981] text-[#09090b] rounded-lg hover:bg-[#10b981]/90 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                {saving ? 'Kaydediliyor...' : `Seçilenleri Ekle (${selectedCount})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
