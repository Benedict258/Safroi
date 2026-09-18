import OpenAI from 'openai';

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

if (!NVIDIA_API_KEY) {
  console.warn('NVIDIA_API_KEY not set. NIM models will not be available.');
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    if (!NVIDIA_API_KEY) {
      throw new Error('NVIDIA_API_KEY is required for NIM models');
    }
    client = new OpenAI({
      baseURL: NVIDIA_BASE_URL,
      apiKey: NVIDIA_API_KEY,
    });
  }
  return client;
}

export const MODELS = {
  GLM_5_3: 'z-ai/glm-5.3',
  GLM_5_2: 'z-ai/glm-5.2', // fallback
  CONTENT_SAFETY: 'nvidia/nemotron-3.5-content-safety',
} as const;

export async function generateWithGLM5(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: { temperature?: number; maxTokens?: number; model?: string }
): Promise<string> {
  const client = getClient();
  const model = options?.model || MODELS.GLM_5_3;
  
  try {
    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature: options?.temperature ?? 0.1,
      top_p: 1,
      max_tokens: options?.maxTokens ?? 4096,
      stream: false,
    });
    
    return completion.choices[0]?.message?.content || '';
  } catch (err) {
    console.error(`[NVIDIA GLM] Error with model ${model}:`, err);
    
    // Fallback to GLM-5.2 if GLM-5.3 fails
    if (model === MODELS.GLM_5_3) {
      console.log('[NVIDIA GLM] Falling back to GLM-5.2');
      return generateWithGLM5(messages, { ...options, model: MODELS.GLM_5_2 });
    }
    
    throw err;
  }
}

export async function analyzeContractWithGLM(
  contractText: string,
  targetLanguage: string = 'English'
): Promise<string> {
  const prompt = `
You are a legal AI assistant analyzing Terms of Service and Privacy Policies.

Task: Analyze the following contract text and provide a structured analysis.

Contract Text:
${contractText}

Output schema (JSON only, no markdown):
{
  "legal_explanation": "Detailed legal analysis in ${targetLanguage}",
  "plain_language": "Simple explanation in ${targetLanguage}",
  "impact": "One sentence impact summary in ${targetLanguage}",
  "category": "Privacy|Data|Security|Payments|Terms|Other"
}

Requirements:
- Produce output directly in ${targetLanguage} (no need to translate later)
- Keep legal explanation technical and detailed
- Plain language must be understandable to non-lawyers
- Category must be one of the specified options
`;

  const messages = [
    { role: 'system', content: 'You are a legal AI assistant specializing in contract analysis.' },
    { role: 'user', content: prompt }
  ];

  return generateWithGLM5(messages, { temperature: 0.1, maxTokens: 8192 });
}

export async function checkImageSafety(imageBase64: string, mimeType: string): Promise<{ safe: boolean; reasons?: string[] }> {
  const client = getClient();
  
  try {
    const completion = await client.chat.completions.create({
      model: MODELS.CONTENT_SAFETY,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Is this image safe for processing? Analyze for NSFW, violence, hate, or other inappropriate content. Return JSON: {"safe": boolean, "reasons": []}'
            },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${imageBase64}` }
            }
          ]
        }
      ],
      temperature: 0,
      max_tokens: 256,
    });

    const content = completion.choices[0]?.message?.content || '{}';
    
    try {
      const result = JSON.parse(content);
      return {
        safe: result.safe === true,
        reasons: result.reasons || []
      };
    } catch {
      // If parsing fails, be conservative
      return { safe: false, reasons: ['Unable to parse safety check result'] };
    }
  } catch (err) {
    console.error('[NVIDIA Safety] Error:', err);
    // Fail closed - reject if safety check fails
    return { safe: false, reasons: ['Safety check failed'] };
  }
}
