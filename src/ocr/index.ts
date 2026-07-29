import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

interface WordBox {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

interface OcrResult {
  text: string;
  words: WordBox[];
}

let worker: Awaited<ReturnType<typeof createWorker>> | null = null;

async function getWorker() {
  if (!worker) {
    worker = await createWorker('eng', 1, {
      logger: m => { if (m.status === 'recognizing text') console.log(`[OCR] ${Math.round(m.progress * 100)}%`); },
    });
  }
  return worker;
}

export async function ocrImage(buffer: Buffer): Promise<OcrResult> {
  const w = await getWorker();
  const { data } = await w.recognize(buffer);

  const words: WordBox[] = [];
  if (data.blocks) {
    for (const block of data.blocks) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          for (const word of line.words) {
            words.push({
              text: word.text,
              bbox: { x0: word.bbox.x0, y0: word.bbox.y0, x1: word.bbox.x1, y1: word.bbox.y1 },
              confidence: word.confidence,
            });
          }
        }
      }
    }
  }

  return { text: data.text, words };
}

export async function highlightImage(
  buffer: Buffer,
  words: WordBox[],
  clauses: { text: string; severity: 'low' | 'medium' | 'high' }[]
): Promise<{ buffer: Buffer; matchCount: number }> {
  const { width = 800, height = 600 } = await sharp(buffer).metadata();
  const overlays: { input: Buffer; top: number; left: number }[] = [];

  for (const clause of clauses) {
    const searchTerms = clause.text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const matched = words.filter(w =>
      searchTerms.some(t => w.text.toLowerCase().includes(t)) && w.confidence > 30
    );
    if (matched.length === 0 && searchTerms.length > 0) {
      const firstTerm = searchTerms[0];
      const fallback = words.filter(w => w.text.toLowerCase().includes(firstTerm) && w.confidence > 30);
      matched.push(...fallback.slice(0, 3));
    }
    for (const m of matched) {
      const pad = 4;
      const x = Math.max(0, m.bbox.x0 - pad);
      const y = Math.max(0, m.bbox.y0 - pad);
      const w2 = Math.min(width! - x, m.bbox.x1 - m.bbox.x0 + pad * 2);
      const h2 = Math.min(height! - y, m.bbox.y1 - m.bbox.y0 + pad * 2);
      const color = clause.severity === 'high' ? { r: 239, g: 68, b: 68, alpha: 0.50 } :
                    clause.severity === 'medium' ? { r: 245, g: 158, b: 11, alpha: 0.50 } :
                    { r: 34, g: 197, b: 94, alpha: 0.50 };
      const rect = await sharp({ create: { width: w2, height: h2, channels: 4, background: color } })
        .png().toBuffer();
      overlays.push({ input: rect, top: y, left: x });
    }
  }

  if (overlays.length === 0) {
    return { buffer, matchCount: 0 };
  }

  const highlighted = await sharp(buffer)
    .composite(overlays)
    .png()
    .toBuffer();

  return { buffer: highlighted, matchCount: overlays.length };
}

export async function shutdownWorker() {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
