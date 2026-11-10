export interface PreparedAttachment {
  name: string;
  mimeType: string;
  data: string; // Base64 string without data URL prefix
  previewUrl?: string;
  sizeKB: number;
}

/**
 * Yüklenen veya Ctrl+V ile yapıştırılan görselleri HTML5 Canvas ile max 1600px boyutuna
 * ve JPEG (0.8 kalite) formatına sıkıştırır. PDF dosyalarını doğrudan base64 olarak hazırlar.
 */
export async function prepareFileForGemini(file: File): Promise<PreparedAttachment> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const base64 = await fileToBase64(file);
    return {
      name: file.name || 'ekstre.pdf',
      mimeType: 'application/pdf',
      data: base64,
      sizeKB: Math.round(file.size / 1024),
    };
  }

  if (file.type.startsWith('image/')) {
    return compressImageOnCanvas(file, 1024, 0.68);
  }

  throw new Error('Desteklenmeyen dosya formatı. Lütfen görsel (PNG/JPEG/WebP) veya PDF yükleyin.');
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Dosya okunamadı.'));
    reader.readAsDataURL(file);
  });
}

function compressImageOnCanvas(
  file: File,
  maxDimension = 1024,
  quality = 0.68
): Promise<PreparedAttachment> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Görsel sıkıştırma zaman aşımına uğradı. Lütfen farklı bir ekran görüntüsü deneyin.'));
    }, 6000);

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        clearTimeout(timeoutId);
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas başlatılamadı.'));
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
        const commaIdx = jpegDataUrl.indexOf(',');
        const base64Data = commaIdx >= 0 ? jpegDataUrl.slice(commaIdx + 1) : jpegDataUrl;

        resolve({
          name: file.name.replace(/\.[^.]+$/, '') + '.jpg',
          mimeType: 'image/jpeg',
          data: base64Data,
          previewUrl: jpegDataUrl,
          sizeKB: Math.max(1, Math.round((base64Data.length * 3) / 4 / 1024)),
        });
      };
      img.onerror = () => {
        clearTimeout(timeoutId);
        reject(new Error('Görsel işlenemedi.'));
      };
      img.src = dataUrl;
    };
    reader.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error('Görsel okunamadı.'));
    };
    reader.readAsDataURL(file);
  });
}
