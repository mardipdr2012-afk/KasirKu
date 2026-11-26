/* =============================================================================
   KasirKu — JavaScript.html (klien)
   - SPA murni di GitHub Pages: navigasi = tampil/sembunyi <section> (0 ms); server lewat fetch() ke GAS REST
   - Stale-while-revalidate: tampilan awal dari localStorage, server menyegarkan di belakang layar
   - Optimistic UI: checkout, stok, keranjang diperbarui seketika; sinkron ke server via outbox idempoten
   - Pencarian / filter / kategori sepenuhnya lokal (tanpa RTT)
   ============================================================================= */
(function () {
'use strict';

/* ---------- util dasar ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => 'Rp ' + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const num = n => Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const ic = (n, c) => '<svg class="i ' + (c || '') + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>';
const pad = n => String(n).padStart(2, '0');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const debounce = (fn, ms) => { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); }; };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const fmtK = n => Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0).replace('.', ',') + ' jt' : Math.abs(n) >= 1e3 ? Math.round(n / 1e3) + ' rb' : String(Math.round(n));
const initial = s => (String(s || '?').trim()[0] || '?').toUpperCase();

/* localStorage aman (bisa diblokir di iframe / mode privat) */
const LS = {
  mem: {},
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? (k in this.mem ? this.mem[k] : d) : JSON.parse(v); } catch (e) { return k in this.mem ? this.mem[k] : d; } },
  set(k, v) { this.mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } },
  del(k) { delete this.mem[k]; try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } }
};

/* ---------- waktu mengikuti zona waktu server ---------- */
function parseTs(s) { const m = /(\d+)-(\d+)-(\d+)[ T](\d+):(\d+):(\d+)/.exec(String(s)); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : new Date(); }
function fmtTs(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
const nowDate = () => new Date(S.nowBase + (Date.now() - S.bootTs));
const nowStr = () => fmtTs(nowDate());
const dayStr = (off) => { const d = nowDate(); d.setDate(d.getDate() - (off || 0)); return fmtTs(d).slice(0, 10); };
const fmtDate = s => { const d = String(s).slice(0, 10).split('-'); return d.length === 3 ? (+d[2]) + ' ' + MONTHS[+d[1] - 1] + ' ' + d[0] : s; };
const fmtDT = s => fmtDate(s) + ', ' + String(s).slice(11, 16) + ' WIB';

/* =============================================================================
   STATE
   ============================================================================= */
const S = {
  token: null, me: null, st: { nama: 'KasirKu', alamat: '', telp: '', logo: '', format: '80', pajak: 0, stokMinus: false, emailNotif: '' },
  produk: [], pmap: {}, tx: [], trend: [], ver: '', nowBase: Date.now(), bootTs: Date.now(),
  view: 'kasir', cart: [], cat: 'Semua', grid: 'grid', q: {}, outbox: [], online: true, busy: 0, failed: [],
  rh: { from: '', to: '', metode: '', status: '', kasir: '', page: 1, sel: null, list: [], loading: false },
  rp: { preset: '7', from: '', to: '', kat: '', kasir: '', metode: '', data: null, loading: false, err: '' },
  pr: { lowOnly: false, inactive: false, cat: 'Semua' },
  users: null, txCache: {}, repCache: {}, dirty: {}
};
const VIEWS = {
  kasir: { t: 'Kasir (POS)', ico: 'pos', roles: ['Owner', 'Kasir'], search: 'Cari nama atau kode produk…' },
  dashboard: { t: 'Dashboard', ico: 'dash', roles: ['Owner', 'Kasir'] },
  produk: { t: 'Produk & Stok', ico: 'box', roles: ['Owner', 'Kasir'], search: 'Cari produk atau kode…' },
  riwayat: { t: 'Riwayat Pesanan', ico: 'receipt', roles: ['Owner', 'Kasir'], search: 'Cari ID transaksi atau kasir…' },
  laporan: { t: 'Laporan Penjualan', ico: 'chart', roles: ['Owner'], search: 'Cari produk pada laporan…' },
  pengguna: { t: 'Pengguna', ico: 'users', roles: ['Owner'] },
  pengaturan: { t: 'Pengaturan', ico: 'gear', roles: ['Owner'] }
};
const isOwner = () => S.me && S.me.peran === 'Owner';

/* =============================================================================
   KOMUNIKASI SERVER
   ============================================================================= */
const CFG = window.APP_CONFIG || {};
const GAS_URL = CFG.GAS_URL || '';
const ROUTE = { apiLogin: 'login', apiLogout: 'logout', apiBootstrap: 'bootstrap', apiPing: 'ping' };
const READ = { ping: 1, getTransactions: 1, getReport: 1, listUsers: 1, getMutasi: 1, 'struk.list': 1, 'printer.get': 1 };
const BATCHABLE = { getTransactions: 1, getReport: 1, listUsers: 1, getMutasi: 1, 'struk.list': 1, 'printer.get': 1 };
const M = { n: 0, batched: 0, deduped: 0, retried: 0, lastMs: 0, lastSrv: 0, byAction: {} };   // metrik nyata
let writeEpoch = 0; const inflight = {}; let bq = [], btimer = null;

/** Satu-satunya pintu jaringan: POST text/plain (tanpa preflight CORS) → JSON. */
async function post(body, timeoutMs) {
  if (!GAS_URL || /GANTI|XXXX/.test(GAS_URL)) throw { net: true, message: 'Alamat server belum diisi di js/config.js.' };
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), timeoutMs || 30000), t0 = performance.now();
  try {
    const res = await fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ac.signal, redirect: 'follow' });
    const txt = await res.text(); let j;
    try { j = JSON.parse(txt); } catch (e) { throw { net: true, message: 'Server membalas tidak valid. Pastikan deployment: Siapa saja.' }; }
    const ms = Math.round(performance.now() - t0); M.n++; M.lastMs = ms; M.lastSrv = j.ms || 0;
    const A = M.byAction[body.action] = M.byAction[body.action] || { n: 0, tot: 0, srv: 0 }; A.n++; A.tot += ms; A.srv += j.ms || 0;
    if (j && j.redirect === 'login') forceLogout(j.message);
    return j;
  } catch (e) {
    if (e && e.net) throw e;
    throw { net: true, message: e && e.name === 'AbortError' ? 'Server terlalu lama merespons.' : 'Koneksi ke server gagal.' };
  } finally { clearTimeout(to); }
}
async function postRetry(body) {   // baca-saja & idempoten boleh diulang 1x
  try { return await post(body); }
  catch (e) { if (!e.net) throw e; M.retried++; await new Promise(r => setTimeout(r, 700)); return post(body); }
}
/** Kumpulkan pembacaan dalam satu tick menjadi satu permintaan `batch`. */
function enqueueBatch(item) {
  return new Promise((resolve, reject) => {
    bq.push({ item, resolve, reject });
    if (!btimer) btimer = setTimeout(flushBatch, 0);
  });
}
async function flushBatch() {
  const q = bq; bq = []; btimer = null; if (!q.length) return;
  if (q.length === 1) { const c = q[0]; try { c.resolve(await postRetry({ action: c.item.action, token: c.item.token, data: c.item.data, extra: c.item.extra })); } catch (e) { c.reject(e); } return; }
  M.batched += q.length - 1;
  try {
    const r = await postRetry({ action: 'batch', token: q[0].item.token, data: { calls: q.map(c => ({ action: c.item.action, data: c.item.data, extra: c.item.extra })) } });
    if (!r.success || !Array.isArray(r.data)) { q.forEach(c => c.resolve(r)); return; }
    q.forEach((c, i) => c.resolve(r.data[i] || { success: false, message: 'Respons batch kosong.' }));
  } catch (e) { q.forEach(c => c.reject(e)); }
}
/** rpc: dedupe in-flight untuk baca, epoch tulis, batcher otomatis. */
function rpc(action, token, data, extra) {
  if (!READ[action]) { writeEpoch++; return post({ action, token, data, extra }); }
  const k = writeEpoch + '|' + action + '|' + JSON.stringify([data, extra]);
  if (inflight[k]) { M.deduped++; return inflight[k]; }
  const p = BATCHABLE[action] ? enqueueBatch({ action, token, data, extra }) : postRetry({ action, token, data, extra });
  inflight[k] = p; const done = () => { delete inflight[k]; }; p.then(done, done);
  return p;
}
/** Adaptor nama lama: call('apiLogin', email, pin) / call('apiPing', token, ver) / call('apiX', token, a, b). */
function call(fn) {
  const a = Array.prototype.slice.call(arguments, 1);
  const act = ROUTE[fn] || (fn.charAt(3).toLowerCase() + fn.slice(4));
  if (fn === 'apiLogin') return rpc(act, null, { email: a[0], pin: a[1] });
  if (fn === 'apiPing') return rpc(act, a[0], { ver: a[1] });
  if (fn === 'apiLogout' || fn === 'apiBootstrap') return rpc(act, a[0]);
  const d = typeof a[1] === 'string' ? { id: a[1] } : a[1];
  return rpc(act, a[0], d, a[2]);
}
/** Panggilan terautentikasi + indikator sinkron. */
async function api(fn, a, b) {
  setBusy(1);
  try { return await call(fn, S.token, a, b); }
  finally { setBusy(-1); }
}
/** Aksi baru (struk.*, printer.*) memakai nama langsung. */
async function apiX(action, data) {
  setBusy(1);
  try { return await rpc(action, S.token, data); }
  finally { setBusy(-1); }
}
window.KK = { api: (act, d) => apiX(act, d), toast: (m, t) => toast(m, t), isOwner: () => isOwner(), stats() { const o = {}; Object.keys(M.byAction).forEach(k => { const x = M.byAction[k]; o[k] = { n: x.n, rata_ms: Math.round(x.tot / x.n), server_ms: Math.round(x.srv / x.n) }; }); return { total: M.n, batch_dihemat: M.batched, dedupe: M.deduped, retry: M.retried, terakhir_ms: M.lastMs, server_terakhir_ms: M.lastSrv, aksi: o }; } };
function setBusy(d) { S.busy = Math.max(0, S.busy + d); renderSync(); }
function renderSync() {
  const dot = $('#syncDot'), txt = $('#syncTxt'); if (!dot) return;
  const n = S.outbox.length;
  dot.className = 'dot' + (!S.online || (n && !S.busy && S.retry) ? ' off' : S.busy || n ? ' busy' : '');
  txt.textContent = !S.online ? 'Offline' + (n ? ' · ' + n + ' antre' : '') : n ? 'Menyimpan ' + n + ' transaksi…' : S.busy ? 'Menyinkronkan…' : 'Tersinkron';
}

/* =============================================================================
   TOAST, MODAL, POPOVER
   ============================================================================= */
function toast(msg, type, ms) {
  const el = document.createElement('div'); el.className = 'toast ' + (type || 'ok'); el.setAttribute('role', type === 'bad' ? 'alert' : 'status');
  el.innerHTML = ic(type === 'bad' ? 'alert' : type === 'warn' ? 'alert' : 'check') + '<span>' + esc(msg) + '</span>';
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), ms || (type === 'bad' ? 6000 : 3200));
}
const modals = [];
function modal(o) {
  const prev = document.activeElement;
  const sc = document.createElement('div'); sc.className = 'scrim' + (o.drawer ? ' drawer-scrim' : '');
  sc.innerHTML = '<div class="modal ' + (o.wide ? 'wide ' : '') + (o.drawer ? 'drawer ' : '') + (o.center ? 'center' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(o.title || 'Dialog') + '">' +
    '<div class="modal-h"><h3>' + esc(o.title || '') + '</h3><button class="iconbtn" data-close aria-label="Tutup">' + ic('x') + '</button></div>' +
    '<div class="modal-b">' + (o.body || '') + '</div>' + (o.footer ? '<div class="modal-f">' + o.footer + '</div>' : '') + '</div>';
  $('#overlay').appendChild(sc);
  const m = { el: sc, box: sc.firstChild, $: s => $(s, sc), close() { if (!sc.isConnected) return; sc.remove(); const i = modals.indexOf(m); if (i >= 0) modals.splice(i, 1); if (o.onClose) o.onClose(); try { prev && prev.focus && prev.focus(); } catch (e) { /* abaikan */ } } };
  sc.addEventListener('mousedown', e => { if (e.target === sc && !o.persist) m.close(); });
  sc.addEventListener('click', e => { if (e.target.closest('[data-close]')) m.close(); });
  modals.push(m);
  setTimeout(() => { const f = o.focus ? $(o.focus, sc) : $('input:not([type=checkbox]),textarea,select', sc); (f || $('.btn.primary', sc) || $('[data-close]', sc)).focus(); }, 30);
  return m;
}
function closeTop() { const m = modals[modals.length - 1]; if (m) { m.close(); return true; } return false; }
function confirmBox(title, text, okLabel, danger) {
  return new Promise(res => {
    let done = false;
    const m = modal({ title, center: true, body: '<p class="t2">' + esc(text) + '</p>', footer: '<button class="btn" data-close>Batal</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" id="cfOk">' + esc(okLabel || 'Ya, lanjutkan') + '</button>', onClose() { if (!done) res(false); } });
    m.$('#cfOk').onclick = () => { done = true; m.close(); res(true); };
  });
}
let popEl = null;
function popover(anchor, html) {
  closePop(); popEl = document.createElement('div'); popEl.className = 'pop'; popEl.innerHTML = html; document.body.appendChild(popEl);
  const r = anchor.getBoundingClientRect(), w = popEl.offsetWidth, h = popEl.offsetHeight;
  let left = Math.min(Math.max(8, r.right - w), innerWidth - w - 8), top = r.bottom + 8; if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 8);
  popEl.style.left = left + 'px'; popEl.style.top = top + 'px'; return popEl;
}
function closePop() { if (popEl) { popEl.remove(); popEl = null; } }

/* =============================================================================
   DATA: produk, transaksi, perhitungan
   ============================================================================= */
function setProduk(list) { S.produk = list; S.pmap = {}; list.forEach(p => { S.pmap[p.id] = p; }); }
function applyStok(arr) { (arr || []).forEach(s => { const p = S.pmap[s.id]; if (p) p.stok = s.stok; }); }
const cats = () => Array.from(new Set(S.produk.filter(p => p.aktif).map(p => p.kat).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'id'));
const lowList = () => S.produk.filter(p => p.aktif && p.stok <= p.min).sort((a, b) => a.stok - b.stok);
const done = t => t.st === 'Selesai';
function dayStats(day) {
  const l = S.tx.filter(t => done(t) && t.t.slice(0, 10) === day);
  const tot = l.reduce((a, t) => a + t.tot, 0), items = l.reduce((a, t) => a + (t.d || []).reduce((x, d) => x + d.q, 0), 0);
  return { tot, ord: l.length, avg: l.length ? tot / l.length : 0, items, list: l };
}
function pct(cur, prev) { if (!prev) return cur > 0 ? null : 0; return (cur - prev) / prev * 100; }
function trendLive() {
  const tr = S.trend.map(x => ({ d: x.d, tot: x.tot, ord: x.ord }));
  [0, 1].forEach(o => { const d = dayStr(o), i = tr.findIndex(x => x.d === d); if (i >= 0) { const s = dayStats(d); tr[i].tot = s.tot; tr[i].ord = s.ord; } });
  return tr;
}
function totals() {
  const sub = S.cart.reduce((a, c) => { const p = S.pmap[c.id]; return a + (p ? p.harga * c.qty : 0); }, 0);
  const pjk = Math.round(sub * (S.st.pajak || 0) / 100);
  return { sub, pjk, tot: sub + pjk, n: S.cart.reduce((a, c) => a + c.qty, 0) };
}
function saveCart() { if (S.me) LS.set('kk_cart_' + S.me.id, S.cart); }
function saveCache() { LS.set('kk_boot', { me: S.me, st: S.st, produk: S.produk, tx: S.tx.filter(t => !t._pending), trend: S.trend, ver: S.ver, now: nowStr(), savedAt: Date.now() }); }

/* =============================================================================
   BOOT & SESI
   ============================================================================= */
function applyBoot(d, keepCart) {
  S.me = d.me; S.st = Object.assign({}, S.st, d.settings); setProduk(d.produk); S.tx = d.tx; S.trend = d.trend || []; S.ver = d.ver;
  S.nowBase = parseTs(d.now).getTime(); S.bootTs = Date.now();
  if (d.struk && window.StrukPrinter) StrukPrinter.pasang({ templates: d.struk.templates, server: d.struk.printer, logoUrl: S.st.logo, appUrl: appBase() });
  if (!keepCart) { S.cart = LS.get('kk_cart_' + S.me.id, []); }
  S.cart = S.cart.filter(c => S.pmap[c.id] && S.pmap[c.id].aktif);
}
function startApp() {
  $('#login').classList.add('hide'); $('#app').classList.remove('hide');
  buildNav(); $('#pName').textContent = S.me.nama; $('#pRole').textContent = S.me.peran + ' • ' + S.st.nama; $('#avatar').textContent = initial(S.me.nama);
  applyBrand();
  const v = location.hash && VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : (LS.get('kk_view', 'kasir'));
  go(VIEWS[v] && VIEWS[v].roles.indexOf(S.me.peran) >= 0 ? v : 'kasir', true);
}
function applyBrand() {
  $('#brandName').textContent = S.st.nama || 'KasirKu';
  const bl = $('#brandLogo'); bl.innerHTML = S.st.logo ? '<img src="' + esc(S.st.logo) + '" alt="" data-fb="' + esc(initial(S.st.nama)) + '">' : ic('cart', 'lg');
  document.title = (S.st.nama || 'KasirKu') + ' — Kasir Digital';
}
async function boot() {
  initTheme();
  S.token = LS.get('kk_token', null);
  S.outbox = LS.get('kk_outbox', []);
  const cache = LS.get('kk_boot', null);
  if (S.token && cache && cache.me) {
    // tampilan instan dari cache, lalu segarkan di belakang layar
    applyBoot({ me: cache.me, settings: cache.st, produk: cache.produk, tx: cache.tx, trend: cache.trend, ver: cache.ver, now: cache.now }, false);
    S.nowBase += Date.now() - cache.savedAt;
    S.outbox.forEach(o => { if (o.tx) { S.tx.push(o.tx); (o.tx.d || []).forEach(d => { /* stok lokal sudah tersimpan di cache server; antre akan dikurangi saat sinkron */ }); } });
    startApp();
    revalidate();
  } else if (S.token) {
    showLoading(); await revalidate(true);
  } else showLogin();
}
function showLoading() { $('#login').classList.add('hide'); $('#app').classList.add('hide'); }
async function revalidate(first) {
  try {
    const r = await call('apiBootstrap', S.token);
    if (r.success) {
      const hadApp = !$('#app').classList.contains('hide');
      const pending = S.outbox.length ? S.tx.filter(t => t._pending) : [];
      applyBoot(r.data, true); S.tx = S.tx.concat(pending); saveCache();
      if (!hadApp) startApp(); else { buildNav(); renderAll(); }
      flushOutbox();
    } else if (first) showLogin(r.message);
  } catch (e) { S.online = false; renderSync(); if (first) showLogin('Tidak dapat terhubung ke server. Periksa koneksi internet.'); }
}
function showLogin(msg) {
  $('#app').classList.add('hide'); $('#login').classList.remove('hide');
  $('#lgEmail').value = LS.get('kk_email', ''); $('#lgPin').value = ''; $('#lgErr').textContent = msg || '';
  setTimeout(() => ($('#lgEmail').value ? $('#lgPin') : $('#lgEmail')).focus(), 50);
}
async function doLogin(e) {
  e.preventDefault();
  const email = $('#lgEmail').value.trim(), pin = $('#lgPin').value.trim(), err = $('#lgErr'), btn = $('#lgBtn');
  err.textContent = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Format email tidak valid.'; $('#lgEmail').focus(); return; }
  if (!/^\d{4,6}$/.test(pin)) { err.textContent = 'PIN harus 4–6 digit angka.'; $('#lgPin').focus(); return; }
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Memeriksa…';
  try {
    const r = await call('apiLogin', email, pin);
    if (!r.success) { err.textContent = r.message; $('#lgPin').value = ''; $('#lgPin').focus(); return; }
    LS.set('kk_email', email); S.token = r.data.token; LS.set('kk_token', S.token);
    S.outbox = LS.get('kk_outbox', []);
    resetSession(); applyBoot(r.data, false); saveCache();
    startApp(); flushOutbox();
  } catch (x) { err.textContent = x.message || 'Gagal terhubung.'; }
  finally { btn.disabled = false; btn.textContent = 'Masuk'; }
}
function forceLogout(msg) {
  if (!S.token) return;
  S.token = null; LS.del('kk_token'); LS.del('kk_boot'); S.me = null; closeAllModals(); showLogin(msg || 'Sesi berakhir. Silakan masuk kembali.');
}
function closeAllModals() { while (modals.length) modals[modals.length - 1].close(); }
/** Bersihkan seluruh state tampilan saat berganti pengguna (kasir ⇄ owner di perangkat yang sama). */
function resetSession() {
  Object.keys(SECTION_READY).forEach(k => { delete SECTION_READY[k]; });
  $$('#views > section').forEach(s => { s.innerHTML = ''; });
  S.dirty = {}; S.txCache = {}; S.repCache = {}; S.users = null; S.q = {}; S.cat = 'Semua'; S.lastSuccess = null;
  S.rh = { from: '', to: '', metode: '', status: '', kasir: '', page: 1, sel: null, list: [], loading: false };
  S.rp = { preset: '7', from: '', to: '', kat: '', kasir: '', metode: '', data: null, loading: false, err: '' };
  S.pr = { lowOnly: false, inactive: false, cat: 'Semua' };
  const cs = $('#cartScrim'); if (cs) cs.remove(); closePop(); LS.del('kk_view');
}
async function logout() {
  if (S.outbox.length) { toast('Masih ada ' + S.outbox.length + ' transaksi menunggu sinkron. Tunggu sebentar.', 'warn'); return; }
  const t = S.token; call('apiLogout', t).catch(() => { }); S.token = null; LS.del('kk_token'); LS.del('kk_boot'); S.me = null; closeAllModals(); showLogin('');
}

/* =============================================================================
   TEMA
   ============================================================================= */
function effectiveTheme() { const a = document.documentElement.getAttribute('data-theme'); return a || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
function initTheme() { const t = LS.get('kk_theme', null); if (t) document.documentElement.setAttribute('data-theme', t); themeIcon(); }
function themeIcon() { const dark = effectiveTheme() === 'dark'; $('#themeIco').innerHTML = '<use href="#i-' + (dark ? 'sun' : 'moon') + '"/>'; $('#themeBtn').setAttribute('aria-label', dark ? 'Ganti ke tema terang' : 'Ganti ke tema gelap'); }
function toggleTheme() { const n = effectiveTheme() === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n); LS.set('kk_theme', n); themeIcon(); if (S.view === 'dashboard' || S.view === 'laporan') renderView(S.view); }

/* =============================================================================
   NAVIGASI SPA
   ============================================================================= */
function buildNav() {
  $('#nav').innerHTML = Object.keys(VIEWS).filter(k => VIEWS[k].roles.indexOf(S.me.peran) >= 0).map(k =>
    '<button data-act="go" data-v="' + k + '"' + (k === S.view ? ' aria-current="page"' : '') + '>' + ic(VIEWS[k].ico) + '<span>' + esc(VIEWS[k].t) + '</span></button>').join('');
}
function go(v, initial) {
  if (!VIEWS[v] || VIEWS[v].roles.indexOf(S.me.peran) < 0) v = 'kasir';
  S.view = v; LS.set('kk_view', v); closeSide(); closePop();
  $$('#views > section').forEach(s => s.classList.toggle('hide', s.id !== 'v-' + v));
  $$('#nav button').forEach(b => { if (b.dataset.v === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#pageTitle').textContent = VIEWS[v].t;
  $('#pageSub').textContent = 'Selamat datang kembali, ' + (S.me.nama.split(' ')[0]) + '!';
  const sb = $('#searchBox'); sb.classList.toggle('hide', !VIEWS[v].search);
  if (VIEWS[v].search) { $('#gSearch').placeholder = VIEWS[v].search; $('#gSearch').value = S.q[v] || ''; }
  if (!SECTION_READY[v] || S.dirty[v] || initial) renderView(v);
  const el = $('#v-' + v); if (v !== 'kasir') el.scrollTop = 0;
  updateBell();
}
const SECTION_READY = {};
function renderView(v) { SECTION_READY[v] = true; S.dirty[v] = false; ({ kasir: renderKasir, dashboard: renderDashboard, produk: renderProduk, riwayat: renderRiwayat, laporan: renderLaporan, pengguna: renderPengguna, pengaturan: renderPengaturan })[v](); }
/** Setelah data berubah: tandai semua view kotor, render ulang hanya view aktif. */
function renderAll() { Object.keys(VIEWS).forEach(k => { S.dirty[k] = true; }); if (S.me) { renderView(S.view); S.dirty[S.view] = false; updateBell(); renderSync(); } }
function openSide() { $('#side').classList.add('open'); $('#sideScrim').classList.remove('hide'); }
function closeSide() { $('#side').classList.remove('open'); $('#sideScrim').classList.add('hide'); }
function updateBell() {
  const n = lowList().length, b = $('#bellN'); b.textContent = n > 99 ? '99+' : n; b.classList.toggle('hide', !n);
}

/* =============================================================================
   KASIR (POS)
   ============================================================================= */
function kpiHTML(mini) {
  const t = dayStats(dayStr(0)), y = dayStats(dayStr(1));
  const cell = (ico, l, v, cur, prev) => {
    const p = pct(cur, prev); let d;
    if (p === null) d = '<span class="d flat">Baru hari ini</span>';
    else d = '<span class="d ' + (p > 0.05 ? 'up' : p < -0.05 ? 'down' : 'flat') + '">' + (p > 0.05 ? '▲ ' : p < -0.05 ? '▼ ' : '– ') + '<span class="sr-only">' + (p >= 0 ? 'naik ' : 'turun ') + '</span>' + Math.abs(p).toFixed(1).replace('.', ',') + '% <span class="muted" style="font-weight:500">dari kemarin</span></span>';
    return '<div class="card kpi"><div class="ico">' + ic(ico) + '</div><div style="min-width:0"><div class="l">' + l + '</div><div class="v">' + v + '</div>' + d + '</div></div>';
  };
  return '<div class="kpis' + (mini ? ' mini' : '') + '">' +
    cell('coin', 'Total Penjualan', fmt(t.tot), t.tot, y.tot) + cell('receipt', 'Jumlah Order', t.ord, t.ord, y.ord) +
    cell('pack', 'Item Terjual', t.items + ' <span class="xs muted" style="font-weight:500;font-family:var(--font)">item</span>', t.items, y.items) +
    cell('cart', 'Rata-rata Order', fmt(t.avg), t.avg, y.avg) + '</div>';
}
function renderKasir() {
  const el = $('#v-kasir');
  el.innerHTML = '<div id="posKpi"></div><div class="pos-grid">' +
    '<section class="cart" id="cart" aria-label="Penjualan saat ini"></section>' +
    '<section class="card catalog" aria-label="Katalog produk"><div class="cat-bar"><div class="cats" id="cats" role="group" aria-label="Kategori"></div>' +
    '<div class="seg" role="group" aria-label="Tampilan"><button data-act="gridmode" data-m="grid" aria-label="Tampilan kotak">' + ic('grid', 'sm') + '</button><button data-act="gridmode" data-m="list" aria-label="Tampilan daftar">' + ic('list', 'sm') + '</button></div></div>' +
    '<div class="prod-wrap"><div class="prods" id="prods"></div></div></section></div>' +
    '<button class="cart-bar" id="cartBar" data-act="cartopen" aria-label="Buka keranjang"></button>';
  renderPosKpi(); renderCats(); renderProds(); renderCart();
}
function renderPosKpi() { const h = $('#posKpi'); if (h) h.innerHTML = kpiHTML(true); }
function renderCats() {
  const el = $('#cats'); if (!el) return; const all = S.produk.filter(p => p.aktif);
  const cs = ['Semua'].concat(cats()); if (cs.indexOf(S.cat) < 0) S.cat = 'Semua';
  el.innerHTML = cs.map(c => '<button class="chip" data-act="cat" data-c="' + esc(c) + '" aria-pressed="' + (c === S.cat) + '">' + esc(c) + ' <small>' + (c === 'Semua' ? all.length : all.filter(p => p.kat === c).length) + '</small></button>').join('');
  $$('[data-act=gridmode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === S.grid));
}
function posFiltered() {
  const q = (S.q.kasir || '').toLowerCase().trim();
  return S.produk.filter(p => p.aktif && (S.cat === 'Semua' || p.kat === S.cat) && (!q || p.nama.toLowerCase().indexOf(q) >= 0 || p.id.toLowerCase().indexOf(q) >= 0));
}
function thumb(p, cls) { return p.foto ? '<img src="' + esc(p.foto) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-fb="' + esc(initial(p.nama)) + '">' : esc(initial(p.nama)); }
function renderProds() {
  const el = $('#prods'); if (!el) return; const list = posFiltered();
  el.className = 'prods' + (S.grid === 'list' ? ' list' : '');
  if (!list.length) { el.innerHTML = '<div class="empty" style="grid-column:1/-1">' + ic('search') + '<b>Produk tidak ditemukan</b><span>Ubah kata kunci atau pilih kategori lain.</span></div>'; return; }
  el.innerHTML = list.map(p => {
    const out = !S.st.stokMinus && p.stok <= 0, low = !out && p.stok <= p.min;
    return '<button class="pt' + (out ? ' out' : '') + '" data-act="add" data-id="' + esc(p.id) + '"' + (out ? ' aria-disabled="true"' : '') + ' aria-label="Tambah ' + esc(p.nama) + ', ' + fmt(p.harga) + (out ? ', stok habis' : '') + '">' +
      '<span class="ph">' + (S.grid === 'list' ? '' : thumb(p)) + (out ? '<span class="st tag bad">HABIS</span>' : low ? '<span class="st tag warn">Sisa ' + p.stok + '</span>' : '') + '</span>' +
      '<span class="nm">' + esc(p.nama) + '</span><span class="ft"><span class="pr">' + fmt(p.harga) + '</span><span class="add" aria-hidden="true">' + ic('plus') + '</span></span></button>';
  }).join('');
}
function renderCart() {
  const el = $('#cart'); if (!el) return; const T = totals(), bar = $('#cartBar');
  const lines = S.cart.map((c, i) => {
    const p = S.pmap[c.id]; if (!p) return '';
    return '<div class="line"><div class="thumb">' + thumb(p) + '</div><div><div class="nm">' + esc(p.nama) + '</div><div class="pr">' + fmt(p.harga) + '</div></div><div class="tot">' + fmt(p.harga * c.qty) + '</div>' +
      '<div class="ctrl"><div class="stepper" role="group" aria-label="Jumlah ' + esc(p.nama) + '"><button data-act="dec" data-id="' + esc(c.id) + '" aria-label="Kurangi">' + ic('minus', 'sm') + '</button><b aria-live="polite">' + c.qty + '</b><button data-act="inc" data-id="' + esc(c.id) + '" aria-label="Tambah">' + ic('plus', 'sm') + '</button></div>' +
      '<span class="row" style="gap:0"><button class="mini-act" data-act="note" data-id="' + esc(c.id) + '" aria-label="Catatan untuk ' + esc(p.nama) + '" title="Tambah catatan">' + ic('note', 'sm') + '</button><button class="mini-act del" data-act="del" data-id="' + esc(c.id) + '" aria-label="Hapus ' + esc(p.nama) + '" title="Hapus item">' + ic('trash', 'sm') + '</button></span></div>' +
      (c.note ? '<div class="note-tag">Catatan: ' + esc(c.note) + '</div>' : '') + '</div>';
  }).join('');
  el.innerHTML = '<div class="cart-h"><div><h2>Current Sale</h2><small><span class="dot"></span>' + (T.n ? T.n + ' item' : 'Pesanan baru') + '</small></div><button class="iconbtn" data-act="cartclose" aria-label="Tutup keranjang" style="display:none" id="cartX">' + ic('x') + '</button></div>' +
    '<div class="cart-list">' + (lines || '<div class="empty cart-empty">' + ic('cart') + '<b>Keranjang kosong</b><span>Ketuk produk untuk menambahkan.</span></div>') + '</div>' +
    '<div class="cart-f"><div class="sum"><div><span>Subtotal</span><span class="money">' + fmt(T.sub) + '</span></div>' + (S.st.pajak ? '<div><span>Pajak (' + String(S.st.pajak).replace('.', ',') + '%)</span><span class="money">' + fmt(T.pjk) + '</span></div>' : '') +
    '<div class="grand"><b>Total Tagihan</b><b>' + fmt(T.tot) + '</b></div></div>' +
    '<div class="pay-row"><button class="btn" data-act="clear"' + (T.n ? '' : ' disabled') + '>Kosongkan</button><button class="btn primary pay" data-act="pay"' + (T.n ? '' : ' disabled') + '>Bayar ' + fmt(T.tot) + ' ' + ic('check', 'sm') + '</button></div></div>';
  bar.className = 'cart-bar' + (T.n ? '' : ' empty');
  bar.innerHTML = T.n ? '<span class="row">' + ic('cart') + ' ' + T.n + ' item</span><span class="money">Bayar ' + fmt(T.tot) + '</span>' : '<span class="row">' + ic('cart') + ' Keranjang kosong</span>';
  if (!T.n && el.classList.contains('open')) cartClose();
  const cx = $('#cartX'); if (cx) cx.style.display = matchMedia('(max-width:820px)').matches ? '' : 'none';
}
function cartOpen() { const c = $('#cart'); if (!c) return; c.classList.add('open'); if (!$('#cartScrim')) { const s = document.createElement('div'); s.id = 'cartScrim'; s.className = 'cart-scrim'; s.dataset.act = 'cartclose'; document.body.appendChild(s); } $('#cartBar').classList.add('hide'); renderCart(); }
function cartClose() { const c = $('#cart'); if (c) c.classList.remove('open'); const s = $('#cartScrim'); if (s) s.remove(); const b = $('#cartBar'); if (b) b.classList.remove('hide'); }

function addToCart(id, qty) {
  const p = S.pmap[id]; if (!p || !p.aktif) return;
  const ex = S.cart.find(c => c.id === id), cur = ex ? ex.qty : 0, want = cur + (qty || 1);
  if (!S.st.stokMinus && want > p.stok) { toast(p.stok <= 0 ? '"' + p.nama + '" stok habis.' : 'Stok "' + p.nama + '" tidak cukup (tersisa ' + p.stok + ').', 'warn'); return false; }
  if (ex) ex.qty = want; else S.cart.push({ id, qty: qty || 1, note: '' });
  saveCart(); renderCart(); return true;
}
function setQty(id, d) {
  const c = S.cart.find(x => x.id === id); if (!c) return;
  if (d > 0) { addToCart(id, d); return; }
  c.qty += d; if (c.qty <= 0) S.cart = S.cart.filter(x => x !== c); saveCart(); renderCart();
}
function editNote(id) {
  const c = S.cart.find(x => x.id === id), p = S.pmap[id]; if (!c) return;
  const m = modal({ title: 'Catatan — ' + p.nama, center: true, body: '<div class="field"><label for="ntIn">Catatan item (mis. less sugar, tanpa es)</label><textarea id="ntIn" class="input" maxlength="120" rows="3">' + esc(c.note) + '</textarea></div>', footer: '<button class="btn" data-close>Batal</button><button class="btn primary" id="ntOk">Simpan</button>' });
  m.$('#ntOk').onclick = () => { c.note = m.$('#ntIn').value.trim().slice(0, 120); saveCart(); renderCart(); m.close(); };
}
async function clearCart() { if (!S.cart.length) return; if (await confirmBox('Kosongkan keranjang?', 'Semua item pada pesanan ini akan dihapus.', 'Kosongkan', true)) { S.cart = []; saveCart(); renderCart(); } }

/* ---------- pembayaran ---------- */
function openPay() {
  const T = totals(); if (!T.n) return;
  let method = 'Tunai', cash = 0, conf = false, busy = false;
  const cands = Array.from(new Set([5000, 10000, 20000, 50000, 100000].map(d => Math.ceil(T.tot / d) * d))).filter(v => v > T.tot).sort((a, b) => a - b).slice(0, 3);
  const m = modal({
    title: 'Pembayaran', focus: '#cashIn', body:
      '<div class="pay-total"><small>Total tagihan</small><span class="money">' + fmt(T.tot) + '</span></div>' +
      '<div role="radiogroup" aria-label="Metode pembayaran" class="methods">' +
      [['Tunai', 'cash', 'Tunai'], ['Transfer', 'bank', 'Transfer'], ['QRIS', 'qr', 'QRIS / E-Wallet']].map((x, i) => '<button class="method" role="radio" data-m="' + x[0] + '" aria-checked="' + (i === 0) + '">' + ic(x[1], 'lg') + '<span>' + x[2] + '</span></button>').join('') + '</div>' +
      '<div id="cashBox" class="field"><label for="cashIn">Uang diterima</label><div style="position:relative"><span class="b muted" style="position:absolute;left:14px;top:11px">Rp</span><input id="cashIn" class="input num" inputmode="numeric" autocomplete="off" style="padding-left:44px;font-size:20px;font-weight:700"></div>' +
      '<div class="quick"><button class="chip" data-q="' + T.tot + '">Uang Pas</button>' + cands.map(v => '<button class="chip" data-q="' + v + '">' + fmt(v) + '</button>').join('') + '</div>' +
      '<div class="change" id="chg"><span>Kembalian</span><span class="money" id="chgV">Rp 0</span></div></div>' +
      '<div id="nonCash" class="field hide"><p class="t2" id="ncTxt"></p><label class="row" style="min-height:44px;cursor:pointer"><input type="checkbox" id="confChk" style="width:22px;height:22px"> <b>Pembayaran sudah saya terima</b></label></div>' +
      '<p class="hint">Pintasan: Enter = selesaikan • Esc = batal</p>',
    footer: '<button class="btn" data-close>Batal</button><button class="btn primary pay" id="payOk" disabled>Selesaikan Pembayaran</button>'
  });
  const ok = m.$('#payOk');
  const refresh = () => {
    const isCash = method === 'Tunai'; m.$('#cashBox').classList.toggle('hide', !isCash); m.$('#nonCash').classList.toggle('hide', isCash);
    $$('.method', m.el).forEach(b => b.setAttribute('aria-checked', b.dataset.m === method));
    if (isCash) { const k = cash - T.tot; const c = m.$('#chg'); c.classList.toggle('low', cash > 0 && k < 0); m.$('#chgV').textContent = k >= 0 ? fmt(k) : (cash > 0 ? 'Kurang ' + fmt(-k) : 'Rp 0'); c.firstChild.textContent = k < 0 && cash > 0 ? 'Uang kurang' : 'Kembalian'; ok.disabled = cash < T.tot; }
    else { m.$('#ncTxt').textContent = (method === 'QRIS' ? 'Minta pelanggan scan QRIS / e-wallet sebesar ' : 'Minta pelanggan transfer sebesar ') + fmt(T.tot) + ', lalu konfirmasi setelah dana masuk.'; ok.disabled = !conf; }
  };
  m.el.addEventListener('click', e => {
    const mb = e.target.closest('.method'); if (mb) { method = mb.dataset.m; refresh(); }
    const q = e.target.closest('[data-q]'); if (q) { cash = +q.dataset.q; m.$('#cashIn').value = num(cash); refresh(); }
  });
  m.$('#cashIn').addEventListener('input', e => { cash = +e.target.value.replace(/\D/g, '') || 0; e.target.value = cash ? num(cash) : ''; refresh(); });
  m.$('#confChk').addEventListener('change', e => { conf = e.target.checked; refresh(); });
  m.el.addEventListener('keydown', e => { if (e.key === 'Enter' && !ok.disabled && e.target.tagName !== 'BUTTON') { e.preventDefault(); ok.click(); } });
  ok.onclick = () => { if (busy || ok.disabled) return; busy = true; m.close(); checkout(method, method === 'Tunai' ? cash : T.tot); };
  refresh();
}

/* ---------- checkout optimistis + outbox idempoten ---------- */
function checkout(method, bayar) {
  const T = totals(), cid = uid();
  const d = S.cart.filter(c => S.pmap[c.id]).map(c => { const p = S.pmap[c.id]; return { p: c.id, n: p.nama, q: c.qty, h: p.harga, s: p.harga * c.qty, df: 0, c: c.note || '' }; });
  const tx = { id: 'TMP-' + cid.slice(0, 6).toUpperCase(), _cid: cid, _pending: true, t: nowStr(), k: S.me.nama, m: method, sub: T.sub, pjk: T.pjk, tot: T.tot, byr: bayar, kem: method === 'Tunai' ? bayar - T.tot : 0, st: 'Selesai', ab: '', db: '', wb: '', d };
  const payload = { clientId: cid, metode: method, bayar: bayar, expectedTotal: T.tot, items: S.cart.map(c => ({ id: c.id, qty: c.qty, note: c.note || '' })) };
  S.cart.forEach(c => { const p = S.pmap[c.id]; if (p) p.stok -= c.qty; });      // stok lokal langsung berkurang
  S.cart = []; saveCart();
  S.tx.push(tx);
  S.outbox.push({ cid, payload, tx }); LS.set('kk_outbox', S.outbox.map(o => ({ cid: o.cid, payload: o.payload, tx: o.tx })));
  cartClose(); renderPosKpi(); renderCats(); renderProds(); renderCart(); updateBell(); renderSync();
  showSuccess(tx); flushOutbox();
}
let flushing = false;
async function flushOutbox() {
  if (flushing || !S.token) return; flushing = true; clearTimeout(S.retry); S.retry = null;
  try {
    while (S.outbox.length) {
      const o = S.outbox[0]; let r;
      try { r = await api('apiCheckout', o.payload); S.online = true; }
      catch (e) { S.online = false; S.retry = setTimeout(() => { S.retry = null; flushOutbox(); }, 6000); break; }
      if (!S.token) break;
      if (r.success) {
        r.data.tx._sig = r.data.sig || ''; const i = S.tx.findIndex(t => t._cid === o.cid); if (i >= 0) S.tx[i] = r.data.tx; else S.tx.push(r.data.tx);
        applyStok(r.data.stok); S.outbox.shift(); persistOutbox();
        if (r.data.selisih) toast('Harga di server berbeda dari layar. Total tercatat ' + fmt(r.data.tx.tot) + '.', 'warn');
        if (S.lastSuccess && S.lastSuccess.cid === o.cid) { S.lastSuccess.tx = r.data.tx; refreshSuccess(); }
        saveCache(); renderPosKpi(); renderCats(); renderProds(); updateBell(); S.dirty = Object.keys(VIEWS).reduce((a, k) => (a[k] = k !== 'kasir', a), {});
      } else if (r.code === 'BUSY') { S.retry = setTimeout(() => { S.retry = null; flushOutbox(); }, 3000); break; }
      else { await failCheckout(o, r.message); }
    }
  } finally { flushing = false; renderSync(); }
}
function persistOutbox() { LS.set('kk_outbox', S.outbox.map(o => ({ cid: o.cid, payload: o.payload, tx: o.tx }))); }
async function failCheckout(o, msg) {
  S.outbox = S.outbox.filter(x => x !== o); persistOutbox();
  S.tx = S.tx.filter(t => t._cid !== o.cid); o.payload.items.forEach(it => { const p = S.pmap[it.id]; if (p) p.stok += it.qty; });
  if (S.lastSuccess && S.lastSuccess.cid === o.cid) { const m = S.lastSuccess.m; S.lastSuccess = null; if (m) m.close(); }
  renderPosKpi(); renderCats(); renderProds(); renderCart(); updateBell();
  const m = modal({ title: 'Transaksi tidak dapat disimpan', center: true, persist: true, body: '<div class="alertbar bad">' + ic('alert') + '<span>' + esc(msg) + '</span></div><p class="t2">Transaksi ' + esc(o.tx.id) + ' (' + fmt(o.tx.tot) + ') <b>tidak tercatat</b> dan stok tidak berubah. Kembalikan item ke keranjang untuk dicoba lagi?</p>', footer: '<button class="btn" data-close>Tutup</button><button class="btn primary" id="rbOk">Kembalikan ke keranjang</button>' });
  m.$('#rbOk').onclick = () => { o.payload.items.forEach(it => { if (S.pmap[it.id] && S.pmap[it.id].aktif) { const e = S.cart.find(c => c.id === it.id); if (e) e.qty += it.qty; else S.cart.push({ id: it.id, qty: it.qty, note: it.note || '' }); } }); saveCart(); renderCart(); m.close(); go('kasir'); revalidate(); };
  revalidate();
}

/* ---------- layar sukses ---------- */
function showSuccess(tx) {
  const m = modal({ title: 'Payment Successful', center: true, persist: true, focus: '#scNew', body: '<div id="scBody"></div>', footer: '<button class="btn" data-act="rc-print" id="scPrint">' + ic('print', 'sm') + ' Cetak Struk</button><button class="btn" data-act="rc-pdf" id="scPdf">' + ic('download', 'sm') + ' Unduh PDF</button><button class="btn primary" id="scNew">Transaksi Baru</button>', onClose() { if (S.lastSuccess && S.lastSuccess.m === m) S.lastSuccess = null; } });
  S.lastSuccess = { cid: tx._cid, tx, m }; m.$('#scNew').onclick = () => m.close(); refreshSuccess();
}
function refreshSuccess() {
  const L = S.lastSuccess; if (!L) return; const tx = L.tx, m = L.m, pend = !!tx._pending;
  m.$('#scBody').innerHTML = '<div class="success"><div class="tick">' + ic('check') + '</div><h3 style="font:700 20px var(--font-num)">Pembayaran Berhasil</h3><div class="money" style="font-size:34px;font-weight:700">' + fmt(tx.tot) + '</div>' +
    '<div class="row wrap" style="justify-content:center"><span class="tag brand">' + esc(tx.m) + '</span>' + (pend ? '<span class="tag warn"><span class="spin" style="width:11px;height:11px;border-width:2px"></span> Menyimpan…</span>' : '<span class="tag ok">' + ic('check', 'sm') + ' ' + esc(tx.id) + '</span>') + '</div>' +
    (tx.m === 'Tunai' ? '<div class="change" style="width:100%"><span>Kembalian</span><span class="money">' + fmt(tx.kem) + '</span></div>' : '') + '</div>';
  m.$('#scPrint').disabled = pend; m.$('#scPdf').disabled = pend;
  m.$('#scPrint').dataset.id = tx.id; m.$('#scPdf').dataset.id = tx.id;
}

/* ---------- struk & unduhan ---------- */
function receiptHTML(tx, forPrint) {
  const st = S.st, w = st.format === '58' ? ' w58' : '';
  const line = (a, b, bold) => '<div class="rw' + (bold ? ' bd' : '') + '"><span>' + a + '</span><span>' + b + '</span></div>';
  return '<div class="rc' + w + '"><div class="c bd">' + esc(st.nama) + '</div><div class="c">' + esc(st.alamat) + '</div><div class="c">' + esc(st.telp ? 'Telp: ' + st.telp : '') + '</div><hr>' +
    '<div>No : ' + esc(tx.id) + '</div><div>Tgl: ' + esc(fmtDT(tx.t)) + '</div><div>Kasir: ' + esc(tx.k) + '</div><hr>' +
    (tx.d || []).map(l => '<div>' + esc(l.n) + '</div>' + line('&nbsp;&nbsp;' + l.q + ' x ' + num(l.h), num(l.s)) + (l.c ? '<div>&nbsp;&nbsp;* ' + esc(l.c) + '</div>' : '')).join('') + '<hr>' +
    line('Subtotal', fmt(tx.sub)) + line('Pajak (' + String(st.pajak).replace('.', ',') + '%)', fmt(tx.pjk)) + line('TOTAL', fmt(tx.tot), true) + line('Bayar (' + esc(tx.m) + ')', fmt(tx.byr)) + line('Kembali', fmt(tx.kem)) + '<hr>' +
    (tx.st === 'Dibatalkan' ? '<div class="c bd">*** DIBATALKAN ***</div>' : '') + '<div class="c">Terima kasih atas kunjungan Anda!</div><div class="c" style="font-size:.85em">Powered by KasirKu</div></div>';
}
function appBase() { return location.origin + location.pathname.replace(/[^/]*$/, ''); }
/** Kamus data datar untuk modul struk (kontrak gas-struk-resi-printer). */
function dataStruk(tx) {
  const st = S.st, batal = tx.st === 'Dibatalkan', pad2 = n => String(n).padStart(2, '0');
  const tgl = String(tx.t || '').slice(0, 10), jam = String(tx.t || '').slice(11, 16);
  return {
    TOKO_NAMA: st.nama, TOKO_ALAMAT: st.alamat, TOKO_WA: st.telp, TOKO_TELP: st.telp,
    NOTA: tx.id, TANGGAL: tgl, JAM: jam, KASIR: tx.k, PELANGGAN: 'Umum',
    ITEM: (tx.d || []).map(l => ({ NAMA: l.n, VARIAN: '', QTY: l.q, SATUAN: 'pcs', HARGA: l.h, SUB: l.s, CATATAN: l.c || '' })),
    JUMLAH_ITEM: (tx.d || []).reduce((a, l) => a + l.q, 0),
    SUBTOTAL: tx.sub, DISKON: 0, PAJAK: tx.pjk, PAJAK_PERSEN: st.pajak, TOTAL: tx.tot, METODE: tx.m, DITERIMA: tx.byr, KEMBALI: tx.kem,
    STATUS: batal ? 'DIBATALKAN' : 'LUNAS', LUNAS: batal ? '' : 'YA', TEMPO: '', BATAL: batal ? 'YA' : '', TUNAI: tx.m === 'Tunai' ? 'YA' : '',
    URL_VERIFIKASI: tx._sig ? appBase() + 'verifikasi.html?n=' + encodeURIComponent(tx.id) + '&s=' + tx._sig : '', CATATAN: ''
  };
}
async function cetakStruk(tx) {
  if (!tx) return;
  if (!window.StrukUI) { printReceipt(tx); return; }
  if (!tx._sig && !tx._pending && S.online) { try { const r = await apiX('struk.tanda', { id: tx.id }); if (r.success && r.data.sig) tx._sig = r.data.sig; } catch (e) { /* tanpa QR bila offline */ } }
  StrukUI.pratinjau({ jenis: 'STRUK', data: dataStruk(tx), nomor: tx.id, lebarToko: S.st.format, namaFile: tx.id });
}
function printReceipt(tx) {
  if (!tx) return; $('#printArea').innerHTML = receiptHTML(tx, true);
  setTimeout(() => { try { window.print(); } catch (e) { toast('Pencetakan tidak didukung di perangkat ini. Gunakan Unduh PDF.', 'warn'); } }, 60);
}
function dlB64(name, mime, b64) {
  const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([u], { type: mime })), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function dlText(name, text, mime) { const url = URL.createObjectURL(new Blob(['﻿' + text], { type: mime || 'text/csv;charset=utf-8' })), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }
async function btnTask(btn, fn) {
  if (!btn || btn.disabled) return; const html = btn.innerHTML; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="spin"></span> Memproses…';
  try { await fn(); } catch (e) { toast((e && e.message) || 'Terjadi kesalahan.', 'bad'); } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = html; }
}
async function pdfReceipt(id, btn) {
  await btnTask(btn, async () => { const r = await api('apiReceiptPdf', id); if (!r.success) { toast(r.message, 'bad'); return; } dlB64(r.data.name, r.data.mime, r.data.b64); toast('Struk PDF diunduh.', 'ok'); });
}
function findTx(id) { return S.tx.find(t => t.id === id) || S.rh.list.find(t => t.id === id) || null; }

/* =============================================================================
   GRAFIK SVG ringan (tanpa library) — dengan hover/touch tooltip
   ============================================================================= */
function niceMax(v) { if (v <= 0) return 10; const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
function chartBase(host, pts, kind, o) {
  o = o || {}; const W = 640, H = 230, L = 52, R = 14, T = 14, B = 30, iw = W - L - R, ih = H - T - B, n = pts.length;
  const max = niceMax(Math.max.apply(null, pts.map(p => p.y).concat(0)));
  const band = iw / Math.max(n, 1), xc = i => kind === 'bar' ? L + band * (i + .5) : L + (n > 1 ? iw * i / (n - 1) : iw / 2), yv = v => T + ih - (v / max) * ih;
  const color = o.color || 'var(--c1)'; let g = '';
  for (let k = 0; k <= 4; k++) { const yy = T + ih * k / 4; g += '<line class="' + (k === 4 ? 'ax' : 'gl') + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/><text x="' + (L - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + fmtK(max * (4 - k) / 4) + '</text>'; }
  const every = Math.ceil(n / 8); pts.forEach((p, i) => { if (i % every === 0 || i === n - 1 && n < 9) g += '<text x="' + xc(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(p.x) + '</text>'; });
  let marks = '';
  if (kind === 'line') {
    const d = pts.map((p, i) => (i ? 'L' : 'M') + xc(i).toFixed(1) + ' ' + yv(p.y).toFixed(1)).join(' ');
    marks = '<path d="' + d + ' L' + xc(n - 1).toFixed(1) + ' ' + (T + ih) + ' L' + xc(0).toFixed(1) + ' ' + (T + ih) + 'Z" fill="' + color + '" opacity=".12"/><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      pts.map((p, i) => '<circle cx="' + xc(i).toFixed(1) + '" cy="' + yv(p.y).toFixed(1) + '" r="4" fill="' + color + '" stroke="var(--surface)" stroke-width="2"/>').join('');
  } else {
    const bw = Math.min(40, band * .62);
    marks = pts.map((p, i) => { const h = p.y > 0 ? Math.max(3, ih * p.y / max) : 0, x = xc(i) - bw / 2, y = T + ih - h, r = Math.min(4, h / 2, bw / 2); return h ? '<path d="M' + x + ' ' + (T + ih) + 'V' + (y + r) + 'Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y + 'H' + (x + bw - r) + 'Q' + (x + bw) + ' ' + y + ' ' + (x + bw) + ' ' + (y + r) + 'V' + (T + ih) + 'Z" fill="' + color + '"/>' : ''; }).join('');
  }
  const total = pts.reduce((a, p) => a + p.y, 0);
  host.innerHTML = '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || 'Grafik') + '">' + g + marks + '<line id="cx" class="ax" y1="' + T + '" y2="' + (T + ih) + '" style="display:none"/></svg><div class="tip hide"></div>' +
    '<table class="sr-only"><caption>' + esc(o.label || 'Data grafik') + '</caption><tbody>' + pts.map(p => '<tr><th>' + esc(p.x) + '</th><td>' + p.y + '</td></tr>').join('') + '</tbody></table></div>';
  const wrap = $('.chart', host), svg = $('svg', wrap), tip = $('.tip', wrap), cx = $('#cx', svg);
  if (!n) return;
  const show = ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W; let i = kind === 'bar' ? Math.floor((px - L) / band) : Math.round((px - L) / (iw / Math.max(n - 1, 1))); i = Math.max(0, Math.min(n - 1, i));
    const p = pts[i]; tip.innerHTML = '<div class="muted xs">' + esc(p.tipX || p.x) + '</div><b>' + esc(o.fmtTip ? o.fmtTip(p) : fmt(p.y)) + '</b>' + (p.sub ? '<div class="xs t2">' + esc(p.sub) + '</div>' : '');
    tip.classList.remove('hide'); const sx = xc(i) / W * r.width, sy = yv(p.y) / H * r.height; tip.style.left = Math.min(Math.max(sx, 70), r.width - 70) + 'px'; tip.style.top = Math.max(sy - 10, 40) + 'px';
    if (kind === 'line') { cx.setAttribute('x1', xc(i)); cx.setAttribute('x2', xc(i)); cx.style.display = ''; }
  };
  svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show); svg.addEventListener('pointerleave', () => { tip.classList.add('hide'); cx.style.display = 'none'; });
  void total;
}
function hbars(rows, fmtV) {
  if (!rows.length) return '<div class="empty">' + ic('chart') + '<span>Belum ada data.</span></div>';
  const mx = Math.max.apply(null, rows.map(r => r.v).concat(1));
  return rows.map(r => '<div class="hbar" title="' + esc(r.name + ': ' + fmtV(r.v)) + '"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.name) + '</span><div class="trk"><div class="fil" style="width:' + (r.v / mx * 100).toFixed(1) + '%"></div></div><span class="tr b num">' + fmtV(r.v) + '</span></div>').join('');
}
const METHOD_COL = { Tunai: 'var(--c-aqua)', Transfer: 'var(--c-blue)', QRIS: 'var(--c-orange)' };
function methodBar(map) {
  const tot = Object.keys(map).reduce((a, k) => a + map[k].tot, 0);
  if (!tot) return '<div class="empty">' + ic('coin') + '<span>Belum ada transaksi.</span></div>';
  const keys = Object.keys(map).filter(k => map[k].tot > 0);
  return '<div class="stack" role="img" aria-label="Komposisi metode pembayaran">' + keys.map(k => '<span title="' + esc(k + ': ' + fmt(map[k].tot)) + '" style="flex:' + map[k].tot + ';background:' + (METHOD_COL[k] || 'var(--c1)') + '"></span>').join('') + '</div>' +
    '<div style="margin-top:12px">' + Object.keys(map).map(k => '<div class="det-row"><span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px;background:' + (METHOD_COL[k] || 'var(--c1)') + '"></i>' + esc(k) + ' <span class="muted">(' + map[k].n + ' trx)</span></span><span class="b num">' + fmt(map[k].tot) + ' <span class="muted xs">' + (tot ? Math.round(map[k].tot / tot * 100) : 0) + '%</span></span></div>').join('') + '</div>';
}
function byMethod(txs) { const m = { Tunai: { n: 0, tot: 0 }, Transfer: { n: 0, tot: 0 }, QRIS: { n: 0, tot: 0 } }; txs.forEach(t => { const o = m[t.m] || (m[t.m] = { n: 0, tot: 0 }); o.n++; o.tot += t.tot; }); return m; }

/* =============================================================================
   DASHBOARD
   ============================================================================= */
function renderDashboard() {
  const el = $('#v-dashboard'), today = dayStats(dayStr(0)), low = lowList();
  const top = {}; today.list.forEach(t => (t.d || []).forEach(l => { top[l.n] = (top[l.n] || 0) + l.q; }));
  const topRows = Object.keys(top).map(k => ({ name: k, v: top[k] })).sort((a, b) => b.v - a.v).slice(0, 6);
  el.innerHTML = '<div class="page-h"><div><h2>Dashboard</h2><p>' + (isOwner() ? 'Ringkasan penjualan seluruh kasir hari ini.' : 'Ringkasan transaksi shift Anda hari ini.') + '</p></div><span class="tag brand">' + (isOwner() ? ic('shield', 'sm') + ' Akses Owner' : 'Shift ' + esc(S.me.nama)) + '</span></div>' + kpiHTML(false) +
    '<div class="charts"><div class="card"><div class="card-h"><h3>Tren omzet 7 hari</h3><span class="muted xs">termasuk pajak</span></div><div class="card-b" id="dTrend"></div></div>' +
    '<div class="card"><div class="card-h"><h3>Stok menipis</h3><span class="tag ' + (low.length ? 'warn' : 'ok') + '">' + low.length + ' produk</span></div><div class="card-b">' +
    (low.length ? low.slice(0, 7).map(p => '<div class="det-row" style="align-items:center"><span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.nama) + '</span><span class="tag ' + (p.stok <= 0 ? 'bad' : 'warn') + '">' + (p.stok <= 0 ? 'Habis' : 'Sisa ' + p.stok) + '</span><span class="muted xs">min ' + p.min + '</span></div>').join('') + (low.length > 7 ? '<button class="btn ghost sm" data-act="go" data-v="produk" data-low="1" style="margin-top:6px">Lihat semua ' + low.length + '</button>' : '') : '<div class="empty">' + ic('check') + '<span>Semua stok aman.</span></div>') + '</div></div></div>' +
    '<div class="charts" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="card"><div class="card-h"><h3>Barang terlaris hari ini</h3></div><div class="card-b">' + hbars(topRows, v => v + ' pcs') + '</div></div>' +
    '<div class="card"><div class="card-h"><h3>Metode pembayaran hari ini</h3></div><div class="card-b">' + methodBar(byMethod(today.list)) + '</div></div></div>';
  const tr = trendLive();
  chartBase($('#dTrend'), tr.map(x => ({ x: x.d.slice(8) + ' ' + MONTHS[+x.d.slice(5, 7) - 1], tipX: fmtDate(x.d), y: x.tot, sub: x.ord + ' order' })), 'line', { label: 'Omzet harian 7 hari terakhir' });
}

/* =============================================================================
   PRODUK & STOK
   ============================================================================= */
function renderProduk() {
  const el = $('#v-produk'), own = isOwner(), all = S.produk, act = all.filter(p => p.aktif);
  const aset = act.reduce((a, p) => a + Math.max(p.stok, 0) * (p.modal || 0), 0), low = lowList();
  el.innerHTML = '<div class="page-h"><div><h2>Produk &amp; Manajemen Stok</h2><p>' + (own ? 'Kelola katalog, harga jual, harga modal, dan mutasi stok.' : 'Daftar produk, harga jual, dan stok tersedia (hanya lihat).') + '</p></div>' + (own ? '<button class="btn primary" data-act="pnew">' + ic('plus', 'sm') + ' Tambah Produk</button>' : '') + '</div>' +
    '<div class="kpis" style="margin-bottom:16px"><div class="card kpi"><div class="ico">' + ic('box') + '</div><div><div class="l">Produk aktif</div><div class="v">' + act.length + '</div></div></div>' +
    (own ? '<div class="card kpi"><div class="ico">' + ic('coin') + '</div><div><div class="l">Nilai aset stok (modal)</div><div class="v">' + fmt(aset) + '</div></div></div>' : '<div class="card kpi"><div class="ico">' + ic('pack') + '</div><div><div class="l">Total unit tersedia</div><div class="v">' + num(act.reduce((a, p) => a + Math.max(p.stok, 0), 0)) + '</div></div></div>') +
    '<div class="card kpi"><div class="ico" style="background:var(--warn-soft);color:var(--warn)">' + ic('alert') + '</div><div><div class="l">Stok menipis</div><div class="v">' + low.filter(p => p.stok > 0).length + '</div></div></div>' +
    '<div class="card kpi"><div class="ico" style="background:var(--bad-soft);color:var(--bad)">' + ic('ban') + '</div><div><div class="l">Stok habis</div><div class="v">' + act.filter(p => p.stok <= 0).length + '</div></div></div></div>' +
    '<div class="card"><div class="cat-bar"><div class="cats" id="pCats"></div></div><div class="tbl-wrap" id="pTbl"></div><div class="card-b muted xs" id="pFoot"></div></div>';
  renderProdTable();
}
function renderProdTable() {
  const own = isOwner(), q = (S.q.produk || '').toLowerCase().trim(), pr = S.pr;
  let base = S.produk.filter(p => own && pr.inactive ? true : p.aktif);
  const cs = ['Semua'].concat(Array.from(new Set(base.map(p => p.kat))).sort((a, b) => a.localeCompare(b, 'id')));
  if (cs.indexOf(pr.cat) < 0) pr.cat = 'Semua';
  $('#pCats').innerHTML = cs.map(c => '<button class="chip" data-act="pcat" data-c="' + esc(c) + '" aria-pressed="' + (c === pr.cat) + '">' + esc(c) + ' <small>' + (c === 'Semua' ? base.length : base.filter(p => p.kat === c).length) + '</small></button>').join('') +
    '<button class="chip" data-act="plow" aria-pressed="' + pr.lowOnly + '">' + ic('alert', 'sm') + ' Stok menipis</button>' + (own ? '<button class="chip" data-act="pinact" aria-pressed="' + pr.inactive + '">Tampilkan nonaktif</button>' : '');
  const list = base.filter(p => (pr.cat === 'Semua' || p.kat === pr.cat) && (!pr.lowOnly || p.stok <= p.min) && (!q || p.nama.toLowerCase().indexOf(q) >= 0 || p.id.toLowerCase().indexOf(q) >= 0));
  $('#pTbl').innerHTML = list.length ? '<table class="tbl"><thead><tr><th>Produk &amp; Kode</th><th class="hm">Kategori</th><th class="r">Harga jual</th>' + (own ? '<th class="r hm">Harga modal</th><th class="r hm">Margin</th>' : '') + '<th class="r">Stok</th><th class="r hm">Min</th>' + (own ? '<th class="r">Aksi</th>' : '') + '</tr></thead><tbody>' +
    list.map(p => { const out = p.stok <= 0, lo = !out && p.stok <= p.min, mg = p.harga ? Math.round((p.harga - (p.modal || 0)) / p.harga * 100) : 0;
      return '<tr' + (p.aktif ? '' : ' class="void"') + '><td><div class="pname"><div class="thumb">' + thumb(p) + '</div><div><b class="nm">' + esc(p.nama) + '</b><small>' + esc(p.id) + (p.aktif ? '' : ' • nonaktif') + '</small></div></div></td><td class="hm"><span class="tag">' + esc(p.kat) + '</span></td><td class="r money">' + fmt(p.harga) + '</td>' +
        (own ? '<td class="r money hm">' + fmt(p.modal) + '</td><td class="r hm"><span class="tag ' + (mg >= 30 ? 'ok' : mg >= 10 ? 'info' : 'warn') + '">' + mg + '%</span></td>' : '') +
        '<td class="r"><span class="tag ' + (out ? 'bad' : lo ? 'warn' : 'ok') + '">' + (out ? 'Habis' : p.stok + ' pcs') + '</span></td><td class="r hm muted">' + p.min + '</td>' +
        (own ? '<td class="r"><button class="btn sm" data-act="pstok" data-id="' + esc(p.id) + '">Stok</button> <button class="mini-act" style="display:inline-grid" data-act="pedit" data-id="' + esc(p.id) + '" aria-label="Ubah ' + esc(p.nama) + '">' + ic('edit', 'sm') + '</button></td>' : '') + '</tr>'; }).join('') + '</tbody></table>'
    : '<div class="empty">' + ic('box') + '<b>Tidak ada produk</b><span>Ubah filter atau kata kunci.</span></div>';
  $('#pFoot').textContent = 'Menampilkan ' + list.length + ' dari ' + base.length + ' produk • data tersinkron dengan server';
}
function openProductForm(id) {
  const p = id ? S.pmap[id] : null; if (id && !p) return;
  const dl = cats().map(c => '<option value="' + esc(c) + '">').join('');
  const m = modal({ title: p ? 'Ubah Produk' : 'Tambah Produk', wide: true, body:
    '<form id="pf" class="grid2" novalidate>' +
    '<div class="field" style="grid-column:1/-1"><label for="pfN">Nama produk</label><input id="pfN" class="input" maxlength="80" required value="' + esc(p ? p.nama : '') + '"></div>' +
    '<div class="field"><label for="pfK">Kategori</label><input id="pfK" class="input" list="pfKl" maxlength="30" required value="' + esc(p ? p.kat : '') + '"><datalist id="pfKl">' + dl + '</datalist></div>' +
    '<div class="field"><label for="pfS">' + (p ? 'Stok saat ini' : 'Stok awal') + '</label><input id="pfS" class="input" type="number" inputmode="numeric" min="0" step="1" value="' + (p ? p.stok : 0) + '"' + (p ? ' disabled aria-describedby="pfSh"' : '') + '>' + (p ? '<span class="hint" id="pfSh">Ubah stok lewat tombol “Stok” agar tercatat di mutasi.</span>' : '') + '</div>' +
    '<div class="field"><label for="pfH">Harga jual (Rp)</label><input id="pfH" class="input" type="number" inputmode="numeric" min="0" step="1" required value="' + (p ? p.harga : '') + '"></div>' +
    '<div class="field"><label for="pfM">Harga modal (Rp)</label><input id="pfM" class="input" type="number" inputmode="numeric" min="0" step="1" required value="' + (p ? p.modal : '') + '"></div>' +
    '<div class="field"><label for="pfI">Stok minimum (peringatan)</label><input id="pfI" class="input" type="number" inputmode="numeric" min="0" step="1" value="' + (p ? p.min : 5) + '"></div>' +
    '<div class="field"><label for="pfA">Status</label><select id="pfA" class="input"><option value="1"' + (!p || p.aktif ? ' selected' : '') + '>Aktif (tampil di kasir)</option><option value="0"' + (p && !p.aktif ? ' selected' : '') + '>Nonaktif</option></select></div>' +
    '<div class="field" style="grid-column:1/-1"><label for="pfF">Foto produk (opsional)</label><div class="row"><div class="thumb" id="pfT" style="width:56px;height:56px">' + (p && p.foto ? thumb(p) : ic('image')) + '</div><input id="pfF" class="input" placeholder="https://… (otomatis terisi saat unggah)" value="' + esc(p ? p.foto : '') + '"><label class="btn sm" style="flex:none">' + ic('upload', 'sm') + ' Unggah<input id="pfU" type="file" accept="image/*" class="sr-only"></label></div><span class="hint" id="pfUh">Foto dikompres otomatis (maks. 800 px) lalu disimpan di Google Drive.</span></div>' +
    '<div class="alertbar" id="pfMg" style="grid-column:1/-1;background:var(--brand-soft);color:var(--brand-ink)"></div><p class="err" id="pfE" role="alert" style="grid-column:1/-1"></p></form>',
    footer: '<button class="btn" data-close>Batal</button><button class="btn primary" id="pfOk">Simpan</button>' });
  const mg = () => { const h = +m.$('#pfH').value || 0, c = +m.$('#pfM').value || 0; m.$('#pfMg').textContent = h ? 'Laba per unit ' + fmt(h - c) + ' • margin ' + Math.round((h - c) / h * 100) + '%' : 'Isi harga jual & modal untuk melihat margin.'; };
  ['#pfH', '#pfM'].forEach(s => m.$(s).addEventListener('input', mg)); mg();
  m.$('#pfU').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; const h = m.$('#pfUh'); h.textContent = 'Mengompres & mengunggah…'; try { const url = await uploadImage(f, 'foto'); m.$('#pfF').value = url; m.$('#pfT').innerHTML = '<img src="' + esc(url) + '" alt="">'; h.textContent = 'Foto terunggah.'; } catch (x) { h.textContent = x.message; } });
  m.$('#pfOk').onclick = async () => {
    const g = s => m.$(s).value, err = m.$('#pfE'); err.textContent = '';
    const d = { id: p ? p.id : '', nama: g('#pfN').trim(), kat: g('#pfK').trim(), harga: +g('#pfH'), modal: +g('#pfM'), min: +g('#pfI') || 0, stok: +g('#pfS') || 0, foto: g('#pfF').trim(), aktif: g('#pfA') === '1' };
    if (!d.nama) { err.textContent = 'Nama produk wajib diisi.'; m.$('#pfN').focus(); return; }
    if (!d.kat) { err.textContent = 'Kategori wajib diisi.'; m.$('#pfK').focus(); return; }
    if (!(d.harga >= 0) || g('#pfH') === '') { err.textContent = 'Harga jual wajib diisi.'; m.$('#pfH').focus(); return; }
    if (g('#pfM') === '') { err.textContent = 'Harga modal wajib diisi.'; m.$('#pfM').focus(); return; }
    await btnTask(m.$('#pfOk'), async () => {
      const r = await api('apiSaveProduct', d); if (!r.success) { err.textContent = r.message; return; }
      const np = r.data, i = S.produk.findIndex(x => x.id === np.id); if (i >= 0) S.produk[i] = np; else S.produk.push(np); setProduk(S.produk);
      saveCache(); m.close(); toast('Produk tersimpan.', 'ok'); renderAll();
    });
  };
}
function openStockForm(id) {
  const p = S.pmap[id]; if (!p) return; let jenis = 'Masuk';
  const m = modal({ title: 'Penyesuaian Stok Cepat', drawer: true, body:
    '<div class="card" style="box-shadow:none"><div class="card-b row"><div class="thumb" style="width:52px;height:52px">' + thumb(p) + '</div><div class="grow"><b>' + esc(p.nama) + '</b><div class="muted sm">Stok saat ini: <b class="num" style="color:var(--warn)" id="sCur">' + p.stok + '</b> pcs • Min: ' + p.min + '</div></div><span class="tag num">' + esc(p.id) + '</span></div></div>' +
    '<div role="radiogroup" aria-label="Jenis mutasi" class="field"><span class="lbl">Jenis mutasi inventaris</span>' + [['Masuk', 'Stok Masuk / Pembelian', 'Penerimaan pasokan baru dari vendor'], ['Koreksi', 'Koreksi Stok Fisik (Opname)', 'Samakan dengan hitungan nyata di rak'], ['Keluar', 'Barang Rusak / Kadaluarsa', 'Pemusnahan atau produk cacat']].map((x, i) => '<button type="button" class="method" role="radio" data-j="' + x[0] + '" aria-checked="' + (i === 0) + '" style="justify-items:start;text-align:left;padding:10px 14px;margin-bottom:8px"><b>' + x[1] + '</b><span class="muted xs" style="font-weight:400">' + x[2] + '</span></button>').join('') + '</div>' +
    '<div class="field"><label for="sQ" id="sQl">Jumlah tambahan (+)</label><div style="display:grid;gap:10px"><input id="sQ" class="input num" type="number" inputmode="numeric" min="0" step="1" value="10" style="font-size:20px;font-weight:700"><div class="quick" id="sQk">' + [10, 20, 50].map(v => '<button type="button" class="chip" data-add="' + v + '">+' + v + '</button>').join('') + '</div></div></div>' +
    '<div class="change" id="sEst"><span>Estimasi stok baru</span><span class="money" id="sEstV"></span></div>' +
    '<div class="field"><label for="sN">Catatan / referensi dokumen</label><textarea id="sN" class="input" maxlength="200" placeholder="mis. Restok batch pagi #PO-991"></textarea></div><p class="err" id="sE" role="alert"></p>' +
    '<div class="field"><span class="lbl">Riwayat mutasi terakhir</span><div id="sHist" class="card" style="box-shadow:none"><div class="card-b"><div class="skel" style="height:40px"></div></div></div></div>' +
    '<div class="alertbar" style="background:var(--surface-2);color:var(--text-2)">' + ic('shield', 'sm') + ' Dicatat atas nama <b>' + esc(S.me.nama) + '</b> • ' + esc(fmtDT(nowStr())) + '</div>',
    footer: '<button class="btn" data-close>Batal</button><button class="btn primary" id="sOk">Simpan &amp; Mutasi Stok</button>' });
  const q = () => Math.max(0, Math.floor(+m.$('#sQ').value || 0));
  const est = () => { const v = q(), cur = p.stok, nw = jenis === 'Masuk' ? cur + v : jenis === 'Keluar' ? cur - v : v; const e = m.$('#sEst'); e.classList.toggle('low', nw < 0); m.$('#sEstV').innerHTML = nw + ' pcs <span class="tag ' + (nw < 0 ? 'bad' : nw <= p.min ? 'warn' : 'ok') + '">' + (nw < 0 ? 'Tidak valid' : nw <= p.min ? 'Menipis' : 'Aman') + '</span>'; return nw; };
  m.el.addEventListener('click', e => {
    const j = e.target.closest('[data-j]'); if (j) { jenis = j.dataset.j; $$('[data-j]', m.el).forEach(b => b.setAttribute('aria-checked', b === j)); m.$('#sQl').textContent = jenis === 'Masuk' ? 'Jumlah tambahan (+)' : jenis === 'Keluar' ? 'Jumlah dikurangi (−)' : 'Jumlah stok fisik sebenarnya'; m.$('#sQk').style.display = jenis === 'Masuk' ? '' : 'none'; if (jenis === 'Koreksi') m.$('#sQ').value = p.stok; est(); }
    const a = e.target.closest('[data-add]'); if (a) { m.$('#sQ').value = q() + +a.dataset.add; est(); }
  });
  m.$('#sQ').addEventListener('input', est); est();
  api('apiGetMutasi', p.id).then(r => { const h = m.$('#sHist'); if (!h) return; h.innerHTML = r.success && r.data.length ? r.data.map(x => '<div class="pop-i"><div><b class="sm">' + esc(x.ket || x.j) + '</b><div class="muted xs">' + esc(fmtDT(x.t)) + ' • ' + esc(x.by) + '</div></div><b class="num" style="color:' + (x.q >= 0 ? 'var(--ok)' : 'var(--bad)') + '">' + (x.q > 0 ? '+' : '') + x.q + ' pcs</b></div>').join('') : '<div class="empty" style="padding:18px">Belum ada mutasi.</div>'; }).catch(() => { });
  m.$('#sOk').onclick = async () => {
    const err = m.$('#sE'); err.textContent = ''; const nw = est();
    if (nw < 0) { err.textContent = 'Jumlah melebihi stok saat ini.'; return; }
    if (jenis !== 'Koreksi' && q() < 1) { err.textContent = 'Jumlah minimal 1.'; return; }
    const old = p.stok; p.stok = nw; saveCache(); m.close(); renderAll(); toast('Stok ' + p.nama + ' → ' + nw + ' pcs', 'ok');   // optimistis
    try {
      const r = await api('apiAdjustStock', { id: p.id, jenis, qty: q(), note: m.$('#sN').value.trim() });
      if (!r.success) { p.stok = old; renderAll(); toast('Gagal: ' + r.message, 'bad'); } else { p.stok = r.data.stok; saveCache(); renderAll(); }
    } catch (e) { p.stok = old; renderAll(); toast('Koneksi gagal, stok dikembalikan.', 'bad'); }
  };
}
async function uploadImage(file, kind) {
  if (!/^image\//.test(file.type)) throw new Error('File harus berupa gambar.');
  const img = await new Promise((res, rej) => { const u = URL.createObjectURL(file), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = () => rej(new Error('Gambar tidak dapat dibaca.')); i.src = u; });
  const mx = kind === 'logo' ? 400 : 800, k = Math.min(1, mx / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const data = c.toDataURL(kind === 'logo' ? 'image/png' : 'image/jpeg', .82), r = await api('apiUploadImage', { kind, mime: kind === 'logo' ? 'image/png' : 'image/jpeg', data });
  if (!r.success) throw new Error(r.message); return r.data.url;
}

/* =============================================================================
   RIWAYAT TRANSAKSI
   ============================================================================= */
async function rhLoad() {
  const rh = S.rh; if (!rh.from) { rh.from = rh.to = dayStr(0); }
  if (rh.from > rh.to) { toast('Tanggal awal melebihi tanggal akhir.', 'warn'); return; }
  if (rh.from >= dayStr(1)) { rh.list = S.tx.filter(t => { const d = t.t.slice(0, 10); return d >= rh.from && d <= rh.to; }); rh.loading = false; rhTable(); return; }
  const key = rh.from + '|' + rh.to, c = S.txCache[key];
  if (c && Date.now() - c.at < 60000) { rh.list = c.list; rh.loading = false; rhTable(); return; }
  rh.loading = true; rhTable();
  try {
    const r = await api('apiGetTransactions', { from: rh.from, to: rh.to });
    if (r.success) { rh.list = r.data.tx; S.txCache[key] = { at: Date.now(), list: r.data.tx }; if (r.data.truncated) toast('Menampilkan 1.500 transaksi terbaru. Persempit rentang tanggal.', 'warn'); }
    else { rh.list = []; toast(r.message, 'bad'); }
  } catch (e) { rh.list = []; toast('Gagal memuat riwayat: ' + e.message, 'bad'); }
  rh.loading = false; rhTable();
}
function rhFiltered() {
  const rh = S.rh, q = (S.q.riwayat || '').toLowerCase().trim();
  return rh.list.filter(t => (!rh.metode || t.m === rh.metode) && (!rh.status || t.st === rh.status) && (!rh.kasir || t.k === rh.kasir) && (!q || t.id.toLowerCase().indexOf(q) >= 0 || t.k.toLowerCase().indexOf(q) >= 0)).sort((a, b) => a.id < b.id ? 1 : -1);
}
function renderRiwayat() {
  const el = $('#v-riwayat'), rh = S.rh; if (!rh.from) { rh.from = rh.to = dayStr(0); }
  const kasirs = isOwner() ? Array.from(new Set(S.tx.map(t => t.k).concat(S.users ? S.users.map(u => u.nama) : []))).sort() : [];
  const maxRange = isOwner() ? 93 : 7, minD = (() => { const d = nowDate(); d.setDate(d.getDate() - maxRange); return fmtTs(d).slice(0, 10); })();
  el.innerHTML = '<div class="page-h"><div><h2>Riwayat Transaksi</h2><p>' + (isOwner() ? 'Pantau jejak audit pesanan dan verifikasi pembatalan.' : 'Transaksi milik Anda (7 hari terakhir). Pembatalan hanya oleh Owner.') + '</p></div><div class="row wrap"><button class="btn" data-act="rhrefresh">' + ic('refresh', 'sm') + ' Refresh</button>' + (isOwner() ? '<button class="btn primary" data-act="rhcsv">' + ic('download', 'sm') + ' Ekspor CSV</button>' : '') + '</div></div>' +
    '<div id="rhKpi" class="kpis" style="margin-bottom:16px"></div>' +
    '<div class="card" style="margin-bottom:16px"><div class="card-b row wrap" style="gap:12px">' +
    '<div class="field"><label for="rhF">Dari</label><input id="rhF" class="input" type="date" value="' + rh.from + '" min="' + minD + '" max="' + dayStr(0) + '"></div><div class="field"><label for="rhT">Sampai</label><input id="rhT" class="input" type="date" value="' + rh.to + '" min="' + minD + '" max="' + dayStr(0) + '"></div>' +
    '<div class="field"><label for="rhM">Metode</label><select id="rhM" class="input"><option value="">Semua metode</option>' + ['Tunai', 'Transfer', 'QRIS'].map(x => '<option' + (rh.metode === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="rhS">Status</label><select id="rhS" class="input"><option value="">Semua status</option>' + ['Selesai', 'Dibatalkan'].map(x => '<option' + (rh.status === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div>' +
    (isOwner() ? '<div class="field"><label for="rhK">Kasir</label><select id="rhK" class="input"><option value="">Semua kasir</option>' + kasirs.map(x => '<option' + (rh.kasir === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div>' : '') +
    '<div class="row wrap" style="align-self:flex-end"><button class="chip" data-act="rhpre" data-d="0">Hari ini</button><button class="chip" data-act="rhpre" data-d="1">Kemarin</button><button class="chip" data-act="rhpre" data-d="6">7 hari</button></div></div></div>' +
    '<div class="split"><div class="card"><div class="tbl-wrap" id="rhTbl"></div><div class="card-b row between wrap" id="rhPg"></div></div><aside class="panel-sticky" id="rhDet" aria-label="Detail transaksi"></aside></div>';
  rhLoad(); rhDetail();
}
function rhTable() {
  const rh = S.rh, tb = $('#rhTbl'); if (!tb) return; const all = rhFiltered(), PER = 12, pages = Math.max(1, Math.ceil(all.length / PER)); rh.page = Math.min(rh.page, pages);
  const done_ = all.filter(done), vd = all.filter(t => !done(t));
  $('#rhKpi').innerHTML = [['receipt', 'Total transaksi', all.length + ' <span class="xs muted" style="font-family:var(--font)">pesanan</span>', fmt(all.reduce((a, t) => a + t.tot, 0))], ['check', 'Selesai / lunas', done_.length + ' <span class="xs muted" style="font-family:var(--font)">pesanan</span>', fmt(done_.reduce((a, t) => a + t.tot, 0))], ['ban', 'Dibatalkan / void', vd.length + ' <span class="xs muted" style="font-family:var(--font)">pesanan</span>', fmt(vd.reduce((a, t) => a + t.tot, 0))], ['coin', 'Rata-rata nilai order', fmt(done_.length ? done_.reduce((a, t) => a + t.tot, 0) / done_.length : 0), done_.length + ' transaksi selesai']]
    .map(k => '<div class="card kpi"><div class="ico">' + ic(k[0]) + '</div><div style="min-width:0"><div class="l">' + k[1] + '</div><div class="v">' + k[2] + '</div><div class="d flat">' + k[3] + '</div></div></div>').join('');
  if (rh.loading) { tb.innerHTML = '<div class="card-b">' + '<div class="skel" style="height:44px;margin-bottom:10px"></div>'.repeat(6) + '</div>'; $('#rhPg').innerHTML = ''; return; }
  const rows = all.slice((rh.page - 1) * PER, rh.page * PER);
  tb.innerHTML = rows.length ? '<table class="tbl"><thead><tr><th>Waktu</th><th>ID Transaksi</th><th class="hm">Kasir</th><th>Metode</th><th class="r hm">Item</th><th class="r">Total</th><th>Status</th></tr></thead><tbody>' + rows.map(t =>
    '<tr class="clk' + (t.st !== 'Selesai' ? ' void' : '') + (rh.sel === t.id ? ' sel' : '') + '" data-act="rhsel" data-id="' + esc(t.id) + '" tabindex="0"><td><b class="num">' + esc(t.t.slice(11, 16)) + '</b><div class="muted xs">' + esc(fmtDate(t.t)) + '</div></td><td class="num">' + esc(t.id) + (t._pending ? ' <span class="tag warn">menyimpan</span>' : '') + '</td><td class="hm">' + esc(t.k) + '</td><td><span class="tag ' + (t.m === 'Tunai' ? 'ok' : t.m === 'QRIS' ? 'info' : 'brand') + '">' + esc(t.m) + '</span></td><td class="r hm">' + (t.d || []).reduce((a, d) => a + d.q, 0) + '</td><td class="r money">' + fmt(t.tot) + '</td><td><span class="tag ' + (t.st === 'Selesai' ? 'ok' : 'bad') + '">' + esc(t.st) + '</span></td></tr>').join('') + '</tbody></table>' : '<div class="empty">' + ic('receipt') + '<b>Tidak ada transaksi</b><span>Ubah rentang tanggal atau filter.</span></div>';
  $('#rhPg').innerHTML = '<span class="muted xs">Menampilkan ' + (all.length ? (rh.page - 1) * PER + 1 : 0) + '–' + Math.min(rh.page * PER, all.length) + ' dari ' + all.length + '</span><div class="row"><button class="btn sm" data-act="rhpg" data-d="-1"' + (rh.page <= 1 ? ' disabled' : '') + '>Sebelumnya</button><span class="num b">' + rh.page + ' / ' + pages + '</span><button class="btn sm" data-act="rhpg" data-d="1"' + (rh.page >= pages ? ' disabled' : '') + '>Selanjutnya</button></div>';
}
function detailHTML(t) {
  const lines = (t.d || []).map(l => '<div class="det-row"><span><b class="num">' + l.q + '×</b> ' + esc(l.n) + (l.c ? '<div class="muted xs">• ' + esc(l.c) + '</div>' : '') + '</span><b class="num">' + fmt(l.s) + '</b></div>').join('');
  const audit = '<div class="det-row"><span>' + ic('check', 'sm') + ' Pesanan dibuat oleh <b>' + esc(t.k) + '</b></span><span class="muted xs num">' + esc(t.t.slice(11, 16)) + '</span></div><div class="det-row"><span>' + ic('check', 'sm') + ' Pembayaran ' + esc(t.m) + ' diterima</span><span class="muted xs num">' + esc(t.t.slice(11, 16)) + '</span></div>' +
    (t.st === 'Dibatalkan' ? '<div class="alertbar bad" style="margin-top:8px;align-items:flex-start">' + ic('ban') + '<span>Dibatalkan oleh <b>' + esc(t.db) + '</b> pada ' + esc(fmtDT(t.wb)) + '<br>Alasan: ' + esc(t.ab) + '</span></div>' : '');
  return '<div class="card"><div class="card-h"><div><h3 class="num" style="font-size:18px">' + esc(t.id) + '</h3><div class="muted xs">' + esc(fmtDT(t.t)) + '<br>Kasir: ' + esc(t.k) + '</div></div><span class="tag ' + (t.st === 'Selesai' ? 'ok' : 'bad') + '">' + esc(t.st) + '</span></div><div class="card-b">' +
    '<div class="lbl" style="margin-bottom:4px">RINCIAN ITEM</div>' + lines + '<div class="card" style="box-shadow:none;background:var(--surface-2);margin:12px 0"><div class="card-b" style="padding:12px 14px"><div class="det-row"><span>Subtotal</span><span class="num">' + fmt(t.sub) + '</span></div><div class="det-row"><span>Pajak</span><span class="num">' + fmt(t.pjk) + '</span></div><div class="det-row" style="font-size:16px"><b>Total</b><b class="num">' + fmt(t.tot) + '</b></div><div class="det-row muted"><span>Bayar (' + esc(t.m) + ')</span><span class="num">' + fmt(t.byr) + '</span></div><div class="det-row muted"><span>Kembalian</span><span class="num">' + fmt(t.kem) + '</span></div></div></div>' +
    '<div class="lbl" style="margin-bottom:4px">JEJAK AUDIT</div>' + audit +
    '<div class="row wrap" style="margin-top:14px"><button class="btn grow" data-act="rc-print" data-id="' + esc(t.id) + '"' + (t._pending ? ' disabled' : '') + '>' + ic('print', 'sm') + ' Cetak Struk</button><button class="btn grow" data-act="rc-pdf" data-id="' + esc(t.id) + '"' + (t._pending ? ' disabled' : '') + '>' + ic('download', 'sm') + ' PDF</button></div>' +
    (isOwner() && t.st === 'Selesai' && !t._pending ? '<div class="alertbar bad" style="margin-top:14px;display:block"><b>Otorisasi pembatalan (Owner)</b><div class="xs" style="margin:4px 0 10px;font-weight:500">Stok produk akan dikembalikan otomatis. Transaksi tidak dihapus — hanya ditandai dibatalkan.</div><button class="btn danger block" data-act="void" data-id="' + esc(t.id) + '">' + ic('ban', 'sm') + ' Batalkan Transaksi (Void)</button></div>' : (!isOwner() && t.st === 'Selesai' ? '<p class="hint" style="margin-top:12px">Pembatalan hanya dapat dilakukan oleh Owner.</p>' : '')) + '</div></div>';
}
function rhDetail() {
  const box = $('#rhDet'); if (!box) return; const t = S.rh.sel && findTx(S.rh.sel);
  box.innerHTML = t ? detailHTML(t) : '<div class="card"><div class="empty">' + ic('receipt') + '<b>Pilih transaksi</b><span>Ketuk baris untuk melihat rincian, struk, dan jejak audit.</span></div></div>';
}
function openVoid(id) {
  const t = findTx(id); if (!t) return;
  const m = modal({ title: 'Batalkan ' + t.id, center: true, body: '<div class="alertbar bad">' + ic('alert') + '<span>' + fmt(t.tot) + ' • stok ' + (t.d || []).length + ' produk akan dikembalikan.</span></div><div class="field"><label for="vR">Alasan pembatalan (wajib)</label><textarea id="vR" class="input" maxlength="200" placeholder="mis. Pelanggan salah pesan"></textarea></div><div class="field"><label for="vP">PIN Owner</label><input id="vP" class="input pin-in" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></div><p class="err" id="vE" role="alert"></p>', footer: '<button class="btn" data-close>Batal</button><button class="btn danger" id="vOk">Batalkan Transaksi</button>' });
  m.$('#vOk').onclick = async () => {
    const al = m.$('#vR').value.trim(), pin = m.$('#vP').value.trim(), err = m.$('#vE'); err.textContent = '';
    if (al.length < 3) { err.textContent = 'Alasan pembatalan wajib diisi.'; m.$('#vR').focus(); return; }
    if (!/^\d{4,6}$/.test(pin)) { err.textContent = 'Masukkan PIN Owner (4–6 digit).'; m.$('#vP').focus(); return; }
    await btnTask(m.$('#vOk'), async () => {
      const r = await api('apiVoid', { id, alasan: al, pin }); if (!r.success) { err.textContent = r.message; return; }
      [S.tx, S.rh.list].forEach(arr => { const i = arr.findIndex(x => x.id === id); if (i >= 0) { r.data.tx.d = arr[i].d; arr[i] = r.data.tx; } });
      Object.keys(S.txCache).forEach(k => { const l = S.txCache[k].list, i = l.findIndex(x => x.id === id); if (i >= 0) l[i] = r.data.tx; });
      applyStok(r.data.stok); S.repCache = {}; saveCache(); m.close(); toast(r.message, 'ok'); renderAll();
    });
  };
}
function csvCell(v) { v = String(v == null ? '' : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function exportCsv() {
  const rows = rhFiltered(); if (!rows.length) { toast('Tidak ada data untuk diekspor.', 'warn'); return; }
  const head = ['ID Transaksi', 'Waktu', 'Kasir', 'Metode', 'Subtotal', 'Pajak', 'Total', 'Bayar', 'Kembalian', 'Status', 'Alasan Batal', 'Dibatalkan Oleh', 'Waktu Batal'];
  dlText('riwayat_' + S.rh.from + '_' + S.rh.to + '.csv', [head].concat(rows.map(t => [t.id, t.t, t.k, t.m, t.sub, t.pjk, t.tot, t.byr, t.kem, t.st, t.ab, t.db, t.wb])).map(r => r.map(csvCell).join(',')).join('\r\n'));
  toast('CSV diunduh (' + rows.length + ' baris).', 'ok');
}

/* =============================================================================
   LAPORAN (Owner)
   ============================================================================= */
function rpRange(p) {
  const t = dayStr(0); if (p === 'today') return [t, t]; if (p === '7') return [dayStr(6), t]; if (p === '30') return [dayStr(29), t];
  if (p === 'month') return [t.slice(0, 8) + '01', t]; return [S.rp.from || dayStr(6), S.rp.to || t];
}
function renderLaporan() {
  const el = $('#v-laporan'), rp = S.rp; if (!rp.from) { const r = rpRange(rp.preset); rp.from = r[0]; rp.to = r[1]; }
  el.innerHTML = '<div class="page-h"><div><h2>Laporan Penjualan</h2><p>Omzet, barang terlaris, metode pembayaran, dan estimasi laba.</p></div><div class="row wrap"><button class="btn" data-act="rpx" data-f="xlsx">' + ic('download', 'sm') + ' Excel</button><button class="btn primary" data-act="rpx" data-f="pdf">' + ic('download', 'sm') + ' PDF</button></div></div>' +
    '<div class="card" style="margin-bottom:16px"><div class="card-b row wrap" style="gap:12px"><div class="seg" role="group" aria-label="Periode">' + [['today', 'Hari ini'], ['7', '7 hari'], ['30', '30 hari'], ['month', 'Bulan ini'], ['custom', 'Kustom']].map(x => '<button data-act="rppre" data-p="' + x[0] + '" aria-pressed="' + (rp.preset === x[0]) + '">' + x[1] + '</button>').join('') + '</div>' +
    '<div class="field"><label for="rpF">Dari</label><input id="rpF" class="input" type="date" value="' + rp.from + '" max="' + dayStr(0) + '"></div><div class="field"><label for="rpT">Sampai</label><input id="rpT" class="input" type="date" value="' + rp.to + '" max="' + dayStr(0) + '"></div>' +
    '<div class="field"><label for="rpK">Kategori</label><select id="rpK" class="input"></select></div><div class="field"><label for="rpU">Kasir</label><select id="rpU" class="input"></select></div><div class="field"><label for="rpM">Metode</label><select id="rpM" class="input"><option value="">Semua</option>' + ['Tunai', 'Transfer', 'QRIS'].map(x => '<option' + (rp.metode === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div></div></div><div id="rpBody"></div>';
  rpLoad();
}
async function rpLoad(force) {
  const rp = S.rp, key = rp.from + '|' + rp.to; if (rp.from > rp.to) { toast('Tanggal awal melebihi tanggal akhir.', 'warn'); return; }
  const c = S.repCache[key]; if (c && !force && Date.now() - c.at < 90000) { rp.data = c.d; rp.err = ''; rpBody(); return; }
  rp.loading = true; rp.err = ''; rpBody();
  try { const r = await api('apiGetReport', { from: rp.from, to: rp.to }); if (r.success) { rp.data = r.data; S.repCache[key] = { at: Date.now(), d: r.data }; } else { rp.err = r.message; rp.data = null; } }
  catch (e) { rp.err = 'Gagal memuat laporan: ' + e.message; rp.data = null; }
  rp.loading = false; rpBody();
}
function rpBody() {
  const rp = S.rp, box = $('#rpBody'); if (!box) return;
  if (rp.loading) { box.innerHTML = '<div class="kpis">' + '<div class="card skel" style="height:78px"></div>'.repeat(4) + '</div><div class="card skel" style="height:260px;margin-top:16px"></div>'; return; }
  if (rp.err) { box.innerHTML = '<div class="card"><div class="empty">' + ic('alert') + '<b>' + esc(rp.err) + '</b><button class="btn" data-act="rpretry">Coba lagi</button></div></div>'; return; }
  const d = rp.data; if (!d) { box.innerHTML = ''; return; }
  const ksel = $('#rpK'), usel = $('#rpU'), kats = Array.from(new Set(d.baris.map(b => b.kat))).sort(), kas = Array.from(new Set(d.tx.map(t => t.k))).sort();
  ksel.innerHTML = '<option value="">Semua</option>' + kats.map(x => '<option' + (rp.kat === x ? ' selected' : '') + '>' + esc(x) + '</option>').join(''); usel.innerHTML = '<option value="">Semua</option>' + kas.map(x => '<option' + (rp.kasir === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
  const q = (S.q.laporan || '').toLowerCase().trim();
  const bar = d.baris.filter(b => (!rp.kat || b.kat === rp.kat) && (!rp.kasir || b.k === rp.kasir) && (!rp.metode || b.m === rp.metode));
  const tx = d.tx.filter(t => (!rp.kasir || t.k === rp.kasir) && (!rp.metode || t.m === rp.metode));
  const sales = bar.reduce((a, b) => a + b.s, 0), cogs = bar.reduce((a, b) => a + b.mod * b.q, 0), laba = sales - cogs, qty = bar.reduce((a, b) => a + b.q, 0);
  const prod = {}; bar.forEach(b => { const o = prod[b.p] || (prod[b.p] = { n: b.n, kat: b.kat, q: 0, s: 0, c: 0 }); o.q += b.q; o.s += b.s; o.c += b.mod * b.q; });
  let plist = Object.keys(prod).map(k => prod[k]).sort((a, b) => b.s - a.s); const top = plist.slice().sort((a, b) => b.q - a.q).slice(0, 8);
  if (q) plist = plist.filter(p => p.n.toLowerCase().indexOf(q) >= 0 || p.kat.toLowerCase().indexOf(q) >= 0);
  const days = {}; for (let dt = new Date(rp.from + 'T00:00:00'), end = new Date(rp.to + 'T00:00:00'); dt <= end; dt.setDate(dt.getDate() + 1)) { days[dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate())] = 0; }
  bar.forEach(b => { const k = b.t.slice(0, 10); if (k in days) days[k] += b.s; });
  const pts = Object.keys(days).map(k => ({ x: k.slice(8) + ' ' + MONTHS[+k.slice(5, 7) - 1], tipX: fmtDate(k), y: days[k] }));
  const mm = byMethod(tx), kpi = (i, l, v, s) => '<div class="card kpi"><div class="ico">' + ic(i) + '</div><div style="min-width:0"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="d flat">' + s + '</div></div></div>';
  box.innerHTML = '<div class="kpis">' + kpi('coin', 'Penjualan (sebelum pajak)', fmt(sales), tx.length + ' transaksi') + kpi('trend', 'Estimasi laba', fmt(laba), 'Margin ' + (sales ? (laba / sales * 100).toFixed(1).replace('.', ',') : '0') + '%') + kpi('pack', 'Item terjual', num(qty), plist.length + ' produk') + kpi('ban', 'Transaksi dibatalkan', d.voidN, fmt(d.voidTot) + ' (tidak dihitung)') + '</div>' +
    '<div class="charts"><div class="card"><div class="card-h"><h3>Omzet harian</h3><span class="muted xs">penjualan sebelum pajak</span></div><div class="card-b" id="rpChart"></div></div><div class="card"><div class="card-h"><h3>Barang terlaris</h3><span class="muted xs">jumlah terjual</span></div><div class="card-b">' + hbars(top.map(p => ({ name: p.n, v: p.q })), v => num(v) + ' pcs') + '</div></div></div>' +
    '<div class="charts" style="grid-template-columns:minmax(0,1fr) minmax(0,1.6fr)"><div class="card"><div class="card-h"><h3>Rekap per metode bayar</h3></div><div class="card-b">' + methodBar(mm) + '<p class="hint" style="margin-top:8px">Total diterima (termasuk pajak) untuk rekonsiliasi laci &amp; rekening. Tidak terpengaruh filter kategori.</p></div></div>' +
    '<div class="card"><div class="card-h"><h3>Estimasi laba per produk</h3><span class="muted xs">' + plist.length + ' produk</span></div><div class="tbl-wrap" style="max-height:340px;overflow-y:auto">' + (plist.length ? '<table class="tbl"><thead><tr><th>Produk</th><th class="hm">Kategori</th><th class="r">Qty</th><th class="r">Penjualan</th><th class="r hm">Modal</th><th class="r">Laba</th></tr></thead><tbody>' + plist.map(p => '<tr><td><b class="nm">' + esc(p.n) + '</b></td><td class="hm"><span class="tag">' + esc(p.kat) + '</span></td><td class="r num">' + num(p.q) + '</td><td class="r money">' + fmt(p.s) + '</td><td class="r money hm">' + fmt(p.c) + '</td><td class="r money" style="color:' + (p.s - p.c >= 0 ? 'var(--ok)' : 'var(--bad)') + '">' + fmt(p.s - p.c) + '</td></tr>').join('') + '</tbody></table>' : '<div class="empty">' + ic('chart') + '<span>Tidak ada data pada filter ini.</span></div>') + '</div></div></div>';
  chartBase($('#rpChart'), pts, 'bar', { label: 'Omzet harian', fmtTip: p => fmt(p.y) });
}
async function exportReport(fmtX, btn) {
  const rp = S.rp; await btnTask(btn, async () => {
    const r = await api('apiExportReport', { from: rp.from, to: rp.to, kat: rp.kat, kasir: rp.kasir, metode: rp.metode }, fmtX);
    if (!r.success) { toast(r.message, 'bad'); return; } dlB64(r.data.name, r.data.mime, r.data.b64); toast('Laporan ' + fmtX.toUpperCase() + ' diunduh.', 'ok');
  });
}

/* =============================================================================
   PENGGUNA (Owner)
   ============================================================================= */
async function renderPengguna() {
  const el = $('#v-pengguna');
  el.innerHTML = '<div class="page-h"><div><h2>Pengguna</h2><p>Tambah kasir, nonaktifkan akun, dan reset PIN.</p></div><button class="btn primary" data-act="unew">' + ic('plus', 'sm') + ' Tambah Pengguna</button></div><div class="card"><div class="tbl-wrap" id="uTbl"><div class="card-b"><div class="skel" style="height:120px"></div></div></div></div>';
  if (!S.users) { try { const r = await api('apiListUsers'); if (r.success) S.users = r.data; else { toast(r.message, 'bad'); return; } } catch (e) { toast('Gagal memuat pengguna.', 'bad'); return; } }
  const tb = $('#uTbl'); if (!tb) return;
  tb.innerHTML = '<table class="tbl"><thead><tr><th>Nama</th><th class="hm">Email</th><th>Peran</th><th>Status</th><th>PIN</th><th class="r">Aksi</th></tr></thead><tbody>' + S.users.map(u => '<tr' + (u.aktif ? '' : ' class="void"') + '><td><div class="pname" style="min-width:0"><div class="avatar" style="background:var(--brand-soft);color:var(--brand-ink)">' + esc(initial(u.nama)) + '</div><b>' + esc(u.nama) + '</b></div></td><td class="hm">' + esc(u.email) + '</td><td><span class="tag ' + (u.peran === 'Owner' ? 'brand' : '') + '">' + esc(u.peran) + '</span></td><td><span class="tag ' + (u.aktif ? 'ok' : 'bad') + '">' + (u.aktif ? 'Aktif' : 'Nonaktif') + '</span></td><td>' + (u.hasPin ? '<span class="tag ok">Terpasang</span>' : '<span class="tag warn">Belum</span>') + '</td><td class="r"><button class="btn sm" data-act="uedit" data-id="' + esc(u.id) + '">Ubah / Reset PIN</button></td></tr>').join('') + '</tbody></table>';
}
function openUserForm(id) {
  const u = id ? (S.users || []).find(x => x.id === id) : null;
  const m = modal({ title: u ? 'Ubah Pengguna' : 'Tambah Pengguna', center: true, body: '<form class="grid2" novalidate><div class="field" style="grid-column:1/-1"><label for="uN">Nama (tampil di struk)</label><input id="uN" class="input" maxlength="60" value="' + esc(u ? u.nama : '') + '"></div><div class="field" style="grid-column:1/-1"><label for="uE">Email akun Google</label><input id="uE" class="input" type="email" value="' + esc(u ? u.email : '') + '"></div><div class="field"><label for="uR">Peran</label><select id="uR" class="input"><option' + (u && u.peran === 'Kasir' || !u ? ' selected' : '') + '>Kasir</option><option' + (u && u.peran === 'Owner' ? ' selected' : '') + '>Owner</option></select></div><div class="field"><label for="uA">Status</label><select id="uA" class="input"><option value="1"' + (!u || u.aktif ? ' selected' : '') + '>Aktif</option><option value="0"' + (u && !u.aktif ? ' selected' : '') + '>Nonaktif</option></select></div><div class="field" style="grid-column:1/-1"><label for="uP">' + (u ? 'PIN baru (kosongkan bila tidak diubah)' : 'PIN (4–6 digit)') + '</label><input id="uP" class="input pin-in" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div><p class="err" id="uErr" role="alert" style="grid-column:1/-1"></p></form>', footer: '<button class="btn" data-close>Batal</button><button class="btn primary" id="uOk">Simpan</button>' });
  m.$('#uOk').onclick = async () => {
    const err = m.$('#uErr'); err.textContent = ''; const d = { id: u ? u.id : '', nama: m.$('#uN').value.trim(), email: m.$('#uE').value.trim(), peran: m.$('#uR').value, aktif: m.$('#uA').value === '1', pin: m.$('#uP').value.trim() };
    if (!d.nama) { err.textContent = 'Nama wajib diisi.'; return; } if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) { err.textContent = 'Format email tidak valid.'; return; } if (d.pin && !/^\d{4,6}$/.test(d.pin)) { err.textContent = 'PIN harus 4–6 digit angka.'; return; } if (!u && !d.pin) { err.textContent = 'PIN wajib diisi untuk pengguna baru.'; return; }
    await btnTask(m.$('#uOk'), async () => { const r = await api('apiSaveUser', d); if (!r.success) { err.textContent = r.message; return; } S.users = null; m.close(); toast('Pengguna tersimpan.', 'ok'); renderPengguna(); });
  };
}
function openPinChange() {
  const m = modal({ title: 'Ubah PIN', center: true, body: '<div class="field"><label for="pcO">PIN lama</label><input id="pcO" class="input pin-in" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password"></div><div class="field"><label for="pcN">PIN baru (4–6 digit)</label><input id="pcN" class="input pin-in" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div><p class="err" id="pcE" role="alert"></p>', footer: '<button class="btn" data-close>Batal</button><button class="btn primary" id="pcOk">Simpan PIN</button>' });
  m.$('#pcOk').onclick = async () => { const err = m.$('#pcE'); err.textContent = ''; const o = m.$('#pcO').value.trim(), n = m.$('#pcN').value.trim(); if (!/^\d{4,6}$/.test(o) || !/^\d{4,6}$/.test(n)) { err.textContent = 'PIN harus 4–6 digit angka.'; return; } await btnTask(m.$('#pcOk'), async () => { const r = await api('apiChangePin', { lama: o, baru: n }); if (!r.success) { err.textContent = r.message; return; } m.close(); toast('PIN berhasil diubah.', 'ok'); }); };
}

/* =============================================================================
   PENGATURAN (Owner)
   ============================================================================= */
function renderPengaturan() {
  const el = $('#v-pengaturan'), s = S.st;
  el.innerHTML = '<div class="page-h"><div><h2>Pengaturan</h2><p>Profil toko, struk, pajak, notifikasi, dan migrasi data.</p></div><button class="btn primary" id="stSave">' + ic('check', 'sm') + ' Simpan Pengaturan</button></div>' +
    '<div class="grid2" style="align-items:start"><div class="card"><div class="card-h"><h3>Profil toko</h3></div><div class="card-b" style="display:grid;gap:14px">' +
    '<div class="field"><label for="stN">Nama toko</label><input id="stN" class="input" maxlength="80" value="' + esc(s.nama) + '"></div><div class="field"><label for="stA">Alamat</label><input id="stA" class="input" maxlength="200" value="' + esc(s.alamat) + '"></div><div class="field"><label for="stT">Telepon</label><input id="stT" class="input" inputmode="tel" maxlength="30" value="' + esc(s.telp) + '"></div>' +
    '<div class="field"><label for="stL">Logo</label><div class="row"><div class="brand-logo" style="background:var(--side)" id="stLp">' + (s.logo ? '<img src="' + esc(s.logo) + '" alt="" data-fb="' + esc(initial(s.nama)) + '">' : ic('cart', 'lg')) + '</div><input id="stL" class="input" placeholder="https://…" value="' + esc(s.logo) + '"><label class="btn sm" style="flex:none">' + ic('upload', 'sm') + ' Unggah<input id="stLu" type="file" accept="image/*" class="sr-only"></label></div></div></div></div>' +
    '<div class="card"><div class="card-h"><h3>Struk, pajak &amp; stok</h3></div><div class="card-b" style="display:grid;gap:14px"><div class="grid2"><div class="field"><label for="stP">Pajak (%)</label><input id="stP" class="input" type="number" inputmode="decimal" min="0" max="100" step="0.5" value="' + s.pajak + '"></div><div class="field"><label for="stF">Lebar struk</label><select id="stF" class="input"><option value="58"' + (s.format === '58' ? ' selected' : '') + '>58 mm</option><option value="80"' + (s.format === '80' ? ' selected' : '') + '>80 mm</option></select></div></div>' +
    '<div class="field"><label for="stM">Penjualan saat stok habis</label><select id="stM" class="input"><option value="0"' + (!s.stokMinus ? ' selected' : '') + '>Tolak (stok tidak boleh minus)</option><option value="1"' + (s.stokMinus ? ' selected' : '') + '>Izinkan stok minus</option></select></div>' +
    '<div class="field"><label for="stE">Email notifikasi stok (ringkasan harian)</label><input id="stE" class="input" type="email" value="' + esc(s.emailNotif) + '"></div></div></div>' +
    '<div class="card"><div class="card-h"><h3>Printer &amp; template struk</h3></div><div class="card-b" style="display:grid;gap:12px"><p class="t2 sm">Atur tata letak struk (direktif teks), metode cetak (Bluetooth / RawBT / browser), lebar kertas, dan QR verifikasi.</p><div class="row wrap"><button class="btn" data-act="st-ed">' + ic('gear', 'sm') + ' Editor template</button><button class="btn" data-act="st-pr">' + ic('print', 'sm') + ' Pengaturan printer</button></div></div></div>' +
    '<div class="card"><div class="card-h"><h3>Pratinjau struk</h3></div><div class="card-b"><div class="rcv" id="stPv"></div></div></div>' +
    '<div class="card"><div class="card-h"><h3>Migrasi data dari versi lama</h3></div><div class="card-b" style="display:grid;gap:12px"><p class="t2 sm">Salin data dari spreadsheet KasirKu lama ke database ini. Spreadsheet lama hanya dibaca. Aman diulang (idempoten) sebelum cutover.</p><div class="field"><label for="mgS">ID atau URL spreadsheet lama</label><input id="mgS" class="input" placeholder="https://docs.google.com/spreadsheets/d/…"></div><div class="row wrap"><button class="btn" data-act="mgscan">1. Pindai (simulasi)</button><button class="btn primary" data-act="mgrun">2. Jalankan migrasi</button></div><div id="mgOut"></div></div></div>' +
    '<div class="card"><div class="card-h"><h3>Tampilan &amp; keamanan</h3></div><div class="card-b row wrap"><button class="btn" data-act="theme">' + ic('moon', 'sm') + ' Ganti tema</button><button class="btn" data-act="pin">' + ic('lock', 'sm') + ' Ubah PIN saya</button></div></div></div>';
  const live = () => { const t = { id: 'TRX-20261124-0001', t: nowStr(), k: S.me.nama, m: 'Tunai', sub: 125000, pjk: Math.round(125000 * (+$('#stP').value || 0) / 100), tot: 0, byr: 150000, kem: 0, st: 'Selesai', d: [{ n: 'Cappuccino', q: 1, h: 28000, s: 28000 }, { n: 'Bagel Keju', q: 2, h: 22000, s: 44000 }, { n: 'Caesar Salad', q: 1, h: 35000, s: 35000 }, { n: 'Jus Jeruk Segar', q: 1, h: 18000, s: 18000 }] }; t.tot = t.sub + t.pjk; t.kem = t.byr - t.tot; const keep = S.st; S.st = Object.assign({}, S.st, { nama: $('#stN').value, alamat: $('#stA').value, telp: $('#stT').value, pajak: +$('#stP').value || 0, format: $('#stF').value }); $('#stPv').innerHTML = receiptHTML(t); S.st = keep; };
  ['#stN', '#stA', '#stT', '#stP', '#stF'].forEach(x => $(x).addEventListener('input', live)); live();
  $('#stLu').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { const url = await uploadImage(f, 'logo'); $('#stL').value = url; $('#stLp').innerHTML = '<img src="' + esc(url) + '" alt="">'; toast('Logo terunggah. Klik Simpan Pengaturan.', 'ok'); } catch (x) { toast(x.message, 'bad'); } });
  $('#stSave').onclick = () => btnTask($('#stSave'), async () => {
    const d = { nama: $('#stN').value.trim(), alamat: $('#stA').value.trim(), telp: $('#stT').value.trim(), logo: $('#stL').value.trim(), format: $('#stF').value, pajak: +$('#stP').value, stokMinus: $('#stM').value === '1', emailNotif: $('#stE').value.trim() };
    if (!d.nama) { toast('Nama toko wajib diisi.', 'warn'); return; } if (!(d.pajak >= 0 && d.pajak <= 100)) { toast('Pajak harus 0–100%.', 'warn'); return; }
    const r = await api('apiSaveSettings', d); if (!r.success) { toast(r.message, 'bad'); return; }
    S.st = Object.assign({}, S.st, r.data); saveCache(); applyBrand(); $('#pRole').textContent = S.me.peran + ' • ' + S.st.nama; toast('Pengaturan disimpan.', 'ok'); Object.keys(VIEWS).forEach(k => { if (k !== 'pengaturan') S.dirty[k] = true; });
  });
}
async function migrate(mode, btn) {
  const src = $('#mgS').value.trim(); if (!src) { toast('Masukkan ID atau URL spreadsheet lama.', 'warn'); return; }
  if (mode === 'jalankan' && !(await confirmBox('Jalankan migrasi?', 'Data dari spreadsheet lama akan digabungkan ke database ini. Disarankan menjalankan “Pindai” terlebih dahulu.', 'Jalankan'))) return;
  await btnTask(btn, async () => {
    const r = await api('apiMigrasi', { sumber: src, mode }); if (!r.success) { $('#mgOut').innerHTML = '<div class="alertbar bad">' + ic('alert') + '<span>' + esc(r.message) + '</span></div>'; return; }
    const h = r.data.hasil; $('#mgOut').innerHTML = '<div class="alertbar" style="background:var(--ok-soft);color:var(--ok)">' + ic('check') + '<span>' + esc(r.message) + '</span></div><table class="tbl"><thead><tr><th>Sheet</th><th class="r">Tambah</th><th class="r">Perbarui</th><th class="r">Lewati</th></tr></thead><tbody>' + Object.keys(h).map(k => '<tr><td>' + esc(k) + '</td><td class="r num">' + h[k].inserted + '</td><td class="r num">' + h[k].updated + '</td><td class="r num">' + h[k].skipped + '</td></tr>').join('') + '</tbody></table>';
    if (mode === 'jalankan') { await revalidate(); toast('Migrasi selesai.', 'ok'); }
  });
}

/* =============================================================================
   PEMBERITAHUAN, PROFIL, EVENT
   ============================================================================= */
function bellPop() {
  const l = lowList(); const html = '<div class="pop-i"><b>Stok menipis</b><span class="tag ' + (l.length ? 'warn' : 'ok') + '">' + l.length + '</span></div>' + (l.length ? l.slice(0, 8).map(p => '<div class="pop-i"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.nama) + '</span><span class="tag ' + (p.stok <= 0 ? 'bad' : 'warn') + '">' + (p.stok <= 0 ? 'Habis' : 'Sisa ' + p.stok) + '</span></div>').join('') + '<div class="pop-i"><button class="btn sm block" data-act="go" data-v="produk" data-low="1">Lihat di Produk &amp; Stok</button></div>' : '<div class="pop-i muted">Semua stok aman.</div>');
  popover($('#bellBtn'), html);
}
function profilePop() {
  popover($('#profileBtn'), '<div class="pop-i"><div><b>' + esc(S.me.nama) + '</b><div class="muted xs">' + esc(S.me.email) + ' • ' + esc(S.me.peran) + '</div></div></div><div class="pop-i"><button class="btn sm block" data-act="pin">' + ic('lock', 'sm') + ' Ubah PIN</button></div><div class="pop-i"><button class="btn sm block" data-act="logout">' + ic('logout', 'sm') + ' Ganti kasir / Keluar</button></div>');
}
const ACT = {
  go(a) { if (a.dataset.low) { S.pr.lowOnly = true; S.dirty.produk = true; } go(a.dataset.v); }, cat(a) { S.cat = a.dataset.c; renderCats(); renderProds(); },
  gridmode(a) { S.grid = a.dataset.m; renderCats(); renderProds(); }, add(a) { if (addToCart(a.dataset.id)) { a.classList.remove('bump'); void a.offsetWidth; a.classList.add('bump'); } },
  inc(a) { setQty(a.dataset.id, 1); }, dec(a) { setQty(a.dataset.id, -1); }, del(a) { S.cart = S.cart.filter(c => c.id !== a.dataset.id); saveCart(); renderCart(); }, note(a) { editNote(a.dataset.id); },
  clear() { clearCart(); }, pay() { openPay(); }, cartopen() { cartOpen(); }, cartclose() { cartClose(); },
  'rc-print'(a) { cetakStruk(findTx(a.dataset.id) || (S.lastSuccess && S.lastSuccess.tx)); }, 'rc-pdf'(a) { pdfReceipt(a.dataset.id, a); }, 'st-ed'() { window.StrukUI && StrukUI.editor(); }, 'st-pr'() { window.StrukUI && StrukUI.pengaturanPrinter(); },
  pcat(a) { S.pr.cat = a.dataset.c; renderProdTable(); }, plow() { S.pr.lowOnly = !S.pr.lowOnly; renderProdTable(); }, pinact() { S.pr.inactive = !S.pr.inactive; renderProdTable(); },
  pnew() { openProductForm(); }, pedit(a) { openProductForm(a.dataset.id); }, pstok(a) { openStockForm(a.dataset.id); },
  rhsel(a) { S.rh.sel = a.dataset.id; rhTable(); rhDetail(); if (matchMedia('(max-width:1100px)').matches) { const t = findTx(S.rh.sel); if (t) { const m = modal({ title: 'Detail transaksi', drawer: true, body: detailHTML(t) }); m.el.addEventListener('click', e => { if (e.target.closest('[data-act=void]') || e.target.closest('[data-act=rc-print]') || e.target.closest('[data-act=rc-pdf]')) { /* tangani oleh delegasi global */ } }); } } },
  rhpg(a) { S.rh.page += +a.dataset.d; rhTable(); }, rhrefresh() { S.txCache = {}; S.rh.loading = false; rhLoad(); },
  rhpre(a) { const d = +a.dataset.d; S.rh.to = dayStr(0); S.rh.from = dayStr(d === 1 ? 1 : d); if (d === 1) S.rh.to = dayStr(1); S.rh.page = 1; $('#rhF').value = S.rh.from; $('#rhT').value = S.rh.to; rhLoad(); },
  rhcsv() { exportCsv(); }, void(a) { openVoid(a.dataset.id); },
  rppre(a) { S.rp.preset = a.dataset.p; if (a.dataset.p !== 'custom') { const r = rpRange(a.dataset.p); S.rp.from = r[0]; S.rp.to = r[1]; } renderLaporan(); }, rpx(a) { exportReport(a.dataset.f, a); }, rpretry() { rpLoad(true); },
  unew() { openUserForm(); }, uedit(a) { openUserForm(a.dataset.id); }, mgscan(a) { migrate('pindai', a); }, mgrun(a) { migrate('jalankan', a); },
  theme() { toggleTheme(); }, pin() { closePop(); openPinChange(); }, logout() { closePop(); logout(); }
};
function bind() {
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (a && ACT[a.dataset.act]) { if (a.tagName === 'BUTTON' && a.disabled) return; ACT[a.dataset.act](a, e); }
    if (popEl && !e.target.closest('.pop') && !e.target.closest('#bellBtn') && !e.target.closest('#profileBtn')) closePop();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (popEl) closePop(); else if (!closeTop()) { const c = $('#cart'); if (c && c.classList.contains('open')) cartClose(); closeSide(); } }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && S.me) { const sb = $('#searchBox'); if (!sb.classList.contains('hide')) { e.preventDefault(); $('#gSearch').focus(); $('#gSearch').select(); } }
    if (e.key === 'F2' && S.me && S.view === 'kasir' && !modals.length) { e.preventDefault(); openPay(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr.clk')) { e.preventDefault(); e.target.click(); }
  });
  document.addEventListener('error', e => { const t = e.target; if (t && t.tagName === 'IMG' && t.dataset.fb) { t.replaceWith(document.createTextNode(t.dataset.fb)); } }, true);
  $('#loginForm').addEventListener('submit', doLogin);
  $('#menuBtn').onclick = openSide; $('#sideScrim').onclick = closeSide; $('#themeBtn').onclick = toggleTheme; $('#bellBtn').onclick = e => { e.stopPropagation(); popEl ? closePop() : bellPop(); }; $('#profileBtn').onclick = e => { e.stopPropagation(); popEl ? closePop() : profilePop(); };
  const gs = $('#gSearch');
  gs.addEventListener('input', debounce(() => { S.q[S.view] = gs.value; if (S.view === 'kasir') renderProds(); else if (S.view === 'produk') renderProdTable(); else if (S.view === 'riwayat') { S.rh.page = 1; rhTable(); } else if (S.view === 'laporan') rpBody(); }, 120));
  gs.addEventListener('keydown', e => { if (e.key === 'Enter' && S.view === 'kasir') { const l = posFiltered(), q = gs.value.trim().toLowerCase(), ex = l.find(p => p.id.toLowerCase() === q); const hit = ex || (l.length === 1 ? l[0] : null); if (hit) { addToCart(hit.id); gs.value = ''; S.q.kasir = ''; renderProds(); } } });
  document.addEventListener('change', e => {
    const t = e.target, id = t.id;
    if (['rhF', 'rhT', 'rhM', 'rhS', 'rhK'].indexOf(id) >= 0) { const rh = S.rh; if (id === 'rhF') rh.from = t.value || rh.from; if (id === 'rhT') rh.to = t.value || rh.to; if (id === 'rhM') rh.metode = t.value; if (id === 'rhS') rh.status = t.value; if (id === 'rhK') rh.kasir = t.value; rh.page = 1; if (id === 'rhF' || id === 'rhT') rhLoad(); else rhTable(); }
    if (['rpF', 'rpT'].indexOf(id) >= 0) { S.rp.preset = 'custom'; if (id === 'rpF') S.rp.from = t.value; else S.rp.to = t.value; $$('[data-act=rppre]').forEach(b => b.setAttribute('aria-pressed', b.dataset.p === 'custom')); rpLoad(); }
    if (['rpK', 'rpU', 'rpM'].indexOf(id) >= 0) { if (id === 'rpK') S.rp.kat = t.value; if (id === 'rpU') S.rp.kasir = t.value; if (id === 'rpM') S.rp.metode = t.value; rpBody(); }
  });
  addEventListener('online', () => { S.online = true; renderSync(); flushOutbox(); ping(); }); addEventListener('offline', () => { S.online = false; renderSync(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { flushOutbox(); ping(); } });
  addEventListener('resize', debounce(() => { const c = $('#cart'); if (c && !matchMedia('(max-width:820px)').matches) cartClose(); const cx = $('#cartX'); if (cx) cx.style.display = matchMedia('(max-width:820px)').matches ? '' : 'none'; }, 150));
  // Polling adaptif: 15 dtk saat aktif, 60 dtk saat diam, berhenti saat tab tersembunyi (hemat kuota eksekusi GAS)
  ['pointerdown', 'keydown', 'scroll'].forEach(ev => addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true }));
  (function tick() { const idle = Date.now() - lastAct > 60000; setTimeout(() => { ping(); tick(); }, idle ? 60000 : 15000); })();
}
/** Ping ringan: hanya mengunduh data bila versi di server berubah (mis. kasir lain menjual). */
let pinging = false, lastAct = Date.now();
async function ping() {
  if (!S.token || !S.me || pinging || document.hidden || S.outbox.length || modals.length) return; pinging = true;
  try {
    const r = await call('apiPing', S.token, S.ver); S.online = true;
    if (r.success && !r.data.same && !S.outbox.length) { S.ver = r.data.ver; setProduk(r.data.produk); const yk = dayStr(1); S.tx = S.tx.filter(t => t.t.slice(0, 10) < yk).concat(r.data.tx); S.cart = S.cart.filter(c => S.pmap[c.id] && S.pmap[c.id].aktif); S.txCache = {}; S.repCache = {}; saveCache(); renderAll(); }
  } catch (e) { S.online = false; } finally { pinging = false; renderSync(); }
}

bind(); boot();
})();
