/**
 * SpenTrack — Cloudflare Workers + D1 Production Backend
 * Supports D1 db.batch() for multi-row statement & profile sync inserts,
 * CRUD endpoints, and server-side @google/genai Structured Outputs for extraction & chat.
 */
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  buildDraftExpenseFromPrompt,
  normalizeCategory,
  normalizeTagList,
  parseInstantAssistantMessage,
  parseTurkishAmount,
} from './src/utils/expenseLogic';
import {
  ExtractedExpense,
  ExtractedReminder,
  PaymentReminder,
} from './src/types';
import {
  computeNextDueDate,
  getRecurrenceLabel,
  normalizeRecurrence,
  normalizeReminderStatus,
  parseInstantReminderMessage,
} from './src/utils/reminderLogic';
import {
  SPENTRACK_MCP_TOOLS,
  buildMcpServerInfo,
  convertToTRY,
} from './src/utils/mcpCore';

const memoryBotKeys = new Map<string, string>();

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
}

export interface Env {
  DB: D1Database;
  GEMINI_API_KEY?: string;
}

const FIXED_CATEGORIES = [
  'Market',
  'Yeme-İçme',
  'Ulaşım',
  'Fatura & Abonelik',
  'Alışveriş',
  'Eğlence',
  'Sağlık',
  'Diğer',
];

const EXTRACTION_SYSTEM_INSTRUCTION = `Sen "SpenTrack" adlı Türkiye odaklı finans, dekont ve harcama takip sisteminin hızlı görsel ayrıştırıcısısın.
Görevin: Kullanıcının yüklediği fiş fotoğrafı, Havale/EFT/FAST transfer ekranı, mobil bankacılık ekran görüntüsü veya PDF kredi kartı ekstresindeki geçerli harcama satırlarını JSON olarak ayıklamaktır.

KRİTİK KURALLAR:
1. HAVALE / EFT / FAST TRANSFER EKRANLARI:
   - "Bakiye / Kullanılabilir Bakiye" (örn: 44.330,15 TL) veya "0,00 TL İşlem Masrafı" satırlarını KESİNLİKLE harcama tutarı olarak alma!
   - Sadece "İşlem Bilgileri -> Tutar" alanındaki gerçek ödeme/transfer tutarını (örn: 5.867,60 TL -> 5867.6) "amount" olarak al.
   - "Alıcı Ad Soyad/Ünvan" bilgisini "title" olarak al, "Açıklama" bilgisini "notes" içine yaz.
2. BANKA TANIMA:
   - Yapı Kredi / World -> "#yapikredi", Kuveyt Türk / Sağlam Kart -> "#saglamkart", Garanti -> "#garanti", Enpara -> "#enpara", İş Bankası -> "#isbankasi", Akbank -> "#akbank", VakıfBank -> "#vakifbank", Ziraat -> "#ziraat".
3. EKSTRE TUZAK SATIRLARI YOK SAY:
   - "Önceki Dönem Bakiyesi", "Dönem Borcu Ödemesi", "Teşekkür Ederiz", "Kazanılan Worldpuan / Bonus", "Toplam Dönem Borcu", "Asgari Ödeme Tutarı" satırlarını ASLA harcama olarak alma!
4. TAKSİT, HESAP ÇIKIŞI VE İADE:
   - Taksitli işlemlerde (örn: "2/6 Taksit") sadece tek dönem taksit tutarını al, "#taksit" ekle.
   - Banka hesap hareketlerinde "-560,00 TL | Ödeme - Enerjisa Ayesaş faturası" gibi eksi (-) işareti hesap çıkışını gösterir, İADE DEĞİLDİR! Açıklamada açıkça İade/İptal/Cashback yazmıyorsa tutarı POZİTİF (+560) harcama olarak çıkar.
   - Gerçek iadelerde tutarı negatif (-amount) yap ve "#iade" ekle.
5. KATEGORİ (Sadece şu 8 değerden biri): "Market", "Yeme-İçme", "Ulaşım", "Fatura & Abonelik", "Alışveriş", "Eğlence", "Sağlık", "Diğer".
6. YANIT FORMATI (Sadece geçerli JSON döndür):
{"detectedBank": "Banka", "summaryNote": "Özet", "reply": "Kısa Türkçe açıklama", "expenses": [{"title": "Başlık", "amount": 5867.6, "currency": "TRY", "amountInTRY": 5867.6, "category": "Fatura & Abonelik", "tags": ["#aidat"], "date": "2026-11-10", "notes": ""}], "proposedExpenses": [{"title": "Başlık", "amount": 5867.6, "currency": "TRY", "amountInTRY": 5867.6, "category": "Fatura & Abonelik", "tags": ["#aidat"], "date": "2026-11-10", "notes": ""}]}`;

const CHAT_SYSTEM_INSTRUCTION = `Sen "SpenTrack Asistan" adında, Türkçe konuşan, hızlı, yalın ve net bir kişisel harcama & ekstre asistanısın.
Kullanıcı sana üç tür istekte bulunabilir:
1. HARCAMA EKLEME İSTEĞİ:
   Örn: "Bugün Sağlam Kart ile 220 TL kahve, 1450 TL market harcadım" veya ekte fiş/ekstre görseli/PDF göndermek.
   - Bu durumda metindeki veya dosyadaki tüm harcamaları ayıkla ve "proposedExpenses" dizisine ekle.
   - Kart/banka adı geçiyorsa (#saglamkart, #yapikredi, #kuveytturk, #garanti, #enpara, #nakit) otomatik etiketle.
   - Taksit varsa SADECE dönem taksit tutarını yaz, #taksit etiketi ekle ve notes kısmına "2/6 Taksit" gibi yaz.
   - İade varsa tutarı eksi (-amount) yap ve #iade etiketi ekle.
   - "reply" alanında kullanıcıya tespit ettiğin harcamaları kısaca özetle ve aşağıdaki onay kartından kaydedebileceğini söyle.

2. İLERİ TARİHLİ ÖDEME HATIRLATMA / TAKVİM PLANI EKLEME:
   Örn: "25 Kasım'da 4500 TL elektrik faturası hatırlat", "Her ayın 5'inde 18000 TL kira planla", "Gelecek ay 2000 TL aidat takvime ekle".
   - Bu istekler gerçekleşmiş harcama DEĞİLDİR! "proposedExpenses" dizisini boş bırakıp ödeme planlarını "proposedReminders" dizisine ekle:
     {"title": "...", "amount": 4500, "currency": "TRY", "amountInTRY": 4500, "category": "Fatura & Abonelik", "tags": ["#fatura"], "dueDate": "YYYY-MM-DD", "recurrence": "once|monthly|yearly", "notes": ""}.
   - Aylık tekrar edenler için recurrence="monthly", yıllık için "yearly", tek seferlik için "once" yaz.

3. SORU, HARCAMA & ÖDEME TAKVİMİ ANALİZİ:
   Örn: "Bu ay #yapikredi etiketine ne kadar harcadım?" veya "Yaklaşan / geciken ödemelerim neler?".
   - Sana verilen mevcut harcama özetini VE bekleyen/geciken ödeme hatırlatmalarını dikkatle hesapla.
   - Rakamları kuruşuna kadar doğru topla, net Türkçe yanıt ("reply") üret ve "analysisHighlight" alanını doldur.`;

const memoryUserKeys = new Map<string, string>();

function sanitizeGeminiApiKey(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let cleaned = raw
    .replace(/[\u200B-\u200D\uFEFF\r\n\t]/g, '')
    .trim()
    .replace(/^(?:GEMINI_API_KEY|VITE_GEMINI_API_KEY|API_KEY|Bearer)\s*[:=]\s*/i, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .trim();

  const aizaMatch = cleaned.match(/AIza[0-9A-Za-z_-]{25,}/);
  if (aizaMatch) {
    cleaned = aizaMatch[0];
  } else if (/^AQ[0-9A-Za-z_.-]{15,}/.test(cleaned)) {
    return null;
  }

  if (
    !cleaned ||
    cleaned.length < 15 ||
    cleaned === 'MY_GEMINI_API_KEY' ||
    cleaned === 'YOUR_API_KEY' ||
    cleaned === 'undefined' ||
    cleaned === 'null'
  ) {
    return null;
  }
  return cleaned;
}

async function getCandidateApiKeys(
  env: Env & { API_KEY?: string },
  request: Request,
  userId: string
): Promise<string[]> {
  const candidates: string[] = [];
  const pushUnique = (val?: string | null) => {
    const clean = sanitizeGeminiApiKey(val);
    if (clean && !candidates.includes(clean)) {
      candidates.push(clean);
    }
  };

  const cleanedHeaderKey = sanitizeGeminiApiKey(request.headers.get('x-custom-gemini-key'));
  pushUnique(cleanedHeaderKey);

  if (userId && userId !== 'default_user') {
    if (env.DB) {
      try {
        const row = await env.DB.prepare('SELECT gemini_api_key FROM users WHERE id = ?')
          .bind(userId)
          .first<{ gemini_api_key?: string }>();
        pushUnique(row?.gemini_api_key);

        if (cleanedHeaderKey && row?.gemini_api_key !== cleanedHeaderKey) {
          await env.DB.prepare(
            `INSERT INTO users (id, email, name, gemini_api_key, updated_at)
             VALUES (?, '', 'Kullanıcı', ?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
               gemini_api_key = excluded.gemini_api_key,
               updated_at = datetime('now')`
          )
            .bind(userId, cleanedHeaderKey)
            .run();
        }
      } catch {
        // ignore
      }
    }
    pushUnique(memoryUserKeys.get(userId));
    if (cleanedHeaderKey) {
      memoryUserKeys.set(userId, cleanedHeaderKey);
    }
  }

  if (candidates.length === 0 && env.DB) {
    try {
      const anyRow = await env.DB.prepare(
        "SELECT gemini_api_key FROM users WHERE gemini_api_key IS NOT NULL AND length(gemini_api_key) > 10 ORDER BY updated_at DESC LIMIT 1"
      ).first<{ gemini_api_key?: string }>();
      pushUnique(anyRow?.gemini_api_key);
    } catch {
      // ignore
    }
  }

  pushUnique(env.GEMINI_API_KEY);
  pushUnique(env.API_KEY);

  return candidates;
}

const GEMINI_TEXT_TIMEOUT_MS = 28000;
const GEMINI_MEDIA_TIMEOUT_MS = 45000;
const GEMINI_TOTAL_BUDGET_MS = 48000;
const PRIMARY_VISION_MODEL = 'gemini-4-hydrogen';
const FAST_LITE_VISION_MODEL = 'gemini-3.1-flash-lite';
const FAST_FLASH_VISION_MODEL = 'gemini-2.5-flash';

interface WorkerHedgedModelSpec {
  model: string;
  thinkingConfig: { thinkingLevel?: ThinkingLevel; thinkingBudget?: number };
  staggerMs: number;
}

const WORKER_HEDGED_SPECS: WorkerHedgedModelSpec[] = [
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

function parseGeminiJsonSafe(rawText: string): Record<string, unknown> {
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
    return {};
  }
}

async function callGeminiWithTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`GEMINI_TIMEOUT: ${label} (${timeoutMs}ms sınırı aşıldı)`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task(controller.signal), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function formatGeminiErrorMessage(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err || 'Belge analiz edilirken hata oluştu.');
  if (raw.includes('API_KEY_INVALID') || raw.includes('API key not valid')) {
    return {
      status: 400,
      message:
        "Girilen Gemini API anahtarı Google tarafından reddedildi (API_KEY_INVALID). Lütfen https://aistudio.google.com/apikey adresinden geçerli ('AIza...' ile başlayan) anahtarınızı kontrol edip eksiksiz kopyaladığınızdan emin olun.",
    };
  }
  if (raw.includes('GEMINI_TIMEOUT') || raw.includes('AbortError')) {
    return {
      status: 504,
      message:
        'Gemini API yanıt süresi sınırı aşıldı (zaman aşımı). Lütfen bağlantınızı kontrol edip tekrar deneyin.',
    };
  }
  return { status: 500, message: raw };
}

async function runHedgedKeyGeneration(
  ai: GoogleGenAI,
  params: {
    parts: Record<string, unknown>[];
    systemInstruction: string;
  },
  parentSignal: AbortSignal
): Promise<{ text: string; model: string }> {
  const groupController = new AbortController();
  const onParentAbort = () => groupController.abort();
  if (parentSignal.aborted) {
    groupController.abort();
  } else {
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
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
    const tasks = WORKER_HEDGED_SPECS.map(async (spec) => {
      if (spec.staggerMs > 0) {
        await waitForStaggerOrEarlyFail(spec.staggerMs);
      }
      if (groupController.signal.aborted) {
        throw new Error('Aborted');
      }
      try {
        const res = await ai.models.generateContent({
          model: spec.model,
          contents: { parts: params.parts },
          config: {
            thinkingConfig: spec.thinkingConfig,
            systemInstruction: params.systemInstruction,
            responseMimeType: 'application/json',
            abortSignal: groupController.signal,
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
    parentSignal.removeEventListener('abort', onParentAbort);
    for (const t of timers) clearTimeout(t);
  }
}

async function generateGeminiContentWithFallback(
  candidateKeys: string[],
  params: {
    parts: Record<string, unknown>[];
    systemInstruction: string;
    responseSchema?: Record<string, unknown>;
    timeoutMs?: number;
    operationLabel?: string;
  }
): Promise<string> {
  let lastError: unknown = null;
  const overallStart = Date.now();
  const hasMedia = params.parts.some((p) => 'inlineData' in p);
  const perAttemptTimeoutMs =
    params.timeoutMs ?? (hasMedia ? GEMINI_MEDIA_TIMEOUT_MS : GEMINI_TEXT_TIMEOUT_MS);
  const opLabel = params.operationLabel || (hasMedia ? 'multimodal-extract' : 'text-chat');

  for (const apiKey of candidateKeys) {
    const keyPrefix = `${apiKey.slice(0, 4)}...${apiKey.slice(-3)}`;
    const modeLabel = 'hedged-direct';
    const ai = new GoogleGenAI({ apiKey });

    const elapsedTotal = Date.now() - overallStart;
    if (elapsedTotal >= GEMINI_TOTAL_BUDGET_MS) {
      throw lastError || new Error(`GEMINI_TIMEOUT: Toplam süre sınırı (${GEMINI_TOTAL_BUDGET_MS}ms) aşıldı.`);
    }

    const remainingBudget = GEMINI_TOTAL_BUDGET_MS - elapsedTotal;
    const effectiveTimeoutMs = Math.max(6000, Math.min(perAttemptTimeoutMs, remainingBudget));
    const attemptStart = Date.now();

    try {
      const winner = await callGeminiWithTimeout(
        (signal) =>
          runHedgedKeyGeneration(
            ai,
            {
              parts: params.parts,
              systemInstruction: params.systemInstruction,
            },
            signal
          ),
        effectiveTimeoutMs,
        `${opLabel}:${modeLabel}`
      );

      const attemptMs = Date.now() - attemptStart;
      const totalMs = Date.now() - overallStart;
      const text = (winner.text || '{}').trim();
      if (text) {
        console.info(
          `[SpenTrack Perf] Gemini OK | op=${opLabel} model=${winner.model} mode=${modeLabel} key=${keyPrefix} attemptMs=${attemptMs}ms totalMs=${totalMs}ms`
        );
        return text;
      }
    } catch (err) {
      lastError = err;
      const attemptMs = Date.now() - attemptStart;
      const totalMs = Date.now() - overallStart;
      const msg = err instanceof Error ? err.message : String(err || '');
      const isTimeout = msg.includes('GEMINI_TIMEOUT') || msg.includes('AbortError');
      console.warn(
        `[SpenTrack Perf] Gemini ${isTimeout ? 'TIMEOUT' : 'FAIL'} | op=${opLabel} mode=${modeLabel} key=${keyPrefix} attemptMs=${attemptMs}ms totalMs=${totalMs}ms reason=${msg.slice(0, 140)}`
      );
    }
  }

  throw lastError || new Error('Gemini API yanıt vermedi.');
}

function fallbackNaturalLanguageAssist(
  message: string,
  existingExpenses: {
    title: string;
    amount: number;
    amountInTRY: number;
    category: string;
    tags: string[];
    date: string;
  }[],
  today: string
): {
  reply: string;
  proposedExpenses: ExtractedExpense[];
  analysisHighlight?: { label: string; totalTRY: number; count: number };
} {
  const res = parseInstantAssistantMessage(message, existingExpenses, today);
  return {
    reply: res.reply,
    proposedExpenses: res.proposedExpenses,
    analysisHighlight: res.analysisHighlight,
  };
}

const WORKER_JWT_SECRET = 'spentrack-hmac-sha256-secret-key-2026';

function toBase64Url(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function signJwtWebCrypto(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = toBase64Url(
    JSON.stringify({
      ...payload,
      iat: now,
      exp: now + 60 * 60 * 24 * 30,
    })
  );
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${header}.${body}`)
  );
  const signature = bytesToBase64Url(new Uint8Array(sigBuf));
  return `${header}.${body}.${signature}`;
}

async function verifyJwtWebCrypto(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuf = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(`${header}.${body}`)
    );
    const expectedSig = bytesToBase64Url(new Uint8Array(sigBuf));
    if (sig !== expectedSig) return null;
    const padded = body.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(decodeURIComponent(escape(atob(padded))));
    if (decoded.exp && Math.floor(Date.now() / 1000) > Number(decoded.exp)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

let schemaInitialized = false;
const memoryExpenses = new Map<string, Record<string, unknown>[]>();
const memoryReminders = new Map<string, PaymentReminder[]>();

function resolveD1Database(envObj: Record<string, unknown>): D1Database | undefined {
  if (envObj.DB && typeof (envObj.DB as D1Database).prepare === 'function') {
    return envObj.DB as D1Database;
  }
  for (const val of Object.values(envObj)) {
    if (
      val &&
      typeof val === 'object' &&
      typeof (val as D1Database).prepare === 'function' &&
      typeof (val as D1Database).batch === 'function'
    ) {
      return val as D1Database;
    }
  }
  return undefined;
}

async function ensureSchema(db?: D1Database): Promise<void> {
  if (!db || schemaInitialized) return;
  try {
    await db.batch([
      db.prepare(
        `CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT NOT NULL,
          avatar_url TEXT DEFAULT '',
          gemini_api_key TEXT DEFAULT '',
          bot_api_key TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`
      ),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS expenses (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL DEFAULT 'default_user',
          title TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT NOT NULL DEFAULT 'TRY',
          amount_in_try REAL NOT NULL,
          category TEXT NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          date TEXT NOT NULL,
          notes TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`
      ),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS payment_reminders (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL DEFAULT 'default_user',
          title TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT NOT NULL DEFAULT 'TRY',
          amount_in_try REAL NOT NULL,
          category TEXT NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          due_date TEXT NOT NULL,
          recurrence TEXT NOT NULL DEFAULT 'once',
          status TEXT NOT NULL DEFAULT 'pending',
          notes TEXT DEFAULT '',
          paid_at TEXT DEFAULT '',
          paid_expense_id TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`
      ),
    ]);
    try {
      await db.prepare("ALTER TABLE users ADD COLUMN gemini_api_key TEXT DEFAULT ''").run();
    } catch {
      // Column already exists
    }
    try {
      await db.prepare("ALTER TABLE users ADD COLUMN bot_api_key TEXT DEFAULT ''").run();
    } catch {
      // Column already exists
    }
    try {
      await db.prepare("ALTER TABLE expenses ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default_user'").run();
    } catch {
      // Column already exists
    }
    try {
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, date DESC)").run();
    } catch {
      // Index already exists
    }
    try {
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_reminders_user_due ON payment_reminders(user_id, due_date ASC)").run();
    } catch {
      // Index already exists
    }
    try {
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_users_bot_api_key ON users(bot_api_key)").run();
    } catch {
      // Index already exists
    }
    schemaInitialized = true;
  } catch {
    // ignore
  }
}

export default {
  async fetch(request: Request, env: Env & { JWT_SECRET?: string }): Promise<Response> {
    const url = new URL(request.url);
    const jwtSecret = env.JWT_SECRET || WORKER_JWT_SECRET;
    const detectedDb = resolveD1Database(env as unknown as Record<string, unknown>);
    if (detectedDb && !env.DB) {
      (env as { DB?: D1Database }).DB = detectedDb;
    }

    let userId = request.headers.get('x-user-id') || 'default_user';
    let userEmail = (request.headers.get('x-user-email') || '').trim().toLowerCase();
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const verified = await verifyJwtWebCrypto(authHeader.slice(7).trim(), jwtSecret);
      if (verified && typeof verified.sub === 'string' && verified.sub.trim()) {
        userId = verified.sub.trim();
      }
      if (verified && typeof verified.email === 'string' && verified.email.trim()) {
        userEmail = verified.email.trim().toLowerCase();
      }
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-user-email, x-custom-gemini-key',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      await ensureSchema(env.DB);

      // POST /api/auth/google
      if (url.pathname === '/api/auth/google' && request.method === 'POST') {
        const body = (await request.json()) as Record<string, unknown>;
        const id = String(body.id || body.email || '').trim();
        const email = String(body.email || '').trim();
        const name = String(body.name || email.split('@')[0] || 'Kullanıcı').trim();
        const avatarUrl = body.avatarUrl ? String(body.avatarUrl).trim() : '';

        if (!id || !email) {
          return Response.json(
            { error: 'Geçersiz Google kullanıcı bilgisi.' },
            { status: 400, headers: corsHeaders }
          );
        }

        let savedKey = memoryUserKeys.get(id) || '';
        if (env.DB) {
          await env.DB.prepare(
            `INSERT INTO users (id, email, name, avatar_url, updated_at)
             VALUES (?, ?, ?, ?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
               email = excluded.email,
               name = excluded.name,
               avatar_url = excluded.avatar_url,
               updated_at = datetime('now')`
          )
            .bind(id, email, name, avatarUrl)
            .run();

          try {
            const row = await env.DB.prepare('SELECT gemini_api_key FROM users WHERE id = ?')
              .bind(id)
              .first<{ gemini_api_key?: string }>();
            if (row?.gemini_api_key) {
              savedKey = String(row.gemini_api_key).trim();
            }
          } catch {
            // ignore
          }
        }

        const token = await signJwtWebCrypto(
          { sub: id, email, name },
          jwtSecret
        );

        return Response.json(
          {
            token,
            user: {
              id,
              email,
              name,
              avatarUrl: avatarUrl || undefined,
              geminiApiKey: savedKey,
            },
          },
          { headers: corsHeaders }
        );
      }

      // GET /api/user/apikey
      if (url.pathname === '/api/user/apikey' && request.method === 'GET') {
        if (!userId || userId === 'default_user') {
          return Response.json({ apiKey: '', hasKey: false }, { headers: corsHeaders });
        }
        let apiKey = memoryUserKeys.get(userId) || '';
        if (env.DB) {
          try {
            const row = await env.DB.prepare('SELECT gemini_api_key FROM users WHERE id = ?')
              .bind(userId)
              .first<{ gemini_api_key?: string }>();
            if (row && typeof row.gemini_api_key === 'string') {
              apiKey = row.gemini_api_key.trim();
            }
          } catch {
            // ignore
          }
        }
        return Response.json(
          {
            apiKey,
            hasKey: apiKey.length > 10,
          },
          { headers: corsHeaders }
        );
      }

      // PUT /api/user/apikey
      if (url.pathname === '/api/user/apikey' && request.method === 'PUT') {
        if (!userId || userId === 'default_user') {
          return Response.json(
            { error: 'API anahtarını hesaba tanımlamak için lütfen önce Google ile giriş yapın.' },
            { status: 401, headers: corsHeaders }
          );
        }
        const body = (await request.json()) as { apiKey?: string };
        const rawInput = String(body.apiKey || '').trim();
        const apiKey = rawInput ? sanitizeGeminiApiKey(rawInput) || rawInput : '';
        memoryUserKeys.set(userId, apiKey);

        if (env.DB) {
          await env.DB.prepare(
            `INSERT INTO users (id, email, name, gemini_api_key, updated_at)
             VALUES (?, '', 'Kullanıcı', ?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
               gemini_api_key = excluded.gemini_api_key,
               updated_at = datetime('now')`
          )
            .bind(userId, apiKey)
            .run();
        }

        return Response.json(
          {
            ok: true,
            apiKey,
            hasKey: apiKey.length > 10,
          },
          { headers: corsHeaders }
        );
      }

      // GET /api/user/botkey
      if (url.pathname === '/api/user/botkey' && request.method === 'GET') {
        if (!userId || userId === 'default_user') {
          return Response.json({ botApiKey: '', hasKey: false }, { headers: corsHeaders });
        }
        let botApiKey = memoryBotKeys.get(userId) || '';
        if (env.DB) {
          try {
            const row = await env.DB.prepare('SELECT bot_api_key FROM users WHERE id = ?')
              .bind(userId)
              .first<{ bot_api_key?: string }>();
            if (row && typeof row.bot_api_key === 'string') {
              botApiKey = row.bot_api_key.trim();
            }
          } catch {
            // ignore
          }
        }
        return Response.json(
          {
            botApiKey,
            hasKey: botApiKey.startsWith('st_live_') && botApiKey.length > 20,
          },
          { headers: corsHeaders }
        );
      }

      // POST /api/user/botkey
      if (url.pathname === '/api/user/botkey' && request.method === 'POST') {
        if (!userId || userId === 'default_user') {
          return Response.json(
            { error: 'Bot API anahtarı oluşturmak için lütfen önce giriş yapın.' },
            { status: 401, headers: corsHeaders }
          );
        }
        const rawHex = Array.from(crypto.getRandomValues(new Uint8Array(20)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const botApiKey = `st_live_${rawHex}`;
        memoryBotKeys.set(userId, botApiKey);

        if (env.DB) {
          await env.DB.prepare(
            `INSERT INTO users (id, email, name, bot_api_key, updated_at)
             VALUES (?, '', 'Kullanıcı', ?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
               bot_api_key = excluded.bot_api_key,
               updated_at = datetime('now')`
          )
            .bind(userId, botApiKey)
            .run();
        }

        return Response.json({ ok: true, botApiKey, hasKey: true }, { headers: corsHeaders });
      }

      // DELETE /api/user/botkey
      if (url.pathname === '/api/user/botkey' && request.method === 'DELETE') {
        if (!userId || userId === 'default_user') {
          return Response.json({ error: 'Lütfen önce giriş yapın.' }, { status: 401, headers: corsHeaders });
        }
        memoryBotKeys.delete(userId);
        if (env.DB) {
          await env.DB.prepare('UPDATE users SET bot_api_key = "", updated_at = datetime("now") WHERE id = ?')
            .bind(userId)
            .run();
        }
        return Response.json({ ok: true }, { headers: corsHeaders });
      }

      // MCP Endpoint (/api/mcp and /api/mcp/sse)
      if (url.pathname === '/api/mcp' || url.pathname === '/api/mcp/sse') {
        // SSE handshake
        if (
          request.method === 'GET' &&
          (request.headers.get('Accept')?.includes('text/event-stream') || url.pathname.endsWith('/sse'))
        ) {
          return new Response(`event: endpoint\ndata: ${url.origin}/api/mcp\n\n`, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            },
          });
        }

        // Resolve Bot User
        const authHeader = request.headers.get('Authorization') || '';
        const bearerMatch = authHeader.match(/^Bearer\s+(st_live_[a-zA-Z0-9_-]+)/i);
        const token =
          (bearerMatch ? bearerMatch[1] : null) ||
          request.headers.get('x-bot-api-key') ||
          url.searchParams.get('key');

        let targetUserId: string | null = null;
        if (token && token.startsWith('st_live_')) {
          if (env.DB) {
            const userRow = await env.DB.prepare('SELECT id FROM users WHERE bot_api_key = ?')
              .bind(token)
              .first<{ id: string }>();
            if (userRow?.id) targetUserId = userRow.id;
          }
          if (!targetUserId) {
            for (const [uid, bkey] of memoryBotKeys.entries()) {
              if (bkey === token) {
                targetUserId = uid;
                break;
              }
            }
          }
        }

        if (!targetUserId && userId && userId !== 'default_user') {
          targetUserId = userId;
        }

        let body: {
          id?: string | number | null;
          method?: string;
          params?: { name?: string; arguments?: Record<string, unknown> };
        } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          // ignore
        }

        const id = body.id ?? null;
        const method = body.method;

        if (method === 'initialize') {
          return Response.json({ jsonrpc: '2.0', id, result: buildMcpServerInfo() }, { headers: corsHeaders });
        }
        if (method === 'notifications/initialized') {
          // Accepted MCP notifications have no JSON-RPC response body.
          return new Response(null, { status: 202, headers: corsHeaders });
        }
        if (method === 'ping') {
          return Response.json({ jsonrpc: '2.0', id, result: {} }, { headers: corsHeaders });
        }

        if (!targetUserId) {
          return Response.json(
            {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32001,
                message:
                  "Yetkilendirme başarısız. Lütfen 'Authorization: Bearer st_live_...' başlığı ile geçerli bir SpenTrack Bot API Anahtarı gönderin.",
              },
            },
            { status: 401, headers: corsHeaders }
          );
        }

        if (method === 'tools/list') {
          return Response.json(
            { jsonrpc: '2.0', id, result: { tools: SPENTRACK_MCP_TOOLS } },
            { headers: corsHeaders }
          );
        }

        if (method === 'tools/call') {
          const toolName = body.params?.name;
          const args = body.params?.arguments || {};

          try {
            if (toolName === 'add_expense') {
              const title = String(args.title || '').trim();
              const amount = Number(args.amount);
              if (!title || !Number.isFinite(amount) || amount === 0) {
                return Response.json(
                  {
                    jsonrpc: '2.0',
                    id,
                    result: {
                      content: [{ type: 'text', text: 'Hata: title ve sıfırdan farklı sayısal amount zorunludur.' }],
                      isError: true,
                    },
                  },
                  { headers: corsHeaders }
                );
              }

              const currency = String(args.currency || 'TRY').toUpperCase();
              const validCurrency = ['TRY', 'USD', 'EUR', 'GBP'].includes(currency) ? currency : 'TRY';
              const amountInTRY = convertToTRY(amount, validCurrency);

              const category = normalizeCategory(String(args.category || ''));
              const tags = normalizeTagList(Array.isArray(args.tags) ? args.tags : []);
              const date =
                args.date && /^\d{4}-\d{2}-\d{2}$/.test(String(args.date))
                  ? String(args.date)
                  : new Date().toISOString().slice(0, 10);
              const notes = String(args.notes || '').trim();
              const expenseId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

              if (env.DB) {
                await env.DB.prepare(
                  `INSERT INTO expenses (id, user_id, title, amount, currency, amount_in_try, category, tags, date, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                  .bind(
                    expenseId,
                    targetUserId,
                    title,
                    amount,
                    validCurrency,
                    amountInTRY,
                    category,
                    JSON.stringify(tags),
                    date,
                    notes
                  )
                  .run();
              } else {
                const userList = memoryExpenses.get(targetUserId) || [];
                userList.unshift({
                  id: expenseId,
                  user_id: targetUserId,
                  title,
                  amount,
                  currency: validCurrency,
                  amount_in_try: amountInTRY,
                  category,
                  tags: JSON.stringify(tags),
                  date,
                  notes,
                  created_at: new Date().toISOString(),
                });
                memoryExpenses.set(targetUserId, userList);
              }

              const sign = amount < 0 ? 'İade' : 'Harcama';
              const text = `✅ ${sign} başarıyla kaydedildi:\n• İşyeri / Başlık: ${title}\n• Tutar: ${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 }).format(amount)} ${validCurrency}${validCurrency !== 'TRY' ? ` (${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 }).format(amountInTRY)} ₺)` : ''}\n• Kategori: ${category}\n• Tarih: ${date}\n• Etiketler: ${tags.join(' ') || '(etiketsiz)'}\n• ID: \`${expenseId}\`${notes ? `\n• Not: ${notes}` : ''}`;

              return Response.json(
                {
                  jsonrpc: '2.0',
                  id,
                  result: {
                    content: [{ type: 'text', text }],
                    isError: false,
                    data: {
                      id: expenseId,
                      title,
                      amount,
                      currency: validCurrency,
                      amountInTRY,
                      category,
                      tags,
                      date,
                      notes,
                    },
                  },
                },
                { headers: corsHeaders }
              );
            }

            if (toolName === 'update_expense') {
              const expId = String(args.id || '').trim();
              if (!expId) {
                return Response.json(
                  {
                    jsonrpc: '2.0',
                    id,
                    result: { content: [{ type: 'text', text: 'Hata: Güncellenecek harcama id değeri zorunludur.' }], isError: true },
                  },
                  { headers: corsHeaders }
                );
              }

              let existing: Record<string, unknown> | null = null;
              if (env.DB) {
                existing = await env.DB.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?')
                  .bind(expId, targetUserId)
                  .first();
              } else {
                const list = memoryExpenses.get(targetUserId) || [];
                existing = list.find((e) => e.id === expId) || null;
              }

              if (!existing) {
                return Response.json(
                  {
                    jsonrpc: '2.0',
                    id,
                    result: { content: [{ type: 'text', text: `Hata: ${expId} ID'li harcama kaydı bulunamadı.` }], isError: true },
                  },
                  { headers: corsHeaders }
                );
              }

              const title = args.title !== undefined ? String(args.title).trim() : String(existing.title);
              const amount = args.amount !== undefined ? Number(args.amount) : Number(existing.amount);
              const currency =
                args.currency !== undefined ? String(args.currency).toUpperCase() : String(existing.currency);
              const amountInTRY = convertToTRY(amount, currency);
              const category =
                args.category !== undefined ? normalizeCategory(String(args.category)) : String(existing.category);
              const tags =
                args.tags !== undefined
                  ? normalizeTagList(Array.isArray(args.tags) ? args.tags : [])
                  : JSON.parse(String(existing.tags || '[]'));
              const date = args.date !== undefined ? String(args.date) : String(existing.date);
              const notes = args.notes !== undefined ? String(args.notes).trim() : String(existing.notes || '');

              if (env.DB) {
                await env.DB.prepare(
                  `UPDATE expenses
                   SET title = ?, amount = ?, currency = ?, amount_in_try = ?, category = ?, tags = ?, date = ?, notes = ?
                   WHERE id = ? AND user_id = ?`
                )
                  .bind(
                    title,
                    amount,
                    currency,
                    amountInTRY,
                    category,
                    JSON.stringify(tags),
                    date,
                    notes,
                    expId,
                    targetUserId
                  )
                  .run();
              }

              return Response.json(
                {
                  jsonrpc: '2.0',
                  id,
                  result: {
                    content: [
                      {
                        type: 'text',
                        text: `✅ Harcama (#${expId}) güncellendi:\n• ${title} • ${amount} ${currency} • ${category} • ${date}`,
                      },
                    ],
                    isError: false,
                  },
                },
                { headers: corsHeaders }
              );
            }

            if (toolName === 'list_expenses') {
              let rows: Record<string, unknown>[] = [];
              if (env.DB) {
                let sql = 'SELECT * FROM expenses WHERE user_id = ?';
                const sqlParams: unknown[] = [targetUserId];
                if (args.monthYear && /^\d{4}-\d{2}$/.test(String(args.monthYear))) {
                  sql += ' AND date LIKE ?';
                  sqlParams.push(`${args.monthYear}%`);
                }
                if (args.category) {
                  sql += ' AND category = ?';
                  sqlParams.push(normalizeCategory(String(args.category)));
                }
                if (args.query) {
                  sql += ' AND (title LIKE ? OR notes LIKE ?)';
                  const q = `%${args.query}%`;
                  sqlParams.push(q, q);
                }
                sql += ' ORDER BY date DESC, created_at DESC';
                const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
                sql += ` LIMIT ${limit}`;
                const result = await env.DB.prepare(sql).bind(...sqlParams).all();
                rows = result.results || [];
              } else {
                rows = memoryExpenses.get(targetUserId) || [];
              }

              if (args.tag) {
                const rawTag = String(args.tag).trim().toLowerCase();
                const cleanTag = rawTag.startsWith('#') ? rawTag : `#${rawTag}`;
                rows = rows.filter((r) => {
                  try {
                    const list = JSON.parse(String(r.tags || '[]')) as string[];
                    return list.some((t) => t.toLowerCase() === cleanTag);
                  } catch {
                    return false;
                  }
                });
              }

              if (rows.length === 0) {
                return Response.json(
                  {
                    jsonrpc: '2.0',
                    id,
                    result: {
                      content: [{ type: 'text', text: 'Kriterlere uygun herhangi bir harcama kaydı bulunamadı.' }],
                      isError: false,
                      data: [],
                    },
                  },
                  { headers: corsHeaders }
                );
              }

              const lines = rows.map((r, i) => {
                const tags = JSON.parse(String(r.tags || '[]')).join(' ');
                return `${i + 1}. **${r.title}**: ${Number(r.amount).toLocaleString('tr-TR', {
                  minimumFractionDigits: 2,
                })} ${r.currency} (${r.date}) [${r.category}] ${tags} - ID: \`${r.id}\``;
              });

              const totalTRY = rows.reduce((s, r) => s + Number(r.amount_in_try || 0), 0);
              const header = `📋 Toplam ${rows.length} harcama kaydı listelendi (Toplam: ${totalTRY.toLocaleString('tr-TR', {
                minimumFractionDigits: 2,
              })} ₺):\n\n`;

              return Response.json(
                {
                  jsonrpc: '2.0',
                  id,
                  result: {
                    content: [{ type: 'text', text: header + lines.join('\n') }],
                    isError: false,
                    data: rows,
                  },
                },
                { headers: corsHeaders }
              );
            }

            if (toolName === 'get_financial_summary') {
              const ym =
                args.monthYear && /^\d{4}-\d{2}$/.test(String(args.monthYear))
                  ? String(args.monthYear)
                  : new Date().toISOString().slice(0, 7);

              let rows: Record<string, unknown>[] = [];
              if (env.DB) {
                const res = await env.DB.prepare('SELECT * FROM expenses WHERE user_id = ? AND date LIKE ?')
                  .bind(targetUserId, `${ym}%`)
                  .all();
                rows = res.results || [];
              } else {
                rows = (memoryExpenses.get(targetUserId) || []).filter((r) => String(r.date || '').startsWith(ym));
              }

              let totalSpentTRY = 0;
              let totalRefundTRY = 0;
              const categoryTotals: Record<string, number> = {};

              for (const r of rows) {
                const amtTRY = Number(r.amount_in_try || 0);
                if (amtTRY >= 0) {
                  totalSpentTRY += amtTRY;
                  const cat = String(r.category || 'Diğer');
                  categoryTotals[cat] = (categoryTotals[cat] || 0) + amtTRY;
                } else {
                  totalRefundTRY += Math.abs(amtTRY);
                }
              }

              const netTRY = totalSpentTRY - totalRefundTRY;
              const topCategories = Object.entries(categoryTotals)
                .sort((a, b) => b[1] - a[1])
                .map(
                  ([cat, amt]) =>
                    `• ${cat}: ${amt.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺ (%${
                      totalSpentTRY > 0 ? Math.round((amt / totalSpentTRY) * 100) : 0
                    })`
                )
                .join('\n');

              const text = `📊 **SpenTrack Finansal Özeti (${ym})**:\n\n• Toplam Harcama: **${totalSpentTRY.toLocaleString(
                'tr-TR',
                { minimumFractionDigits: 2 }
              )} ₺**\n• Toplam İade / Geri Ödeme: **${totalRefundTRY.toLocaleString('tr-TR', {
                minimumFractionDigits: 2,
              })} ₺**\n• Net Dönem Harcaması: **${netTRY.toLocaleString('tr-TR', {
                minimumFractionDigits: 2,
              })} ₺**\n• Toplam İşlem Sayısı: **${rows.length} adet**\n\n**Kategori Dağılımı:**\n${
                topCategories || 'Henüz harcama yok.'
              }`;

              return Response.json(
                {
                  jsonrpc: '2.0',
                  id,
                  result: {
                    content: [{ type: 'text', text }],
                    isError: false,
                    data: {
                      monthYear: ym,
                      totalSpentTRY,
                      totalRefundTRY,
                      netTRY,
                      transactionCount: rows.length,
                      categoryTotals,
                    },
                  },
                },
                { headers: corsHeaders }
              );
            }

            if (toolName === 'delete_expense') {
              const expId = String(args.id || '').trim();
              if (!expId) {
                return Response.json(
                  {
                    jsonrpc: '2.0',
                    id,
                    result: { content: [{ type: 'text', text: 'Hata: Silinecek id zorunludur.' }], isError: true },
                  },
                  { headers: corsHeaders }
                );
              }

              if (env.DB) {
                const info = await env.DB.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?')
                  .bind(expId, targetUserId)
                  .run();
                if (!info.success) {
                  return Response.json(
                    {
                      jsonrpc: '2.0',
                      id,
                      result: { content: [{ type: 'text', text: `Hata: ${expId} ID'li harcama kaydı silinemedi.` }], isError: true },
                    },
                    { headers: corsHeaders }
                  );
                }
              }

              return Response.json(
                {
                  jsonrpc: '2.0',
                  id,
                  result: {
                    content: [{ type: 'text', text: `🗑️ ${expId} ID'li harcama kaydı başarıyla silindi.` }],
                    isError: false,
                  },
                },
                { headers: corsHeaders }
              );
            }

            if (toolName === 'add_payment_reminder') {
              const title = String(args.title || '').trim();
              const amount = Math.abs(Number(args.amount));
              const dueDate = String(args.dueDate || '').slice(0, 10);
              if (!title || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
                return Response.json(
                  {
                    jsonrpc: '2.0',
                    id,
                    result: {
                      content: [{ type: 'text', text: 'Hata: title, pozitif amount ve YYYY-MM-DD formatında dueDate zorunludur.' }],
                      isError: true,
                    },
                  },
                  { headers: corsHeaders }
                );
              }
              const currency = (['TRY', 'USD', 'EUR', 'GBP'].includes(String(args.currency || 'TRY').toUpperCase())
                ? String(args.currency || 'TRY').toUpperCase()
                : 'TRY') as PaymentReminder['currency'];
              const amountInTRY = convertToTRY(amount, currency);
              const category = normalizeCategory(String(args.category || `${title} Fatura`));
              const tags = normalizeTagList(Array.isArray(args.tags) ? (args.tags as string[]) : ['#planli']);
              const recurrence = normalizeRecurrence(String(args.recurrence || 'once'));
              const notes = String(args.notes || '').trim();
              const remId = `rem-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

              const reminderObj: PaymentReminder = {
                id: remId,
                userId: targetUserId,
                title,
                amount,
                currency,
                amountInTRY,
                category,
                tags: tags.length > 0 ? tags : ['#planli'],
                dueDate,
                recurrence,
                status: 'pending',
                notes,
              };

              if (env.DB) {
                await env.DB.prepare(
                  `INSERT INTO payment_reminders (id, user_id, title, amount, currency, amount_in_try, category, tags, due_date, recurrence, status, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
                )
                  .bind(
                    remId,
                    targetUserId,
                    title,
                    amount,
                    currency,
                    amountInTRY,
                    category,
                    JSON.stringify(reminderObj.tags),
                    dueDate,
                    recurrence,
                    notes
                  )
                  .run();
              } else {
                const list = memoryReminders.get(targetUserId) || [];
                memoryReminders.set(targetUserId, [reminderObj, ...list]);
              }

              const text = `📅 Ödeme hatırlatması takvime eklendi:\n• Başlık: ${title}\n• Tutar: ${amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${currency}\n• Vade / Hatırlatma Tarihi: ${dueDate}\n• Sıklık: ${getRecurrenceLabel(recurrence)}\n• ID: \`${remId}\``;
              return Response.json(
                {
                  jsonrpc: '2.0',
                  id,
                  result: {
                    content: [{ type: 'text', text }],
                    isError: false,
                    data: reminderObj,
                  },
                },
                { headers: corsHeaders }
              );
            }

            if (toolName === 'list_payment_reminders') {
              const statusFilter = String(args.status || 'pending').toLowerCase();
              const monthFilter = args.monthYear && /^\d{4}-\d{2}$/.test(String(args.monthYear)) ? String(args.monthYear) : '';
              const includeOverdue = args.includeOverdue !== false;
              const today = new Date().toISOString().slice(0, 10);

              let rows: PaymentReminder[] = [];
              if (env.DB) {
                const res = await env.DB.prepare(
                  'SELECT * FROM payment_reminders WHERE user_id = ? ORDER BY due_date ASC, created_at DESC'
                )
                  .bind(targetUserId)
                  .all();
                rows = (res.results || []).map((r: Record<string, unknown>) => ({
                  id: String(r.id),
                  userId: String(r.user_id),
                  title: String(r.title),
                  amount: Number(r.amount),
                  currency: (String(r.currency || 'TRY') as PaymentReminder['currency']),
                  amountInTRY: Number(r.amount_in_try),
                  category: normalizeCategory(String(r.category || 'Diğer')),
                  tags: JSON.parse(String(r.tags || '[]')),
                  dueDate: String(r.due_date),
                  recurrence: normalizeRecurrence(String(r.recurrence || 'once')),
                  status: normalizeReminderStatus(String(r.status || 'pending')),
                  notes: String(r.notes || ''),
                  paidAt: String(r.paid_at || ''),
                  paidExpenseId: String(r.paid_expense_id || ''),
                }));
              } else {
                rows = memoryReminders.get(targetUserId) || [];
              }

              rows = rows.filter((r) => {
                if (statusFilter !== 'all' && r.status !== statusFilter) return false;
                if (monthFilter) {
                  const inMonth = r.dueDate.startsWith(monthFilter);
                  const isOverdue = includeOverdue && r.status === 'pending' && r.dueDate < today;
                  return inMonth || isOverdue;
                }
                return true;
              });

              if (rows.length === 0) {
                return Response.json(
                  {
                    jsonrpc: '2.0',
                    id,
                    result: {
                      content: [{ type: 'text', text: 'Kriterlere uygun ödeme hatırlatması bulunamadı.' }],
                      isError: false,
                      data: [],
                    },
                  },
                  { headers: corsHeaders }
                );
              }

              const totalTRY = rows.reduce((s, r) => s + Number(r.amountInTRY || 0), 0);
              const lines = rows.map(
                (r, idx) =>
                  `${idx + 1}. **${r.title}** (${r.dueDate}) — ${r.amount.toLocaleString('tr-TR', {
                    minimumFractionDigits: 2,
                  })} ${r.currency} [${r.status === 'paid' ? 'Ödendi' : r.dueDate < today ? 'Gecikmiş' : 'Bekliyor'} / ${getRecurrenceLabel(r.recurrence)}] - ID: \`${r.id}\``
              );
              return Response.json(
                {
                  jsonrpc: '2.0',
                  id,
                  result: {
                    content: [
                      {
                        type: 'text',
                        text: `📅 Toplam ${rows.length} hatırlatma (Toplam: ${totalTRY.toLocaleString('tr-TR', {
                          minimumFractionDigits: 2,
                        })} ₺):\n\n${lines.join('\n')}`,
                      },
                    ],
                    isError: false,
                    data: rows,
                  },
                },
                { headers: corsHeaders }
              );
            }

            if (toolName === 'complete_payment_reminder') {
              const remId = String(args.id || '').trim();
              if (!remId) {
                return Response.json(
                  {
                    jsonrpc: '2.0',
                    id,
                    result: { content: [{ type: 'text', text: 'Hata: Ödenecek hatırlatma id değeri zorunludur.' }], isError: true },
                  },
                  { headers: corsHeaders }
                );
              }
              const paidDate =
                args.paidDate && /^\d{4}-\d{2}-\d{2}$/.test(String(args.paidDate))
                  ? String(args.paidDate)
                  : new Date().toISOString().slice(0, 10);

              let targetRem: PaymentReminder | null = null;
              if (env.DB) {
                const r = await env.DB.prepare('SELECT * FROM payment_reminders WHERE id = ? AND user_id = ?')
                  .bind(remId, targetUserId)
                  .first<Record<string, unknown>>();
                if (r) {
                  targetRem = {
                    id: String(r.id),
                    userId: String(r.user_id),
                    title: String(r.title),
                    amount: Number(r.amount),
                    currency: String(r.currency || 'TRY') as PaymentReminder['currency'],
                    amountInTRY: Number(r.amount_in_try),
                    category: normalizeCategory(String(r.category || 'Diğer')),
                    tags: JSON.parse(String(r.tags || '[]')),
                    dueDate: String(r.due_date),
                    recurrence: normalizeRecurrence(String(r.recurrence || 'once')),
                    status: normalizeReminderStatus(String(r.status || 'pending')),
                    notes: String(r.notes || ''),
                  };
                }
              } else {
                targetRem = (memoryReminders.get(targetUserId) || []).find((r) => r.id === remId) || null;
              }

              if (!targetRem) {
                return Response.json(
                  {
                    jsonrpc: '2.0',
                    id,
                    result: { content: [{ type: 'text', text: `Hata: ${remId} ID'li hatırlatma bulunamadı.` }], isError: true },
                  },
                  { headers: corsHeaders }
                );
              }

              const newExpId = `exp-rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const createdExpense = {
                id: newExpId,
                userId: targetUserId,
                title: targetRem.title,
                amount: Math.abs(targetRem.amount),
                currency: targetRem.currency,
                amountInTRY: Math.abs(targetRem.amountInTRY),
                category: targetRem.category,
                tags: targetRem.tags,
                date: paidDate,
                notes: targetRem.notes ? `${targetRem.notes} (Takvim ödemesi)` : 'Takvim hatırlatmasından ödendi',
              };

              let nextReminder: PaymentReminder | null = null;
              if (targetRem.recurrence !== 'once') {
                const nextDue = computeNextDueDate(targetRem.dueDate, targetRem.recurrence);
                nextReminder = {
                  ...targetRem,
                  id: `rem-next-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  dueDate: nextDue,
                  status: 'pending',
                  paidAt: undefined,
                  paidExpenseId: undefined,
                };
              }

              if (env.DB) {
                const stmts: D1PreparedStatement[] = [
                  env.DB.prepare(
                    `INSERT INTO expenses (id, user_id, title, amount, currency, amount_in_try, category, tags, date, notes)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                  ).bind(
                    createdExpense.id,
                    targetUserId,
                    createdExpense.title,
                    createdExpense.amount,
                    createdExpense.currency,
                    createdExpense.amountInTRY,
                    createdExpense.category,
                    JSON.stringify(createdExpense.tags),
                    createdExpense.date,
                    createdExpense.notes
                  ),
                  env.DB.prepare(
                    `UPDATE payment_reminders SET status = 'paid', paid_at = ?, paid_expense_id = ? WHERE id = ? AND user_id = ?`
                  ).bind(paidDate, createdExpense.id, remId, targetUserId),
                ];
                if (nextReminder) {
                  stmts.push(
                    env.DB.prepare(
                      `INSERT INTO payment_reminders (id, user_id, title, amount, currency, amount_in_try, category, tags, due_date, recurrence, status, notes)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
                    ).bind(
                      nextReminder.id,
                      targetUserId,
                      nextReminder.title,
                      nextReminder.amount,
                      nextReminder.currency,
                      nextReminder.amountInTRY,
                      nextReminder.category,
                      JSON.stringify(nextReminder.tags),
                      nextReminder.dueDate,
                      nextReminder.recurrence,
                      nextReminder.notes || ''
                    )
                  );
                }
                await env.DB.batch(stmts);
              } else {
                const expList = memoryExpenses.get(targetUserId) || [];
                memoryExpenses.set(targetUserId, [
                  {
                    ...createdExpense,
                    user_id: targetUserId,
                    amount_in_try: createdExpense.amountInTRY,
                    tags: JSON.stringify(createdExpense.tags),
                  },
                  ...expList,
                ]);
                const remList = memoryReminders.get(targetUserId) || [];
                const updatedRems = remList.map((r) =>
                  r.id === remId ? { ...r, status: 'paid' as const, paidAt: paidDate, paidExpenseId: newExpId } : r
                );
                if (nextReminder) updatedRems.unshift(nextReminder);
                memoryReminders.set(targetUserId, updatedRems);
              }

              const nextMsg = nextReminder ? `\n• Sonraki Dönem Planı: ${nextReminder.dueDate} (\`${nextReminder.id}\`)` : '';
              return Response.json(
                {
                  jsonrpc: '2.0',
                  id,
                  result: {
                    content: [
                      {
                        type: 'text',
                        text: `✅ **${targetRem.title}** ödendi olarak işaretlendi ve **Harcama Ekranına** aktarıldı:\n• Tutar: ${createdExpense.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${createdExpense.currency}\n• Harcama ID: \`${createdExpense.id}\`${nextMsg}`,
                      },
                    ],
                    isError: false,
                    data: { createdExpense, nextReminder },
                  },
                },
                { headers: corsHeaders }
              );
            }

            return Response.json(
              { jsonrpc: '2.0', id, error: { code: -32601, message: `Bilinmeyen MCP aracı: '${toolName}'` } },
              { headers: corsHeaders }
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Araç yürütülürken hata oluştu';
            return Response.json(
              {
                jsonrpc: '2.0',
                id,
                result: { content: [{ type: 'text', text: `Hata: ${msg}` }], isError: true },
              },
              { headers: corsHeaders }
            );
          }
        }

        return Response.json(
          { jsonrpc: '2.0', id, error: { code: -32601, message: `Desteklenmeyen metod: '${method}'` } },
          { headers: corsHeaders }
        );
      }

      // GET /api/expenses
      if (url.pathname === '/api/expenses' && request.method === 'GET') {
        if (!env.DB) {
          const byId = memoryExpenses.get(userId) || [];
          const byEmail = userEmail ? memoryExpenses.get(userEmail) || [] : [];
          const merged = [...byId];
          const seen = new Set(byId.map((e) => String(e.id)));
          for (const item of byEmail) {
            if (!seen.has(String(item.id))) {
              merged.push(item);
            }
          }
          return Response.json(
            { expenses: merged, storageMode: 'memory' },
            { headers: corsHeaders }
          );
        }

        const { results } = await env.DB.prepare(
          'SELECT * FROM expenses WHERE user_id = ? OR (? != "" AND LOWER(user_id) = ?) ORDER BY date DESC, created_at DESC'
        )
          .bind(userId, userEmail, userEmail)
          .all();

        const mapped = results.map((r: Record<string, unknown>) => ({
          id: r.id,
          userId: r.user_id,
          title: r.title,
          amount: Number(r.amount),
          currency: r.currency || 'TRY',
          amountInTRY: Number(r.amount_in_try),
          category: r.category,
          tags: JSON.parse(String(r.tags || '[]')),
          date: r.date,
          notes: r.notes || '',
          createdAt: r.created_at,
        }));

        return Response.json({ expenses: mapped, storageMode: 'd1' }, { headers: corsHeaders });
      }

      // POST /api/expenses (Single)
      if (url.pathname === '/api/expenses' && request.method === 'POST') {
        const body = (await request.json()) as Record<string, unknown>;
        const id = String(body.id || crypto.randomUUID());
        const title = String(body.title || '').trim();
        const amount = Number(body.amount || 0);
        const currency = String(body.currency || 'TRY');
        const amountInTRY = Number(body.amountInTRY ?? body.amount ?? 0);
        const category = normalizeCategory(String(body.category || 'Diğer'));
        const tags = normalizeTagList(Array.isArray(body.tags) ? (body.tags as string[]) : []);
        const date = String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
        const notes = String(body.notes || '').trim();
        const expenseObj = { id, userId, title, amount, currency, amountInTRY, category, tags, date, notes };

        if (env.DB) {
          await env.DB.prepare(
            `INSERT OR REPLACE INTO expenses (id, user_id, title, amount, currency, amount_in_try, category, tags, date, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(id, userId, title, amount, currency, amountInTRY, category, JSON.stringify(tags), date, notes)
            .run();
        } else {
          const list = memoryExpenses.get(userId) || [];
          memoryExpenses.set(userId, [expenseObj, ...list.filter((e) => e.id !== id)]);
        }

        return Response.json(
          {
            ok: true,
            id,
            expense: expenseObj,
          },
          { headers: corsHeaders }
        );
      }

      // POST /api/expenses/batch (D1 db.batch() Toplu Kayıt)
      if (url.pathname === '/api/expenses/batch' && request.method === 'POST') {
        const body = (await request.json()) as { expenses?: Record<string, unknown>[] };
        const items = Array.isArray(body.expenses) ? body.expenses : [];
        if (items.length === 0) {
          return Response.json({ ok: true, inserted: 0, expenses: [] }, { headers: corsHeaders });
        }

        const savedList: Record<string, unknown>[] = [];
        const statements = items.map((item) => {
          const id = String(item.id || crypto.randomUUID());
          const title = String(item.title || 'Harcama').trim();
          const amount = Number(item.amount || 0);
          const currency = String(item.currency || 'TRY');
          const amountInTRY = Number(item.amountInTRY ?? item.amount ?? 0);
          const category = normalizeCategory(String(item.category || 'Diğer'));
          const tags = normalizeTagList(Array.isArray(item.tags) ? (item.tags as string[]) : []);
          const date = String(item.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
          const notes = String(item.notes || '').trim();

          savedList.push({ id, userId, title, amount, currency, amountInTRY, category, tags, date, notes });

          return env.DB
            ? env.DB.prepare(
                `INSERT OR REPLACE INTO expenses (id, user_id, title, amount, currency, amount_in_try, category, tags, date, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(id, userId, title, amount, currency, amountInTRY, category, JSON.stringify(tags), date, notes)
            : null;
        });

        if (env.DB) {
          await env.DB.batch(statements.filter(Boolean) as D1PreparedStatement[]);
        } else {
          const list = memoryExpenses.get(userId) || [];
          memoryExpenses.set(userId, [...savedList, ...list]);
        }

        return Response.json(
          { ok: true, inserted: savedList.length, expenses: savedList },
          { headers: corsHeaders }
        );
      }

      // PUT /api/expenses/:id
      if (url.pathname.startsWith('/api/expenses/') && request.method === 'PUT') {
        const id = url.pathname.split('/').pop() || '';
        const body = (await request.json()) as Record<string, unknown>;
        const title = String(body.title || '').trim();
        const amount = Number(body.amount || 0);
        const currency = String(body.currency || 'TRY');
        const amountInTRY = Number(body.amountInTRY ?? body.amount ?? 0);
        const category = normalizeCategory(String(body.category || 'Diğer'));
        const tags = normalizeTagList(Array.isArray(body.tags) ? (body.tags as string[]) : []);
        const date = String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
        const notes = String(body.notes || '').trim();
        const expenseObj = { id, userId, title, amount, currency, amountInTRY, category, tags, date, notes };

        if (env.DB) {
          await env.DB.prepare(
            `UPDATE expenses
             SET title = ?, amount = ?, currency = ?, amount_in_try = ?, category = ?, tags = ?, date = ?, notes = ?
             WHERE id = ? AND user_id = ?`
          )
            .bind(title, amount, currency, amountInTRY, category, JSON.stringify(tags), date, notes, id, userId)
            .run();
        } else {
          const list = memoryExpenses.get(userId) || [];
          memoryExpenses.set(
            userId,
            list.map((e) => (e.id === id ? expenseObj : e))
          );
        }

        return Response.json(
          {
            ok: true,
            expense: expenseObj,
          },
          { headers: corsHeaders }
        );
      }

      // DELETE /api/expenses/:id
      if (url.pathname.startsWith('/api/expenses/') && request.method === 'DELETE') {
        const id = url.pathname.split('/').pop() || '';
        if (env.DB) {
          await env.DB.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?')
            .bind(id, userId)
            .run();
        } else {
          const list = memoryExpenses.get(userId) || [];
          memoryExpenses.set(
            userId,
            list.filter((e) => e.id !== id)
          );
        }
        return Response.json({ ok: true }, { headers: corsHeaders });
      }

      // GET /api/reminders
      if (url.pathname === '/api/reminders' && request.method === 'GET') {
        if (!env.DB) {
          const byId = memoryReminders.get(userId) || [];
          const byEmail = userEmail ? memoryReminders.get(userEmail) || [] : [];
          const merged = [...byId];
          const seen = new Set(byId.map((r) => r.id));
          for (const item of byEmail) {
            if (!seen.has(item.id)) merged.push(item);
          }
          return Response.json({ reminders: merged, storageMode: 'memory' }, { headers: corsHeaders });
        }

        const { results } = await env.DB.prepare(
          'SELECT * FROM payment_reminders WHERE user_id = ? OR (? != "" AND LOWER(user_id) = ?) ORDER BY due_date ASC, created_at DESC'
        )
          .bind(userId, userEmail, userEmail)
          .all();

        const mapped: PaymentReminder[] = results.map((r: Record<string, unknown>) => ({
          id: String(r.id),
          userId: String(r.user_id),
          title: String(r.title),
          amount: Number(r.amount),
          currency: (String(r.currency || 'TRY') as PaymentReminder['currency']),
          amountInTRY: Number(r.amount_in_try),
          category: normalizeCategory(String(r.category || 'Diğer')),
          tags: (() => {
            try {
              return JSON.parse(String(r.tags || '[]'));
            } catch {
              return [];
            }
          })(),
          dueDate: String(r.due_date),
          recurrence: normalizeRecurrence(String(r.recurrence || 'once')),
          status: normalizeReminderStatus(String(r.status || 'pending')),
          notes: String(r.notes || ''),
          paidAt: String(r.paid_at || '') || undefined,
          paidExpenseId: String(r.paid_expense_id || '') || undefined,
          createdAt: String(r.created_at || ''),
        }));

        return Response.json({ reminders: mapped, storageMode: 'd1' }, { headers: corsHeaders });
      }

      // POST /api/reminders
      if (url.pathname === '/api/reminders' && request.method === 'POST') {
        const body = (await request.json()) as Record<string, unknown>;
        const id = String(body.id || `rem-${crypto.randomUUID()}`);
        const title = String(body.title || '').trim();
        const amount = Math.abs(Number(body.amount || 0));
        const currency = (['TRY', 'USD', 'EUR', 'GBP'].includes(String(body.currency || 'TRY').toUpperCase())
          ? String(body.currency || 'TRY').toUpperCase()
          : 'TRY') as PaymentReminder['currency'];
        const amountInTRY = Math.abs(Number(body.amountInTRY ?? amount));
        const category = normalizeCategory(String(body.category || 'Fatura & Abonelik'));
        const tags = normalizeTagList(Array.isArray(body.tags) ? (body.tags as string[]) : []);
        const dueDate = String(body.dueDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
        const recurrence = normalizeRecurrence(String(body.recurrence || 'once'));
        const status = normalizeReminderStatus(String(body.status || 'pending'));
        const notes = String(body.notes || '').trim();

        const reminderObj: PaymentReminder = {
          id,
          userId,
          title,
          amount,
          currency,
          amountInTRY,
          category,
          tags: tags.length > 0 ? tags : ['#planli'],
          dueDate,
          recurrence,
          status,
          notes,
        };

        if (env.DB) {
          await env.DB.prepare(
            `INSERT OR REPLACE INTO payment_reminders (id, user_id, title, amount, currency, amount_in_try, category, tags, due_date, recurrence, status, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(
              id,
              userId,
              title,
              amount,
              currency,
              amountInTRY,
              category,
              JSON.stringify(reminderObj.tags),
              dueDate,
              recurrence,
              status,
              notes
            )
            .run();
        } else {
          const list = memoryReminders.get(userId) || [];
          memoryReminders.set(userId, [reminderObj, ...list.filter((r) => r.id !== id)]);
        }

        return Response.json({ ok: true, id, reminder: reminderObj }, { headers: corsHeaders });
      }

      // POST /api/reminders/batch
      if (url.pathname === '/api/reminders/batch' && request.method === 'POST') {
        const body = (await request.json()) as { reminders?: Record<string, unknown>[] };
        const items = Array.isArray(body.reminders) ? body.reminders : [];
        if (items.length === 0) {
          return Response.json({ ok: true, inserted: 0, reminders: [] }, { headers: corsHeaders });
        }

        const savedList: PaymentReminder[] = [];
        const stmts: D1PreparedStatement[] = [];
        for (const item of items) {
          const id = String(item.id || `rem-${crypto.randomUUID()}`);
          const title = String(item.title || 'Planlanan Ödeme').trim();
          const amount = Math.abs(Number(item.amount || 0));
          if (!amount) continue;
          const currency = (['TRY', 'USD', 'EUR', 'GBP'].includes(String(item.currency || 'TRY').toUpperCase())
            ? String(item.currency || 'TRY').toUpperCase()
            : 'TRY') as PaymentReminder['currency'];
          const amountInTRY = Math.abs(Number(item.amountInTRY ?? amount));
          const category = normalizeCategory(String(item.category || 'Fatura & Abonelik'));
          const tags = normalizeTagList(Array.isArray(item.tags) ? (item.tags as string[]) : []);
          const dueDate = String(item.dueDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
          const recurrence = normalizeRecurrence(String(item.recurrence || 'once'));
          const status = normalizeReminderStatus(String(item.status || 'pending'));
          const notes = String(item.notes || '').trim();

          const obj: PaymentReminder = {
            id,
            userId,
            title,
            amount,
            currency,
            amountInTRY,
            category,
            tags: tags.length > 0 ? tags : ['#planli'],
            dueDate,
            recurrence,
            status,
            notes,
          };
          savedList.push(obj);
          if (env.DB) {
            stmts.push(
              env.DB.prepare(
                `INSERT OR REPLACE INTO payment_reminders (id, user_id, title, amount, currency, amount_in_try, category, tags, due_date, recurrence, status, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(
                id,
                userId,
                title,
                amount,
                currency,
                amountInTRY,
                category,
                JSON.stringify(obj.tags),
                dueDate,
                recurrence,
                status,
                notes
              )
            );
          }
        }

        if (env.DB && stmts.length > 0) {
          await env.DB.batch(stmts);
        } else if (!env.DB) {
          const list = memoryReminders.get(userId) || [];
          memoryReminders.set(userId, [...savedList, ...list]);
        }

        return Response.json({ ok: true, inserted: savedList.length, reminders: savedList }, { headers: corsHeaders });
      }

      // POST /api/reminders/:id/pay
      if (url.pathname.startsWith('/api/reminders/') && url.pathname.endsWith('/pay') && request.method === 'POST') {
        const parts = url.pathname.split('/');
        const id = parts[parts.length - 2] || '';
        const body = (await request.json().catch(() => ({}))) as { paidDate?: string };
        const paidDate =
          body.paidDate && /^\d{4}-\d{2}-\d{2}$/.test(body.paidDate)
            ? body.paidDate
            : new Date().toISOString().slice(0, 10);

        let targetRem: PaymentReminder | null = null;
        if (env.DB) {
          const r = await env.DB.prepare('SELECT * FROM payment_reminders WHERE id = ? AND user_id = ?')
            .bind(id, userId)
            .first<Record<string, unknown>>();
          if (r) {
            targetRem = {
              id: String(r.id),
              userId: String(r.user_id),
              title: String(r.title),
              amount: Number(r.amount),
              currency: String(r.currency || 'TRY') as PaymentReminder['currency'],
              amountInTRY: Number(r.amount_in_try),
              category: normalizeCategory(String(r.category || 'Diğer')),
              tags: JSON.parse(String(r.tags || '[]')),
              dueDate: String(r.due_date),
              recurrence: normalizeRecurrence(String(r.recurrence || 'once')),
              status: normalizeReminderStatus(String(r.status || 'pending')),
              notes: String(r.notes || ''),
            };
          }
        } else {
          targetRem = (memoryReminders.get(userId) || []).find((r) => r.id === id) || null;
        }

        if (!targetRem) {
          return Response.json({ error: 'Hatırlatma bulunamadı.' }, { status: 404, headers: corsHeaders });
        }

        const newExpId = `exp-rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const createdExpense = {
          id: newExpId,
          userId,
          title: targetRem.title,
          amount: Math.abs(targetRem.amount),
          currency: targetRem.currency,
          amountInTRY: Math.abs(targetRem.amountInTRY),
          category: targetRem.category,
          tags: targetRem.tags,
          date: paidDate,
          notes: targetRem.notes ? `${targetRem.notes} (Takvim ödemesi)` : 'Takvim hatırlatmasından ödendi',
        };

        const paidReminder: PaymentReminder = {
          ...targetRem,
          status: 'paid',
          paidAt: paidDate,
          paidExpenseId: newExpId,
        };

        let nextReminder: PaymentReminder | null = null;
        if (targetRem.recurrence !== 'once') {
          nextReminder = {
            ...targetRem,
            id: `rem-${crypto.randomUUID()}`,
            dueDate: computeNextDueDate(targetRem.dueDate, targetRem.recurrence),
            status: 'pending',
            paidAt: undefined,
            paidExpenseId: undefined,
          };
        }

        if (env.DB) {
          const stmts: D1PreparedStatement[] = [
            env.DB.prepare(
              `INSERT INTO expenses (id, user_id, title, amount, currency, amount_in_try, category, tags, date, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              createdExpense.id,
              userId,
              createdExpense.title,
              createdExpense.amount,
              createdExpense.currency,
              createdExpense.amountInTRY,
              createdExpense.category,
              JSON.stringify(createdExpense.tags),
              createdExpense.date,
              createdExpense.notes
            ),
            env.DB.prepare(
              `UPDATE payment_reminders SET status = 'paid', paid_at = ?, paid_expense_id = ? WHERE id = ? AND user_id = ?`
            ).bind(paidDate, newExpId, id, userId),
          ];
          if (nextReminder) {
            stmts.push(
              env.DB.prepare(
                `INSERT INTO payment_reminders (id, user_id, title, amount, currency, amount_in_try, category, tags, due_date, recurrence, status, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
              ).bind(
                nextReminder.id,
                userId,
                nextReminder.title,
                nextReminder.amount,
                nextReminder.currency,
                nextReminder.amountInTRY,
                nextReminder.category,
                JSON.stringify(nextReminder.tags),
                nextReminder.dueDate,
                nextReminder.recurrence,
                nextReminder.notes || ''
              )
            );
          }
          await env.DB.batch(stmts);
        } else {
          const expList = memoryExpenses.get(userId) || [];
          memoryExpenses.set(userId, [createdExpense, ...expList]);
          const remList = memoryReminders.get(userId) || [];
          const nextList = remList.map((r) => (r.id === id ? paidReminder : r));
          if (nextReminder) nextList.unshift(nextReminder);
          memoryReminders.set(userId, nextList);
        }

        return Response.json(
          { ok: true, paidReminder, createdExpense, nextReminder },
          { headers: corsHeaders }
        );
      }

      // PUT /api/reminders/:id
      if (url.pathname.startsWith('/api/reminders/') && request.method === 'PUT') {
        const id = url.pathname.split('/').pop() || '';
        const body = (await request.json()) as Record<string, unknown>;
        const title = String(body.title || '').trim();
        const amount = Math.abs(Number(body.amount || 0));
        const currency = (['TRY', 'USD', 'EUR', 'GBP'].includes(String(body.currency || 'TRY').toUpperCase())
          ? String(body.currency || 'TRY').toUpperCase()
          : 'TRY') as PaymentReminder['currency'];
        const amountInTRY = Math.abs(Number(body.amountInTRY ?? amount));
        const category = normalizeCategory(String(body.category || 'Fatura & Abonelik'));
        const tags = normalizeTagList(Array.isArray(body.tags) ? (body.tags as string[]) : []);
        const dueDate = String(body.dueDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
        const recurrence = normalizeRecurrence(String(body.recurrence || 'once'));
        const status = normalizeReminderStatus(String(body.status || 'pending'));
        const notes = String(body.notes || '').trim();

        const reminderObj: PaymentReminder = {
          id,
          userId,
          title,
          amount,
          currency,
          amountInTRY,
          category,
          tags: tags.length > 0 ? tags : ['#planli'],
          dueDate,
          recurrence,
          status,
          notes,
        };

        if (env.DB) {
          await env.DB.prepare(
            `UPDATE payment_reminders
             SET title = ?, amount = ?, currency = ?, amount_in_try = ?, category = ?, tags = ?, due_date = ?, recurrence = ?, status = ?, notes = ?
             WHERE id = ? AND user_id = ?`
          )
            .bind(
              title,
              amount,
              currency,
              amountInTRY,
              category,
              JSON.stringify(reminderObj.tags),
              dueDate,
              recurrence,
              status,
              notes,
              id,
              userId
            )
            .run();
        } else {
          const list = memoryReminders.get(userId) || [];
          memoryReminders.set(
            userId,
            list.map((r) => (r.id === id ? { ...r, ...reminderObj } : r))
          );
        }

        return Response.json({ ok: true, reminder: reminderObj }, { headers: corsHeaders });
      }

      // DELETE /api/reminders/:id
      if (url.pathname.startsWith('/api/reminders/') && request.method === 'DELETE') {
        const id = url.pathname.split('/').pop() || '';
        if (env.DB) {
          await env.DB.prepare('DELETE FROM payment_reminders WHERE id = ? AND user_id = ?')
            .bind(id, userId)
            .run();
        } else {
          const list = memoryReminders.get(userId) || [];
          memoryReminders.set(
            userId,
            list.filter((r) => r.id !== id)
          );
        }
        return Response.json({ ok: true }, { headers: corsHeaders });
      }

      // POST /api/ai/extract
      if (url.pathname === '/api/ai/extract' && request.method === 'POST') {
        const routeStart = Date.now();
        const body = (await request.json()) as {
          files?: { mimeType: string; data: string; name?: string }[];
          existingTags?: string[];
          textPrompt?: string;
        };

        const candidateKeys = await getCandidateApiKeys(env, request, userId);
        if (candidateKeys.length === 0) {
          return Response.json(
            {
              error:
                "Tanımlı bir Gemini API anahtarı bulunamadı. Lütfen AI Studio 'Settings > Secrets' panelinden GEMINI_API_KEY anahtarınızı seçin veya üstteki API Anahtarı alanından ücretsiz Gemini API anahtarınızı hesabınıza kaydedin.",
            },
            { status: 400, headers: corsHeaders }
          );
        }

        const parts: Record<string, unknown>[] = [];
        for (const f of body.files || []) {
          parts.push({
            inlineData: {
              mimeType: f.mimeType,
              data: f.data,
            },
          });
        }
        const today = new Date().toISOString().slice(0, 10);
        parts.push({
          text: `Mevcut kullanıcı etiket havuzu: ${(body.existingTags || []).join(', ')}. Bugünün tarihi: ${today}. ${body.textPrompt || 'Belgedeki tüm harcamaları kurallara göre çıkar.'}`,
        });

        let responseText = '';
        try {
          responseText = await generateGeminiContentWithFallback(candidateKeys, {
            parts,
            systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
            timeoutMs: GEMINI_MEDIA_TIMEOUT_MS,
            operationLabel: 'extract-statement',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                detectedBank: { type: Type.STRING },
                summaryNote: { type: Type.STRING },
                expenses: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      amount: { type: Type.NUMBER },
                      currency: { type: Type.STRING },
                      amountInTRY: { type: Type.NUMBER },
                      category: { type: Type.STRING, enum: FIXED_CATEGORIES },
                      tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                      date: { type: Type.STRING },
                      notes: { type: Type.STRING },
                    },
                    required: ['title', 'amount', 'currency', 'amountInTRY', 'category', 'tags', 'date'],
                  },
                },
              },
              required: ['expenses'],
            },
          });
        } catch (lastError) {
          const durationMs = Date.now() - routeStart;
          console.error(`[SpenTrack Perf] POST /api/ai/extract FAILED in ${durationMs}ms`);
          const formatted = formatGeminiErrorMessage(lastError);
          return Response.json(
            { error: formatted.message },
            {
              status: formatted.status,
              headers: {
                ...corsHeaders,
                'X-Response-Time-Ms': String(durationMs),
                'Server-Timing': `extract;dur=${durationMs}`,
              },
            }
          );
        }

        const parsed = parseGeminiJsonSafe(responseText || '{}');
        const rawExpenses = Array.isArray(parsed.expenses)
          ? parsed.expenses
          : Array.isArray(parsed.proposedExpenses)
          ? parsed.proposedExpenses
          : [];
        const normalizedExpenses: ExtractedExpense[] = (rawExpenses as Record<string, unknown>[])
          .map((item: Record<string, unknown>) => ({
            title: String(item.title || 'Harcama').trim(),
            amount: parseTurkishAmount(item.amount as number | string),
            currency: (['TRY', 'USD', 'EUR', 'GBP'].includes(String(item.currency))
              ? item.currency
              : 'TRY') as ExtractedExpense['currency'],
            amountInTRY: parseTurkishAmount((item.amountInTRY ?? item.amount) as number | string),
            category: normalizeCategory(String(item.category || 'Diğer')),
            tags: normalizeTagList(Array.isArray(item.tags) ? (item.tags as string[]) : []),
            date: String(item.date || today).slice(0, 10),
            notes: String(item.notes || '').trim(),
          }))
          .filter((item) => item.amount !== 0);

        const durationMs = Date.now() - routeStart;
        console.info(
          `[SpenTrack Perf] POST /api/ai/extract OK | files=${(body.files || []).length} items=${normalizedExpenses.length} durationMs=${durationMs}ms`
        );

        return Response.json(
          {
            detectedBank: parsed.detectedBank || '',
            summaryNote: parsed.summaryNote || `${normalizedExpenses.length} işlem tespit edildi.`,
            expenses: normalizedExpenses,
          },
          {
            headers: {
              ...corsHeaders,
              'X-Response-Time-Ms': String(durationMs),
              'Server-Timing': `extract;dur=${durationMs}`,
            },
          }
        );
      }

      // POST /api/ai/chat
      if (url.pathname === '/api/ai/chat' && request.method === 'POST') {
        const routeStart = Date.now();
        const today = new Date().toISOString().slice(0, 10);
        const body = (await request.json()) as {
          message?: string;
          files?: { mimeType: string; data: string; name?: string }[];
          existingExpenses?: {
            title: string;
            amount: number;
            amountInTRY: number;
            category: string;
            tags: string[];
            date: string;
            notes?: string;
          }[];
          existingReminders?: PaymentReminder[];
          existingTags?: string[];
        };

        const message = body.message || '';
        const files = body.files || [];
        const existingExpenses = body.existingExpenses || [];
        const existingReminders = body.existingReminders || [];
        const existingTags = body.existingTags || [];

        if (files.length === 0 && message.trim()) {
          const instantReminder = parseInstantReminderMessage(message, existingReminders, today);
          if (instantReminder.handled) {
            const durationMs = Date.now() - routeStart;
            console.info(
              `[SpenTrack Perf] POST /api/ai/chat OK (instant-reminder-nlp) | reminders=${instantReminder.proposedReminders.length} durationMs=${durationMs}ms`
            );
            return Response.json(
              {
                reply: instantReminder.reply,
                proposedExpenses: [],
                proposedReminders: instantReminder.proposedReminders,
                analysisHighlight: instantReminder.analysisHighlight,
              },
              {
                headers: {
                  ...corsHeaders,
                  'X-Response-Time-Ms': String(durationMs),
                  'Server-Timing': `instant_reminder_nlp;dur=${durationMs}`,
                },
              }
            );
          }

          const instant = parseInstantAssistantMessage(message, existingExpenses, today);
          if (instant.handled) {
            const durationMs = Date.now() - routeStart;
            console.info(
              `[SpenTrack Perf] POST /api/ai/chat OK (instant-nlp) | items=${instant.proposedExpenses.length} durationMs=${durationMs}ms`
            );
            return Response.json(
              {
                reply: instant.reply,
                proposedExpenses: instant.proposedExpenses,
                proposedReminders: [],
                analysisHighlight: instant.analysisHighlight,
              },
              {
                headers: {
                  ...corsHeaders,
                  'X-Response-Time-Ms': String(durationMs),
                  'Server-Timing': `instant_nlp;dur=${durationMs}`,
                },
              }
            );
          }
        }

        const candidateKeys = await getCandidateApiKeys(env, request, userId);

        if (candidateKeys.length === 0 && files.length === 0) {
          const fallback = fallbackNaturalLanguageAssist(message, existingExpenses, today);
          const durationMs = Date.now() - routeStart;
          return Response.json(
            { ...fallback, proposedReminders: [] },
            {
              headers: {
                ...corsHeaders,
                'X-Response-Time-Ms': String(durationMs),
              },
            }
          );
        }

        if (candidateKeys.length === 0) {
          return Response.json(
            {
              error:
                "Dosya analizi için Gemini API anahtarı gereklidir. Lütfen AI Studio 'Settings > Secrets' panelinden GEMINI_API_KEY anahtarınızı seçin veya ücretsiz Gemini API anahtarınızı hesabınıza kaydedin.",
            },
            { status: 400, headers: corsHeaders }
          );
        }

        try {
          const parts: Record<string, unknown>[] = [];
          for (const f of files) {
            if (f?.mimeType && f?.data) {
              parts.push({
                inlineData: {
                  mimeType: f.mimeType,
                  data: f.data,
                },
              });
            }
          }

          if (files.length > 0) {
            parts.push({
              text: `Bugünün tarihi: ${today}. Mevcut #etiket havuzu: ${existingTags.slice(0, 30).join(', ')}.
Kullanıcı mesajı / notu: "${message || 'Görseldeki harcamaları çıkar.'}"
ÖNEMLİ: Görseldeki fiş, dekont veya ekran görüntüsündeki harcama tutarını ve tarihini hızlıca çıkar. Eğer kullanıcı mesajında özel bir başlık (örn: site yönetimi, market adı vb.) veya #etiket (örn: #aidat) belirttiyse doğrudan o başlığı ve etiketi kullan.`,
            });
          } else {
            const compactLedger = existingExpenses.slice(0, 120).map((e) => ({
              date: e.date,
              title: e.title,
              amountInTRY: e.amountInTRY,
              category: e.category,
              tags: e.tags,
              notes: e.notes,
            }));
            const compactReminders = existingReminders.slice(0, 60).map((r) => ({
              title: r.title,
              amountInTRY: r.amountInTRY,
              dueDate: r.dueDate,
              status: r.status,
              recurrence: r.recurrence,
              category: r.category,
            }));

            parts.push({
              text: `Bugünün tarihi: ${today}
Kullanıcının mevcut #etiket havuzu: ${existingTags.join(', ')}
Kullanıcının mevcut harcama kayıtları (JSON):
${JSON.stringify(compactLedger)}
Kullanıcının mevcut ödeme hatırlatmaları (JSON):
${JSON.stringify(compactReminders)}

Kullanıcı mesajı: "${message}"`,
            });
          }

          let responseText = '';
          try {
            responseText = await generateGeminiContentWithFallback(candidateKeys, {
              parts,
              systemInstruction:
                files.length > 0
                  ? EXTRACTION_SYSTEM_INSTRUCTION
                  : `${CHAT_SYSTEM_INSTRUCTION}\n\n${EXTRACTION_SYSTEM_INSTRUCTION}`,
              timeoutMs: files.length > 0 ? GEMINI_MEDIA_TIMEOUT_MS : GEMINI_TEXT_TIMEOUT_MS,
              operationLabel: files.length > 0 ? 'assistant-media-chat' : 'assistant-text-chat',
            });
          } catch (lastError) {
            const durationMs = Date.now() - routeStart;
            if (files.length === 0) {
              console.warn(
                `[SpenTrack Perf] POST /api/ai/chat Gemini failed after ${durationMs}ms, using local NLP fallback`
              );
              const fallback = fallbackNaturalLanguageAssist(message, existingExpenses, today);
              return Response.json(
                { ...fallback, proposedReminders: [] },
                {
                  headers: {
                    ...corsHeaders,
                    'X-Response-Time-Ms': String(durationMs),
                  },
                }
              );
            }
            const formatted = formatGeminiErrorMessage(lastError);
            return Response.json(
              { error: formatted.message },
              {
                status: formatted.status,
                headers: {
                  ...corsHeaders,
                  'X-Response-Time-Ms': String(durationMs),
                },
              }
            );
          }

          const parsed = parseGeminiJsonSafe(responseText || '{}');
          const userDraft = files.length > 0 && message.trim() ? buildDraftExpenseFromPrompt(message, today) : null;
          const rawList: Record<string, unknown>[] = Array.isArray(parsed.proposedExpenses)
            ? parsed.proposedExpenses
            : Array.isArray(parsed.expenses)
            ? (parsed.expenses as Record<string, unknown>[])
            : [];
          const normalizedExpenses: ExtractedExpense[] = rawList
            .map((item: Record<string, unknown>) => {
              const rawTitle = String(item.title || '').trim();
              const finalTitle =
                userDraft && rawList.length === 1 && userDraft.title !== 'Görsel Harcaması'
                  ? userDraft.title
                  : rawTitle || userDraft?.title || 'Harcama';
              const mergedTags = normalizeTagList([
                ...(Array.isArray(item.tags) ? (item.tags as string[]) : []),
                ...(userDraft ? userDraft.tags.filter((t) => t !== '#genel') : []),
              ]);
              const finalCategory =
                userDraft && userDraft.category !== 'Diğer'
                  ? userDraft.category
                  : normalizeCategory(String(item.category || finalTitle || 'Diğer'));

              return {
                title: finalTitle,
                amount: parseTurkishAmount(item.amount as number | string),
                currency: (['TRY', 'USD', 'EUR', 'GBP'].includes(String(item.currency))
                  ? item.currency
                  : 'TRY') as ExtractedExpense['currency'],
                amountInTRY: parseTurkishAmount((item.amountInTRY ?? item.amount) as number | string),
                category: finalCategory,
                tags: mergedTags.length > 0 ? mergedTags : ['#genel'],
                date: String(item.date || today).slice(0, 10),
                notes: String(item.notes || '').trim(),
              };
            })
            .filter((item) => item.amount !== 0);

          const rawReminders: Record<string, unknown>[] = Array.isArray(parsed.proposedReminders)
            ? parsed.proposedReminders
            : [];
          const normalizedReminders: ExtractedReminder[] = rawReminders
            .map((item: Record<string, unknown>) => {
              const title = String(item.title || 'Planlanan Ödeme').trim();
              const amt = Math.abs(parseTurkishAmount((item.amount ?? 0) as number | string));
              const amtTRY = Math.abs(parseTurkishAmount((item.amountInTRY ?? amt) as number | string));
              const curr = (['TRY', 'USD', 'EUR', 'GBP'].includes(String(item.currency || 'TRY').toUpperCase())
                ? String(item.currency || 'TRY').toUpperCase()
                : 'TRY') as ExtractedReminder['currency'];
              const tags = normalizeTagList(Array.isArray(item.tags) ? (item.tags as string[]) : ['#planli']);
              return {
                title,
                amount: amt,
                currency: curr,
                amountInTRY: amtTRY || amt,
                category: normalizeCategory(String(item.category || `${title} Fatura`)),
                tags: tags.length > 0 ? tags : ['#planli'],
                dueDate:
                  typeof item.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)
                    ? item.dueDate
                    : today,
                recurrence: normalizeRecurrence(String(item.recurrence || 'once')),
                notes: String(item.notes || '').trim(),
              };
            })
            .filter((r) => r.title.length > 0);

          const durationMs = Date.now() - routeStart;
          console.info(
            `[SpenTrack Perf] POST /api/ai/chat OK (gemini) | files=${files.length} items=${normalizedExpenses.length} reminders=${normalizedReminders.length} durationMs=${durationMs}ms`
          );

          return Response.json(
            {
              reply: parsed.reply || 'İşlem tamamlandı.',
              proposedExpenses: normalizedExpenses,
              proposedReminders: normalizedReminders,
              analysisHighlight: parsed.analysisHighlight,
            },
            {
              headers: {
                ...corsHeaders,
                'X-Response-Time-Ms': String(durationMs),
                'Server-Timing': `chat;dur=${durationMs}`,
              },
            }
          );
        } catch (err) {
          const durationMs = Date.now() - routeStart;
          if (files.length === 0) {
            const fallback = fallbackNaturalLanguageAssist(message, existingExpenses, today);
            return Response.json(
              { ...fallback, proposedReminders: [] },
              {
                headers: {
                  ...corsHeaders,
                  'X-Response-Time-Ms': String(durationMs),
                },
              }
            );
          }
          const formatted = formatGeminiErrorMessage(err);
          return Response.json(
            { error: formatted.message },
            {
              status: formatted.status,
              headers: {
                ...corsHeaders,
                'X-Response-Time-Ms': String(durationMs),
              },
            }
          );
        }
      }

      return Response.json({ error: 'Not Found' }, { status: 404, headers: corsHeaders });
    } catch (err: unknown) {
      const formatted = formatGeminiErrorMessage(err);
      return Response.json(
        { error: formatted.message },
        { status: formatted.status, headers: corsHeaders }
      );
    }
  },
};
