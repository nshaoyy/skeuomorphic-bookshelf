// SPDX-License-Identifier: AGPL-3.0-only
// Offline UI demo: fake provider + real server, pre-filled with one synthetic shelf photo.
// Usage: node test/demo-server.ts [port] [dataDir]   (no API key, no network, no cost)
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { Store } from '../src/db.ts';
import { Providers } from '../src/providers.ts';
import { defaultPrompts } from '../src/prompts.ts';
import { processJob, startWorker, type Deps } from '../src/pipeline.ts';
import { createApp } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';
import { fakeProvider, shelfPhoto } from './helpers.ts';

const port = Number(process.argv[2] || 8790), dataDir = path.resolve(process.argv[3] || './data-demo');
const photo = shelfPhoto(12);
const titles = ['百年孤独', '三体', 'Sapiens', '活着', '小王子', 'The Pragmatic Programmer', '围城', '红楼梦', 'Dune', '平凡的世界', '人类简史', '1984', '追风筝的人', '挪威的森林', 'Atomic Habits', '月亮与六便士', '白夜行', 'Clean Code', '霍乱时期的爱情', '局外人'];
const provider = await fakeProvider({ quads: photo.quads, titles });
const config = loadConfig({ DATA_DIR: dataDir, VISION_BASE_URL: provider.url, VISION_MODEL: 'fake', IMAGE_API_STYLE: 'none', PORT: String(port) });
const store = new Store(dataDir), deps: Deps = { store, providers: new Providers(config), prompts: defaultPrompts, config, log: console.log };
if (!store.books().length) {
  writeFileSync(path.join(store.filesDir, 'seed.jpg'), photo.bytes);
  store.addPhoto({ id: 'seed', file: 'seed.jpg', mime: 'image/jpeg', sha256: 'seed' }); store.addJob('00000000-0000-4000-8000-000000000000', 'seed');
  await processJob(store.claimJob()!, deps);
}
startWorker(deps);
createApp(config, deps).listen(port, '127.0.0.1', () => console.log(`demo on http://127.0.0.1:${port}`));
