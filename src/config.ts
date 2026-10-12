// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';

export type ImageApiStyle = 'none' | 'openai-edits' | 'json-image';
export type Config = {
  host: string; port: number; dataDir: string; password: string; publicShelf: boolean;
  vision: { baseUrl: string; apiKey: string; model: string };
  image: { style: ImageApiStyle; baseUrl: string; apiKey: string; model: string; size: string };
  maxBooksPerPhoto: number; maxPhotosPerDay: number;
};

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, max: number) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) > max) throw new Error(`${name} must be an integer between 1 and ${max}`);
  return Number(raw);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const style = (env.IMAGE_API_STYLE || 'none') as ImageApiStyle;
  if (!['none', 'openai-edits', 'json-image'].includes(style)) throw new Error('IMAGE_API_STYLE must be none, openai-edits or json-image');
  const config: Config = {
    host: env.HOST || '127.0.0.1',
    port: int(env, 'PORT', 8787, 65535),
    dataDir: path.resolve(env.DATA_DIR || './data'),
    password: env.SHELF_PASSWORD || '',
    publicShelf: env.SHELF_PUBLIC === 'true',
    vision: { baseUrl: (env.VISION_BASE_URL || '').replace(/\/+$/, ''), apiKey: env.VISION_API_KEY || '', model: env.VISION_MODEL || '' },
    image: { style, baseUrl: (env.IMAGE_BASE_URL || '').replace(/\/+$/, ''), apiKey: env.IMAGE_API_KEY || '', model: env.IMAGE_MODEL || '', size: env.IMAGE_SIZE || '1024x2048' },
    maxBooksPerPhoto: int(env, 'MAX_BOOKS_PER_PHOTO', 10, 60),
    maxPhotosPerDay: int(env, 'MAX_PHOTOS_PER_DAY', 20, 1000),
  };
  const local = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
  if (!local && !config.password) throw new Error('Refusing to listen on a public address without SHELF_PASSWORD');
  if (!config.vision.baseUrl || !config.vision.model) throw new Error('VISION_BASE_URL and VISION_MODEL are required (see .env.example)');
  if (style !== 'none' && (!config.image.baseUrl || !config.image.model)) throw new Error('IMAGE_BASE_URL and IMAGE_MODEL are required unless IMAGE_API_STYLE=none');
  return config;
}
