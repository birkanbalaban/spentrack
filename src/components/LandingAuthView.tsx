import React, { useState } from 'react';
import {
  Eye,
  ShieldCheck,
  Lock,
  Sparkles,
  FileSpreadsheet,
  Tags,
  ArrowRight,
  X,
  Wallet,
  TrendingUp,
  PieChart,
  CheckCircle2,
  ScanLine,
  Coins,
} from 'lucide-react';

interface LandingAuthViewProps {
  onGoogleLogin: () => void;
  onStartDemo: () => void;
  authError?: string | null;
  isLoggingIn?: boolean;
}

const PREVIEW_EXPENSES = [
  {
    id: 'p1',
    title: 'Migros Jet',
    category: 'Market',
    color: '#10b981',
    tags: ['#saglamkart', '#market'],
    date: 'Bugün · 18:40',
    amount: '₺840,00',
  },
  {
    id: 'p2',
    title: 'Shell Akaryakıt',
    category: 'Ulaşım',
    color: '#0ea5e9',
    tags: ['#yapikredi', '#akaryakit'],
    date: 'Dün · 14:15',
    amount: '₺1.650,00',
  },
  {
    id: 'p3',
    title: 'Starbucks',
    category: 'Yeme & İçme',
    color: '#f97316',
    tags: ['#enpara', '#kahve'],
    date: '2 Kasım · 10:20',
    amount: '₺145,00',
  },
  {
    id: 'p4',
    title: 'Amazon TR',
    category: 'Alışveriş',
    color: '#8b5cf6',
    tags: ['#garanti', '#taksit'],
    date: '1 Kasım · 21:05',
    amount: '₺1.290,00',
  },
];

const GoogleGIcon = () => (
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

export const LandingAuthView: React.FC<LandingAuthViewProps> = ({
  onGoogleLogin,
  onStartDemo,
  authError,
  isLoggingIn = false,
}) => {
  const [legalModal, setLegalModal] = useState<'privacy' | 'terms' | null>(null);

  return (
    <div className="min-h-screen bg-[#09090b] text-[#f4f4f5] flex flex-col selection:bg-[#10b981]/20 selection:text-[#10b981]">
      {/* 1. Üst Bar (Sticky Header) */}
      <header className="sticky top-0 z-40 bg-[#09090b]/90 backdrop-blur-md border-b border-[#27272a]">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          {/* Sol: ST Rozeti ve SpenTrack Başlığı */}
          <a
            href="#top"
            className="flex items-center gap-3 text-[#f4f4f5] hover:opacity-90 transition-opacity"
          >
            <span className="w-9 h-9 rounded-xl bg-[#18181b] border border-[#27272a] flex items-center justify-center font-mono text-xs font-bold tracking-wider text-[#f4f4f5]">
              ST
            </span>
            <span className="text-lg font-bold tracking-tight">SpenTrack</span>
          </a>

          {/* Orta: Navigasyon Bağlantıları */}
          <nav
            aria-label="Karşılama Sayfası Navigasyonu"
            className="hidden md:flex items-center gap-8 text-sm font-medium text-[#a1a1aa]"
          >
            <a href="#features" className="hover:text-[#f4f4f5] transition-colors">
              Özellikler
            </a>
            <a href="#preview" className="hover:text-[#f4f4f5] transition-colors">
              Arayüz Önizleme
            </a>
            <a href="#security" className="hover:text-[#f4f4f5] transition-colors">
              Güvenlik & Gizlilik
            </a>
          </nav>

          {/* Sağ: Canlı Demo ve Google ile Giriş */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={onStartDemo}
              className="px-3.5 py-2 text-xs sm:text-sm font-medium bg-[#18181b] hover:bg-[#27272a] text-[#f4f4f5] border border-[#27272a] rounded-xl flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Eye className="w-4 h-4 text-[#10b981]" />
              <span>Canlı Demo</span>
            </button>

            <button
              type="button"
              onClick={onGoogleLogin}
              disabled={isLoggingIn}
              className="px-4 py-2 text-xs sm:text-sm font-semibold bg-[#f4f4f5] hover:bg-white text-[#09090b] rounded-xl flex items-center gap-2.5 transition-colors shadow-sm cursor-pointer disabled:opacity-60"
            >
              <GoogleGIcon />
              <span>{isLoggingIn ? 'Bağlanılıyor...' : 'Google ile Giriş'}</span>
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-12 sm:py-20 space-y-20">
        {/* 2. Hero Bölümü */}
        <section className="text-center max-w-3xl mx-auto space-y-6">
          {/* Üstte 3 Minimal Rozet */}
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <span className="px-3.5 py-1.5 rounded-xl bg-[#121215] border border-[#27272a] text-xs font-medium text-[#d4d4d8] inline-flex items-center gap-2">
              <ScanLine className="w-3.5 h-3.5 text-[#0ea5e9]" />
              <span>Ekstre & Fiş Okuma</span>
            </span>
            <span className="px-3.5 py-1.5 rounded-xl bg-[#121215] border border-[#27272a] text-xs font-medium text-[#d4d4d8] inline-flex items-center gap-2">
              <Coins className="w-3.5 h-3.5 text-[#10b981]" />
              <span>Çoklu Para Birimi</span>
            </span>
            <span className="px-3.5 py-1.5 rounded-xl bg-[#121215] border border-[#27272a] text-xs font-medium text-[#d4d4d8] inline-flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#8b5cf6]" />
              <span>Gemini Destekli</span>
            </span>
          </div>

          {/* Ana Başlık */}
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-[#f4f4f5] leading-[1.15]">
            Tüm Harcamalarınızı Tek Merkezden Akıllıca Yönetin
          </h1>

          {/* Alt Açıklama */}
          <p className="text-base sm:text-lg text-[#a1a1aa] leading-relaxed max-w-2xl mx-auto">
            Kredi kartı ekstreleri, market fişleri ve günlük giderler... Ekran görüntüsü yükleyerek
            veya saniyeler içinde yazarak harcamalarınızı etiketleyin, kategorilere ayırın ve
            bütçenizi kontrol altına alın.
          </p>

          {authError && (
            <div className="max-w-md mx-auto p-3.5 rounded-xl bg-[#f43f5e]/10 border border-[#f43f5e]/30 text-sm text-[#f43f5e]">
              {authError}
            </div>
          )}

          {/* İki Ana Buton (CTA) */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2">
            <button
              type="button"
              onClick={onGoogleLogin}
              disabled={isLoggingIn}
              className="w-full sm:w-auto px-7 py-3.5 text-sm sm:text-base font-bold bg-[#f4f4f5] hover:bg-white text-[#09090b] rounded-xl flex items-center justify-center gap-3 transition-colors shadow-lg cursor-pointer disabled:opacity-60"
            >
              <GoogleGIcon />
              <span>{isLoggingIn ? 'Google Hesabına Bağlanılıyor...' : 'Google ile Başla'}</span>
            </button>

            <button
              type="button"
              onClick={onStartDemo}
              className="w-full sm:w-auto px-7 py-3.5 text-sm sm:text-base font-semibold bg-[#18181b] hover:bg-[#27272a] text-[#f4f4f5] border border-[#27272a] rounded-xl flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
            >
              <Eye className="w-4 h-4 text-[#10b981]" />
              <span>Canlı Demoyu İncele</span>
            </button>
          </div>

          {/* Alt Güvence Satırı */}
          <p className="text-xs sm:text-sm text-[#71717a] pt-1">
            Kayıt gerektirmez · Kredi kartı gerekmez · Güvenli bulut senkronizasyonu
          </p>
        </section>

        {/* 3. Arayüz Önizleme Kartı (#preview) */}
        <section id="preview" className="space-y-5 scroll-mt-24">
          <div className="bg-[#121215] border border-[#27272a] rounded-2xl p-5 sm:p-8 shadow-2xl space-y-6">
            {/* Önizleme Üst Çubuğu */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#27272a]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#18181b] border border-[#27272a] flex items-center justify-center font-mono text-xs font-bold text-[#f4f4f5]">
                  ST
                </div>
                <div>
                  <div className="text-sm font-bold text-[#f4f4f5]">
                    SpenTrack Kontrol Paneli Önizlemesi
                  </div>
                  <div className="text-xs text-[#a1a1aa]">
                    Gerçek zamanlı kur dönüşümü, banka etiketleri ve akıllı ekstre analizi
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg bg-[#18181b] border border-[#27272a] font-mono text-xs text-[#10b981]">
                  ₺ TRY · $ USD · € EUR · £ GBP
                </span>
              </div>
            </div>

            {/* 4'lü Özet Metrik Kutusu */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-[#a1a1aa]">
                  <span>Bu Ay Toplam Harcama</span>
                  <Wallet className="w-4 h-4 text-[#71717a]" />
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-[#f4f4f5]">
                  ₺18.450,00
                </div>
                <div className="text-xs text-[#71717a]">İadeler düşülmüş net toplam</div>
              </div>

              <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-[#a1a1aa]">
                  <span>İşlem Sayısı</span>
                  <CheckCircle2 className="w-4 h-4 text-[#71717a]" />
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-[#f4f4f5]">
                  24 Harcama
                </div>
                <div className="text-xs text-[#71717a]">Fiş, ekstre ve manuel kayıtlar</div>
              </div>

              <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-[#a1a1aa]">
                  <span>En Yüksek Kategori</span>
                  <PieChart className="w-4 h-4 text-[#71717a]" />
                </div>
                <div className="text-xl font-bold text-[#f4f4f5] flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
                  <span>Market & Gıda</span>
                  <span className="text-xs font-mono text-[#10b981] ml-auto">%38</span>
                </div>
                <div className="text-xs text-[#71717a]">Lider etiket: #saglamkart</div>
              </div>

              <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-[#a1a1aa]">
                  <span>Günlük Ortalama</span>
                  <TrendingUp className="w-4 h-4 text-[#71717a]" />
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-[#f4f4f5]">
                  ₺615,00
                </div>
                <div className="text-xs text-[#71717a]">Son 30 günlük harcama temposu</div>
              </div>
            </div>

            {/* Örnek 4 Harcama Satırı */}
            <div className="bg-[#09090b] border border-[#27272a] rounded-xl divide-y divide-[#27272a]/70">
              {PREVIEW_EXPENSES.map((item) => (
                <div
                  key={item.id}
                  className="px-4 py-3.5 flex items-center justify-between gap-4 hover:bg-[#18181b]/50 transition-colors"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <div className="min-w-0">
                      <div className="text-sm sm:text-base font-semibold text-[#f4f4f5] truncate">
                        {item.title}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#a1a1aa] mt-0.5">
                        <span style={{ color: item.color }} className="font-medium">
                          {item.category}
                        </span>
                        <span>·</span>
                        {item.tags.map((tag) => (
                          <span key={tag} className="font-mono text-[#10b981]">
                            {tag}
                          </span>
                        ))}
                        <span className="hidden sm:inline">·</span>
                        <span className="hidden sm:inline text-[#71717a]">{item.date}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-sm sm:text-base font-mono font-bold tabular-nums text-[#f4f4f5] shrink-0">
                    -{item.amount}
                  </div>
                </div>
              ))}
            </div>

            {/* Kart Altı Canlı Demo Çağrısı */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-[#27272a]">
              <p className="text-sm text-[#a1a1aa]">
                Bu panoyu tarayıcınızda canlı verilerle denemek ister misiniz?
              </p>
              <button
                type="button"
                onClick={onStartDemo}
                className="px-5 py-2.5 text-sm font-semibold bg-[#18181b] hover:bg-[#27272a] text-[#f4f4f5] border border-[#27272a] hover:border-[#10b981] rounded-xl flex items-center gap-2 transition-colors cursor-pointer"
              >
                <span>Canlı Demoyu Aç (Tek Tık)</span>
                <ArrowRight className="w-4 h-4 text-[#10b981]" />
              </button>
            </div>
          </div>
        </section>

        {/* 4. Neden SpenTrack? (#features - 3 Kutu) */}
        <section id="features" className="space-y-8 scroll-mt-24">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <h2 className="text-2xl sm:text-3xl font-bold text-[#f4f4f5]">Neden SpenTrack?</h2>
            <p className="text-sm sm:text-base text-[#a1a1aa]">
              Karmaşık banka tabloları yerine hız, etiket ve yapay zeka odaklı yalın finans takibi.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="bg-[#121215] border border-[#27272a] rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-[#10b981] bg-[#10b981]/10 border border-[#10b981]/30 px-2.5 py-1 rounded-lg">
                  01
                </span>
                <FileSpreadsheet className="w-5 h-5 text-[#0ea5e9]" />
              </div>
              <h3 className="text-lg font-bold text-[#f4f4f5]">
                01. Ekran Görüntüsü & Fişten Otomatik Çıkarım
              </h3>
              <p className="text-sm text-[#a1a1aa] leading-relaxed">
                Kredi kartı ekstresi veya fiş görseli yükleyin; Gemini AI harcama kalemlerini,
                tutarları ve tarihleri saniyeler içinde ayıklayıp onayınıza sunsun.
              </p>
            </div>

            <div className="bg-[#121215] border border-[#27272a] rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-[#f97316] bg-[#f97316]/10 border border-[#f97316]/30 px-2.5 py-1 rounded-lg">
                  02
                </span>
                <Tags className="w-5 h-5 text-[#f97316]" />
              </div>
              <h3 className="text-lg font-bold text-[#f4f4f5]">
                02. Akıllı Etiketleme & Çoklu Para Birimi
              </h3>
              <p className="text-sm text-[#a1a1aa] leading-relaxed">
                TRY, USD, EUR ve GBP harcamalarınızı etiketleyin (
                <code className="font-mono text-[#10b981]">#tatil</code>,{' '}
                <code className="font-mono text-[#10b981]">#iş</code>,{' '}
                <code className="font-mono text-[#10b981]">#market</code>), canlı kurlarla tek para
                biriminde konsolide edin.
              </p>
            </div>

            <div className="bg-[#121215] border border-[#27272a] rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-[#8b5cf6] bg-[#8b5cf6]/10 border border-[#8b5cf6]/30 px-2.5 py-1 rounded-lg">
                  03
                </span>
                <Sparkles className="w-5 h-5 text-[#8b5cf6]" />
              </div>
              <h3 className="text-lg font-bold text-[#f4f4f5]">03. Gemini AI Harcama Asistanı</h3>
              <p className="text-sm text-[#a1a1aa] leading-relaxed">
                Harcama alışkanlıklarınızı analiz edin, kategori bazlı artışları yakalayın ve bütçe
                tasarruf önerileri alın.
              </p>
            </div>
          </div>
        </section>

        {/* 5. Güvenlik Kartı (#security) */}
        <section id="security" className="scroll-mt-24">
          <div className="bg-[#121215] border border-[#27272a] rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#10b981]">
                <ShieldCheck className="w-4 h-4" />
                <span>Tam Gizlilik ve İzole Veritabanı</span>
              </div>
              <h3 className="text-xl font-bold text-[#f4f4f5]">
                Finansal Verileriniz Yalnızca Size Aittir
              </h3>
              <p className="text-sm text-[#a1a1aa] leading-relaxed">
                SpenTrack banka şifrenizi veya kart numaranızı asla istemez. Tüm harcama kayıtlarınız
                kullanıcı kimliğinize özel izole veritabanında şifreli olarak saklanır ve dilediğiniz
                an JSON veya CSV formatında dışa aktarılabilir.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={onGoogleLogin}
                disabled={isLoggingIn}
                className="px-5 py-3 text-sm font-bold bg-[#f4f4f5] hover:bg-white text-[#09090b] rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                <span>Güvenli Giriş Yap</span>
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#27272a] bg-[#09090b] py-8 px-4 sm:px-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#71717a]">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#a1a1aa]">SpenTrack</span>
            <span>·</span>
            <span>Sıfır pazarlama çerezi · GDPR/KVKK uyumlu veri silme hakkı · 256-bit TLS şifreleme</span>
          </div>
          <div className="flex items-center gap-4 text-[#a1a1aa]">
            <button
              type="button"
              onClick={() => setLegalModal('privacy')}
              className="hover:text-[#f4f4f5] transition-colors cursor-pointer"
            >
              Gizlilik Politikası
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => setLegalModal('terms')}
              className="hover:text-[#f4f4f5] transition-colors cursor-pointer"
            >
              Kullanım Koşulları
            </button>
          </div>
        </div>
      </footer>

      {/* Gizlilik Politikası / Kullanım Koşulları Modalı */}
      {legalModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <div className="w-full max-w-lg bg-[#18181b] border border-[#27272a] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#27272a]">
              <h3 className="text-base font-bold text-[#f4f4f5]">
                {legalModal === 'privacy' ? 'Gizlilik Politikası' : 'Kullanım Koşulları'}
              </h3>
              <button
                type="button"
                onClick={() => setLegalModal(null)}
                className="p-1.5 rounded-lg text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#27272a] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-sm text-[#a1a1aa] space-y-3 leading-relaxed">
              {legalModal === 'privacy' ? (
                <>
                  <p>
                    <strong>1. Veri İzolasyonu:</strong> SpenTrack üzerinde oluşturduğunuz tüm harcama
                    ve etiket kayıtları yalnızca Google hesabınıza tanımlı benzersiz kullanıcı kimliği
                    altında izole olarak saklanır.
                  </p>
                  <p>
                    <strong>2. Belge İşleme:</strong> Yüklediğiniz fiş ve ekstre görüntüleri yalnızca
                    harcama satırlarını ayıklamak amacıyla anlık olarak işlenir; üçüncü taraf reklam
                    veya pazarlama ağlarıyla paylaşılmaz.
                  </p>
                  <p>
                    <strong>3. Veri Taşınabilirliği ve Silme:</strong> Verilerinizi dilediğiniz zaman
                    JSON/CSV olarak indirebilir veya kalıcı olarak silebilirsiniz.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <strong>1. Hizmet Tanımı:</strong> SpenTrack kişisel harcama, etiket ve bütçe
                    takibini kolaylaştıran yalın bir finansal organizasyon aracıdır.
                  </p>
                  <p>
                    <strong>2. Yapay Zeka Çıktıları:</strong> Ekstre ve fiş tarayıcısı tarafından
                    çıkarılan satırlar kaydetmeden önce onay tablosunda kullanıcı kontrolüne sunulur.
                  </p>
                  <p>
                    <strong>3. Güvenlik:</strong> Tüm bağlantılar 256-bit TLS şifreleme ve güvenli
                    oturum anahtarları ile korunmaktadır.
                  </p>
                </>
              )}
            </div>
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setLegalModal(null)}
                className="px-4 py-2 text-xs font-semibold bg-[#f4f4f5] text-[#09090b] rounded-xl cursor-pointer"
              >
                Anladım
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
