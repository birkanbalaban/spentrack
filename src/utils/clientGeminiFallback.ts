import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  Expense,
  ExpenseCategory,
  ExtractedExpense,
  FIXED_CATEGORIES,
} from '../types';
import {
  buildDraftExpenseFromPrompt,
  normalizeCategory,
  normalizeTagList,
  parseInstantAssistantMessage,
  parseTurkishAmount,
} from './expenseLogic';

export const PRIMARY_VISION_MODEL = 'gemini-4-hydrogen';

export const ACTIVE_GEMINI_MODELS = [PRIMARY_VISION_MODEL];

const SINGLE_MODEL_TIMEOUT_MS = 24000;

async function generateResilientLatestContent(params: {
  ai: GoogleGenAI;
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
  systemInstruction: string;
  signal: AbortSignal;
}) {
  const { ai, parts, systemInstruction, signal } = params;
  return await ai.models.generateContent({
    model: PRIMARY_VISION_MODEL,
    contents: [{ role: 'user', parts }],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      abortSignal: signal,
      systemInstruction,
      responseMimeType: 'application/json',
    },
  });
}

export function parseGeminiJsonObject(rawText: string): Record<string, unknown> {
  const cleaned = String(rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) return {};
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    }
    throw new Error('Geçersiz JSON yanıtı alındı.');
  }
}

async function callSingleVisionModel<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`GEMINI_TIMEOUT: ${label} (${timeoutMs}ms aşıldı)`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task(controller.signal), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createDirectClient(apiKey: string): { ai: GoogleGenAI; mode: 'aistudio' } {
  const trimmed = apiKey.trim();
  return {
    ai: new GoogleGenAI({ apiKey: trimmed }),
    mode: 'aistudio',
  };
}

export async function extractStatementDirectClient(params: {
  apiKey: string;
  files: Array<{ name: string; mimeType: string; data: string }>;
  existingTags: string[];
}): Promise<{
  detectedBank: string;
  summaryNote: string;
  expenses: ExtractedExpense[];
}> {
  const { apiKey, files, existingTags } = params;
  const { ai, mode } = createDirectClient(apiKey);
  const todayISO = new Date().toISOString().split('T')[0];

  const systemInstruction = `Sen Türkiye finans, dekont ve bankacılık ekstreleri konusunda uzman hızlı bir OCR & Harcama Ayrıştırma Yapay Zekasısın.
Yüklenen fiş fotoğrafını, Havale/EFT/FAST transfer ekranını, mobil bankacılık ekran görüntüsünü veya PDF kredi kartı ekstresini analiz edip JSON döndürürsün.

KRİTİK KURALLAR:
1. HAVALE / EFT / FAST DEKONT EKRANLARI:
   - "Bakiye / Kullanılabilir Bakiye" (örn: 44.330,15 TL) veya "0,00 TL İşlem Masrafı" satırlarını ASLA harcama tutarı olarak alma!
   - Sadece "İşlem Bilgileri -> Tutar" alanındaki gerçek transfer tutarını (örn: 5.867,60 TL -> 5867.6) "amount" olarak al.
   - "Alıcı Ad Soyad/Ünvan" bilgisini "title" olarak al, "Açıklama" alanını "notes" içine yaz.
2. EKSTRE TUZAK SATIRLARINI EKLEME:
   - "Önceki Dönem Bakiyesi", "Dönem Borcu Ödemesi", "Kazanılan Puan/Bonus/Worldpuan", "Toplam Dönem Borcu", "Asgari Ödeme" satırlarını dahil etme.
3. TAKSİT, HESAP ÇIKIŞI VE İADE:
   - Taksit varsa (örn: "2/6 Taksit") sadece aylık taksit tutarını al, notes'a yaz ve "#taksit" ekle.
   - Banka hesap hareketlerinde "-560,00 TL | Ödeme - Enerjisa Ayesaş faturası" gibi eksi (-) işareti hesap çıkışını gösterir, İADE DEĞİLDİR! Açıklamada açıkça İade/İptal/Cashback yazmıyorsa tutarı POZİTİF (+560) harcama olarak çıkar.
   - Gerçek iade varsa tutarı negatif (-amount) yaz ve "#iade" ekle.
4. KATEGORİ (Sadece şu 8 değerden biri): ${FIXED_CATEGORIES.join(', ')}
5. YANIT FORMATI (Sadece geçerli JSON objesi döndür):
{"detectedBank": "Banka Adı", "summaryNote": "Özet", "expenses": [{"title": "Başlık", "amount": 1250.5, "currency": "TRY", "amountInTRY": 1250.5, "category": "Fatura & Abonelik", "tags": ["#etiket"], "date": "${todayISO}", "notes": ""}]}`;

  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];

  for (const file of files) {
    parts.push({
      inlineData: {
        mimeType: file.mimeType || 'image/jpeg',
        data: file.data,
      },
    });
  }

  parts.push({
    text: `Bugünün tarihi: ${todayISO}. Mevcut etiketler: ${existingTags.slice(0, 30).join(', ')}. Ekteki belgedeki gerçek harcama/transfer satırlarını JSON olarak çıkar.`,
  });

  const attemptStart = Date.now();
  const response = await callSingleVisionModel(
    (signal) =>
      generateResilientLatestContent({
        ai,
        parts,
        systemInstruction,
        signal,
      }),
    SINGLE_MODEL_TIMEOUT_MS,
    `client/extract:${mode}/${PRIMARY_VISION_MODEL}`
  );

  const attemptMs = Date.now() - attemptStart;
  console.info(
    `[SpenTrack Perf] Client Vision OK | op=extract | mode=${mode} | model=${PRIMARY_VISION_MODEL} | attemptMs=${attemptMs}ms`
  );

  const parsed = parseGeminiJsonObject(response.text || '{}');
  const rawExpenses = Array.isArray(parsed.expenses) ? parsed.expenses : [];
  const normalized: ExtractedExpense[] = rawExpenses
    .map((item: Record<string, unknown>) => {
      const amt =
        typeof item.amount === 'number'
          ? item.amount
          : parseTurkishAmount(String(item.amount || 0));
      const amtTRY =
        typeof item.amountInTRY === 'number'
          ? item.amountInTRY
          : parseTurkishAmount(String(item.amountInTRY || amt));
      const rawCurr = String(item.currency || 'TRY').toUpperCase();
      const curr = (['TRY', 'USD', 'EUR', 'GBP'].includes(rawCurr)
        ? rawCurr
        : 'TRY') as ExtractedExpense['currency'];

      return {
        title: String(item.title || 'İsimsiz Harcama').trim(),
        amount: amt,
        currency: curr,
        amountInTRY: amtTRY || amt,
        category: normalizeCategory(String(item.category || 'Diğer')) as ExpenseCategory,
        tags: normalizeTagList(Array.isArray(item.tags) ? (item.tags as string[]) : []),
        date:
          typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
            ? item.date
            : todayISO,
        notes: String(item.notes || '').trim(),
      };
    })
    .filter((item) => item.amount !== 0);

  return {
    detectedBank: String(parsed.detectedBank || ''),
    summaryNote: String(parsed.summaryNote || `${normalized.length} satır ayrıştırıldı.`),
    expenses: normalized,
  };
}

export async function chatWithAssistantDirectClient(params: {
  apiKey: string;
  message: string;
  files: Array<{ name: string; mimeType: string; data: string }>;
  existingExpenses: Expense[];
  existingTags: string[];
}): Promise<{
  reply: string;
  analysisHighlight?: {
    label: string;
    totalTRY: number;
    count: number;
  };
  proposedExpenses: ExtractedExpense[];
}> {
  const { apiKey, message, files, existingExpenses, existingTags } = params;
  const todayISO = new Date().toISOString().split('T')[0];

  if (files.length === 0 && message.trim()) {
    const instant = parseInstantAssistantMessage(message, existingExpenses, todayISO);
    if (instant.handled) {
      return {
        reply: instant.reply,
        analysisHighlight: instant.analysisHighlight,
        proposedExpenses: instant.proposedExpenses,
      };
    }
  }

  const { ai, mode } = createDirectClient(apiKey);

  const systemInstruction =
    files.length > 0
      ? `Sen "SpenTrack" hızlı fiş, Havale/EFT/FAST dekontu ve ekstre okuyucususun. Bugünün tarihi: ${todayISO}.
KRİTİK KURALLAR:
1. Havale/EFT/FAST ekran görüntülerinde "Bakiye" (örn: 44.330,15 TL) veya "0,00 TL İşlem Masrafı" satırlarını ASLA alma! Sadece "İşlem Bilgileri -> Tutar" alanındaki gerçek transfer/ödeme tutarını (örn: 5.867,60 TL -> 5867.6) "amount" olarak al.
2. Kullanıcı mesajında özel bir başlık (örn: AC YAPI MOMENT İSTANBUL SİTE YÖNETİMİ) veya #etiket (örn: #aidat) belirttiyse doğrudan onu uygula.
3. Banka hesap hareketlerinde "-560,00 TL | Ödeme - Enerjisa Ayesaş faturası" gibi eksi (-) işareti hesap çıkışını gösterir, İADE DEĞİLDİR; açıkça iade/iptal yazmıyorsa tutarı POZİTİF (560) harcama olarak al.
4. "date" alanını YYYY-MM-DD (örn: 16/11/2026 -> 2026-11-16) formatında yaz.
5. Sadece şu 8 kategoriden birini seç: ${FIXED_CATEGORIES.join(', ')}
6. Sadece şu JSON formatında yanıt ver:
{"reply": "Kısa Türkçe açıklama", "proposedExpenses": [{"title": "Başlık", "amount": 5867.6, "currency": "TRY", "amountInTRY": 5867.6, "category": "Fatura & Abonelik", "tags": ["#aidat"], "date": "${todayISO}", "notes": ""}]}`
      : `Sen "SpenTrack Finansal Asistanı"sın. Bugünün tarihi: ${todayISO}.
Mevcut harcama özeti: ${JSON.stringify(
          existingExpenses.slice(0, 100).map((e) => ({
            title: e.title,
            amountInTRY: e.amountInTRY,
            category: e.category,
            tags: e.tags,
            date: e.date,
          }))
        )}
Mevcut etiketler: ${JSON.stringify(existingTags.slice(0, 30))}
Kategoriler: ${FIXED_CATEGORIES.join(', ')}
Sadece şu JSON formatında yanıt ver:
{"reply": "Türkçe yanıt", "proposedExpenses": [], "analysisHighlight": {"label": "Özet", "totalTRY": 0, "count": 0}}`;

  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];

  for (const file of files) {
    parts.push({
      inlineData: {
        mimeType: file.mimeType || 'image/jpeg',
        data: file.data,
      },
    });
  }

  parts.push({
    text:
      files.length > 0
        ? `Kullanıcı mesajı: "${message || 'Görseldeki harcamayı çıkar.'}". Görseldeki gerçek işlem tutarını (Tutar alanını) ve detayları JSON olarak çıkar.`
        : message || 'Analiz yap.',
  });

  const attemptStart = Date.now();
  const response = await callSingleVisionModel(
    (signal) =>
      generateResilientLatestContent({
        ai,
        parts,
        systemInstruction,
        signal,
      }),
    SINGLE_MODEL_TIMEOUT_MS,
    `client/chat:${mode}/${PRIMARY_VISION_MODEL}`
  );

  const attemptMs = Date.now() - attemptStart;
  console.info(
    `[SpenTrack Perf] Client Vision OK | op=chat | mode=${mode} | model=${PRIMARY_VISION_MODEL} | attemptMs=${attemptMs}ms`
  );

  const parsed = parseGeminiJsonObject(response.text || '{}');
  const userDraft =
    files.length > 0 && message.trim() ? buildDraftExpenseFromPrompt(message, todayISO) : null;
  const rawList: Record<string, unknown>[] = Array.isArray(parsed.proposedExpenses)
    ? parsed.proposedExpenses
    : Array.isArray(parsed.expenses)
    ? (parsed.expenses as Record<string, unknown>[])
    : [];

  const proposed: ExtractedExpense[] = rawList
    .map((item: Record<string, unknown>) => {
      const amt =
        typeof item.amount === 'number'
          ? item.amount
          : parseTurkishAmount(String(item.amount || 0));
      const amtTRY =
        typeof item.amountInTRY === 'number'
          ? item.amountInTRY
          : parseTurkishAmount(String(item.amountInTRY || amt));
      const rawCurr = String(item.currency || 'TRY').toUpperCase();
      const curr = (['TRY', 'USD', 'EUR', 'GBP'].includes(rawCurr)
        ? rawCurr
        : 'TRY') as ExtractedExpense['currency'];

      const rawTitle = String(item.title || '').trim();
      const finalTitle =
        userDraft && rawList.length === 1 && userDraft.title !== 'Görsel Harcaması'
          ? userDraft.title
          : rawTitle || userDraft?.title || 'Harcama';
      const mergedTags = normalizeTagList([
        ...(Array.isArray(item.tags) ? (item.tags as string[]) : []),
        ...(userDraft ? userDraft.tags.filter((t) => t !== '#genel') : []),
      ]);
      const finalCategory = (
        userDraft && userDraft.category !== 'Diğer'
          ? userDraft.category
          : normalizeCategory(String(item.category || finalTitle || 'Diğer'))
      ) as ExpenseCategory;

      return {
        title: finalTitle,
        amount: amt,
        currency: curr,
        amountInTRY: amtTRY || amt,
        category: finalCategory,
        tags: mergedTags.length > 0 ? mergedTags : ['#genel'],
        date:
          typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
            ? item.date
            : todayISO,
        notes: String(item.notes || '').trim(),
      };
    })
    .filter((item) => item.amount !== 0);

  const highlightObj = parsed.analysisHighlight as Record<string, unknown> | undefined;
  const highlight =
    highlightObj && typeof highlightObj === 'object' && Number(highlightObj.count || 0) > 0
      ? {
          label: String(highlightObj.label || ''),
          totalTRY: Number(highlightObj.totalTRY || 0),
          count: Number(highlightObj.count || 0),
        }
      : undefined;

  return {
    reply: String(
      parsed.reply ||
        (proposed.length > 0
          ? `Görselden ${proposed.length} adet işlem (${proposed[0].title} - ${proposed[0].amountInTRY.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺) tespit edildi. Onaylayarak kaydedebilirsiniz:`
          : 'İşleminiz tamamlandı.')
    ),
    analysisHighlight: highlight,
    proposedExpenses: proposed,
  };
}
