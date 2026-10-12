// SPDX-License-Identifier: AGPL-3.0-only
import { prepareUpload } from '/upload.js';

const en = !/^zh/i.test(navigator.language);
const copy = {
  title: 'My bookshelf', add: 'Add books', empty: 'The shelf is empty. Take a photo with the spines facing out to start.',
  consentTitle: 'Share this photo for AI processing?', consentBody: 'The photo is sent to the AI service configured on this site to identify books and create spine images. It may show background details, so make sure there is nothing you do not want to share. Location and other capture details are removed before upload.',
  cancel: 'Cancel', agree: 'Agree and upload', fTitle: 'Title', fAuthor: 'Author', fStatus: 'Status', unread: 'Unread', reading: 'Reading', read: 'Finished',
  fStarted: 'Started', fFinished: 'Finished', fNote: 'Notes', delete: 'Remove from shelf', save: 'Save',
};
const t = (key, zh) => (en && copy[key]) || zh;
if (en) { document.documentElement.lang = 'en'; document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = copy[el.dataset.i18n] ?? el.textContent; }); }

const $ = id => document.getElementById(id);
let state = { books: [], jobs: [], canEdit: false, limits: {} }, password = sessionStorage.getItem('shelf-pw') || '';

async function api(path, init = {}, retry = true) {
  const headers = { ...(init.headers || {}) };
  if (password) headers.Authorization = 'Basic ' + btoa(unescape(encodeURIComponent(':' + password)));
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401 && retry && init.method && init.method !== 'GET') {
    const entered = prompt(t('pw', '需要密码才能修改书架：'));
    if (entered) { password = entered; sessionStorage.setItem('shelf-pw', entered); return api(path, init, false); }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const SPINE_HEIGHT = () => Math.min(260, Math.max(160, window.innerHeight * 0.3));
function renderShelf() {
  const shelf = $('shelf'); shelf.replaceChildren();
  $('empty').hidden = state.books.length > 0;
  $('count').textContent = state.books.length ? (en ? `${state.books.length} books` : `${state.books.length} 本`) : '';
  // Usable row width = shelf content box minus the row's own 6px side padding.
  const cs = getComputedStyle(shelf), height = SPINE_HEIGHT();
  const maxRow = shelf.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 12;
  let row = null, used = Infinity;
  for (const book of state.books) {
    const width = Math.max(14, Math.round(height * book.width / book.height));
    if (used + width + 3 > maxRow) { row = document.createElement('div'); row.className = 'shelf-row'; shelf.append(row); used = 0; }
    const btn = document.createElement('button');
    btn.className = 'spine'; btn.title = book.author ? `${book.title} · ${book.author}` : book.title;
    btn.style.width = `${width}px`; btn.style.height = `${height}px`;
    const img = document.createElement('img'); img.src = `/spines/${book.spine_file}`; img.alt = book.title; img.loading = 'lazy';
    btn.append(img); btn.addEventListener('click', () => openEditor(book));
    row.append(btn); used += width + 3;
  }
}

const label = s => ({ admitted: t('a', '已入架'), duplicate: t('d', '已在书架上'), skipped: t('s', '本次未处理'), failed: t('f', '未成功'), pending: t('p', '处理中') }[s] || s);
function renderJobs() {
  const box = $('jobs'); box.replaceChildren();
  for (const job of state.jobs.filter(j => Date.now() - j.updated_at < 3600_000).slice(0, 3)) {
    const el = document.createElement('div'); el.className = 'job';
    const admitted = job.items.filter(i => i.state === 'admitted').length, skipped = job.items.filter(i => i.state === 'skipped').length;
    const head = document.createElement('strong');
    head.textContent = job.status === 'queued' || job.status === 'processing' ? t('working', '正在整理照片…')
      : job.status === 'failed' ? `${t('jobFailed', '这张照片未能完成识别：')}${job.error ?? ''}`
      : en ? `Found ${job.detected} books, added ${admitted}.` : `从照片中找到 ${job.detected} 本书，已入架 ${admitted} 本。`;
    el.append(head);
    if (skipped) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = en ? `Each photo processes up to ${state.limits.booksPerPhoto} books; ${skipped} were not processed. Take another photo of them.` : `每张照片最多处理 ${state.limits.booksPerPhoto} 本，其余 ${skipped} 本这次没有处理，可以单独再拍一张继续添加。`; el.append(p); }
    const problems = job.items.filter(i => i.state === 'failed' || i.state === 'duplicate');
    if (problems.length && job.status === 'completed') {
      const ul = document.createElement('ul');
      for (const i of problems) { const li = document.createElement('li'); li.textContent = `${i.title || t('unknown', '未识别的书')}：${label(i.state)}${i.error && i.state === 'failed' ? `（${i.error}）` : ''}`; ul.append(li); }
      el.append(ul);
    }
    box.append(el);
  }
}

async function refresh() {
  state = await api('/api/shelf');
  $('add').hidden = false; renderShelf(); renderJobs();
  if (state.jobs.some(j => j.status === 'queued' || j.status === 'processing')) setTimeout(refresh, 3000);
}

// Upload: pick → explicit consent → prepare in browser → upload.
let pending = null;
$('add').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', () => { pending = $('file').files[0] || null; $('file').value = ''; if (pending) $('consent').showModal(); });
$('agree').addEventListener('click', async () => {
  const file = pending; pending = null; $('consent').close(); if (!file) return;
  $('add').disabled = true;
  try { const prepared = await prepareUpload(file); await api('/api/photos', { method: 'POST', headers: { 'Content-Type': prepared.type }, body: prepared }); await refresh(); }
  catch (e) { alert(e.message); }
  finally { $('add').disabled = false; }
});
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { pending = null; b.closest('dialog').close(); }));

// Editing.
let editing = null;
function openEditor(book) {
  editing = book; const f = $('editForm');
  $('editTitle').textContent = book.title; $('editSpine').src = `/spines/${book.spine_file}`; $('editSpine').alt = book.title;
  for (const k of ['title', 'author', 'status', 'started', 'finished', 'note']) f.elements[k].value = book[k] ?? '';
  for (const el of f.elements) el.disabled = !state.canEdit && !password && el.dataset.close === undefined;
  $('editError').textContent = ''; $('edit').showModal();
}
$('editForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target;
  const patch = Object.fromEntries(['title', 'author', 'status', 'started', 'finished', 'note'].map(k => [k, f.elements[k].value || null]));
  try { await api(`/api/books/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); $('edit').close(); await refresh(); }
  catch (err) { $('editError').textContent = err.message; }
});
$('delete').addEventListener('click', async () => {
  if (!confirm(t('confirmDelete', '确定从书架移除这本书？'))) return;
  try { await api(`/api/books/${editing.id}`, { method: 'DELETE' }); $('edit').close(); await refresh(); }
  catch (err) { $('editError').textContent = err.message; }
});

let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderShelf, 150); });
refresh().catch(e => { $('empty').hidden = false; $('empty').textContent = e.message; });
