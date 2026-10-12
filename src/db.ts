// SPDX-License-Identifier: AGPL-3.0-only
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type BookStatus = 'unread' | 'reading' | 'read';
export type Book = {
  id: string; title: string; author: string | null; status: BookStatus;
  started: string | null; finished: string | null; note: string | null;
  spine_file: string; width: number; height: number; photo_id: string | null; position: number; created_at: number;
};
export type JobItem = { id: string; quad: number[][]; state: 'pending' | 'skipped' | 'admitted' | 'duplicate' | 'failed'; title?: string; error?: string; bookId?: string };
export type Job = { id: string; photo_id: string; status: 'queued' | 'processing' | 'completed' | 'failed'; error: string | null; detected: number; items: JobItem[]; created_at: number; updated_at: number };

const schema = `
CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, file TEXT NOT NULL, mime TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, photo_id TEXT NOT NULL REFERENCES photos(id), status TEXT NOT NULL, error TEXT, detected INTEGER NOT NULL DEFAULT 0, items TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT, status TEXT NOT NULL DEFAULT 'unread', started TEXT, finished TEXT, note TEXT,
  spine_file TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, photo_id TEXT, position INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS books_position ON books(position);
`;

export class Store {
  readonly db: DatabaseSync;
  readonly filesDir: string;
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.filesDir = path.join(dataDir, 'files');
    mkdirSync(this.filesDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'shelf.db'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.db.exec(schema);
  }
  private static job(row: any): Job { return { ...row, items: JSON.parse(row.items) }; }

  photoBySha(sha: string) { return this.db.prepare('SELECT * FROM photos WHERE sha256=?').get(sha) as { id: string } | undefined; }
  addPhoto(p: { id: string; file: string; mime: string; sha256: string }) { this.db.prepare('INSERT INTO photos(id,file,mime,sha256,created_at) VALUES(?,?,?,?,?)').run(p.id, p.file, p.mime, p.sha256, Date.now()); }
  photo(id: string) { return this.db.prepare('SELECT * FROM photos WHERE id=?').get(id) as { id: string; file: string; mime: string } | undefined; }
  photosSince(ms: number) { return (this.db.prepare('SELECT COUNT(*) n FROM photos WHERE created_at>?').get(ms) as { n: number }).n; }

  addJob(id: string, photoId: string) { const now = Date.now(); this.db.prepare("INSERT INTO jobs(id,photo_id,status,created_at,updated_at) VALUES(?,?,'queued',?,?)").run(id, photoId, now, now); }
  job(id: string) { const r = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id); return r ? Store.job(r) : undefined; }
  jobForPhoto(photoId: string) { const r = this.db.prepare('SELECT * FROM jobs WHERE photo_id=? ORDER BY created_at DESC').get(photoId); return r ? Store.job(r) : undefined; }
  recentJobs(limit = 20) { return this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit).map(Store.job); }
  /** Atomically claims the oldest queued job. */
  claimJob(): Job | undefined {
    const r = this.db.prepare("UPDATE jobs SET status='processing',updated_at=? WHERE id=(SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1) RETURNING *").get(Date.now());
    return r ? Store.job(r) : undefined;
  }
  saveJob(j: Job) { this.db.prepare('UPDATE jobs SET status=?,error=?,detected=?,items=?,updated_at=? WHERE id=?').run(j.status, j.error, j.detected, JSON.stringify(j.items), Date.now(), j.id); }
  /** Jobs left 'processing' by a crash are re-queued at startup; finished items are kept, so no paid step repeats. */
  requeueInterrupted() { this.db.prepare("UPDATE jobs SET status='queued' WHERE status='processing'").run(); }

  books() { return this.db.prepare('SELECT * FROM books ORDER BY position, created_at').all() as Book[]; }
  book(id: string) { return this.db.prepare('SELECT * FROM books WHERE id=?').get(id) as Book | undefined; }
  findBookByTitle(title: string) { return this.books().find(b => normalizeTitle(b.title) === normalizeTitle(title)); }
  addBook(b: Omit<Book, 'position' | 'created_at' | 'status' | 'started' | 'finished' | 'note'>) {
    const position = ((this.db.prepare('SELECT MAX(position) m FROM books').get() as { m: number | null }).m ?? -1) + 1;
    this.db.prepare("INSERT INTO books(id,title,author,status,spine_file,width,height,photo_id,position,created_at) VALUES(?,?,?,'unread',?,?,?,?,?,?)")
      .run(b.id, b.title, b.author, b.spine_file, b.width, b.height, b.photo_id, position, Date.now());
  }
  updateBook(id: string, patch: Partial<Pick<Book, 'title' | 'author' | 'status' | 'started' | 'finished' | 'note'>>) {
    // Column names are interpolated, so only these fixed names may ever reach the SQL text.
    const allowed = ['title', 'author', 'status', 'started', 'finished', 'note'] as const;
    const fields = allowed.filter(f => f in patch);
    if (!fields.length) return;
    this.db.prepare(`UPDATE books SET ${fields.map(f => `${f}=?`).join(',')} WHERE id=?`).run(...fields.map(f => patch[f] ?? null), id);
  }
  deleteBook(id: string) { this.db.prepare('DELETE FROM books WHERE id=?').run(id); }
  reorder(ids: string[]) {
    const set = this.db.prepare('UPDATE books SET position=? WHERE id=?');
    this.db.exec('BEGIN'); try { ids.forEach((id, i) => set.run(i, id)); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
}

/** Duplicate check: case-, width-, punctuation- and whitespace-insensitive. */
export const normalizeTitle = (t: string) => t.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
