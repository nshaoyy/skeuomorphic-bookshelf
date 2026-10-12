// SPDX-License-Identifier: AGPL-3.0-only
// Baseline prompts. They work, but are intentionally simple: tune them for your models by
// placing detect.txt / identify.txt / spine.txt / check.txt in DATA_DIR/prompts/.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const defaultPrompts = {
  detect: `You see a photo of books on a shelf. Find every book whose spine faces the camera.
For each spine return the four corners of its printed spine face, in this order: top-left, top-right, bottom-right, bottom-left,
where "top" is the top of the book as it stands. Use coordinates normalized to 0-1000 (x across the photo width, y down the photo height).
Skip books whose spine is hidden, cut off by the photo edge, or too blurry to read.
Reply with JSON only: {"books":[{"quad":[[x,y],[x,y],[x,y],[x,y]]}]}`,

  identify: `This image is one straightened book spine. Read the title and author printed on it.
Copy the text exactly as printed (keep the original language and characters). Do not guess text you cannot see.
Reply with JSON only: {"readable":true|false,"title":"..." or null,"author":"..." or null}`,

  spine: `Recreate this book spine as a clean, flat, front-facing print for a digital bookshelf.
Keep every printed word, its language, colours, fonts and layout exactly as in the photo; do not add, translate or remove text.
Remove shadows, glare, perspective and surrounding books. The spine fills the whole canvas, upright, top of the book at the top.`,

  check: `Image 1 is a photo crop of a book spine. Image 2 is a generated clean version of the same spine.
Pass only if image 2 shows the same title text as image 1 with no invented, missing or changed words, and looks like the same book.
Reply with JSON only: {"pass":true|false,"reason":"short reason"}`,
};
export type Prompts = typeof defaultPrompts;

export function loadPrompts(dataDir: string): Prompts {
  const dir = path.join(dataDir, 'prompts'), out = { ...defaultPrompts };
  for (const key of Object.keys(out) as (keyof Prompts)[]) {
    const file = path.join(dir, `${key}.txt`);
    if (existsSync(file)) out[key] = readFileSync(file, 'utf8').trim();
  }
  return out;
}
