import React, { useEffect, useState } from 'react';
import {
  X,
  Bot,
  Key,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  Terminal,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface BotIntegrationModalProps {
  isOpen: boolean;
  isAuthenticated: boolean;
  authHeaders?: Record<string, string>;
  onClose: () => void;
}

export const BotIntegrationModal: React.FC<BotIntegrationModalProps> = ({
  isOpen,
  isAuthenticated,
  authHeaders = {},
  onClose,
}) => {
  const [botKey, setBotKey] = useState<string>('');
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<boolean>(false);
  const [copiedConfig, setCopiedConfig] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'hermes' | 'claude' | 'examples'>('hermes');
  const [testStatus, setTestStatus] = useState<{
    loading: boolean;
    success?: boolean;
    message?: string;
  } | null>(null);

  const serverUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/mcp`
      : 'https://spentrack.birkan-balaban0.workers.dev/api/mcp';

  useEffect(() => {
    if (!isOpen) return;
    fetchBotKey();
  }, [isOpen]);

  const fetchBotKey = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/user/botkey', {
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        setBotKey(data.botApiKey || '');
        setHasKey(Boolean(data.hasKey));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateKey = async () => {
    setLoading(true);
    setError('');
    setTestStatus(null);
    try {
      const res = await fetch('/api/user/botkey', {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Bot anahtarı oluşturulamadı.');
      }
      setBotKey(data.botApiKey);
      setHasKey(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anahtar üretilemedi.');
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeKey = async () => {
    if (!confirm('Bot API anahtarınızı iptal etmek istediğinize emin misiniz? Mevcut bot bağlantıları duracaktır.')) {
      return;
    }
    setLoading(true);
    setError('');
    setTestStatus(null);
    try {
      const res = await fetch('/api/user/botkey', {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (!res.ok) {
        throw new Error('Anahtar iptal edilemedi.');
      }
      setBotKey('');
      setHasKey(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anahtar iptal edilemedi.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyKey = () => {
    if (!botKey) return;
    navigator.clipboard.writeText(botKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const hermesConfig = JSON.stringify(
    {
      mcpServers: {
        spentrack: {
          url: serverUrl,
          headers: {
            Authorization: `Bearer ${botKey || 'st_live_YOUR_BOT_KEY'}`,
          },
        },
      },
    },
    null,
    2
  );

  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        spentrack: {
          url: serverUrl,
          headers: {
            Authorization: `Bearer ${botKey || 'st_live_YOUR_BOT_KEY'}`,
          },
        },
      },
    },
    null,
    2
  );

  const handleCopyConfig = (configText: string) => {
    navigator.clipboard.writeText(configText);
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 2000);
  };

  const handleTestConnection = async () => {
    if (!botKey) return;
    setTestStatus({ loading: true });
    try {
      // 1. MCP Initialize Handshake Test (ServerInfo check for OpenBot/Claude)
      const initRes = await fetch('/api/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${botKey}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-init',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'SpenTrack-Tester', version: '1.0.0' },
          },
        }),
      });
      const initData = await initRes.json();
      const serverInfo = initData?.result?.serverInfo;

      // 2. MCP Tools List Test
      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${botKey}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-ping',
          method: 'tools/list',
          params: {},
        }),
      });

      const data = await res.json();
      if (res.ok && data?.result?.tools) {
        const sName = serverInfo?.name || 'spentrack';
        const sVer = serverInfo?.version || '1.0.0';
        setTestStatus({
          loading: false,
          success: true,
          message: `El sıkışma başarılı! Sunucu: ${sName} v${sVer} · ${data.result.tools.length} adet MCP aracı aktif ve hazır.`,
        });
      } else {
        setTestStatus({
          loading: false,
          success: false,
          message: data?.error?.message || 'Bağlantı kurulamadı.',
        });
      }
    } catch (err) {
      setTestStatus({
        loading: false,
        success: false,
        message: err instanceof Error ? err.message : 'Bağlantı hatası.',
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bot-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto"
    >
      <div className="w-full max-w-2xl bg-[#141417] border border-[#27272a] rounded-2xl shadow-2xl overflow-hidden flex flex-col text-[#f4f4f5]">
        {/* Başlık */}
        <div className="px-6 py-4 border-b border-[#27272a] flex items-center justify-between gap-3 bg-[#18181c]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#10b981]/15 border border-[#10b981]/30 flex items-center justify-center text-[#10b981]">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 id="bot-modal-title" className="text-base font-bold text-[#f4f4f5] flex items-center gap-2">
                <span>Model Context Protocol (MCP) & Bot Entegrasyonu</span>
              </h2>
              <p className="text-xs text-[#a1a1aa] mt-0.5">
                OpenBot, Hermes Bot, OpenMaus veya Claude Desktop ile $0 maliyetle dışarıdan harcama ekleyin
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#27272a] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 bg-[#f43f5e]/15 border border-[#f43f5e]/30 rounded-xl text-xs text-[#f43f5e] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 1. Bot API Anahtarı Kartı */}
          <div className="bg-[#18181c] border border-[#27272a] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#f4f4f5]">
                <Key className="w-4 h-4 text-[#10b981]" />
                <span>Kişisel Bot API Anahtarı</span>
              </div>
              {hasKey && (
                <span className="text-[11px] font-mono text-[#10b981] bg-[#10b981]/10 px-2 py-0.5 rounded-md border border-[#10b981]/20">
                  Aktif ve Bağlı
                </span>
              )}
            </div>

            <p className="text-xs text-[#a1a1aa]">
              Bu anahtar Hermes veya OpenMaus botunuzun harcamalarınızı doğrudan hesabınıza ekleyip düzenlemesini sağlar.
            </p>

            {hasKey ? (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3.5 py-2 bg-[#09090b] border border-[#27272a] rounded-xl font-mono text-xs text-[#10b981] truncate">
                    {botKey}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyKey}
                    className="px-3.5 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-[#f4f4f5] rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5 text-[#10b981]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey ? 'Kopyalandı' : 'Kopyala'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRevokeKey}
                    disabled={loading}
                    className="px-2.5 py-2 text-[#71717a] hover:text-[#f43f5e] hover:bg-[#27272a] rounded-xl transition-colors shrink-0 cursor-pointer"
                    title="Anahtarı İptal Et"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center justify-between text-[11px] text-[#71717a]">
                  <span>Anahtar formatı: Bearer token</span>
                  <button
                    type="button"
                    onClick={handleGenerateKey}
                    disabled={loading}
                    className="text-[#a1a1aa] hover:text-[#f4f4f5] flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Yeniden Üret</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleGenerateKey}
                  disabled={loading}
                  className="px-4 py-2.5 bg-[#10b981] hover:bg-[#10b981]/90 text-[#09090b] font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer shadow-md"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  <span>Tek Tıkla Bot API Anahtarı Oluştur</span>
                </button>
              </div>
            )}
          </div>

          {/* 2. MCP Endpoint & Konfigürasyon Kartı */}
          <div className="bg-[#18181c] border border-[#27272a] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-[#f4f4f5] flex items-center gap-2">
                <Terminal className="w-4 h-4 text-[#0ea5e9]" />
                <span>MCP Endpoint URL</span>
              </div>
              <span className="text-[11px] font-mono text-[#a1a1aa]">HTTP / SSE JSON-RPC 2.0</span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={serverUrl}
                aria-label="MCP Endpoint URL"
                className="flex-1 px-3 py-1.5 bg-[#09090b] border border-[#27272a] rounded-lg font-mono text-xs text-[#a1a1aa]"
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(serverUrl);
                  alert('MCP URL kopyalandı.');
                }}
                className="px-3 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-xs font-medium rounded-lg text-[#f4f4f5] cursor-pointer"
              >
                URL Kopyala
              </button>
            </div>

            {/* Sekmeler */}
            <div className="pt-2 border-t border-[#27272a]/60">
              <div className="flex items-center gap-2 border-b border-[#27272a] pb-2 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab('hermes')}
                  className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                    activeTab === 'hermes'
                      ? 'bg-[#27272a] text-[#f4f4f5] font-semibold'
                      : 'text-[#a1a1aa] hover:text-[#f4f4f5]'
                  }`}
                >
                  OpenBot / Hermes / OpenMaus
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('claude')}
                  className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                    activeTab === 'claude'
                      ? 'bg-[#27272a] text-[#f4f4f5] font-semibold'
                      : 'text-[#a1a1aa] hover:text-[#f4f4f5]'
                  }`}
                >
                  Claude Desktop Config
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('examples')}
                  className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                    activeTab === 'examples'
                      ? 'bg-[#27272a] text-[#f4f4f5] font-semibold'
                      : 'text-[#a1a1aa] hover:text-[#f4f4f5]'
                  }`}
                >
                  Örnek Komutlar
                </button>
              </div>

              <div className="mt-3">
                {activeTab === 'hermes' && (
                  <div className="space-y-2">
                    <p className="text-[11px] text-[#a1a1aa]">
                      OpenBot, Hermes veya OpenMaus istemcinizin `config.json` veya MCP ayar dosyasına aşağıdaki bloğu yapıştırın:
                    </p>
                    <div className="relative">
                      <pre className="p-3 bg-[#09090b] border border-[#27272a] rounded-xl font-mono text-[11px] text-[#10b981] overflow-x-auto">
                        {hermesConfig}
                      </pre>
                      <button
                        type="button"
                        onClick={() => handleCopyConfig(hermesConfig)}
                        className="absolute right-2.5 top-2.5 px-2.5 py-1 bg-[#1f1f23] hover:bg-[#27272a] border border-[#2e2e34] rounded-lg text-[11px] text-[#f4f4f5] flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        {copiedConfig ? <Check className="w-3 h-3 text-[#10b981]" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedConfig ? 'Kopyalandı' : 'Kopyala'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === 'claude' && (
                  <div className="space-y-2">
                    <p className="text-[11px] text-[#a1a1aa]">
                      `claude_desktop_config.json` dosyanızın `mcpServers` bölümüne ekleyin:
                    </p>
                    <div className="relative">
                      <pre className="p-3 bg-[#09090b] border border-[#27272a] rounded-xl font-mono text-[11px] text-[#0ea5e9] overflow-x-auto">
                        {claudeDesktopConfig}
                      </pre>
                      <button
                        type="button"
                        onClick={() => handleCopyConfig(claudeDesktopConfig)}
                        className="absolute right-2.5 top-2.5 px-2.5 py-1 bg-[#1f1f23] hover:bg-[#27272a] border border-[#2e2e34] rounded-lg text-[11px] text-[#f4f4f5] flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        {copiedConfig ? <Check className="w-3 h-3 text-[#10b981]" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedConfig ? 'Kopyalandı' : 'Kopyala'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === 'examples' && (
                  <div className="space-y-2 text-xs text-[#d4d4d8]">
                    <p className="text-[11px] text-[#a1a1aa] mb-2">
                      Botunuzla konuşurken şu şekilde doğrudan Türkçe talimatlar verebilirsiniz:
                    </p>
                    <div className="space-y-1.5">
                      <div className="p-2.5 bg-[#09090b] border border-[#27272a] rounded-lg">
                        <span className="text-[#10b981] font-semibold">Harcama Ekleme:</span>
                        <div className="text-[11px] text-[#a1a1aa] mt-0.5">
                          "Bugün Kuveyt Türk Sağlam Kart ile 350 TL öğle yemeği yedim, SpenTrack'e ekle"
                        </div>
                      </div>
                      <div className="p-2.5 bg-[#09090b] border border-[#27272a] rounded-lg">
                        <span className="text-[#0ea5e9] font-semibold">Bakiye & Kategori Sorgulama:</span>
                        <div className="text-[11px] text-[#a1a1aa] mt-0.5">
                          "Bu ay dışarıda yemek kategorisine toplam ne kadar harcamışım kontrol et"
                        </div>
                      </div>
                      <div className="p-2.5 bg-[#09090b] border border-[#27272a] rounded-lg">
                        <span className="text-[#f59e0b] font-semibold">İade ve Taksit:</span>
                        <div className="text-[11px] text-[#a1a1aa] mt-0.5">
                          "Teknosa'dan 4.500 TL elektronik harcaması yaptım, 3 taksit olarak kaydet"
                        </div>
                      </div>
                      <div className="p-2.5 bg-[#09090b] border border-[#27272a] rounded-lg">
                        <span className="text-[#8b5cf6] font-semibold">Listeleme:</span>
                        <div className="text-[11px] text-[#a1a1aa] mt-0.5">
                          "Son 5 harcamamı göster"
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 3. Canlı Test Butonu */}
          {hasKey && (
            <div className="p-3.5 bg-[#18181c] border border-[#27272a] rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs">
                <div className="font-semibold text-[#f4f4f5]">MCP Uç Noktası Canlılık Testi</div>
                <div className="text-[#a1a1aa] text-[11px]">
                  Botunuzun bağlanacağı JSON-RPC `tools/list` yanıtını tarayıcıdan simüle edin.
                </div>
              </div>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testStatus?.loading}
                className="px-3.5 py-1.5 text-xs font-semibold bg-[#27272a] hover:bg-[#3f3f46] text-[#f4f4f5] rounded-lg transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
              >
                {testStatus?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 text-[#10b981]" />}
                <span>Bağlantıyı Test Et</span>
              </button>
            </div>
          )}

          {testStatus && !testStatus.loading && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                testStatus.success
                  ? 'bg-[#10b981]/15 border-[#10b981]/30 text-[#10b981]'
                  : 'bg-[#f43f5e]/15 border-[#f43f5e]/30 text-[#f43f5e]'
              }`}
            >
              {testStatus.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              <span>{testStatus.message}</span>
            </div>
          )}
        </div>

        {/* Alt Kısım */}
        <div className="px-6 py-3.5 border-t border-[#27272a] bg-[#18181c] flex items-center justify-between">
          <div className="text-[11px] text-[#71717a] font-mono">
            Cloudflare Workers + D1 · $0 / ay
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-xs font-semibold text-[#f4f4f5] rounded-xl transition-colors cursor-pointer"
          >
            Tamam
          </button>
        </div>
      </div>
    </div>
  );
};
