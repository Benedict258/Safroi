import { ocrImage as ocrFromIndex } from '../ocr/index';

export async function ocrImage(base64: string, mimeType?: string): Promise<string> {
  try {
    const buffer = Buffer.from(base64, 'base64');
    const result = await ocrFromIndex(buffer);
    return result.text || '';
  } catch (err) {
    console.error('[OCR] Error:', err);
    throw new Error('Failed to extract text from image');
  }
}
