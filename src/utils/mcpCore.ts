/**
 * SpenTrack Model Context Protocol (MCP) Core Definitions & Tool Schemas
 * Standard: JSON-RPC 2.0 (Streamable HTTP / SSE)
 */

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const FALLBACK_CURRENCY_RATES: Record<string, number> = {
  TRY: 1,
  USD: 36.25,
  EUR: 37.85,
  GBP: 45.5,
};

export function convertToTRY(amount: number, currency?: string): number {
  const curr = (currency || 'TRY').toUpperCase();
  if (curr === 'TRY') return amount;
  const rate = FALLBACK_CURRENCY_RATES[curr] || 1;
  return Math.round(amount * rate * 100) / 100;
}

export const SPENTRACK_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'add_expense',
    description:
      "SpenTrack hesabına yeni bir harcama veya iade ekler. Başlık ve tutar zorunludur. İade işlemleri negatif tutar (örn: -250) olarak girilir. Taksitli işlemlerde notes alanına '2/6 Taksit' gibi yazılabilir.",
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Harcama başlığı veya işyeri adı (örn: Migros, Starbucks, Shell, Netflix)',
        },
        amount: {
          type: 'number',
          description:
            'Harcama tutarı (sayısal). Normal harcama için pozitif (örn: 350.50), iade veya iptal için negatif (örn: -150).',
        },
        currency: {
          type: 'string',
          enum: ['TRY', 'USD', 'EUR', 'GBP'],
          description: 'Para birimi. Belirtilmezse varsayılan TRY kabul edilir.',
        },
        category: {
          type: 'string',
          enum: [
            'Market',
            'Yeme-İçme',
            'Ulaşım',
            'Fatura & Abonelik',
            'Alışveriş',
            'Eğlence',
            'Sağlık',
            'Diğer',
          ],
          description:
            'Harcama kategorisi. Belirtilmezse başlığa göre otomatik tahmin edilir veya Diğer atanır.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Harcama etiketleri (örn: ["#saglamkart", "#kahve", "#market"]). Kart/banka adları etiket olarak eklenmelidir.',
        },
        date: {
          type: 'string',
          description: 'Harcama tarihi YYYY-MM-DD formatında (örn: 2026-11-04). Boş bırakılırsa bugünün tarihi atanır.',
        },
        notes: {
          type: 'string',
          description: 'Ek açıklama, taksit bilgisi (örn: 2/6 Taksit) veya detaylar.',
        },
      },
      required: ['title', 'amount'],
    },
  },
  {
    name: 'update_expense',
    description:
      'Mevcut bir harcamanın başlığını, tutarını, kategorisini, etiketlerini veya notlarını günceller.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Güncellenecek harcamanın benzersiz ID değeri (örn: exp-123456)',
        },
        title: {
          type: 'string',
          description: 'Yeni işyeri veya harcama başlığı',
        },
        amount: {
          type: 'number',
          description: 'Yeni harcama tutarı',
        },
        currency: {
          type: 'string',
          enum: ['TRY', 'USD', 'EUR', 'GBP'],
          description: 'Para birimi',
        },
        category: {
          type: 'string',
          enum: [
            'Market',
            'Yeme-İçme',
            'Ulaşım',
            'Fatura & Abonelik',
            'Alışveriş',
            'Eğlence',
            'Sağlık',
            'Diğer',
          ],
          description: 'Yeni kategori',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Yeni etiket listesi',
        },
        date: {
          type: 'string',
          description: 'Yeni tarih YYYY-MM-DD',
        },
        notes: {
          type: 'string',
          description: 'Yeni açıklama veya taksit notu',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_expenses',
    description:
      'Kullanıcının harcama kayıtlarını listeler ve filtreler (ay, kategori, etiket veya serbest metin aramasıyla).',
    inputSchema: {
      type: 'object',
      properties: {
        monthYear: {
          type: 'string',
          description: 'Ay ve yıl filtresi YYYY-MM (örn: 2026-11). Belirtilmezse tüm harcamalar taranır.',
        },
        category: {
          type: 'string',
          description: 'Kategori filtresi (örn: Market, Yeme-İçme, Ulaşım)',
        },
        tag: {
          type: 'string',
          description: 'Etiket filtresi (örn: #saglamkart veya #kahve)',
        },
        query: {
          type: 'string',
          description: 'Başlık veya not alanında arama yapılacak kelime',
        },
        limit: {
          type: 'number',
          description: 'Döndürülecek maksimum işlem sayısı (varsayılan: 20, en fazla: 100)',
        },
      },
    },
  },
  {
    name: 'get_financial_summary',
    description:
      'Kullanıcının aylık bütçe özetini, toplam harcamasını, kategori bazlı kırılımlarını ve işlem sayısını getirir.',
    inputSchema: {
      type: 'object',
      properties: {
        monthYear: {
          type: 'string',
          description: 'Özeti istenen ay YYYY-MM formatında (örn: 2026-11). Boş bırakılırsa cari ay kullanılır.',
        },
      },
    },
  },
  {
    name: 'delete_expense',
    description: 'Belirtilen ID değerine sahip harcama kaydını kalıcı olarak siler.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Silinecek harcama kaydının ID değeri',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'add_payment_reminder',
    description:
      "İleriye dönük bir ödeme hatırlatması / takvim planı ekler (örn: kira, fatura, kredi kartı ödemesi, taksit). Ödendiğinde harcamaya dönüştürülebilir.",
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Ödeme başlığı (örn: Kira Ödemesi, Enerjisa Elektrik Faturası, Aidat)',
        },
        amount: {
          type: 'number',
          description: 'Beklenen ödeme tutarı (pozitif sayı)',
        },
        currency: {
          type: 'string',
          enum: ['TRY', 'USD', 'EUR', 'GBP'],
          description: 'Para birimi (varsayılan TRY)',
        },
        category: {
          type: 'string',
          enum: [
            'Market',
            'Yeme-İçme',
            'Ulaşım',
            'Fatura & Abonelik',
            'Alışveriş',
            'Eğlence',
            'Sağlık',
            'Diğer',
          ],
          description: 'Kategori (varsayılan: başlığa göre tahmin veya Fatura & Abonelik)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Etiketler (örn: ["#aidat", "#yapikredi"])',
        },
        dueDate: {
          type: 'string',
          description: 'Son ödeme / hatırlatma tarihi YYYY-MM-DD formatında (örn: 2026-12-05)',
        },
        recurrence: {
          type: 'string',
          enum: ['once', 'monthly', 'yearly'],
          description: 'Tekrar sıklığı: once (tek seferlik), monthly (aylık), yearly (yıllık)',
        },
        notes: {
          type: 'string',
          description: 'Ek açıklama veya abone numarası',
        },
      },
      required: ['title', 'amount', 'dueDate'],
    },
  },
  {
    name: 'list_payment_reminders',
    description:
      'Takvimdeki ileriye dönük, gecikmiş veya ödenmiş ödeme hatırlatmalarını listeler.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'paid', 'all'],
          description: 'Durum filtresi (varsayılan: pending)',
        },
        monthYear: {
          type: 'string',
          description: 'Opsiyonel dönem filtresi YYYY-MM (örn: 2026-12)',
        },
        includeOverdue: {
          type: 'boolean',
          description: 'monthYear verilse bile gecikmiş (dueDate < bugün) bekleyenleri dahil et (varsayılan true)',
        },
      },
    },
  },
  {
    name: 'complete_payment_reminder',
    description:
      'Belirtilen ID değerine sahip ödeme hatırlatmasını ödendi olarak işaretler, otomatik olarak harcama ekranına gerçek harcama kaydı ekler ve aylık/yıllık ise sonraki dönemi planlar.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Ödendi işaretlenecek hatırlatma kaydının ID değeri',
        },
        paidDate: {
          type: 'string',
          description: 'Ödemenin yapıldığı tarih YYYY-MM-DD (boşsa bugünün tarihi)',
        },
      },
      required: ['id'],
    },
  },
];

export function buildMcpServerInfo() {
  return {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {
        listChanged: false,
      },
      prompts: {},
      resources: {},
    },
    serverInfo: {
      name: 'spentrack',
      version: '1.0.0',
    },
    name: 'spentrack',
    version: '1.0.0',
  };
}
