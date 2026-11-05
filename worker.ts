/**
 * SpenTrack — Cloudflare Workers + D1 Production Backend
 * Supports D1 db.batch() for multi-row statement & profile sync inserts,
 * CRUD endpoints, and server-side @google/genai Structured Outputs for extraction & chat.
 */
import { GoogleGenAI, Type } from '@google/genai';
import {
  normalizeCategory,
  normalizeTagList,
  parseTurkishAmount,
} from './src/utils/expenseLogic';
import { ExpenseCategory, ExtractedExpense } from './src/types';
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

const EXTRACTION_SYSTEM_INSTRUCTION = `Sen "SpenTrack" adlı Türkiye odaklı finans ve harcama takip sisteminin uzman finansal belge ayrıştırıcısısın.
Görevin: Kullanıcının yüklediği fiş fotoğrafı, mobil bankacılık ekran görüntüsü veya çok sayfalı PDF kredi kartı ekstresindeki TÜM geçerli harcama ve iade satırlarını eksiksiz ayıklamaktır.

KRİTİK TÜRKİYE BANKACILIK VE EKSTRE KURALLARI:
1. BANKA TANIMA: Görselin veya PDF ekstresinin hangi bankaya/karta ait olduğunu başlıktan, logodan veya arayüzden tespit et ve TÜM satırlara ilgili banka etiketini otomatik ekle:
   - Yapı Kredi / World -> "#yapikredi"
   - Kuveyt Türk / Sağlam Kart -> "#saglamkart", "#kuveytturk"
   - Garanti BBVA / Bonus -> "#garanti"
   - Enpara.com -> "#enpara"
   - İş Bankası / Maximum -> "#isbankasi"
   - Akbank / Axess -> "#akbank"
2. TUZAK SATIRLARI KESİNLİKLE YOK SAY:
   - "Önceki Dönem Bakiyesi", "Dönem Borcu Ödemesi", "Teşekkür Ederiz", "Hesaptan Aktarım", "Otomatik Ödeme Tahsilatı", "Kazanılan Worldpuan / Altın Puan / Bonus", "Toplam Dönem Borcu", "Asgari Ödeme Tutarı" gibi ödeme/bilgi satırlarını KESİNLİKLE harcama olarak alma!
3. TAKSİTLİ İŞLEMLER:
   - Taksitli işlemlerde (örn: "2/6 Taksit", "3/9 Taksit") toplam alışveriş borcunu değil, SADECE o döneme yansıyan taksit tutarını "amount" olarak al.
   - Etiketlere "#taksit" ekle ve "notes" alanına kaçıncı taksit olduğunu (örn: "2/6 Taksit") yaz.
4. İADE VE İPTALLER:
   - İade, iptal veya alacak ("-" veya "+" ile gösterilen iade) satırlarında tutarı negatif ("-amount", örn: -350.00) olarak çıkar ve etiketlere "#iade" ekle.
5. TÜRKİYE PARA FORMATI:
   - "1.250,50 TL" gibi tutarları noktadan arındırıp virgülü ondalık noktaya çevirerek 1250.50 (NUMBER) olarak döndür.
6. SABİT KATEGORİLER:
   - "category" alanı SADECE şu 8 değerden biri olabilir: "Market", "Yeme-İçme", "Ulaşım", "Fatura & Abonelik", "Alışveriş", "Eğlence", "Sağlık", "Diğer".
7. ETİKET TUTARLILIĞI:
   - Kullanıcının mevcut #etiket havuzundaki etiketleri önceliklendir. Tüm etiketler "#" ile başlamalı ve küçük harf olmalıdır (örn: "#migros", "#kahve").`;

const CHAT_SYSTEM_INSTRUCTION = `Sen "SpenTrack Asistan" adında, Türkçe konuşan, hızlı, yalın ve net bir kişisel harcama & ekstre asistanısın.
Kullanıcı sana iki tür istekte bulunabilir:
1. HARCAMA EKLEME İSTEĞİ:
   Örn: "Bugün Sağlam Kart ile 220 TL kahve, 1450 TL market harcadım" veya ekte fiş/ekstre görseli/PDF göndermek.
   - Bu durumda metindeki veya dosyadaki tüm harcamaları ayıkla ve "proposedExpenses" dizisine ekle.
   - Kart/banka adı geçiyorsa (#saglamkart, #yapikredi, #kuveytturk, #garanti, #enpara, #nakit) otomatik etiketle.
   - Taksit varsa SADECE dönem taksit tutarını yaz, #taksit etiketi ekle ve notes kısmına "2/6 Taksit" gibi yaz.
   - İade varsa tutarı eksi (-amount) yap ve #iade etiketi ekle.
   - "reply" alanında kullanıcıya tespit ettiğin harcamaları kısaca özetle ve aşağıdaki onay kartından kaydedebileceğini söyle.

2. SORU & HARCAMA ANALİZİ:
   Örn: "Bu ay #yapikredi etiketine veya dışarıda yemeye toplam ne kadar harcadım?"
   - Sana verilen mevcut harcama özetini ve listesini dikkatle hesapla.
   - Rakamları kuruşuna kadar doğru topla, iadeleri düş ve çok net, okunaklı bir Türkçe yanıt ("reply") üret.
   - Eğer bir soru/analiz yanıtlıyorsan ve yeni harcama eklenmiyorsa "proposedExpenses" dizisini boş ([]) bırak ve "analysisHighlight" alanını doldur.`;

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
  } else {
    const aqMatch = cleaned.match(/AQ[0-9A-Za-z_.-]{20,}/);
    if (aqMatch) {
      cleaned = aqMatch[0];
    }
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

        if (cleanedHeaderKey && !row?.gemini_api_key) {
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
    if (cleanedHeaderKey && !memoryUserKeys.get(userId)) {
      memoryUserKeys.set(userId, cleanedHeaderKey);
    }
  }

  if (env.DB) {
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

function formatGeminiErrorMessage(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err || 'Belge analiz edilirken hata oluştu.');
  if (raw.includes('API_KEY_INVALID') || raw.includes('API key not valid')) {
    return {
      status: 400,
      message:
        "Girilen Gemini API anahtarı Google tarafından reddedildi (API_KEY_INVALID). Lütfen https://aistudio.google.com/apikey adresinden geçerli ('AIza...' veya 'AQ...' ile başlayan) anahtarınızı kontrol edip eksiksiz kopyaladığınızdan emin olun.",
    };
  }
  return { status: 500, message: raw };
}

async function generateGeminiContentWithFallback(
  candidateKeys: string[],
  params: {
    parts: Record<string, unknown>[];
    systemInstruction: string;
    responseSchema: Record<string, unknown>;
  }
): Promise<string> {
  let lastError: unknown = null;

  for (const apiKey of candidateKeys) {
    // Both classic 'AIza...' and modern Google AI Studio 'AQ...' user keys
    // must be called WITHOUT 'User-Agent: aistudio-build' first so they connect directly to Google GenAI.
    const clientConfigs = [
      {
        httpOptions: undefined,
        models: ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash'],
      },
      {
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        models: ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'],
      },
    ];

    for (const cfg of clientConfigs) {
      const ai = new GoogleGenAI(
        cfg.httpOptions ? { apiKey, httpOptions: cfg.httpOptions } : { apiKey }
      );

      for (const modelName of cfg.models) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: { parts: params.parts },
            config: {
              systemInstruction: params.systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: params.responseSchema,
            },
          });

          const text = (response.text || '{}').trim();
          if (text) {
            return text;
          }
        } catch (err) {
          lastError = err;
          const msg = err instanceof Error ? err.message : String(err || '');
          if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
            break;
          }
        }
      }
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
  const lower = message.toLowerCase();
  const isQuestion =
    lower.includes('ne kadar') ||
    lower.includes('toplam') ||
    lower.includes('kaç tl') ||
    lower.includes('analiz') ||
    lower.includes('özet') ||
    lower.includes('?');

  const detectedBankTags: string[] = [];
  if (/sağlam\s*kart|saglam\s*kart|saglamkart/.test(lower)) detectedBankTags.push('#saglamkart');
  if (/kuveyt\s*türk|kuveytturk/.test(lower)) detectedBankTags.push('#kuveytturk');
  if (/yapı\s*kredi|yapikredi|world/.test(lower)) detectedBankTags.push('#yapikredi');
  if (/garanti|bonus/.test(lower)) detectedBankTags.push('#garanti');
  if (/enpara/.test(lower)) detectedBankTags.push('#enpara');
  if (/nakit/.test(lower)) detectedBankTags.push('#nakit');

  if (isQuestion) {
    const tagMatches = message.match(/#[a-zA-Z0-9_çğıöşüÇĞİÖŞÜ-]+/g) || [];
    const normalizedQueryTags = [
      ...tagMatches.map((t) =>
        t
          .toLowerCase()
          .replace(/ç/g, 'c')
          .replace(/ğ/g, 'g')
          .replace(/ı/g, 'i')
          .replace(/ö/g, 'o')
          .replace(/ş/g, 's')
          .replace(/ü/g, 'u')
      ),
      ...detectedBankTags,
    ];

    let matchedCategory: string | null = null;
    if (/dışarıda\s*yeme|yeme|içme|kahve|restoran/.test(lower)) matchedCategory = 'Yeme-İçme';
    else if (/market|mutfak/.test(lower)) matchedCategory = 'Market';
    else if (/ulaşım|akaryakıt|benzin|taksi/.test(lower)) matchedCategory = 'Ulaşım';
    else if (/fatura|abonelik/.test(lower)) matchedCategory = 'Fatura & Abonelik';
    else if (/alışveriş|giyim|elektronik/.test(lower)) matchedCategory = 'Alışveriş';
    else if (/sağlık|eczane/.test(lower)) matchedCategory = 'Sağlık';

    const filtered = existingExpenses.filter((e) => {
      const tagHit =
        normalizedQueryTags.length > 0 &&
        normalizedQueryTags.some((qt) => e.tags.map((x) => x.toLowerCase()).includes(qt));
      const catHit = matchedCategory && e.category === matchedCategory;
      if (normalizedQueryTags.length > 0 && matchedCategory) return tagHit || catHit;
      if (normalizedQueryTags.length > 0) return tagHit;
      if (matchedCategory) return catHit;
      return true;
    });

    const totalTRY =
      Math.round(filtered.reduce((sum, item) => sum + Number(item.amountInTRY || 0), 0) * 100) / 100;
    const labelParts: string[] = [];
    if (normalizedQueryTags.length > 0) labelParts.push(normalizedQueryTags.join(', '));
    if (matchedCategory) labelParts.push(matchedCategory);
    const label = labelParts.length > 0 ? labelParts.join(' / ') : 'Tüm Harcamalar';

    return {
      reply: `${label} kapsamında toplam ${filtered.length} işlem bulundu. İadeler düşüldükten sonra net harcama tutarınız ${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 }).format(totalTRY)} ₺'dir.`,
      proposedExpenses: [],
      analysisHighlight: {
        label,
        totalTRY,
        count: filtered.length,
      },
    };
  }

  const proposed: ExtractedExpense[] = [];
  const clauses = message.split(/[,;]+|\bve\b/i);

  for (const clause of clauses) {
    const amountMatch = clause.match(/(-?\d+(?:[.,]\d+)?)\s*(?:tl|₺|lira|usd|\$|eur|€)?/i);
    if (!amountMatch) continue;
    const rawNum = parseTurkishAmount(amountMatch[1]);
    if (!rawNum || rawNum === 0) continue;

    const cleanDesc = clause
      .replace(amountMatch[0], ' ')
      .replace(
        /\b(bugün|dün|ile|harcadım|aldım|ödedim|sağlam\s*kart|saglam\s*kart|yapı\s*kredi|garanti|enpara|kuveyt\s*türk|tl|lira)\b/gi,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim();

    const title = cleanDesc ? cleanDesc.charAt(0).toUpperCase() + cleanDesc.slice(1) : 'Harcama';
    const category: ExpenseCategory = normalizeCategory(title);
    const itemTags = [...detectedBankTags];
    if (/kahve|starbucks|espresso/i.test(title)) itemTags.push('#kahve');
    if (/market|migros|bim|a101/i.test(title)) itemTags.push('#market');
    if (/iade/i.test(clause)) itemTags.push('#iade');

    const finalAmount = /iade/i.test(clause) && rawNum > 0 ? -rawNum : rawNum;

    proposed.push({
      title,
      amount: finalAmount,
      currency: 'TRY',
      amountInTRY: finalAmount,
      category,
      tags: normalizeTagList(itemTags.length > 0 ? itemTags : ['#genel']),
      date: today,
      notes: '',
    });
  }

  if (proposed.length > 0) {
    return {
      reply: `Mesajınızdan ${proposed.length} adet harcama tespit ettim ve ilgili etiketleri otomatik ekledim. Aşağıdaki onay kartından kontrol edip tek tıkla kaydedebilirsiniz.`,
      proposedExpenses: proposed,
    };
  }

  return {
    reply:
      'Harcama eklemek için "Bugün Sağlam Kart ile 220 TL kahve, 1450 TL market harcadım" gibi yazabilir veya harcamalarınız hakkında soru sorabilirsiniz.',
    proposedExpenses: [],
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
    schemaInitialized = true;
  } catch {
    // ignore
  }
}

export default {
  async fetch(request: Request, env: Env & { JWT_SECRET?: string }): Promise<Response> {
    const url = new URL(request.url);
    const jwtSecret = env.JWT_SECRET || WORKER_JWT_SECRET;

    let userId = request.headers.get('x-user-id') || 'default_user';
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const verified = await verifyJwtWebCrypto(authHeader.slice(7).trim(), jwtSecret);
      if (verified && typeof verified.sub === 'string' && verified.sub.trim()) {
        userId = verified.sub.trim();
      }
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-custom-gemini-key',
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
          return Response.json({ jsonrpc: '2.0' }, { headers: corsHeaders });
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
          return Response.json(
            { expenses: memoryExpenses.get(userId) || [] },
            { headers: corsHeaders }
          );
        }

        const { results } = await env.DB.prepare(
          'SELECT * FROM expenses WHERE user_id = ? ORDER BY date DESC, created_at DESC'
        )
          .bind(userId)
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

        return Response.json({ expenses: mapped }, { headers: corsHeaders });
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

      // POST /api/ai/extract
      if (url.pathname === '/api/ai/extract' && request.method === 'POST') {
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
          const formatted = formatGeminiErrorMessage(lastError);
          return Response.json(
            { error: formatted.message },
            { status: formatted.status, headers: corsHeaders }
          );
        }

        const parsed = JSON.parse(responseText || '{}');
        const normalizedExpenses: ExtractedExpense[] = (parsed.expenses || []).map(
          (item: Record<string, unknown>) => ({
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
          })
        );

        return Response.json(
          {
            detectedBank: parsed.detectedBank || '',
            summaryNote: parsed.summaryNote || `${normalizedExpenses.length} işlem tespit edildi.`,
            expenses: normalizedExpenses,
          },
          { headers: corsHeaders }
        );
      }

      // POST /api/ai/chat
      if (url.pathname === '/api/ai/chat' && request.method === 'POST') {
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
          existingTags?: string[];
        };

        const message = body.message || '';
        const files = body.files || [];
        const existingExpenses = body.existingExpenses || [];
        const existingTags = body.existingTags || [];

        const candidateKeys = await getCandidateApiKeys(env, request, userId);

        if (candidateKeys.length === 0 && files.length === 0) {
          const fallback = fallbackNaturalLanguageAssist(message, existingExpenses, today);
          return Response.json(fallback, { headers: corsHeaders });
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

          const compactLedger = existingExpenses.slice(0, 200).map((e) => ({
            date: e.date,
            title: e.title,
            amountInTRY: e.amountInTRY,
            category: e.category,
            tags: e.tags,
            notes: e.notes,
          }));

          parts.push({
            text: `Bugünün tarihi: ${today}
Kullanıcının mevcut #etiket havuzu: ${existingTags.join(', ')}
Kullanıcının mevcut harcama kayıtları (JSON):
${JSON.stringify(compactLedger)}

Kullanıcı mesajı: "${message}"`,
          });

          let responseText = '';
          try {
            responseText = await generateGeminiContentWithFallback(candidateKeys, {
              parts,
              systemInstruction: `${CHAT_SYSTEM_INSTRUCTION}\n\n${EXTRACTION_SYSTEM_INSTRUCTION}`,
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  reply: { type: Type.STRING },
                  proposedExpenses: {
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
                  analysisHighlight: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      totalTRY: { type: Type.NUMBER },
                      count: { type: Type.NUMBER },
                    },
                  },
                },
                required: ['reply', 'proposedExpenses'],
              },
            });
          } catch (lastError) {
            if (files.length === 0) {
              const fallback = fallbackNaturalLanguageAssist(message, existingExpenses, today);
              return Response.json(fallback, { headers: corsHeaders });
            }
            const formatted = formatGeminiErrorMessage(lastError);
            return Response.json(
              { error: formatted.message },
              { status: formatted.status, headers: corsHeaders }
            );
          }

          const parsed = JSON.parse(responseText || '{}');
          const normalizedExpenses: ExtractedExpense[] = (parsed.proposedExpenses || []).map(
            (item: Record<string, unknown>) => ({
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
            })
          );

          return Response.json(
            {
              reply: parsed.reply || 'İşlem tamamlandı.',
              proposedExpenses: normalizedExpenses,
              analysisHighlight: parsed.analysisHighlight,
            },
            { headers: corsHeaders }
          );
        } catch (err) {
          if (files.length === 0) {
            const fallback = fallbackNaturalLanguageAssist(message, existingExpenses, today);
            return Response.json(fallback, { headers: corsHeaders });
          }
          const formatted = formatGeminiErrorMessage(err);
          return Response.json(
            { error: formatted.message },
            { status: formatted.status, headers: corsHeaders }
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
