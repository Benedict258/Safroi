import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

export interface WordBox {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
  pageIndex: number;
}

export interface ClauseLocation {
  clauseText: string;
  severity: 'low' | 'medium' | 'high';
  pageIndex: number;
  words: WordBox[];
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
}

interface OcrResult {
  text: string;
  words: WordBox[];
  pageCount: number;
}

interface PageOcrResult {
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

async function preprocessImage(buffer: Buffer): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata();
  const { width = 800, height = 600 } = metadata;

  let processed = sharp(buffer);

  if (width < 1000) {
    const scaleFactor = 1000 / width;
    processed = processed.resize({ width: Math.round(width * scaleFactor), height: Math.round(height * scaleFactor), kernel: sharp.kernel.lanczos3 });
  }

  processed = processed
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.2 })
    .threshold(140)
    .png();

  return processed.toBuffer();
}

async function ocrSinglePage(buffer: Buffer, pageIndex: number): Promise<PageOcrResult> {
  const w = await getWorker();
  const preprocessed = await preprocessImage(buffer);
  const { data } = await w.recognize(preprocessed);

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
              pageIndex,
            });
          }
        }
      }
    }
  }

  return { text: data.text, words };
}

export async function ocrImage(buffer: Buffer): Promise<OcrResult> {
  const metadata = await sharp(buffer).metadata();
  const pages = metadata.pages || 1;

  if (pages <= 1) {
    const result = await ocrSinglePage(buffer, 0);
    return { text: result.text, words: result.words, pageCount: 1 };
  }

  console.log(`[OCR] Multi-page document detected: ${pages} pages`);
  const allWords: WordBox[] = [];
  const pageTexts: string[] = [];

  for (let page = 0; page < pages; page++) {
    console.log(`[OCR] Processing page ${page + 1}/${pages}...`);
    const pageBuffer = await sharp(buffer, { page }).png().toBuffer();
    const result = await ocrSinglePage(pageBuffer, page);
    allWords.push(...result.words);
    pageTexts.push(result.text);
  }

  const combinedText = pageTexts.map((text, i) => `\n--- PAGE ${i + 1} ---\n${text}`).join('\n');
  console.log(`[OCR] Multi-page complete: ${allWords.length} words across ${pages} pages`);

  return { text: combinedText, words: allWords, pageCount: pages };
}

export async function highlightImage(
  buffer: Buffer,
  words: WordBox[],
  clauses: { text: string; severity: 'low' | 'medium' | 'high' }[]
): Promise<{ buffer: Buffer; matchCount: number; locations: ClauseLocation[] }> {
  const metadata = await sharp(buffer).metadata();
  const pages = metadata.pages || 1;
  const { width = 800, height = 600 } = metadata;

  const locations: ClauseLocation[] = [];

  if (pages <= 1) {
    return highlightSinglePage(buffer, words, clauses, width!, height!, 0, locations);
  }

  const pageBuffers: { input: Buffer; page: number }[] = [];
  for (let page = 0; page < pages; page++) {
    const pageBuffer = await sharp(buffer, { page }).png().toBuffer();
    const pageMeta = await sharp(pageBuffer).metadata();
    const pageWords = words.filter(w => w.pageIndex === page);
    const pageClauses = clauses;

    const result = await highlightSinglePage(
      pageBuffer, pageWords, pageClauses,
      pageMeta.width || width!, pageMeta.height || height!, page, locations
    );
    pageBuffers.push({ input: result.buffer, page });
  }

  const outputs = await Promise.all(
    pageBuffers.map(p => sharp(p.input).metadata().then(m => ({ ...p, width: m.width!, height: m.height! })))
  );

  const totalHeight = outputs.reduce((sum, p) => sum + p.height, 0);
  const maxWidth = Math.max(...outputs.map(p => p.width));

  const compositeInputs: sharp.OverlayOptions[] = [];
  let yOffset = 0;
  for (const page of outputs) {
    compositeInputs.push({ input: page.input, top: yOffset, left: 0 });
    yOffset += page.height;
  }

  const combined = await sharp({
    create: { width: maxWidth, height: totalHeight, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
  }).composite(compositeInputs).png().toBuffer();

  const totalMatches = locations.reduce((sum, loc) => sum + loc.words.length, 0);
  return { buffer: combined, matchCount: totalMatches, locations };
}

async function highlightSinglePage(
  buffer: Buffer,
  words: WordBox[],
  clauses: { text: string; severity: 'low' | 'medium' | 'high' }[],
  pageWidth: number,
  pageHeight: number,
  pageIndex: number,
  locations: ClauseLocation[]
): Promise<{ buffer: Buffer; matchCount: number; locations: ClauseLocation[] }> {
  const overlays: { input: Buffer; top: number; left: number }[] = [];
  const pageLocations: ClauseLocation[] = [];

  for (const clause of clauses) {
    const searchTerms = clause.text.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    let matched = words.filter(w =>
      searchTerms.some(t => w.text.toLowerCase().includes(t)) && w.confidence > 25
    );

    if (matched.length === 0 && searchTerms.length > 0) {
      for (const term of searchTerms.slice(0, 3)) {
        const fallback = words.filter(w => w.text.toLowerCase().includes(term) && w.confidence > 25);
        matched.push(...fallback.slice(0, 2));
      }
    }

    const uniqueMatched = matched.filter((w, i, arr) => arr.findIndex(x => x.text === w.text && x.bbox.x0 === w.bbox.x0) === i);

    if (uniqueMatched.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const m of uniqueMatched) {
        minX = Math.min(minX, m.bbox.x0);
        minY = Math.min(minY, m.bbox.y0);
        maxX = Math.max(maxX, m.bbox.x1);
        maxY = Math.max(maxY, m.bbox.y1);
      }

      locations.push({
        clauseText: clause.text,
        severity: clause.severity,
        pageIndex,
        words: uniqueMatched,
        bbox: { x0: minX, y0: minY, x1: maxX, y1: maxY },
      });

      for (const m of uniqueMatched) {
        const pad = 4;
        const x = Math.max(0, m.bbox.x0 - pad);
        const y = Math.max(0, m.bbox.y0 - pad);
        const w2 = Math.min(pageWidth - x, m.bbox.x1 - m.bbox.x0 + pad * 2);
        const h2 = Math.min(pageHeight - y, m.bbox.y1 - m.bbox.y0 + pad * 2);
        const color = clause.severity === 'high' ? { r: 239, g: 68, b: 68, alpha: 0.45 } :
                      clause.severity === 'medium' ? { r: 245, g: 158, b: 11, alpha: 0.45 } :
                      { r: 34, g: 197, b: 94, alpha: 0.45 };
        const rect = await sharp({ create: { width: w2, height: h2, channels: 4, background: color } })
          .png().toBuffer();
        overlays.push({ input: rect, top: y, left: x });
      }
    }
  }

  if (overlays.length === 0) {
    return { buffer, matchCount: 0, locations: pageLocations };
  }

  const highlighted = await sharp(buffer)
    .composite(overlays)
    .png()
    .toBuffer();

  return { buffer: highlighted, matchCount: overlays.length, locations: pageLocations };
}

export async function shutdownWorker() {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
