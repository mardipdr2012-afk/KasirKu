/* =============================================================================
   struk-ui.js — dialog pratinjau & cetak, editor template (Owner), pengaturan printer
   Memakai kelas .scrim/.modal dari style.css agar senada dengan aplikasi.
   ============================================================================= */
(function (root) {
'use strict';
var P = root.StrukPrinter, E = root.StrukEngine;
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var toast = function (m, t) { if (root.KK && root.KK.toast) root.KK.toast(m, t); };
var api = function (a, d) { return root.KK.api(a, d); };

function dialog(title, body, footer, wide) {
  var host = document.getElementById('overlay') || document.body, prev = document.activeElement;
  var sc = document.createElement('div'); sc.className = 'scrim';
  sc.innerHTML = '<div class="modal ' + (wide ? 'wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"' + (wide ? ' style="width:min(900px,100%)"' : '') + '><div class="modal-h"><h3>' + esc(title) + '</h3><button class="iconbtn" data-x aria-label="Tutup"><svg class="i" aria-hidden="true"><use href="#i-x"/></svg></button></div><div class="modal-b">' + body + '</div>' + (footer ? '<div class="modal-f">' + footer + '</div>' : '') + '</div>';
  host.appendChild(sc);
  var d = { el: sc, $: function (s) { return sc.querySelector(s); }, $$: function (s) { return Array.prototype.slice.call(sc.querySelectorAll(s)); }, close: function () { sc.remove(); try { prev && prev.focus(); } catch (e) { /* abaikan */ } } };
  sc.addEventListener('mousedown', function (e) { if (e.target === sc) d.close(); });
  sc.addEventListener('click', function (e) { if (e.target.closest('[data-x]')) d.close(); });
  sc.addEventListener('keydown', function (e) { if (e.key === 'Escape') d.close(); });
  return d;
}
function sel(id, opts, cur) { return '<select id="' + id + '" class="input">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; }
function chk(id, label, on) { return '<label class="row" style="gap:8px;min-height:44px;cursor:pointer"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + ' style="width:20px;height:20px"> <span>' + esc(label) + '</span></label>'; }
var METODE = [['auto', 'Otomatis (disarankan)'], ['bluetooth', 'Bluetooth langsung'], ['rawbt', 'Aplikasi RawBT (Android)'], ['browser', 'Dialog cetak browser (USB/LAN)']];

/* ---------- pratinjau & cetak ---------- */
function pratinjau(c) {
  c = c || {}; var jenis = c.jenis || 'STRUK', base = P.opsi(null, c.lebarToko), cur = Object.assign({}, base);
  var d = dialog('Cetak ' + (jenis === 'STRUK' ? 'Struk' : jenis === 'RESI' ? 'Resi' : 'Tiket'),
    '<div class="st-pv" id="stPv" aria-live="polite"></div>' +
    '<div class="grid2"><div class="field"><label for="oL">Lebar kertas</label>' + sel('oL', [['58', '58 mm (32 kolom)'], ['80', '80 mm (48 kolom)']], cur.lebar) + '</div>' +
    '<div class="field"><label for="oM">Metode cetak</label>' + sel('oM', METODE, cur.metode) + '</div>' +
    '<div class="field"><label for="oS">Rangkap</label>' + sel('oS', [[1, '1 lembar'], [2, '2 lembar'], [3, '3 lembar']], cur.salinan) + '</div>' +
    '<div class="field"><label>Opsi</label><div class="row wrap">' + chk('oH', 'Hemat kertas', cur.hemat) + chk('oQ', 'QR verifikasi', cur.qr) + '</div></div></div>' +
    '<p class="err" id="stErr" role="alert"></p>',
    '<button class="btn" id="stPng">Unduh PNG</button><button class="btn" id="stWa">WhatsApp</button><button class="btn primary" id="stGo">Cetak</button>');
  var lines = [], gen = 0;
  function opts() { return Object.assign({}, cur, { lebar: d.$('#oL').value, metode: d.$('#oM').value, salinan: +d.$('#oS').value, hemat: d.$('#oH').checked, qr: d.$('#oQ').checked }); }
  async function draw() {
    var my = ++gen, o = opts(); lines = P.susun(jenis, c.data, o); var withBm = await P.siapkanBitmap(lines, o);
    if (my !== gen) return; var pv = d.$('#stPv'); pv.innerHTML = ''; pv.appendChild(P.htmlPaper(withBm, o));
  }
  ['#oL', '#oM', '#oS', '#oH', '#oQ'].forEach(function (s) { d.$(s).addEventListener('change', draw); });
  d.$('#stGo').onclick = async function () {
    var b = d.$('#stGo'), o = opts(); b.disabled = true; b.textContent = 'Mencetak…'; d.$('#stErr').textContent = '';
    try {
      P.simpanLokal({ lebar: o.lebar, metode: o.metode, salinan: o.salinan, hemat: o.hemat, qr: o.qr });
      var r = await P.cetak(P.susun(jenis, c.data, o), o);
      if (r.ok) { toast(r.metode === 'browser' ? 'Dialog cetak dibuka.' : 'Struk dikirim ke printer (' + r.metode + ').', 'ok'); if (r.catatan) toast('Metode lain gagal, memakai dialog cetak browser.', 'warn'); d.close(); }
      else if (!r.batal) d.$('#stErr').textContent = 'Gagal mencetak. ' + r.catatan;
    } catch (e) { d.$('#stErr').textContent = 'Gagal mencetak: ' + (e && e.message || e); }
    finally { b.disabled = false; b.textContent = 'Cetak'; }
  };
  d.$('#stPng').onclick = async function () { var o = opts(); await P.unduhPNG(await P.siapkanBitmap(P.susun(jenis, c.data, o), o), o, c.namaFile || c.nomor || 'struk'); toast('Gambar struk diunduh.', 'ok'); };
  d.$('#stWa').onclick = function () {
    var o = opts(), nomor = c.waNomor; if (!nomor) nomor = (root.prompt && root.prompt('Nomor WhatsApp pelanggan (mis. 0812…):')) || ''; if (!nomor) return;
    var a = document.createElement('a'); a.href = P.linkWA(P.susun(jenis, c.data, o), nomor); a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
  };
  draw(); setTimeout(function () { d.$('#stGo').focus(); }, 30); return d;
}

/* ---------- editor template (Owner) ---------- */
function editor() {
  if (!(root.KK && root.KK.isOwner())) { toast('Hanya Owner yang dapat mengubah template.', 'warn'); return; }
  var kode = 'STRUK', o = P.opsi();
  var d = dialog('Editor template struk',
    '<div class="field"><label for="eK">Template</label>' + sel('eK', [['STRUK', 'Struk penjualan'], ['RESI', 'Resi / nota ringkas'], ['TIKET', 'Tiket antrean']], kode) + '</div>' +
    '<div class="st-grid"><div class="field"><label for="eT">Isi template (direktif teks)</label><textarea id="eT" class="input st-ed" spellcheck="false" autocapitalize="off"></textarea>' +
    '<div class="st-chips" id="eC"></div><p class="t2 xs">Direktif: <code>[C] [L] [R] [B] [2] [H] [LR]kiri||kanan [-] [=] [BOX] [QR] [BAR] [LOGO] [FEED]n [CUT]</code> · Blok: <code>{{#ITEM}}…{{/ITEM}}</code>, <code>{{?KUNCI}}…{{/KUNCI}}</code> · Filter: <code>|rp |angka |tgl |kapital |terbilang:rupiah |kosong0</code> · Komentar: <code>// teks</code></p></div>' +
    '<div class="field"><label>Pratinjau (contoh data)</label><div class="st-pv" id="ePv"></div><div class="row"><label class="lbl" for="eW">Lebar</label>' + sel('eW', [['58', '58 mm'], ['80', '80 mm']], o.lebar) + '</div></div></div>' +
    '<p class="err" id="eErr" role="alert"></p><div id="eHist"></div>',
    '<button class="btn" id="eRst">Kembalikan ke bawaan</button><button class="btn" id="eHis">Riwayat versi</button><button class="btn primary" id="eSv">Simpan</button>', true);
  var ta = d.$('#eT'), pv = d.$('#ePv'), gen = 0;
  d.$('#eC').innerHTML = ['{{#ITEM}}', '{{/ITEM}}', '[LR]kiri||kanan', '[QR]', '[BAR]{{NOTA}}', '[BOX]LUNAS', '[-]', '[CUT]'].concat(E.KUNCI.map(function (k) { return '{{' + k + '}}'; })).map(function (k) { return '<button type="button" data-ins="' + esc(k) + '">' + esc(k) + '</button>'; }).join('');
  d.$('#eC').addEventListener('click', function (e) { var b = e.target.closest('[data-ins]'); if (!b) return; var v = b.getAttribute('data-ins'), s = ta.selectionStart, t = ta.selectionEnd; ta.value = ta.value.slice(0, s) + v + ta.value.slice(t); ta.focus(); ta.selectionStart = ta.selectionEnd = s + v.length; redraw(); });
  async function redraw() {
    var my = ++gen, oo = Object.assign({}, P.opsi(), { lebar: d.$('#eW').value, qr: true, barcode: true, logo: false });
    var L = P.susun(kode, E.contohData(), oo, ta.value), w = await P.siapkanBitmap(L, oo); if (my !== gen) return; pv.innerHTML = ''; pv.appendChild(P.htmlPaper(w, oo));
  }
  function load(k) { kode = k; ta.value = P.templateIsi(k); d.$('#eErr').textContent = ''; redraw(); }
  var t; ta.addEventListener('input', function () { clearTimeout(t); t = setTimeout(redraw, 150); });
  d.$('#eK').addEventListener('change', function () { load(this.value); }); d.$('#eW').addEventListener('change', redraw);
  async function refresh() { var r = await api('struk.list'); if (r.success) P.pasang({ templates: r.data }); }
  d.$('#eSv').onclick = async function () {
    var b = this; b.disabled = true; d.$('#eErr').textContent = '';
    try { var r = await api('struk.simpan', { kode: kode, nama: E.DEFAULTS[kode].nama, isi: ta.value }); if (!r.success) { d.$('#eErr').textContent = r.message; return; } await refresh(); toast(r.message || 'Template tersimpan.', 'ok'); }
    catch (e) { d.$('#eErr').textContent = 'Gagal menyimpan: ' + (e && e.message || e); } finally { b.disabled = false; }
  };
  d.$('#eRst').onclick = async function () { try { var r = await api('struk.reset', { kode: kode }); if (!r.success) { d.$('#eErr').textContent = r.message; return; } await refresh(); load(kode); toast('Template kembali ke bawaan.', 'ok'); } catch (e) { d.$('#eErr').textContent = 'Gagal: ' + (e && e.message || e); } };
  d.$('#eHis').onclick = async function () {
    var h = d.$('#eHist'); h.innerHTML = '<p class="t2">Memuat…</p>';
    try {
      var r = await api('struk.detail', { kode: kode }); if (!r.success) { h.innerHTML = '<p class="err">' + esc(r.message) + '</p>'; return; }
      h.innerHTML = r.data.length ? '<div class="card"><div class="card-b" style="display:grid;gap:8px">' + r.data.map(function (v) { return '<div class="row wrap" style="justify-content:space-between"><span><b>v' + v.ver + '</b>' + (v.aktif ? ' <span class="tag ok">aktif</span>' : '') + ' <span class="muted xs">' + esc(v.waktu) + ' · ' + esc(v.oleh) + '</span></span>' + (v.aktif ? '' : '<button class="btn" data-pv="' + v.ver + '">Pulihkan</button>') + '</div>'; }).join('') + '</div></div>' : '<p class="t2">Belum ada versi tersimpan (memakai bawaan).</p>';
      h.querySelectorAll('[data-pv]').forEach(function (b) { b.onclick = async function () { var q = await api('struk.pulihkan', { kode: kode, ver: +b.getAttribute('data-pv') }); if (q.success) { await refresh(); load(kode); d.$('#eHis').click(); toast(q.message, 'ok'); } else d.$('#eErr').textContent = q.message; }; });
    } catch (e) { h.innerHTML = '<p class="err">Gagal memuat riwayat.</p>'; }
  };
  load(kode); return d;
}

/* ---------- pengaturan printer ---------- */
function pengaturanPrinter() {
  var o = P.opsi(), owner = root.KK && root.KK.isOwner();
  var d = dialog('Pengaturan printer',
    '<div class="grid2"><div class="field"><label for="pL">Lebar kertas</label>' + sel('pL', [['58', '58 mm'], ['80', '80 mm']], o.lebar) + '</div>' +
    '<div class="field"><label for="pM">Metode cetak</label>' + sel('pM', METODE, o.metode) + '</div>' +
    '<div class="field"><label for="pS">Rangkap</label>' + sel('pS', [[1, '1'], [2, '2'], [3, '3']], o.salinan) + '</div><div></div></div>' +
    '<div class="row wrap">' + chk('pH', 'Hemat kertas', o.hemat) + chk('pC', 'Potong otomatis', o.potong) + chk('pB', 'Bunyi beep', o.beep) + chk('pQ', 'QR verifikasi', o.qr) + chk('pR', 'Barcode nota', o.barcode) + chk('pG', 'Cetak logo', o.logo) + '</div>' +
    '<div class="row wrap"><button class="btn" id="pT">Tes cetak</button>' + (root.navigator && navigator.bluetooth ? '<button class="btn" id="pF">Lupakan printer Bluetooth</button>' : '') + '</div><p class="err" id="pE" role="alert"></p>' +
    '<p class="t2 xs">“Simpan di perangkat ini” hanya berlaku di HP/komputer ini. “Simpan untuk semua perangkat” (Owner) menjadi bawaan toko.</p>',
    '<button class="btn" id="pD">Simpan di perangkat ini</button>' + (owner ? '<button class="btn primary" id="pS2">Simpan untuk semua perangkat</button>' : ''));
  function val() { return { lebar: d.$('#pL').value, metode: d.$('#pM').value, salinan: +d.$('#pS').value, hemat: d.$('#pH').checked, potong: d.$('#pC').checked, beep: d.$('#pB').checked, qr: d.$('#pQ').checked, barcode: d.$('#pR').checked, logo: d.$('#pG').checked }; }
  d.$('#pD').onclick = function () { P.simpanLokal(val()); toast('Tersimpan di perangkat ini.', 'ok'); d.close(); };
  var s2 = d.$('#pS2'); if (s2) s2.onclick = async function () { try { var r = await api('printer.simpan', val()); if (!r.success) { d.$('#pE').textContent = r.message; return; } P.simpanLokal({}); P.pasang({ server: r.data }); toast('Tersimpan untuk semua perangkat.', 'ok'); d.close(); } catch (e) { d.$('#pE').textContent = 'Gagal menyimpan.'; } };
  d.$('#pT').onclick = async function () { var v = val(); var r = await P.cetak(P.susun('RESI', Object.assign(E.contohData(), { NOTA: 'TES-0001' }), v), v); if (!r.ok && !r.batal) d.$('#pE').textContent = 'Tes gagal. ' + r.catatan; };
  var f = d.$('#pF'); if (f) f.onclick = function () { P.lupakanBT(); toast('Printer dilupakan. Pilih ulang saat mencetak.', 'ok'); };
  return d;
}

root.StrukUI = { pratinjau: pratinjau, editor: editor, pengaturanPrinter: pengaturanPrinter };
})(window);
