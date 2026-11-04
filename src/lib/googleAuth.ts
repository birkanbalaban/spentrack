export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  geminiApiKey?: string;
}

export interface GoogleAuthResult {
  token: string;
  user: AuthenticatedUser;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: (response: {
              access_token?: string;
              error?: string;
              error_description?: string;
            }) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => {
            requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
          };
        };
      };
    };
  }
}

export const BUILTIN_GOOGLE_CLIENT_ID =
  (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ||
  '543473186717-h94d3vvjuncdde0l6jl5fra1dri548nv.apps.googleusercontent.com';

export function triggerDirectGoogleLogin(
  onSuccess: (result: GoogleAuthResult) => void,
  onError?: (errorMessage: string) => void
): void {
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2 || typeof oauth2.initTokenClient !== 'function') {
    onError?.(
      'Google giriş servisi henüz yüklenmedi. Lütfen sayfayı yenileyip tekrar deneyin.'
    );
    return;
  }

  try {
    const tokenClient = oauth2.initTokenClient({
      client_id: BUILTIN_GOOGLE_CLIENT_ID,
      scope: 'openid email profile',
      prompt: 'select_account',
      callback: async (tokenResponse) => {
        if (tokenResponse.error || !tokenResponse.access_token) {
          onError?.(
            tokenResponse.error_description ||
              tokenResponse.error ||
              'Google oturumu doğrulanamadı.'
          );
          return;
        }

        try {
          const userInfoRes = await fetch(
            'https://www.googleapis.com/oauth2/v3/userinfo',
            {
              headers: {
                Authorization: `Bearer ${tokenResponse.access_token}`,
              },
            }
          );

          if (!userInfoRes.ok) {
            throw new Error('Google kullanıcı profili alınamadı.');
          }

          const info = await userInfoRes.json();
          const payload = {
            id: String(info.sub || info.id || info.email),
            email: String(info.email || ''),
            name: String(
              info.name || info.given_name || info.email?.split('@')[0] || 'Kullanıcı'
            ),
            avatarUrl: info.picture ? String(info.picture) : undefined,
          };

          const authRes = await fetch('/api/auth/google', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          });

          if (!authRes.ok) {
            const errData = await authRes.json().catch(() => ({}));
            throw new Error(errData.error || 'Sunucu oturumu oluşturulamadı.');
          }

          const authData: GoogleAuthResult = await authRes.json();
          onSuccess(authData);
        } catch (err) {
          onError?.(
            err instanceof Error
              ? err.message
              : 'Google hesabı doğrulanırken bir hata oluştu.'
          );
        }
      },
      error_callback: (err) => {
        if (err?.type === 'popup_closed') {
          return;
        }
        onError?.(err?.message || 'Google giriş penceresi açılamadı.');
      },
    });

    tokenClient.requestAccessToken({ prompt: 'select_account' });
  } catch (err) {
    onError?.(
      err instanceof Error ? err.message : 'Google girişi başlatılamadı.'
    );
  }
}
