import React, { useEffect, useState } from 'react';
import { ExternalLink, Check, Loader2, Eye, EyeOff } from 'lucide-react';

export function sanitizeClientApiKey(raw: string): string {
  if (!raw) return '';
  let cleaned = raw
    .replace(/[\u200B-\u200D\uFEFF\r\n\t]/g, '')
    .trim()
    .replace(/^(?:GEMINI_API_KEY|VITE_GEMINI_API_KEY|API_KEY|Bearer)\s*[:=]\s*/i, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .trim();

  const aizaMatch = cleaned.match(/AIza[0-9A-Za-z_-]{25,}/);
  if (aizaMatch) {
    cleaned = aizaMatch[0];
  }
  return cleaned;
}

interface AccountApiKeyBoxProps {
  savedApiKey: string;
  isAuthenticated: boolean;
  onSaveApiKey: (apiKey: string) => Promise<void>;
  onDraftKeyChange?: (draftKey: string) => void;
  compact?: boolean;
}

export const AccountApiKeyBox: React.FC<AccountApiKeyBoxProps> = ({
  savedApiKey,
  isAuthenticated,
  onSaveApiKey,
  onDraftKeyChange,
  compact = false,
}) => {
  const [draftKey, setDraftKey] = useState(savedApiKey || '');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setDraftKey(savedApiKey || '');
  }, [savedApiKey]);

  const updateDraft = (val: string) => {
    setDraftKey(val);
    onDraftKeyChange?.(sanitizeClientApiKey(val));
    if (feedback) setFeedback(null);
  };

  const handleSave = async () => {
    const cleaned = sanitizeClientApiKey(draftKey);
    if (!cleaned) {
      setFeedback({ type: 'err', text: 'Lütfen geçerli bir Gemini API anahtarı girin.' });
      return;
    }
    if (!cleaned.startsWith('AIza') || cleaned.length < 30) {
      setFeedback({
        type: 'err',
        text: "Geçersiz anahtar formatı. Google Gemini API anahtarları 'AIza' ile başlar (örn: AIzaSy...).",
      });
      return;
    }

    setDraftKey(cleaned);
    onDraftKeyChange?.(cleaned);
    setSaving(true);
    setFeedback(null);
    try {
      await onSaveApiKey(cleaned);
      setFeedback({
        type: 'ok',
        text: isAuthenticated
          ? 'API anahtarı giriş yapılan hesabınıza tanımlandı.'
          : 'API anahtarı aktif oturuma tanımlandı.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Anahtar kaydedilemedi.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      await onSaveApiKey('');
      setDraftKey('');
      onDraftKeyChange?.('');
      setFeedback({
        type: 'ok',
        text: 'API anahtarı hesabınızdan kaldırıldı.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Anahtar kaldırılamadı.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`${
        compact
          ? 'bg-[#121215] border-b border-[#27272a] px-5 py-3.5'
          : 'bg-[#121215] border border-[#27272a] rounded-xl p-4'
      } space-y-2.5 text-left`}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-[#10b981] hover:underline"
        >
          <span>Ücretsiz Gemini API Anahtarı Al</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <span className="text-[#52525b]">·</span>
        <span className="text-[#a1a1aa]">
          {isAuthenticated
            ? 'Tarayıcıya değil, doğrudan giriş yapılan hesabınıza güvenle tanımlanır'
            : 'Giriş yaptığınızda doğrudan Google hesabınıza tanımlanır'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <input
            type={showKey ? 'text' : 'password'}
            aria-label="Gemini API Anahtarı"
            value={draftKey}
            onChange={(e) => updateDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSave();
              }
            }}
            placeholder="AIzaSy..."
            className="w-full pl-3.5 pr-9 py-2 bg-[#09090b] border border-[#27272a] rounded-xl text-xs sm:text-sm font-mono text-[#f4f4f5] placeholder-[#71717a] focus:outline-none focus:border-[#10b981]"
          />
          <button
            type="button"
            onClick={() => setShowKey((prev) => !prev)}
            aria-label={showKey ? 'Anahtarı gizle' : 'Anahtarı göster'}
            title={showKey ? 'Anahtarı gizle' : 'Anahtarı göster'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#71717a] hover:text-[#f4f4f5] cursor-pointer"
          >
            {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-xs sm:text-sm font-semibold bg-[#27272a] hover:bg-[#3f3f46] text-[#f4f4f5] rounded-xl transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          <span>Kaydet</span>
        </button>
        <button
          type="button"
          onClick={handleRemove}
          disabled={saving || (!savedApiKey && !draftKey)}
          className="px-2.5 py-2 text-xs sm:text-sm font-medium text-[#71717a] hover:text-[#f43f5e] transition-colors shrink-0 cursor-pointer disabled:opacity-40"
        >
          Kaldır
        </button>
      </div>

      {feedback && (
        <div
          className={`text-xs flex items-center gap-1.5 ${
            feedback.type === 'ok' ? 'text-[#10b981]' : 'text-[#f43f5e]'
          }`}
        >
          {feedback.type === 'ok' && <Check className="w-3.5 h-3.5 shrink-0" />}
          <span>{feedback.text}</span>
        </div>
      )}
    </div>
  );
};
