import 'dotenv/config';
import http from 'http';
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import {
  FIXED_CATEGORIES,
  ExtractedExpense,
  ExpenseCategory,
} from './src/types';
import {
  normalizeCategory,
  normalizeTagList,
  parseTurkishAmount,
} from './src/utils/expenseLogic';
import {
  SPENTRACK_MCP_TOOLS,
  buildMcpServerInfo,
  convertToTRY,
} from './src/utils/mcpCore';

const PORT = 3000;
const LEGACY_TMP_DB_PATH = '/tmp/spentrack.sqlite';
const DB_PATH = path.resolve(process.cwd(), 'spentrack.sqlite');
if (!fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_TMP_DB_PATH)) {
  try {
    fs.copyFileSync(LEGACY_TMP_DB_PATH, DB_PATH);
  } catch {
    // ignore copy error
  }
}
const db = new Database(DB_PATH);

// Initialize schema from schema.sql
const schemaPath = path.resolve(process.cwd(), 'schema.sql');
if (fs.existsSync(schemaPath)) {
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schemaSql);
}
try {
  db.exec("ALTER TABLE users ADD COLUMN gemini_api_key TEXT DEFAULT ''");
} catch {
  // Column already exists
}
try {
  db.exec("ALTER TABLE users ADD COLUMN bot_api_key TEXT DEFAULT ''");
} catch {
  // Column already exists
}
try {
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_bot_api_key ON users(bot_api_key)");
} catch {
  // Index already exists
}

// Seed realistic initial data for default_user if table is empty
const existingCount = db
  .prepare('SELECT COUNT(*) as cnt FROM expenses WHERE user_id = ?')
  .get('default_user') as { cnt: number };

if (existingCount.cnt === 0) {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const d = (day: number) => `${ym}-${String(Math.min(day, 28)).padStart(2, '0')}`;

  const seedItems = [
    {
      id: 'seed-1',
      title: 'Migros Ticaret A.Ş.',
      amount: 1450.5,
      currency: 'TRY',
      amountInTRY: 1450.5,
      category: 'Market',
      tags: ['#saglamkart', '#migros', '#market'],
      date: d(4),
      notes: 'Haftalık mutfak alışverişi',
    },
    {
      id: 'seed-2',
      title: 'Espressolab Moda',
      amount: 220.0,
      currency: 'TRY',
      amountInTRY: 220.0,
      category: 'Yeme-İçme',
      tags: ['#saglamkart', '#kahve'],
      date: d(4),
      notes: 'Filtre kahve & kruvasan',
    },
    {
      id: 'seed-3',
      title: 'Apple Store Türkiye',
      amount: 4250.0,
      currency: 'TRY',
      amountInTRY: 4250.0,
      category: 'Alışveriş',
      tags: ['#yapikredi', '#taksit', '#elektronik'],
      date: d(3),
      notes: '2/6 Taksit',
    },
    {
      id: 'seed-4',
      title: 'Opet Akaryakıt İstasyonu',
      amount: 1890.0,
      currency: 'TRY',
      amountInTRY: 1890.0,
      category: 'Ulaşım',
      tags: ['#yapikredi', '#akaryakit'],
      date: d(2),
      notes: 'Tam depo yakıt',
    },
    {
      id: 'seed-5',
      title: 'Zara Online İade',
      amount: -650.0,
      currency: 'TRY',
      amountInTRY: -650.0,
      category: 'Alışveriş',
      tags: ['#yapikredi', '#iade', '#giyim'],
      date: d(2),
      notes: 'Beden değişimi iadesi',
    },
    {
      id: 'seed-6',
      title: 'Netflix & Spotify Aylık',
      amount: 389.9,
      currency: 'TRY',
      amountInTRY: 389.9,
      category: 'Fatura & Abonelik',
      tags: ['#enpara', '#abonelik'],
      date: d(1),
      notes: 'Otomatik ödeme',
    },
    {
      id: 'seed-7',
      title: 'Acıbadem Eczanesi',
      amount: 410.0,
      currency: 'TRY',
      amountInTRY: 410.0,
      category: 'Sağlık',
      tags: ['#garanti', '#saglik'],
      date: d(1),
      notes: 'Vitamin takviyesi',
    },
  ];

  const insertStmt = db.prepare(
    `INSERT INTO expenses (id, user_id, title, amount, currency, amount_in_try, category, tags, date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const seedTx = db.transaction((items: typeof seedItems) => {
    for (const item of items) {
      insertStmt.run(
        item.id,
        'default_user',
        item.title,
        item.amount,
        item.currency,
        item.amountInTRY,
        item.category,
        JSON.stringify(item.tags),
        item.date,
        item.notes
      );
    }
  });
  seedTx(seedItems);
}

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

function getCandidateApiKeys(userId: string, customKey?: string): string[] {
  const candidates: string[] = [];
  const pushUnique = (val?: string | null) => {
    const clean = sanitizeGeminiApiKey(val);
    if (clean && !candidates.includes(clean)) {
      candidates.push(clean);
    }
  };

  const cleanedCustom = sanitizeGeminiApiKey(customKey);
  pushUnique(cleanedCustom);

  if (userId && userId !== 'default_user') {
    try {
      const row = db
        .prepare('SELECT gemini_api_key FROM users WHERE id = ?')
        .get(userId) as { gemini_api_key?: string } | undefined;
      pushUnique(row?.gemini_api_key);

      // If customKey was sent in header and DB has no key yet for this user, auto-persist it
      if (cleanedCustom && !row?.gemini_api_key) {
        db.prepare(
          `INSERT INTO users (id, email, name, gemini_api_key, updated_at)
           VALUES (?, '', 'Kullanıcı', ?, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET
             gemini_api_key = excluded.gemini_api_key,
             updated_at = datetime('now')`
        ).run(userId, cleanedCustom);
      }
    } catch {
      // ignore
    }
  }

  // Fallback to any saved user API key in single-user local DB if still empty
  try {
    const anyRow = db
      .prepare(
        "SELECT gemini_api_key FROM users WHERE gemini_api_key IS NOT NULL AND length(gemini_api_key) > 10 ORDER BY updated_at DESC LIMIT 1"
      )
      .get() as { gemini_api_key?: string } | undefined;
    pushUnique(anyRow?.gemini_api_key);
  } catch {
    // ignore
  }

  pushUnique(process.env.GEMINI_API_KEY);
  pushUnique(process.env.API_KEY);

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

  const ACTIVE_MODELS = [
    'gemini-3.8-flash',
    'gemini-flash-latest',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3-flash-preview',
    'gemini-flash-lite-latest',
    'gemini-4-argon',
    'gemini-2.5-flash',
  ];

  for (const apiKey of candidateKeys) {
    // Supports:
    // 1. Direct Gemini Developer API (generativelanguage.googleapis.com) for AIza... and AQ... keys
    // 2. Vertex AI Express Mode (aiplatform.googleapis.com via vertexai: true) for AQ... service keys
    // 3. AI Studio Build internal proxy (User-Agent: aistudio-build)
    const clientConfigs: Array<{
      vertexai?: boolean;
      httpOptions?: { headers: Record<string, string> };
      models: string[];
    }> = [
      {
        httpOptions: undefined,
        models: ACTIVE_MODELS,
      },
      {
        vertexai: true,
        httpOptions: undefined,
        models: ACTIVE_MODELS,
      },
      {
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        models: ACTIVE_MODELS,
      },
    ];

    for (const cfg of clientConfigs) {
      const ai = new GoogleGenAI({
        apiKey,
        ...(cfg.vertexai ? { vertexai: true } : {}),
        ...(cfg.httpOptions ? { httpOptions: cfg.httpOptions } : {}),
      });

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

/**
 * Doğal dil mesajlarından yerel/deterministik yedek ayrıştırıcı
 * (API anahtarı olmadığında veya çevrimdışı test ortamında da tam işlevsellik sağlar)
 */
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

  // Detect bank tags mentioned in message
  const detectedBankTags: string[] = [];
  if (/sağlam\s*kart|saglam\s*kart|saglamkart/.test(lower)) detectedBankTags.push('#saglamkart');
  if (/kuveyt\s*türk|kuveytturk/.test(lower)) detectedBankTags.push('#kuveytturk');
  if (/yapı\s*kredi|yapikredi|world/.test(lower)) detectedBankTags.push('#yapikredi');
  if (/garanti|bonus/.test(lower)) detectedBankTags.push('#garanti');
  if (/enpara/.test(lower)) detectedBankTags.push('#enpara');
  if (/nakit/.test(lower)) detectedBankTags.push('#nakit');

  if (isQuestion) {
    // Check if asking about a specific #tag or category
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
      if (normalizedQueryTags.length > 0 && matchedCategory) {
        return tagHit || catHit;
      }
      if (normalizedQueryTags.length > 0) return tagHit;
      if (matchedCategory) return catHit;
      return true;
    });

    const totalTRY =
      Math.round(filtered.reduce((sum, item) => sum + Number(item.amountInTRY || 0), 0) * 100) /
      100;
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

  // Otherwise parse natural language expenses: e.g. "Bugün Sağlam Kart ile 220 TL kahve, 1450 TL market harcadım"
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

    const title = cleanDesc
      ? cleanDesc.charAt(0).toUpperCase() + cleanDesc.slice(1)
      : 'Harcama';
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

const JWT_SECRET = process.env.JWT_SECRET || 'spentrack-hmac-sha256-secret-key-2026';

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload: Record<string, unknown>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64UrlEncode(
    JSON.stringify({
      ...payload,
      iat: now,
      exp: now + 60 * 60 * 24 * 30, // 30 days
    })
  );
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${header}.${body}.${signature}`;
}

function verifyJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    if (sig !== expectedSig) return null;
    const decoded = JSON.parse(
      Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    );
    if (decoded.exp && Math.floor(Date.now() / 1000) > Number(decoded.exp)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json({ limit: '25mb' }));

  // Helper to get user_id from Bearer JWT token or x-user-id header
  const getUserId = (req: express.Request): string => {
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const verified = verifyJwt(token);
      if (verified && typeof verified.sub === 'string' && verified.sub.trim()) {
        return verified.sub.trim();
      }
    }
    const uid = req.headers['x-user-id'];
    return typeof uid === 'string' && uid.trim() ? uid.trim() : 'default_user';
  };

  // POST /api/auth/google — UPSERT user & return HMAC-SHA256 JWT token
  app.post('/api/auth/google', (req, res) => {
    try {
      const { id, email, name, avatarUrl } = req.body || {};
      const userId = String(id || email || '').trim();
      const userEmail = String(email || '').trim();
      const userName = String(name || userEmail.split('@')[0] || 'Kullanıcı').trim();
      const userAvatar = avatarUrl ? String(avatarUrl).trim() : '';

      if (!userId || !userEmail) {
        res.status(400).json({ error: 'Geçersiz Google kullanıcı bilgisi.' });
        return;
      }

      db.prepare(
        `INSERT INTO users (id, email, name, avatar_url, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           email = excluded.email,
           name = excluded.name,
           avatar_url = excluded.avatar_url,
           updated_at = datetime('now')`
      ).run(userId, userEmail, userName, userAvatar);

      const userRow = db
        .prepare('SELECT gemini_api_key FROM users WHERE id = ?')
        .get(userId) as { gemini_api_key?: string } | undefined;
      const savedKey = String(userRow?.gemini_api_key || '').trim();

      const token = signJwt({
        sub: userId,
        email: userEmail,
        name: userName,
      });

      res.json({
        token,
        user: {
          id: userId,
          email: userEmail,
          name: userName,
          avatarUrl: userAvatar || undefined,
          geminiApiKey: savedKey,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Kimlik doğrulama hatası';
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/user/apikey — Get the logged-in user's account-bound Gemini API key
  app.get('/api/user/apikey', (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId || userId === 'default_user') {
        res.json({ apiKey: '', hasKey: false });
        return;
      }
      const row = db
        .prepare('SELECT gemini_api_key FROM users WHERE id = ?')
        .get(userId) as { gemini_api_key?: string } | undefined;
      const apiKey = String(row?.gemini_api_key || '').trim();
      res.json({
        apiKey,
        hasKey: apiKey.length > 10,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Anahtar bilgisi alınamadı';
      res.status(500).json({ error: msg });
    }
  });

  // PUT /api/user/apikey — Save or remove the logged-in user's account-bound Gemini API key
  app.put('/api/user/apikey', (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId || userId === 'default_user') {
        res.status(401).json({
          error: 'API anahtarını hesaba tanımlamak için lütfen önce Google ile giriş yapın.',
        });
        return;
      }
      const rawInput = String(req.body?.apiKey || '').trim();
      const apiKey = rawInput ? sanitizeGeminiApiKey(rawInput) || rawInput : '';

      db.prepare(
        `INSERT INTO users (id, email, name, gemini_api_key, updated_at)
         VALUES (?, '', 'Kullanıcı', ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           gemini_api_key = excluded.gemini_api_key,
           updated_at = datetime('now')`
      ).run(userId, apiKey);

      res.json({
        ok: true,
        apiKey,
        hasKey: apiKey.length > 10,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'API anahtarı kaydedilemedi';
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/user/botkey — Get the logged-in user's Bot API key
  app.get('/api/user/botkey', (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId || userId === 'default_user') {
        res.json({ botApiKey: '', hasKey: false });
        return;
      }
      const row = db
        .prepare('SELECT bot_api_key FROM users WHERE id = ?')
        .get(userId) as { bot_api_key?: string } | undefined;
      const botApiKey = String(row?.bot_api_key || '').trim();
      res.json({
        botApiKey,
        hasKey: botApiKey.startsWith('st_live_') && botApiKey.length > 20,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bot anahtarı alınamadı';
      res.status(500).json({ error: msg });
    }
  });

  // POST /api/user/botkey — Generate and save a new Bot API key
  app.post('/api/user/botkey', (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId || userId === 'default_user') {
        res.status(401).json({
          error: 'Bot API anahtarı oluşturmak için lütfen önce giriş yapın.',
        });
        return;
      }
      const rawHex = crypto.randomBytes(24).toString('hex');
      const botApiKey = `st_live_${rawHex}`;

      db.prepare(
        `INSERT INTO users (id, email, name, bot_api_key, updated_at)
         VALUES (?, '', 'Kullanıcı', ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           bot_api_key = excluded.bot_api_key,
           updated_at = datetime('now')`
      ).run(userId, botApiKey);

      res.json({
        ok: true,
        botApiKey,
        hasKey: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bot anahtarı oluşturulamadı';
      res.status(500).json({ error: msg });
    }
  });

  // DELETE /api/user/botkey — Revoke the user's Bot API key
  app.delete('/api/user/botkey', (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId || userId === 'default_user') {
        res.status(401).json({ error: 'Lütfen önce giriş yapın.' });
        return;
      }
      db.prepare('UPDATE users SET bot_api_key = "", updated_at = datetime("now") WHERE id = ?').run(userId);
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bot anahtarı silinemedi';
      res.status(500).json({ error: msg });
    }
  });

  // Helper to authenticate bot requests via Bearer st_live_ token
  function resolveBotUser(req: express.Request): { id: string; name: string; email: string } | null {
    const authHeader = req.headers.authorization || '';
    const bearerMatch = authHeader.match(/^Bearer\s+(st_live_[a-zA-Z0-9_-]+)/i);
    const token =
      (bearerMatch ? bearerMatch[1] : null) ||
      (typeof req.headers['x-bot-api-key'] === 'string' ? req.headers['x-bot-api-key'] : null) ||
      (typeof req.query.key === 'string' ? req.query.key : null);

    if (token && token.startsWith('st_live_')) {
      const user = db.prepare('SELECT id, name, email FROM users WHERE bot_api_key = ?').get(token) as
        | { id: string; name: string; email: string }
        | undefined;
      if (user) return user;
    }

    // Dev/browser test fallback if user is logged in
    const userId = getUserId(req);
    if (userId && userId !== 'default_user') {
      const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(userId) as
        | { id: string; name: string; email: string }
        | undefined;
      if (user) return user;
    }

    // Dev fallback if single user has a bot key configured
    const singleUser = db.prepare("SELECT id, name, email FROM users WHERE bot_api_key != '' LIMIT 1").get() as
      | { id: string; name: string; email: string }
      | undefined;
    if (singleUser && process.env.NODE_ENV !== 'production') {
      return singleUser;
    }

    return null;
  }

  // Model Context Protocol (MCP) Streamable HTTP / JSON-RPC 2.0 Endpoint
  async function handleMcpRequest(req: express.Request, res: express.Response) {
    if (req.method === 'GET' && (req.headers.accept?.includes('text/event-stream') || req.path.endsWith('/sse'))) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      res.write(`event: endpoint\ndata: /api/mcp\n\n`);
      return;
    }

    const botUser = resolveBotUser(req);
    const body = req.body || {};
    const id = body.id ?? null;
    const method = body.method;

    if (method === 'initialize') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: buildMcpServerInfo(),
      });
    }

    if (method === 'notifications/initialized') {
      return res.status(200).json({ jsonrpc: '2.0' });
    }

    if (method === 'ping') {
      return res.json({ jsonrpc: '2.0', id, result: {} });
    }

    if (!botUser) {
      return res.status(401).json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32001,
          message:
            "Yetkilendirme başarısız. Lütfen 'Authorization: Bearer st_live_...' başlığı ile geçerli bir SpenTrack Bot API Anahtarı gönderin.",
        },
      });
    }

    if (method === 'tools/list') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: SPENTRACK_MCP_TOOLS,
        },
      });
    }

    if (method === 'tools/call') {
      const toolName = body.params?.name;
      const args = body.params?.arguments || {};

      try {
        if (toolName === 'add_expense') {
          const title = String(args.title || '').trim();
          const amount = Number(args.amount);
          if (!title || !Number.isFinite(amount) || amount === 0) {
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: 'Hata: title ve sıfırdan farklı sayısal amount zorunludur.' }],
                isError: true,
              },
            });
          }

          const currency = String(args.currency || 'TRY').toUpperCase();
          const validCurrency = ['TRY', 'USD', 'EUR', 'GBP'].includes(currency) ? currency : 'TRY';
          const amountInTRY = convertToTRY(amount, validCurrency);

          const category = normalizeCategory(String(args.category || ''));
          const tags = normalizeTagList(Array.isArray(args.tags) ? args.tags : []);
          const date = args.date && /^\d{4}-\d{2}-\d{2}$/.test(args.date)
            ? args.date
            : new Date().toISOString().slice(0, 10);
          const notes = String(args.notes || '').trim();
          const expenseId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

          db.prepare(
            `INSERT INTO expenses (id, user_id, title, amount, currency, amount_in_try, category, tags, date, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(expenseId, botUser.id, title, amount, validCurrency, amountInTRY, category, JSON.stringify(tags), date, notes);

          const sign = amount < 0 ? 'İade' : 'Harcama';
          const text = `✅ ${sign} başarıyla kaydedildi:\n• İşyeri / Başlık: ${title}\n• Tutar: ${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 }).format(amount)} ${validCurrency}${validCurrency !== 'TRY' ? ` (${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 }).format(amountInTRY)} ₺)` : ''}\n• Kategori: ${category}\n• Tarih: ${date}\n• Etiketler: ${tags.join(' ') || '(etiketsiz)'}\n• ID: \`${expenseId}\`${notes ? `\n• Not: ${notes}` : ''}`;

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text }],
              isError: false,
              data: { id: expenseId, title, amount, currency: validCurrency, amountInTRY, category, tags, date, notes },
            },
          });
        }

        if (toolName === 'update_expense') {
          const expId = String(args.id || '').trim();
          if (!expId) {
            return res.json({
              jsonrpc: '2.0',
              id,
              result: { content: [{ type: 'text', text: 'Hata: Güncellenecek harcama id değeri zorunludur.' }], isError: true },
            });
          }

          const existing = db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(expId, botUser.id) as Record<string, unknown> | undefined;
          if (!existing) {
            return res.json({
              jsonrpc: '2.0',
              id,
              result: { content: [{ type: 'text', text: `Hata: ${expId} ID'li harcama kaydı bulunamadı.` }], isError: true },
            });
          }

          const title = args.title !== undefined ? String(args.title).trim() : String(existing.title);
          const amount = args.amount !== undefined ? Number(args.amount) : Number(existing.amount);
          const currency = args.currency !== undefined ? String(args.currency).toUpperCase() : String(existing.currency);
          const amountInTRY = convertToTRY(amount, currency);
          const category = args.category !== undefined ? normalizeCategory(String(args.category)) : String(existing.category);
          const tags = args.tags !== undefined ? normalizeTagList(Array.isArray(args.tags) ? args.tags : []) : JSON.parse(String(existing.tags || '[]'));
          const date = args.date !== undefined ? String(args.date) : String(existing.date);
          const notes = args.notes !== undefined ? String(args.notes).trim() : String(existing.notes || '');

          db.prepare(
            `UPDATE expenses
             SET title = ?, amount = ?, currency = ?, amount_in_try = ?, category = ?, tags = ?, date = ?, notes = ?
             WHERE id = ? AND user_id = ?`
          ).run(title, amount, currency, amountInTRY, category, JSON.stringify(tags), date, notes, expId, botUser.id);

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `✅ Harcama (#${expId}) güncellendi:\n• ${title} • ${amount} ${currency} • ${category} • ${date}` }],
              isError: false,
            },
          });
        }

        if (toolName === 'list_expenses') {
          let sql = 'SELECT * FROM expenses WHERE user_id = ?';
          const params: unknown[] = [botUser.id];

          if (args.monthYear && /^\d{4}-\d{2}$/.test(args.monthYear)) {
            sql += ' AND date LIKE ?';
            params.push(`${args.monthYear}%`);
          }
          if (args.category) {
            sql += ' AND category = ?';
            params.push(normalizeCategory(String(args.category)));
          }
          if (args.query) {
            sql += ' AND (title LIKE ? OR notes LIKE ?)';
            const q = `%${args.query}%`;
            params.push(q, q);
          }

          sql += ' ORDER BY date DESC, created_at DESC';
          const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
          sql += ` LIMIT ${limit}`;

          let rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

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
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: 'Kriterlere uygun herhangi bir harcama kaydı bulunamadı.' }],
                isError: false,
                data: [],
              },
            });
          }

          const lines = rows.map((r, i) => {
            const tags = JSON.parse(String(r.tags || '[]')).join(' ');
            return `${i + 1}. **${r.title}**: ${Number(r.amount).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${r.currency} (${r.date}) [${r.category}] ${tags} - ID: \`${r.id}\``;
          });

          const totalTRY = rows.reduce((s, r) => s + Number(r.amount_in_try || 0), 0);
          const header = `📋 Toplam ${rows.length} harcama kaydı listelendi (Toplam: ${totalTRY.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺):\n\n`;

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: header + lines.join('\n') }],
              isError: false,
              data: rows,
            },
          });
        }

        if (toolName === 'get_financial_summary') {
          const ym = args.monthYear && /^\d{4}-\d{2}$/.test(args.monthYear)
            ? args.monthYear
            : new Date().toISOString().slice(0, 7);

          const rows = db
            .prepare('SELECT * FROM expenses WHERE user_id = ? AND date LIKE ?')
            .all(botUser.id, `${ym}%`) as Record<string, unknown>[];

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

          const text = `📊 **SpenTrack Finansal Özeti (${ym})**:\n\n• Toplam Harcama: **${totalSpentTRY.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺**\n• Toplam İade / Geri Ödeme: **${totalRefundTRY.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺**\n• Net Dönem Harcaması: **${netTRY.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺**\n• Toplam İşlem Sayısı: **${rows.length} adet**\n\n**Kategori Dağılımı:**\n${topCategories || 'Henüz harcama yok.'}`;

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text }],
              isError: false,
              data: { monthYear: ym, totalSpentTRY, totalRefundTRY, netTRY, transactionCount: rows.length, categoryTotals },
            },
          });
        }

        if (toolName === 'delete_expense') {
          const expId = String(args.id || '').trim();
          if (!expId) {
            return res.json({
              jsonrpc: '2.0',
              id,
              result: { content: [{ type: 'text', text: 'Hata: Silinecek id zorunludur.' }], isError: true },
            });
          }

          const info = db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?').run(expId, botUser.id);
          if (info.changes === 0) {
            return res.json({
              jsonrpc: '2.0',
              id,
              result: { content: [{ type: 'text', text: `Hata: ${expId} ID'li harcama kaydı bulunamadı.` }], isError: true },
            });
          }

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `🗑️ ${expId} ID'li harcama kaydı başarıyla silindi.` }],
              isError: false,
            },
          });
        }

        return res.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Bilinmeyen MCP aracı: '${toolName}'` },
        });
      } catch (toolErr) {
        const msg = toolErr instanceof Error ? toolErr.message : 'Araç yürütülürken hata oluştu';
        return res.json({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `Hata: ${msg}` }], isError: true },
        });
      }
    }

    return res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Desteklenmeyen metod: '${method}'` },
    });
  }

  app.all('/api/mcp', handleMcpRequest);
  app.all('/api/mcp/sse', handleMcpRequest);

  // GET /api/expenses
  app.get('/api/expenses', (req, res) => {
    try {
      const userId = getUserId(req);
      const rows = db
        .prepare('SELECT * FROM expenses WHERE user_id = ? ORDER BY date DESC, created_at DESC')
        .all(userId) as Record<string, unknown>[];

      const expenses = rows.map((r) => ({
        id: String(r.id),
        userId: String(r.user_id),
        title: String(r.title),
        amount: Number(r.amount),
        currency: String(r.currency || 'TRY'),
        amountInTRY: Number(r.amount_in_try),
        category: String(r.category),
        tags: (() => {
          try {
            return JSON.parse(String(r.tags || '[]'));
          } catch {
            return [];
          }
        })(),
        date: String(r.date),
        notes: String(r.notes || ''),
        createdAt: String(r.created_at || ''),
      }));

      res.json({ expenses });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Veritabanı okuma hatası';
      res.status(500).json({ error: msg });
    }
  });

  // POST /api/expenses (Single create)
  app.post('/api/expenses', (req, res) => {
    try {
      const userId = getUserId(req);
      const body = req.body || {};
      const id = String(body.id || crypto.randomUUID());
      const title = String(body.title || '').trim();
      const amount = Number(body.amount);
      if (!title || !Number.isFinite(amount) || amount === 0) {
        res.status(400).json({ error: 'Başlık ve geçerli bir tutar zorunludur.' });
        return;
      }

      const currency = String(body.currency || 'TRY');
      const amountInTRY = Number(body.amountInTRY ?? amount);
      const category = normalizeCategory(String(body.category || 'Diğer'));
      const tags = normalizeTagList(Array.isArray(body.tags) ? body.tags : []);
      const date = String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const notes = String(body.notes || '').trim();

      db.prepare(
        `INSERT OR REPLACE INTO expenses (id, user_id, title, amount, currency, amount_in_try, category, tags, date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, userId, title, amount, currency, amountInTRY, category, JSON.stringify(tags), date, notes);

      res.json({
        ok: true,
        expense: { id, userId, title, amount, currency, amountInTRY, category, tags, date, notes },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Kayıt eklenemedi';
      res.status(500).json({ error: msg });
    }
  });

  // POST /api/expenses/batch (Toplu Kayıt - D1 db.batch() eşdeğeri atomik transaction)
  app.post('/api/expenses/batch', (req, res) => {
    try {
      const userId = getUserId(req);
      const items = Array.isArray(req.body?.expenses) ? req.body.expenses : [];
      if (items.length === 0) {
        res.json({ ok: true, inserted: 0, expenses: [] });
        return;
      }

      const insertStmt = db.prepare(
        `INSERT OR REPLACE INTO expenses (id, user_id, title, amount, currency, amount_in_try, category, tags, date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const savedList: Record<string, unknown>[] = [];
      const batchTx = db.transaction((rows: Record<string, unknown>[]) => {
        for (const item of rows) {
          const id = String(item.id || crypto.randomUUID());
          const title = String(item.title || 'Harcama').trim();
          const amount = Number(item.amount || 0);
          if (!amount) continue;
          const currency = String(item.currency || 'TRY');
          const amountInTRY = Number(item.amountInTRY ?? amount);
          const category = normalizeCategory(String(item.category || 'Diğer'));
          const tags = normalizeTagList(Array.isArray(item.tags) ? (item.tags as string[]) : []);
          const date = String(item.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
          const notes = String(item.notes || '').trim();

          insertStmt.run(
            id,
            userId,
            title,
            amount,
            currency,
            amountInTRY,
            category,
            JSON.stringify(tags),
            date,
            notes
          );
          savedList.push({
            id,
            userId,
            title,
            amount,
            currency,
            amountInTRY,
            category,
            tags,
            date,
            notes,
          });
        }
      });

      batchTx(items);
      res.json({ ok: true, inserted: savedList.length, expenses: savedList });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Toplu kayıt hatası';
      res.status(500).json({ error: msg });
    }
  });

  // PUT /api/expenses/:id
  app.put('/api/expenses/:id', (req, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const body = req.body || {};
      const title = String(body.title || '').trim();
      const amount = Number(body.amount);
      if (!title || !Number.isFinite(amount) || amount === 0) {
        res.status(400).json({ error: 'Başlık ve geçerli bir tutar zorunludur.' });
        return;
      }
      const currency = String(body.currency || 'TRY');
      const amountInTRY = Number(body.amountInTRY ?? amount);
      const category = normalizeCategory(String(body.category || 'Diğer'));
      const tags = normalizeTagList(Array.isArray(body.tags) ? body.tags : []);
      const date = String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const notes = String(body.notes || '').trim();

      db.prepare(
        `UPDATE expenses
         SET title = ?, amount = ?, currency = ?, amount_in_try = ?, category = ?, tags = ?, date = ?, notes = ?
         WHERE id = ? AND user_id = ?`
      ).run(title, amount, currency, amountInTRY, category, JSON.stringify(tags), date, notes, id, userId);

      res.json({
        ok: true,
        expense: { id, userId, title, amount, currency, amountInTRY, category, tags, date, notes },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Güncelleme hatası';
      res.status(500).json({ error: msg });
    }
  });

  // DELETE /api/expenses/:id
  app.delete('/api/expenses/:id', (req, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?').run(id, userId);
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Silme hatası';
      res.status(500).json({ error: msg });
    }
  });

  // POST /api/ai/extract (Fiş, Ekran Görüntüsü ve PDF Kredi Kartı Ekstresi Çıkarımı)
  app.post('/api/ai/extract', async (req, res) => {
    try {
      const userId = getUserId(req);
      const { files = [], existingTags = [], textPrompt = '' } = req.body || {};
      const customKey = req.headers['x-custom-gemini-key'] as string | undefined;
      const candidateKeys = getCandidateApiKeys(userId, customKey);

      if (candidateKeys.length === 0) {
        res.status(400).json({
          error:
            "Tanımlı bir Gemini API anahtarı bulunamadı. Lütfen AI Studio 'Settings > Secrets' panelinden GEMINI_API_KEY anahtarınızı seçin veya üstteki API Anahtarı alanından ücretsiz Gemini API anahtarınızı hesabınıza kaydedin.",
        });
        return;
      }

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

      const today = new Date().toISOString().slice(0, 10);
      parts.push({
        text: `Bugünün tarihi: ${today}.
Kullanıcının mevcut #etiket havuzu (uygunsa bunları önceliklendir): ${(existingTags || []).join(', ')}.
${textPrompt || 'Yüklenen fiş, ekran görüntüsü veya PDF kredi kartı ekstresindeki tüm geçerli harcama ve iade satırlarını kurallara uygun olarak ayıkla.'}`,
      });

      const responseText = await generateGeminiContentWithFallback(candidateKeys, {
        parts,
        systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedBank: {
              type: Type.STRING,
              description: 'Tespit edilen banka veya kart adı (örn: Yapı Kredi World, Sağlam Kart)',
            },
            summaryNote: {
              type: Type.STRING,
              description: 'Ayrıştırma özeti (örn: 5 harcama, 1 taksit, 1 iade tespit edildi, 2 ödeme satırı yok sayıldı)',
            },
            expenses: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: 'İşyeri veya harcama başlığı' },
                  amount: {
                    type: Type.NUMBER,
                    description: 'Dönem harcama tutarı (İadeler için negatif -amount, taksitler için sadece tek taksit tutarı)',
                  },
                  currency: { type: Type.STRING, description: 'TRY, USD, EUR veya GBP' },
                  amountInTRY: { type: Type.NUMBER, description: 'TL karşılığı tutar' },
                  category: {
                    type: Type.STRING,
                    enum: [...FIXED_CATEGORIES],
                    description: 'Sabit 8 kategoriden biri',
                  },
                  tags: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Banka etiketi (#yapikredi, #saglamkart vb.) ve işlem etiketleri (#kahve, #taksit, #iade)',
                  },
                  date: { type: Type.STRING, description: 'YYYY-MM-DD formatında işlem tarihi' },
                  notes: {
                    type: Type.STRING,
                    description: 'Taksit bilgisi (örn: 2/6 Taksit) veya ek açıklama',
                  },
                },
                required: ['title', 'amount', 'currency', 'amountInTRY', 'category', 'tags', 'date'],
              },
            },
          },
          required: ['expenses'],
        },
      });

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

      res.json({
        detectedBank: parsed.detectedBank || '',
        summaryNote: parsed.summaryNote || `${normalizedExpenses.length} işlem tespit edildi.`,
        expenses: normalizedExpenses,
      });
    } catch (err) {
      const formatted = formatGeminiErrorMessage(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // POST /api/ai/chat (Sohbet İle Harcama Ekleme & Analiz Asistanı)
  app.post('/api/ai/chat', async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const {
      message = '',
      files = [],
      existingExpenses = [],
      existingTags = [],
    } = req.body || {};

    try {
      const userId = getUserId(req);
      const customKey = req.headers['x-custom-gemini-key'] as string | undefined;
      const candidateKeys = getCandidateApiKeys(userId, customKey);

      if (candidateKeys.length === 0 && (!files || files.length === 0)) {
        // Fallback local deterministic assistant when no API key is set
        const fallback = fallbackNaturalLanguageAssist(message, existingExpenses, today);
        res.json(fallback);
        return;
      }

      if (candidateKeys.length === 0) {
        res.status(400).json({
          error:
            "Dosya analizi için Gemini API anahtarı gereklidir. Lütfen AI Studio 'Settings > Secrets' panelinden GEMINI_API_KEY anahtarınızı seçin veya ücretsiz Gemini API anahtarınızı hesabınıza kaydedin.",
        });
        return;
      }

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

      // Build compact ledger context for accurate Q&A calculations
      const compactLedger = (existingExpenses || []).slice(0, 200).map((e: Record<string, unknown>) => ({
        date: e.date,
        title: e.title,
        amountInTRY: e.amountInTRY,
        category: e.category,
        tags: e.tags,
        notes: e.notes,
      }));

      parts.push({
        text: `Bugünün tarihi: ${today}
Kullanıcının mevcut #etiket havuzu: ${(existingTags || []).join(', ')}
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
              reply: {
                type: Type.STRING,
                description: 'Kullanıcıya gösterilecek Türkçe yanıt veya analiz sonucu',
              },
              proposedExpenses: {
                type: Type.ARRAY,
                description: 'Kullanıcı harcama eklemek istediyse veya dosya yüklediyse çıkarılan harcamalar listesi',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    amount: { type: Type.NUMBER },
                    currency: { type: Type.STRING },
                    amountInTRY: { type: Type.NUMBER },
                    category: { type: Type.STRING, enum: [...FIXED_CATEGORIES] },
                    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    date: { type: Type.STRING },
                    notes: { type: Type.STRING },
                  },
                  required: ['title', 'amount', 'currency', 'amountInTRY', 'category', 'tags', 'date'],
                },
              },
              analysisHighlight: {
                type: Type.OBJECT,
                description: 'Eğer kullanıcı harcama analizi sorduysa hesaplanan özet metrik',
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
        if (!files || files.length === 0) {
          const fallback = fallbackNaturalLanguageAssist(message, existingExpenses, today);
          res.json(fallback);
          return;
        }
        const formatted = formatGeminiErrorMessage(lastError);
        res.status(formatted.status).json({ error: formatted.message });
        return;
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

      res.json({
        reply: parsed.reply || 'İşlem tamamlandı.',
        proposedExpenses: normalizedExpenses,
        analysisHighlight: parsed.analysisHighlight,
      });
    } catch (err) {
      // Fallback gracefully for text messages if API call fails in test sandbox
      if (!files || files.length === 0) {
        const fallback = fallbackNaturalLanguageAssist(message, existingExpenses, today);
        res.json(fallback);
        return;
      }
      const formatted = formatGeminiErrorMessage(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Vite middleware in development, static dist in production
  const distPath = path.resolve(process.cwd(), 'dist');
  if (process.env.NODE_ENV === 'production' && fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server: httpServer,
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`SpenTrack server running at http://localhost:${PORT}`);
  });
}

startServer();
