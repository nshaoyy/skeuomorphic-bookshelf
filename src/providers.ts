// SPDX-License-Identifier: AGPL-3.0-only
import type { Config } from './config.ts';
import { dataUrl } from './image/codec.ts';

export type Image = { bytes: Uint8Array; mime: string };
export class ProviderError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

/** Extracts the first JSON object from a model reply (tolerates ```json fences and surrounding prose). */
export function parseJsonReply(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new ProviderError('Model reply contained no JSON object', 0);
  return JSON.parse(body.slice(start, end + 1));
}

export class Providers {
  readonly config: Config;
  private readonly fetch: typeof fetch;
  calls = { vision: 0, image: 0 };
  constructor(config: Config, fetchImpl: typeof fetch = fetch) { this.config = config; this.fetch = fetchImpl; }

  private async post(url: string, apiKey: string, body: BodyInit, json: boolean) {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (json) headers['Content-Type'] = 'application/json';
    const res = await this.fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(180_000) });
    const text = await res.text();
    // Never echo request bodies or keys; the provider's own error text is kept short.
    if (!res.ok) throw new ProviderError(`Provider returned HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
    try { return JSON.parse(text); } catch { throw new ProviderError('Provider returned non-JSON response', res.status); }
  }

  /** One vision request; returns the parsed JSON object the prompt asks for. */
  async vision(prompt: string, images: Image[], maxTokens = 1500): Promise<any> {
    const { baseUrl, apiKey, model } = this.config.vision;
    this.calls.vision++;
    const reply = await this.post(`${baseUrl}/chat/completions`, apiKey, JSON.stringify({
      model, temperature: 0, max_tokens: maxTokens,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...images.map(i => ({ type: 'image_url', image_url: { url: dataUrl(i.bytes, i.mime) } }))] }],
    }), true);
    const content = reply?.choices?.[0]?.message?.content;
    const text = Array.isArray(content) ? content.map((c: any) => c.text ?? '').join('') : content;
    if (typeof text !== 'string') throw new ProviderError('Vision reply had no text content', 0);
    return parseJsonReply(text);
  }

  /** Generates a clean spine image from the straightened crop. Returns null when IMAGE_API_STYLE=none. */
  async spine(prompt: string, crop: Image): Promise<Image | null> {
    const { style, baseUrl, apiKey, model, size } = this.config.image;
    if (style === 'none') return null;
    this.calls.image++;
    let reply: any;
    if (style === 'openai-edits') {
      const form = new FormData();
      form.set('model', model); form.set('prompt', prompt); form.set('size', size); form.set('n', '1');
      form.set('image', new Blob([crop.bytes as BlobPart], { type: crop.mime }), crop.mime === 'image/png' ? 'spine.png' : 'spine.jpg');
      reply = await this.post(`${baseUrl}/images/edits`, apiKey, form, false);
    } else {
      reply = await this.post(`${baseUrl}/images/generations`, apiKey, JSON.stringify({ model, prompt, image: dataUrl(crop.bytes, crop.mime), size, n: 1, response_format: 'b64_json', watermark: false }), true);
    }
    const item = reply?.data?.[0];
    if (item?.b64_json) return { bytes: new Uint8Array(Buffer.from(item.b64_json, 'base64')), mime: sniff(Buffer.from(item.b64_json, 'base64')) };
    if (typeof item?.url === 'string' && /^https:\/\//.test(item.url)) {
      const res = await this.fetch(item.url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new ProviderError(`Could not download generated image (HTTP ${res.status})`, res.status);
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { bytes, mime: sniff(bytes) };
    }
    throw new ProviderError('Image reply had neither b64_json nor an https url', 0);
  }
}

function sniff(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  throw new ProviderError('Generated image is neither PNG nor JPEG', 0);
}
