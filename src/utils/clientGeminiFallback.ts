import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  Expense,
  ExpenseCategory,
  ExtractedExpense,
  ExtractedReminder,
  FIXED_CATEGORIES,
  PaymentReminder,
} from '../types';
import {
  buildDraftExpenseFromPrompt,
  normalizeCategory,
  normalizeTagList,
  parseInstantAssistantMessage,
  parseTurkishAmount,
} from './expenseLogic';
import {
  normalizeRecurrence,
  parseInstantReminderMessage,
} from './reminderLogic';

export const PRIMARY_VISION_MODEL = 'gemini-4-hydrogen';
export const FAST_LITE_VISION_MODEL = 'gemini-3.1-flash-lite';
export const FAST_FLASH_VISION_MODEL = 'gemini-2.5-flash';

export const ACTIVE_GEMINI_MODELS = [
  FAST_LITE_VISION_MODEL,
  FAST_FLASH_VISION_MODEL,
  PRIMARY_VISION_MODEL,
];

const SINGLE_MODEL_TIMEOUT_MS = 45000;

interface HedgedModelSpec {
  model: string;
  thinkingConfig: { thinkingLevel?: ThinkingLevel; thinkingBudget?: number };
  staggerMs: number;
}

const HEDGED_VISION_SPECS: HedgedModelSpec[] = [
  {
    model: FAST_LITE_VISION_MODEL,
    thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    staggerMs: 0,
  },
  {
    model: FAST_FLASH_VISION_MODEL,
    thinkingConfig: { thinkingBudget: 0 },
    staggerMs: 0,
  },
  {
    model: PRIMARY_VISION_MODEL,
    thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    staggerMs: 1200,
  },
];

async function generateResilientLatestContent(params: {
  ai: GoogleGenAI;
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
  systemInstruction: string;
  signal: AbortSignal;
}): Promise<{ text: string; model: string }> {
  const { ai, parts, systemInstruction, signal } = params;
  const groupController = new AbortController();
  const onParentAbort = () => groupController.abort();
  if (signal.aborted) {
    groupController.abort();
  } else {
    signal.addEventListener('abort', onParentAbort, { once: true });
  }

  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let triggerDelayedStart: (() => void) | null = null;
  let fastFailures = 0;

  const waitForStaggerOrEarlyFail = (staggerMs: number) =>
    new Promise<void>((resolve) => {
      if (staggerMs <= 0 || fastFailures > 0) {
        resolve();
        return;
      }
      const prevTrigger = triggerDelayedStart;
      triggerDelayedStart = () => {
        if (prevTrigger) prevTrigger();
        resolve();
      };
      const t = setTimeout(resolve, staggerMs);
      timers.push(t);
    });

  try {
    const tasks = HEDGED_VISION_SPECS.map(async (spec) => {
      if (spec.staggerMs > 0) {
        await waitForStaggerOrEarlyFail(spec.staggerMs);
      }
      if (groupController.signal.aborted) {
        throw new Error('Aborted');
      }
      try {
        const res = await ai.models.generateContent({
          model: spec.model,
          contents: [{ role: 'user', parts }],
          config: {
            thinkingConfig: spec.thinkingConfig,
            abortSignal: groupController.signal,
            systemInstruction,
            responseMimeType: 'application/json',
          },
        });
        const text = (res.text || '').trim();
        if (!text || !text.includes('{')) {
          throw new Error(`Boş veya geçersiz JSON yanıtı (${spec.model})`);
        }
        return { text, model: spec.model };
      } catch (err) {
        if (spec.staggerMs === 0) {
          fastFailures++;
          if (triggerDelayedStart) triggerDelayedStart();
        }
        throw err;
      }
    });

    return await Promise.any(tasks);
  } catch (err) {
    if (err && typeof err === 'object' && 'errors' in err && Array.isArray((err as { errors: unknown[] }).errors)) {
      const errs = (err as { errors: unknown[] }).errors;
      const keyErr = errs.find((e) => {
        const m = e instanceof Error ? e.message : String(e || '');
        return m.includes('API_KEY_INVALID') || m.includes('API key not valid');
      });
      if (keyErr) throw keyErr;
      const nonAbort = errs.find((e) => {
        const m = e instanceof Error ? e.message : String(e || '');
        return !m.includes('Aborted') && !m.includes('AbortError');
      });
      throw nonAbort || errs[0] || new Error('Gemini API yanıt vermedi.');
    }
    throw err;
  } finally {
    groupController.abort();
    signal.removeEventListener('abort', onParentAbort);
    for (const t of timers) clearTimeout(t);
  }
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
  existingReminders?: PaymentReminder[];
  existingTags: string[];
}): Promise<{
  reply: string;
  analysisHighlight?: {
    label: string;
    totalTRY: number;
    count: number;
  };
  proposedExpenses: ExtractedExpense[];
  proposedReminders: ExtractedReminder[];
}> {
  const { apiKey, message, files, existingExpenses, existingReminders = [], existingTags } = params;
  const todayISO = new Date().toISOString().split('T')[0];

  if (files.length === 0 && message.trim()) {
    const instantReminder = parseInstantReminderMessage(message, existingReminders, todayISO);
    if (instantReminder.handled) {
      return {
        reply: instantReminder.reply,
        analysisHighlight: instantReminder.analysisHighlight,
        proposedExpenses: [],
        proposedReminders: instantReminder.proposedReminders,
      };
    }

    const instant = parseInstantAssistantMessage(message, existingExpenses, todayISO);
    if (instant.handled) {
      return {
        reply: instant.reply,
        analysisHighlight: instant.analysisHighlight,
        proposedExpenses: instant.proposedExpenses,
        proposedReminders: [],
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
{"reply": "Kısa Türkçe açıklama", "proposedExpenses": [{"title": "Başlık", "amount": 5867.6, "currency": "TRY", "amountInTRY": 5867.6, "category": "Fatura & Abonelik", "tags": ["#aidat"], "date": "${todayISO}", "notes": ""}], "proposedReminders": []}`
      : `Sen "SpenTrack Finansal Asistanı"sın. Bugünün tarihi: ${todayISO}.
İleriye dönük ödeme hatırlatması ("hatırlat", "planla", "her ayın 5'i") istendiyse "proposedExpenses" boş bırakıp "proposedReminders" dizisine ekle:
[{"title": "Başlık", "amount": 4500, "currency": "TRY", "amountInTRY": 4500, "category": "Fatura & Abonelik", "tags": ["#planli"], "dueDate": "YYYY-MM-DD", "recurrence": "once|monthly|yearly", "notes": ""}].
Mevcut harcama özeti: ${JSON.stringify(
          existingExpenses.slice(0, 100).map((e) => ({
            title: e.title,
            amountInTRY: e.amountInTRY,
            category: e.category,
            tags: e.tags,
            date: e.date,
          }))
        )}
Mevcut ödeme hatırlatmaları: ${JSON.stringify(
          existingReminders.slice(0, 60).map((r) => ({
            title: r.title,
            amountInTRY: r.amountInTRY,
            dueDate: r.dueDate,
            status: r.status,
            recurrence: r.recurrence,
          }))
        )}
Mevcut etiketler: ${JSON.stringify(existingTags.slice(0, 30))}
Kategoriler: ${FIXED_CATEGORIES.join(', ')}
Sadece şu JSON formatında yanıt ver:
{"reply": "Türkçe yanıt", "proposedExpenses": [], "proposedReminders": [], "analysisHighlight": {"label": "Özet", "totalTRY": 0, "count": 0}}`;

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

  const rawReminders: Record<string, unknown>[] = Array.isArray(parsed.proposedReminders)
    ? parsed.proposedReminders
    : [];
  const proposedReminders: ExtractedReminder[] = rawReminders
    .map((item: Record<string, unknown>) => {
      const title = String(item.title || 'Planlanan Ödeme').trim();
      const amt = Math.abs(parseTurkishAmount(String(item.amount || 0)));
      const amtTRY = Math.abs(parseTurkishAmount(String(item.amountInTRY || amt)));
      const rawCurr = String(item.currency || 'TRY').toUpperCase();
      const curr = (['TRY', 'USD', 'EUR', 'GBP'].includes(rawCurr)
        ? rawCurr
        : 'TRY') as ExtractedReminder['currency'];
      const tags = normalizeTagList(Array.isArray(item.tags) ? (item.tags as string[]) : ['#planli']);
      return {
        title,
        amount: amt,
        currency: curr,
        amountInTRY: amtTRY || amt,
        category: normalizeCategory(String(item.category || `${title} Fatura`)) as ExpenseCategory,
        tags: tags.length > 0 ? tags : ['#planli'],
        dueDate:
          typeof item.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)
            ? item.dueDate
            : todayISO,
        recurrence: normalizeRecurrence(String(item.recurrence || 'once')),
        notes: String(item.notes || '').trim(),
      };
    })
    .filter((r) => r.title.length > 0);

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
    proposedReminders,
  };
}
