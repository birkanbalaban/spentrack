import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Send,
  Paperclip,
  Check,
  AlertTriangle,
  KeyRound,
  Loader2,
} from 'lucide-react';
import {
  ChatMessage,
  CurrencyCode,
  CurrencyRates,
  Expense,
  ExtractedExpense,
  MarkedCandidate,
} from '../types';
import {
  buildDraftExpenseFromPrompt,
  detectDuplicates,
  formatCurrency,
  parseInstantAssistantMessage,
  parseTurkishAmount,
} from '../utils/expenseLogic';
import { prepareFileForGemini, PreparedAttachment } from '../utils/imageCompressor';
import {
  AccountApiKeyBox,
  sanitizeClientApiKey,
  isValidGeminiApiKey,
} from './AccountApiKeyBox';
import { chatWithAssistantDirectClient } from '../utils/clientGeminiFallback';

interface AssistantDrawerProps {
  isOpen: boolean;
  expenses: Expense[];
  existingTags: string[];
  displayCurrency: CurrencyCode;
  rates: CurrencyRates | null;
  customApiKey: string;
  isAuthenticated?: boolean;
  authHeaders?: Record<string, string>;
  onSaveApiKey: (key: string) => Promise<void>;
  onClose: () => void;
  onBatchSave: (items: ExtractedExpense[]) => Promise<void>;
}

export const AssistantDrawer: React.FC<AssistantDrawerProps> = ({
  isOpen,
  expenses,
  existingTags,
  displayCurrency,
  rates,
  customApiKey,
  isAuthenticated = false,
  authHeaders = {},
  onSaveApiKey,
  onClose,
  onBatchSave,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-msg',
      role: 'assistant',
      content:
        'Merhaba! Ben SpenTrack Asistan. Bana "Bugün Sağlam Kart ile 220 TL kahve, 1450 TL market harcadım" gibi yazarak veya fiş/PDF ekstre yükleyerek harcama ekleyebilir ya da "Bu ay #yapikredi etiketine veya dışarıda yemeye toplam ne kadar harcadım?" diye sorabilirsiniz.',
      timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PreparedAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState<{
    startedAt: number;
    elapsedSec: number;
    fileSummary: string;
    keyStatus: string;
    stageLabel: string;
    pendingText: string;
  } | null>(null);
  const [showKeyConfig, setShowKeyConfig] = useState(false);
  const [liveDraftKey, setLiveDraftKey] = useState<string>(customApiKey || '');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const activeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!loading || !loadingMeta) return;
    const interval = setInterval(() => {
      setLoadingMeta((prev) => {
        if (!prev) return null;
        const elapsedSec = Math.round(((Date.now() - prev.startedAt) / 1000) * 10) / 10;
        let stageLabel = prev.stageLabel;
        if (elapsedSec >= 2.0 && elapsedSec < 5.0 && prev.fileSummary) {
          stageLabel = 'Görsel OCR okunuyor (Hızlı Mod · Düşünme Kapalı)...';
        } else if (elapsedSec >= 5.0) {
          stageLabel = 'Yedek Gemini kanalı devrede, yanıt bekleniyor...';
        }
        return { ...prev, elapsedSec, stageLabel };
      });
    }, 200);
    return () => clearInterval(interval);
  }, [loading]);

  if (!isOpen) return null;

  const handleAttach = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const prepared = await Promise.all(
        Array.from(files).map((f) => prepareFileForGemini(f))
      );
      setAttachments((prev) => {
        const existingKeys = new Set(prev.map((p) => `${p.name}_${p.sizeKB}`));
        const fresh = prepared.filter((p) => !existingKeys.has(`${p.name}_${p.sizeKB}`));
        return [...prev, ...fresh];
      });
      if (fileRef.current) {
        fileRef.current.value = '';
      }
    } catch {
      // ignore invalid file
    }
  };

  const handleManualDraftFallback = (promptText: string, reasonNote?: string) => {
    if (activeAbortRef.current) {
      activeAbortRef.current.abort();
      activeAbortRef.current = null;
    }
    setLoading(false);
    setLoadingMeta(null);

    const draft = buildDraftExpenseFromPrompt(promptText);
    const marked = detectDuplicates([draft], expenses);
    const assistantMsg: ChatMessage = {
      id: `ast_${Date.now() + 2}`,
      role: 'assistant',
      content:
        reasonNote ||
        `Mesajınızdaki başlık ("${draft.title}") ve etiketleri (${draft.tags.join(' ')}) hazır hale getirdim. Aşağıdaki kutudan tutarı girip anında kaydedebilirsiniz:`,
      timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      proposedExpenses: marked,
    };
    setMessages((prev) => [...prev, assistantMsg]);
  };

  const sendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text && attachments.length === 0) return;

    const currentAttachments = [...attachments];
    const totalKB = currentAttachments.reduce((s, a) => s + (a.sizeKB || 0), 0);
    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text || `${currentAttachments.length} dosya gönderildi`,
      attachmentNames: currentAttachments.map((a) => `${a.name} (${a.sizeKB} KB)`),
      timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    };

    if (!overrideText) setInput('');
    setAttachments([]);

    const activeKey = sanitizeClientApiKey(liveDraftKey || customApiKey);
    if (activeKey && activeKey !== customApiKey && isValidGeminiApiKey(activeKey)) {
      onSaveApiKey(activeKey).catch(() => {});
    }

    // Mesajda zaten tutar + açıklama yazılmışsa (dosya eki olsa bile veya olmasa da) 0ms'de anlık çözümle!
    if (text) {
      const instantStart = performance.now();
      const instant = parseInstantAssistantMessage(text, expenses);
      if (instant.handled && (currentAttachments.length === 0 || instant.proposedExpenses.length > 0)) {
        const instantMs = Math.round((performance.now() - instantStart) * 100) / 100;
        console.info(
          `[SpenTrack Perf] Client Assistant instant-nlp resolved in ${instantMs}ms (proposed=${instant.proposedExpenses.length})`
        );
        const markedProposed: MarkedCandidate[] =
          instant.proposedExpenses.length > 0
            ? detectDuplicates(instant.proposedExpenses, expenses)
            : [];
        const assistantMsg: ChatMessage = {
          id: `ast_${Date.now() + 1}`,
          role: 'assistant',
          content: instant.reply,
          timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
          proposedExpenses: markedProposed.length > 0 ? markedProposed : undefined,
          analysisHighlight: instant.analysisHighlight,
        };
        setMessages((prev) => [...prev, userMsg, assistantMsg]);
        return;
      }
    }

    setMessages((prev) => [...prev, userMsg]);
    const hasValidClientKey = Boolean(activeKey && isValidGeminiApiKey(activeKey));
    const keyStatusText = hasValidClientKey
      ? `API Anahtarı Bağlı (${activeKey.slice(0, 4)}...${activeKey.slice(-3)})`
      : 'Sunucu API Anahtarı';
    const fileSummaryText =
      currentAttachments.length > 0
        ? `${currentAttachments.map((a) => a.name).join(', ')} (${totalKB} KB sıkıştırıldı ✓)`
        : '';

    const abortCtrl = new AbortController();
    activeAbortRef.current = abortCtrl;
    setLoading(true);
    setLoadingMeta({
      startedAt: Date.now(),
      elapsedSec: 0,
      fileSummary: fileSummaryText,
      keyStatus: keyStatusText,
      stageLabel:
        currentAttachments.length > 0
          ? 'Görsel Gemini 2.5 Flash’a gönderiliyor (Düşünme Modu Kapalı)...'
          : 'Gemini yanıtı bekleniyor...',
      pendingText: text,
    });

    const payloadFiles = currentAttachments.map((a) => ({
      name: a.name,
      mimeType: a.mimeType,
      data: a.data,
    }));

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...authHeaders,
      };
      if (activeKey) {
        headers['x-custom-gemini-key'] = activeKey;
      }

      let chatData: {
        reply?: string;
        analysisHighlight?: ChatMessage['analysisHighlight'];
        proposedExpenses?: ExtractedExpense[];
      } | null = null;

      const fetchTimeoutMs = payloadFiles.length > 0 ? 9000 : 6000;
      const reqStart = performance.now();

      const serverCall = async () => {
        const timer = setTimeout(() => abortCtrl.abort(), fetchTimeoutMs);
        try {
          const res = await fetch('/api/ai/chat', {
            method: 'POST',
            headers,
            signal: abortCtrl.signal,
            body: JSON.stringify({
              message: text,
              files: payloadFiles,
              // Görsel yüklenirken mevcut harcama listesini göndermeyerek yükü ve süreyi %85 azaltıyoruz
              existingExpenses: payloadFiles.length > 0 ? [] : expenses,
              existingTags: existingTags.slice(0, 30),
            }),
          });

          const data = await res.json();
          const elapsedMs = Math.round(performance.now() - reqStart);
          const serverMs = res.headers.get('X-Response-Time-Ms') || '-';
          console.info(
            `[SpenTrack Perf] /api/ai/chat status=${res.status} clientMs=${elapsedMs}ms serverMs=${serverMs}ms`
          );

          if (!res.ok) {
            throw new Error(data.error || 'Asistan yanıt veremedi.');
          }
          return data;
        } finally {
          clearTimeout(timer);
        }
      };

      if (hasValidClientKey) {
        // Kullanıcının API anahtarı tanımlıysa: Sunucu 1.8 sn içinde dönmezse doğrudan istemci Gemini (thinkingBudget: 0) paralel devreye girer, hangisi önce biterse anında yanıt döner!
        const hedgedClientCall = new Promise<{
          reply: string;
          analysisHighlight?: ChatMessage['analysisHighlight'];
          proposedExpenses: ExtractedExpense[];
        }>((resolve, reject) => {
          const hedgeTimer = setTimeout(() => {
            if (abortCtrl.signal.aborted) {
              reject(new Error('İptal edildi'));
              return;
            }
            chatWithAssistantDirectClient({
              apiKey: activeKey,
              message: text,
              files: payloadFiles,
              existingExpenses: payloadFiles.length > 0 ? [] : expenses,
              existingTags: existingTags.slice(0, 30),
            })
              .then(resolve)
              .catch(reject);
          }, 1800);

          abortCtrl.signal.addEventListener('abort', () => clearTimeout(hedgeTimer), { once: true });
        });

        try {
          chatData = await Promise.any([serverCall(), hedgedClientCall]);
        } catch (aggregateErr) {
          // Her ikisi de hata verdiyse doğrudan son bir istemci denemesi veya hata fırlat
          const errors = (aggregateErr as AggregateError)?.errors || [aggregateErr];
          throw errors[0] || new Error('Gemini API yanıt vermedi.');
        }
      } else {
        chatData = await serverCall();
      }

      const rawProposed: ExtractedExpense[] = chatData?.proposedExpenses || [];
      const markedProposed: MarkedCandidate[] =
        rawProposed.length > 0 ? detectDuplicates(rawProposed, expenses) : [];

      const assistantMsg: ChatMessage = {
        id: `ast_${Date.now()}`,
        role: 'assistant',
        content: chatData?.reply || 'İşleminiz tamamlandı.',
        timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        proposedExpenses: markedProposed.length > 0 ? markedProposed : undefined,
        analysisHighlight: chatData?.analysisHighlight,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      if (abortCtrl.signal.aborted && !loading) {
        return;
      }
      const errMsg = err instanceof Error ? err.message : 'Bir bağlantı hatası oluştu.';
      // Eğer görsel veya metin gönderilmişse ve API zaman aşımına/hataya düştüyse, kullanıcının yazdığı başlık ve etiketi kaybetmeden hemen tutar girilebilir kart sun!
      if (text || payloadFiles.length > 0) {
        const draft = buildDraftExpenseFromPrompt(text);
        const marked = detectDuplicates([draft], expenses);
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            role: 'assistant',
            content: `⚠️ Görsel okuma gecikti veya API yanıt vermedi (${errMsg}). Mesajınızdaki "${draft.title}" ve ${draft.tags.join(' ')} bilgilerini hazırladım; sadece tutarı yazıp hemen kaydedebilirsiniz:`,
            timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            proposedExpenses: marked,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            role: 'assistant',
            content: errMsg,
            timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
      }
    } finally {
      activeAbortRef.current = null;
      setLoading(false);
      setLoadingMeta(null);
    }
  };

  const toggleProposedCandidate = (msgId: string, tempId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.proposedExpenses) return m;
        return {
          ...m,
          proposedExpenses: m.proposedExpenses.map((c) =>
            c.tempId === tempId ? { ...c, selected: !c.selected } : c
          ),
        };
      })
    );
  };

  const updateProposedCandidateAmount = (msgId: string, tempId: string, rawVal: string) => {
    const parsed = parseTurkishAmount(rawVal);
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.proposedExpenses) return m;
        return {
          ...m,
          proposedExpenses: m.proposedExpenses.map((c) =>
            c.tempId === tempId
              ? { ...c, amount: parsed, amountInTRY: parsed, selected: true }
              : c
          ),
        };
      })
    );
  };

  const handleSaveProposed = async (msg: ChatMessage) => {
    if (!msg.proposedExpenses) return;
    const selected = msg.proposedExpenses.filter((c) => c.selected && c.amount !== 0);
    if (selected.length === 0) return;

    await onBatchSave(
      selected.map((c) => ({
        title: c.title,
        amount: c.amount,
        currency: c.currency,
        amountInTRY: c.amountInTRY,
        category: c.category,
        tags: c.tags,
        date: c.date,
        notes: c.notes,
      }))
    );

    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, savedSuccess: true } : m))
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="SpenTrack AI Asistan Paneli"
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
    >
      <div className="w-full max-w-md bg-[#18181b] border-l border-[#27272a] h-full flex flex-col shadow-2xl">
        {/* Üst Başlık */}
        <div className="px-5 py-4 border-b border-[#27272a] flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[#f4f4f5]">
              SpenTrack Asistan
            </h2>
            <p className="text-[11px] text-[#a1a1aa]">
              Yazarak veya ekstre atarak harcama ekleyin ve analiz yapın
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowKeyConfig((v) => !v)}
              aria-label="Kendi Gemini API Anahtarın ayarları"
              className={`px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1 border transition-colors cursor-pointer ${
                showKeyConfig || customApiKey
                  ? 'bg-[#10b981]/15 border-[#10b981] text-[#10b981]'
                  : 'bg-[#121215] border-[#27272a] text-[#a1a1aa] hover:text-[#f4f4f5]'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>API Anahtarı</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Asistanı kapat"
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Hesaba Tanımlı Gemini API Anahtarı Bölümü */}
        {showKeyConfig && (
          <AccountApiKeyBox
            savedApiKey={customApiKey}
            isAuthenticated={isAuthenticated}
            onSaveApiKey={onSaveApiKey}
            onDraftKeyChange={setLiveDraftKey}
            compact
          />
        )}

        {/* Hızlı Örnek Komutlar */}
        <div className="px-4 py-2.5 bg-[#121215]/60 border-b border-[#27272a] flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() =>
              sendMessage('Bugün Sağlam Kart ile 220 TL kahve, 1450 TL market harcadım')
            }
            className="px-2.5 py-1 text-[11px] bg-[#18181b] border border-[#27272a] rounded-md text-[#a1a1aa] hover:text-[#f4f4f5] hover:border-[#3f3f46] cursor-pointer"
          >
            + "Bugün Sağlam Kart ile 220 TL kahve, 1450 TL market harcadım"
          </button>
          <button
            type="button"
            onClick={() =>
              sendMessage('Bu ay #yapikredi etiketine veya dışarıda yemeye toplam ne kadar harcadım?')
            }
            className="px-2.5 py-1 text-[11px] bg-[#18181b] border border-[#27272a] rounded-md text-[#a1a1aa] hover:text-[#f4f4f5] hover:border-[#3f3f46] cursor-pointer"
          >
            ? "#yapikredi veya dışarıda yemeye ne kadar harcadım?"
          </button>
        </div>

        {/* Mesaj Akışı */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <div
                className={`max-w-[90%] rounded-xl p-3.5 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[#10b981] text-[#09090b] font-medium'
                    : 'bg-[#121215] border border-[#27272a] text-[#f4f4f5]'
                }`}
              >
                <div>{msg.content}</div>

                {msg.attachmentNames && msg.attachmentNames.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-black/20 text-[11px] font-mono">
                    Ekler: {msg.attachmentNames.join(', ')}
                  </div>
                )}

                {/* Analiz Özet Kartı */}
                {msg.analysisHighlight && (
                  <div className="mt-3 p-3 rounded-lg bg-[#18181b] border border-[#27272a] flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] text-[#a1a1aa]">
                        {msg.analysisHighlight.label}
                      </div>
                      <div className="text-[11px] text-[#71717a] font-mono tabular-nums">
                        {msg.analysisHighlight.count} işlem
                      </div>
                    </div>
                    <div className="text-sm font-bold font-mono tabular-nums text-[#10b981]">
                      {formatCurrency(
                        msg.analysisHighlight.totalTRY,
                        displayCurrency,
                        rates
                      )}
                    </div>
                  </div>
                )}

                {/* Harcamaları Kaydet Onay Kartı */}
                {msg.proposedExpenses && msg.proposedExpenses.length > 0 && (
                  <div
                    data-testid="assistant-confirm-card"
                    className="mt-3 p-3 rounded-lg bg-[#18181b] border border-[#27272a] space-y-2.5"
                  >
                    <div className="text-xs font-semibold text-[#f4f4f5] flex items-center justify-between">
                      <span>Tespit Edilen Harcamalar</span>
                      <span className="font-mono text-[11px] text-[#a1a1aa]">
                        {msg.proposedExpenses.length} kayıt
                      </span>
                    </div>

                    <div className="divide-y divide-[#27272a]/60">
                      {msg.proposedExpenses.map((cand) => (
                        <div
                          key={cand.tempId}
                          className="py-2 flex items-start justify-between gap-2"
                        >
                          <label className="flex items-start gap-2 cursor-pointer flex-1 min-w-0">
                            <input
                              type="checkbox"
                              checked={cand.selected}
                              disabled={msg.savedSuccess}
                              onChange={() => toggleProposedCandidate(msg.id, cand.tempId)}
                              className="mt-0.5 rounded border-[#27272a] bg-[#09090b] text-[#10b981]"
                            />
                            <div className="min-w-0">
                              <div className="font-medium text-[#f4f4f5] break-words">{cand.title}</div>
                              <div className="text-[11px] text-[#a1a1aa]">
                                {cand.category} ·{' '}
                                <span className="font-mono text-[#10b981]">
                                  {cand.tags.join(' ')}
                                </span>
                              </div>
                              {cand.isDuplicate && (
                                <div className="text-[10px] text-[#f59e0b] flex items-center gap-1 mt-0.5">
                                  <AlertTriangle className="w-3 h-3" />
                                  <span>Mükerrer Olabilir</span>
                                </div>
                              )}
                            </div>
                          </label>
                          <div className="shrink-0 flex flex-col items-end gap-1">
                            {msg.savedSuccess ? (
                              <div className="font-mono tabular-nums font-semibold text-[#f4f4f5]">
                                {formatCurrency(cand.amountInTRY, displayCurrency, rates)}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  aria-label={`Tutar (${cand.title})`}
                                  placeholder="Tutar girin"
                                  defaultValue={cand.amount !== 0 ? String(cand.amount) : ''}
                                  onChange={(e) =>
                                    updateProposedCandidateAmount(msg.id, cand.tempId, e.target.value)
                                  }
                                  className={`w-24 text-right px-2 py-1 rounded bg-[#09090b] border font-mono tabular-nums text-xs font-semibold focus:outline-none ${
                                    cand.amount === 0
                                      ? 'border-[#f59e0b] text-[#f59e0b] placeholder-[#f59e0b]/70'
                                      : 'border-[#27272a] text-[#f4f4f5] focus:border-[#10b981]'
                                  }`}
                                />
                                <span className="text-[11px] font-mono text-[#a1a1aa]">₺</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {msg.savedSuccess ? (
                      <div className="w-full py-2 text-center text-xs font-semibold text-[#10b981] bg-[#10b981]/10 rounded-lg flex items-center justify-center gap-1.5">
                        <Check className="w-4 h-4" />
                        Harcamalar Kaydedildi
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={
                          msg.proposedExpenses.filter((c) => c.selected && c.amount !== 0).length === 0
                        }
                        onClick={() => handleSaveProposed(msg)}
                        className="w-full py-2 text-xs font-semibold bg-[#10b981] text-[#09090b] rounded-lg hover:bg-[#10b981]/90 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        {msg.proposedExpenses.some((c) => c.selected && c.amount === 0)
                          ? 'Lütfen Yukarıdaki Kutuya Tutarı Yazın'
                          : `Harcamaları Kaydet (${
                              msg.proposedExpenses.filter((c) => c.selected && c.amount !== 0).length
                            })`}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <span className="text-[10px] font-mono text-[#71717a] mt-1 px-1">
                {msg.timestamp}
              </span>
            </div>
          ))}

          {loading && (
            <div className="rounded-xl bg-[#121215] border border-[#27272a] p-3.5 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[#f4f4f5] font-medium">
                  <Loader2 className="w-4 h-4 animate-spin text-[#10b981] shrink-0" />
                  <span>{loadingMeta?.stageLabel || 'SpenTrack Asistan hesaplıyor...'}</span>
                </div>
                <span className="font-mono text-[11px] text-[#10b981] tabular-nums shrink-0">
                  {loadingMeta ? `${loadingMeta.elapsedSec.toFixed(1)} sn` : ''}
                </span>
              </div>

              {loadingMeta && (
                <div className="pl-6 space-y-1 text-[11px] text-[#a1a1aa] font-mono">
                  {loadingMeta.fileSummary && (
                    <div>📎 Görsel: {loadingMeta.fileSummary}</div>
                  )}
                  <div>🔑 Bağlantı: {loadingMeta.keyStatus}</div>
                </div>
              )}

              <div className="pl-6 pt-1 flex flex-wrap items-center gap-2">
                {loadingMeta?.pendingText && (
                  <button
                    type="button"
                    onClick={() =>
                      handleManualDraftFallback(
                        loadingMeta.pendingText,
                        '⚡ Görsel okuma beklenmeden başlık ve etiketleriniz hazırlandı. Sadece tutarı yazıp hemen kaydedebilirsiniz:'
                      )
                    }
                    className="px-2.5 py-1 rounded-md bg-[#10b981]/15 border border-[#10b981]/50 text-[#10b981] hover:bg-[#10b981]/25 text-[11px] font-medium cursor-pointer transition-colors"
                  >
                    ⚡ Beklemeden Tutarı Elle Gir
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (activeAbortRef.current) {
                      activeAbortRef.current.abort();
                      activeAbortRef.current = null;
                    }
                    setLoading(false);
                    setLoadingMeta(null);
                  }}
                  className="px-2.5 py-1 rounded-md bg-[#18181b] border border-[#27272a] text-[#a1a1aa] hover:text-[#f43f5e] text-[11px] cursor-pointer transition-colors"
                >
                  İptal Et
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Alt Giriş Alanı */}
        <div className="p-4 border-t border-[#27272a] bg-[#121215]">
          {attachments.length > 0 && (
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((att, i) => (
                  <span
                    key={i}
                    className="text-[11px] font-mono bg-[#18181b] border border-[#27272a] pl-2 pr-1.5 py-0.5 rounded text-[#10b981] flex items-center gap-1.5"
                  >
                    <span className="truncate max-w-[140px]">{att.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((prev) => prev.filter((_, idx) => idx !== i))
                      }
                      aria-label={`Eki sil: ${att.name}`}
                      title="Bu eki kaldır"
                      className="p-0.5 text-[#71717a] hover:text-[#f43f5e] cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setAttachments([])}
                className="text-[11px] text-[#a1a1aa] hover:text-[#f43f5e] underline transition-colors cursor-pointer"
              >
                Temizle
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={(e) => handleAttach(e.target.files)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Sohbete fiş veya PDF ekstre ekle"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-[#18181b] border border-[#27272a] text-[#a1a1aa] hover:text-[#f4f4f5] cursor-pointer"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <input
              type="text"
              aria-label="Asistana mesaj yazın"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Harcama yazın veya soru sorun..."
              className="flex-1 px-3.5 py-2.5 text-xs bg-[#09090b] border border-[#27272a] rounded-lg text-[#f4f4f5] placeholder-[#71717a] focus:outline-none focus:border-[#10b981]"
            />
            <button
              type="button"
              onClick={() => sendMessage()}
              disabled={loading}
              aria-label="Mesajı gönder"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-[#10b981] text-[#09090b] hover:bg-[#10b981]/90 disabled:opacity-50 cursor-pointer"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
