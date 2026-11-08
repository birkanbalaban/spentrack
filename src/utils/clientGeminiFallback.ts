import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  Expense,
  ExpenseCategory,
  ExtractedExpense,
  FIXED_CATEGORIES,
} from '../types';
import {
  normalizeCategory,
  normalizeTagList,
  parseTurkishAmount,
} from './expenseLogic';

export const ACTIVE_GEMINI_MODELS = [
  'gemini-flash-latest',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
];

function createClientCandidates(apiKey: string): GoogleGenAI[] {
  const trimmed = apiKey.trim();
  // AQ... keys can be either Gemini Developer API keys or Vertex AI Express Mode keys
  if (trimmed.startsWith('AQ')) {
    return [
      new GoogleGenAI({ apiKey: trimmed }),
      new GoogleGenAI({ vertexai: true, apiKey: trimmed }),
    ];
  }
  return [
    new GoogleGenAI({ apiKey: trimmed }),
    new GoogleGenAI({ vertexai: true, apiKey: trimmed }),
  ];
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
  const clients = createClientCandidates(apiKey);
  const todayISO = new Date().toISOString().split('T')[0];

  const systemInstruction = `Sen Türkiye finans ve bankacılık ekstreleri konusunda uzman bir Muhasebe & Harcama Ayrıştırma Yapay Zekasısın.
Sana yüklenen fiş fotoğraflarını, mobil bankacılık ekran görüntülerini veya çok sayfalı PDF kredi kartı ekstrelerini analiz edip yapılandırılmış JSON harcama listesine dönüştürürsün.

KRİTİK TÜRKİYE BANKACILIK KURALLARI:
1. TUZAK SATIRLARI (TRAP ROWS) KESİNLİKLE HARCAMA OLARAK EKLEME:
   - "Önceki Dönem Bakiyesi", "Geçen Aydan Devir", "Dönem Borcu Ödemesi", "Kredi Kartı Ödemesi - Teşekkür Ederiz", "Otomatik Ödeme", "Hesaptan Aktarım", "Kazanılan Worldpuan / Bonus / Chip-para / MaxiPuan", "Toplam Dönem Borcu", "Asgari Ödeme Tutarı" gibi bakiye devri veya borç ödeme satırlarını ASLA listeye dahil etme.
2. TAKSİTLİ İŞLEMLER (INSTALLMENTS):
   - Satırda "2/6 Taksit", "3/9", "Taksit 1/3" gibi ibare varsa: Toplam alışveriş tutarını DEĞİL, sadece bu ekstrenin dönemine yansıyan aylık taksit tutarını (amount) al.
   - "notes" alanına kaçıncı taksit olduğunu yaz (örn: "2/6 Taksit") ve etiketlere "#taksit" ekle.
3. İADE / İPTAL İŞLEMLERİ (REFUNDS):
   - Satırda "İade", "İptal", "Alacak", "(+)" veya ekstreyi azaltan bir iade işlemi varsa: Tutarı NEGATİF sayı (örn: -450.00) olarak döndür ki toplam harcamadan düşsün. Etiketlere "#iade" ekle.
4. BANKA / KART TESPİTİ VE OTOMATİK ETİKETLEME:
   - Belgenin başlığından veya logosundan hangi banka/kart olduğunu tespit et (örn: Kuveyt Türk Sağlam Kart -> "#saglamkart", Yapı Kredi World -> "#yapikredi", Garanti Bonus -> "#garanti", İş Bankası Maximum -> "#isbankasi", Enpara -> "#enpara", Akbank Axess -> "#akbank", Ziraat Bankkart -> "#ziraat", QNB -> "#qnb").
   - Tespit ettiğin banka etiketini o belgedeki TÜM harcama satırlarının "tags" dizisine otomatik ekle.
5. KATEGORİ EŞLEŞTİRME (SADECE ŞU 8 SABİT KATEGORİDEN BİRİ OLMALIDIR):
   - ${FIXED_CATEGORIES.join(', ')}
6. MEVCUT ETİKET HAVUZUNU KORU:
   - Kullanıcının mevcut etiketleri: ${JSON.stringify(existingTags)}
   - Benzer kavramlar için yeni uydurma etiket açmak yerine bu mevcut etiketleri kullan. Tüm etiketler küçük harf, boşluksuz ve '#' ile başlamalıdır.
7. TARİH VE TUTAR:
   - Tarihleri YYYY-MM-DD formatına çevir (yıl belirtilmemişse ${todayISO.slice(0, 4)} yılını baz al; fişte tarih yoksa ${todayISO} kullan).
   - Türk lirası formatındaki "1.250,50" tutarları standart ondalık sayıya (1250.5) dönüştür.`;

  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [
    {
      text: 'Ekteki fiş veya kredi kartı ekstresi dosyalarındaki tüm gerçek harcama ve iade satırlarını kurallara göre çıkar.',
    },
  ];

  for (const file of files) {
    parts.push({
      inlineData: {
        mimeType: file.mimeType || 'image/jpeg',
        data: file.data,
      },
    });
  }

  let lastError: unknown = null;
  for (const ai of clients) {
    for (const model of ACTIVE_GEMINI_MODELS) {
      try {
          const isGemini3 = model.includes('gemini-3') || model.includes('gemini-4');
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
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
                      category: { type: Type.STRING },
                      tags: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      date: { type: Type.STRING },
                      notes: { type: Type.STRING },
                    },
                    required: [
                      'title',
                      'amount',
                      'currency',
                      'amountInTRY',
                      'category',
                      'tags',
                      'date',
                    ],
                  },
                },
              },
              required: ['expenses'],
            },
            ...(isGemini3 ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
          },
        });

      const rawText = response.text || '{}';
      const parsed = JSON.parse(rawText);
      const normalized: ExtractedExpense[] = (parsed.expenses || []).map(
        (item: Record<string, unknown>) => {
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
        }
      );

        return {
          detectedBank: String(parsed.detectedBank || ''),
          summaryNote: String(parsed.summaryNote || `${normalized.length} satır ayrıştırıldı.`),
          expenses: normalized,
        };
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err || '');
        if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
          break;
        }
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Ekstre analiz edilemedi.');
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
  const clients = createClientCandidates(apiKey);
  const todayISO = new Date().toISOString().split('T')[0];

  const compactExpenses = existingExpenses.slice(0, 180).map((e) => ({
    title: e.title,
    amountInTRY: e.amountInTRY,
    category: e.category,
    tags: e.tags,
    date: e.date,
  }));

  const systemInstruction = `Sen "SpenTrack Finansal Asistanı"sın. Kullanıcının kişisel harcamalarını takip etmesine, doğal dille harcama eklemesine ve mevcut harcamalarını analiz etmesine yardımcı olursun.
Bugünün tarihi: ${todayISO}.

YETENEKLERİN:
1. DOĞAL DİLLE VEYA DOSYADAN HARCAMA EKLEME:
   - Kullanıcı "Bugün Migros'tan 850 TL market alışverişi yaptım, Kuveyt Türk Sağlam Kart ile ödedim" gibi bir mesaj yazarsa veya fiş/ekstre yüklerse, bunları "proposedExpenses" dizisine ekle.
2. HARCAMA ANALİZİ VE SORU-CEVAP:
   - Kullanıcının mevcut harcama listesi (özet): ${JSON.stringify(compactExpenses)}
   - Kullanıcının mevcut etiket havuzu: ${JSON.stringify(existingTags)}
3. KATEGORİLER:
   - Sadece şu 8 kategoriden birini kullan: ${FIXED_CATEGORIES.join(', ')}`;

  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [{ text: message || 'Eklenen dosyaları analiz et ve harcamaları çıkar.' }];

  for (const file of files) {
    parts.push({
      inlineData: {
        mimeType: file.mimeType || 'image/jpeg',
        data: file.data,
      },
    });
  }

  let lastError: unknown = null;
  for (const ai of clients) {
    for (const model of ACTIVE_GEMINI_MODELS) {
      try {
        const isGemini3 = model.includes('gemini-3') || model.includes('gemini-4');
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                reply: { type: Type.STRING },
                analysisHighlight: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    totalTRY: { type: Type.NUMBER },
                    count: { type: Type.NUMBER },
                  },
                },
                proposedExpenses: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      amount: { type: Type.NUMBER },
                      currency: { type: Type.STRING },
                      amountInTRY: { type: Type.NUMBER },
                      category: { type: Type.STRING },
                      tags: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      date: { type: Type.STRING },
                      notes: { type: Type.STRING },
                    },
                    required: [
                      'title',
                      'amount',
                      'currency',
                      'amountInTRY',
                      'category',
                      'tags',
                      'date',
                    ],
                  },
                },
              },
              required: ['reply'],
            },
            ...(isGemini3 ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
          },
        });

        const parsed = JSON.parse(response.text || '{}');
        const proposed: ExtractedExpense[] = (parsed.proposedExpenses || []).map(
          (item: Record<string, unknown>) => {
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
              title: String(item.title || 'Harcama').trim(),
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
          }
        );

        const highlight =
          parsed.analysisHighlight && typeof parsed.analysisHighlight === 'object'
            ? {
                label: String(parsed.analysisHighlight.label || ''),
                totalTRY: Number(parsed.analysisHighlight.totalTRY || 0),
                count: Number(parsed.analysisHighlight.count || 0),
              }
            : undefined;

        return {
          reply: String(parsed.reply || 'İşleminiz tamamlandı.'),
          analysisHighlight: highlight,
          proposedExpenses: proposed,
        };
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err || '');
        if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
          break;
        }
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Asistan yanıt veremedi.');
}
