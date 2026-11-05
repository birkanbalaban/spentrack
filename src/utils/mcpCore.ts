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
];

export function buildMcpServerInfo() {
  return {
    name: 'spentrack-mcp',
    version: '1.0.0',
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {},
      prompts: {},
      resources: {},
    },
  };
}
