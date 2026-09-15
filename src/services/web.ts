export async function fetchWebsiteContent(inputUrl: string): Promise<{ content: string; title?: string }> {
  try {
    const url = new URL(inputUrl);
    
    // Block private IPs
    if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      throw new Error('Private URLs not allowed');
    }
    
    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SafroiBot/1.0)'
      }
    });
    
    if (!res.ok) {
      throw new Error(`Failed to fetch URL: ${res.status}`);
    }
    
    const html = await res.text();
    
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : undefined;
    
    // Strip HTML tags
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    return { content: text, title };
  } catch (err) {
    console.error('[Web] Fetch error:', err);
    throw new Error('Failed to fetch website content');
  }
}
