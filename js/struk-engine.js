/* =============================================================================
   struk-engine.js — mesin templat struk (murni, tanpa DOM, tanpa jaringan)
   Template teks direktif + kamus data datar  →  daftar baris siap cetak.
   Satu hasil render dipakai untuk: pratinjau, ESC/POS, PNG, teks WhatsApp.
   ============================================================================= */
(function (root) {
'use strict';

/* ---------- format ---------- */
var BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function angka(n) { return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function rp(n) { var v = Math.round(Number(n) || 0); return (v < 0 ? '-' : '') + 'Rp ' + angka(Math.abs(v)); }
function tgl(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); return m ? (+m[3]) + ' ' + BULAN[+m[2] - 1] + ' ' + m[1] : String(s == null ? '' : s); }
var SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
function terbilangInt(n) {
  n = Math.floor(n);
  if (n < 12) return SATUAN[n];
  if (n < 20) return SATUAN[n - 10] + ' belas';
  if (n < 100) return SATUAN[Math.floor(n / 10)] + ' puluh' + (n % 10 ? ' ' + SATUAN[n % 10] : '');
  if (n < 200) return 'seratus' + (n - 100 ? ' ' + terbilangInt(n - 100) : '');
  if (n < 1000) return SATUAN[Math.floor(n / 100)] + ' ratus' + (n % 100 ? ' ' + terbilangInt(n % 100) : '');
  if (n < 2000) return 'seribu' + (n - 1000 ? ' ' + terbilangInt(n - 1000) : '');
  if (n < 1e6) return terbilangInt(Math.floor(n / 1e3)) + ' ribu' + (n % 1e3 ? ' ' + terbilangInt(n % 1e3) : '');
  if (n < 1e9) return terbilangInt(Math.floor(n / 1e6)) + ' juta' + (n % 1e6 ? ' ' + terbilangInt(n % 1e6) : '');
  if (n < 1e12) return terbilangInt(Math.floor(n / 1e9)) + ' miliar' + (n % 1e9 ? ' ' + terbilangInt(n % 1e9) : '');
  return String(n);
}
function terbilang(n, unit) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return 'nol' + (unit ? ' ' + unit : '');
  return (n < 0 ? 'minus ' : '') + terbilangInt(Math.abs(n)) + (unit ? ' ' + unit : '');
}
function kosong(v) { return v == null || v === '' || v === 0 || v === '0' || v === false || v === 'Tidak'; }

function applyMods(val, mods) {
  for (var i = 0; i < mods.length; i++) {
    var m = mods[i].trim(), a = '';
    var c = m.indexOf(':'); if (c > 0) { a = m.slice(c + 1); m = m.slice(0, c); }
    switch (m) {
      case 'rp': val = rp(val); break;
      case 'angka': val = angka(val); break;
      case 'kapital': val = String(val).toUpperCase(); break;
      case 'kecil': val = String(val).toLowerCase(); break;
      case 'tgl': val = tgl(val); break;
      case 'terbilang': val = terbilang(val, a === 'rupiah' ? 'rupiah' : a); break;
      case 'kosong0': val = (Number(val) === 0 || val === '' || val == null) ? '' : val; break;
      case 'potong': val = String(val).slice(0, +a || 20); break;
      default: break;
    }
    if (val === '' && m === 'kosong0') return '';
  }
  return val;
}

/* ---------- 1) ekspansi blok & variabel ---------- */
function lookup(scopes, key) {
  for (var i = scopes.length - 1; i >= 0; i--) if (scopes[i] && Object.prototype.hasOwnProperty.call(scopes[i], key)) return scopes[i][key];
  return '';
}
function subst(line, scopes) {
  return line.replace(/\{\{\s*([A-Z0-9_]+)((?:\|[^}]*)*)\s*\}\}/g, function (m, key, mods) {
    var v = lookup(scopes, key);
    if (v == null) v = '';
    if (mods) v = applyMods(v, mods.slice(1).split('|'));
    return String(v);
  });
}
function expand(lines, scopes, out) {
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i], m = /^\s*\{\{([#?])([A-Z0-9_]+)\}\}\s*$/.exec(raw);
    if (!m) { out.push(subst(raw, scopes)); continue; }
    // cari penutup bersarang
    var depth = 1, j = i + 1;
    for (; j < lines.length; j++) {
      if (/^\s*\{\{[#?][A-Z0-9_]+\}\}\s*$/.test(lines[j])) depth++;
      else if (/^\s*\{\{\/[A-Z0-9_]+\}\}\s*$/.test(lines[j])) { depth--; if (!depth) break; }
    }
    var body = lines.slice(i + 1, j), val = lookup(scopes, m[2]);
    if (m[1] === '#') {
      var arr = Array.isArray(val) ? val : [];
      for (var k = 0; k < arr.length; k++) expand(body, scopes.concat([arr[k], { NO: k + 1 }]), out);
    } else if (!kosong(val) && !(Array.isArray(val) && !val.length)) expand(body, scopes, out);
    i = j;
  }
  return out;
}

/* ---------- 2) direktif → baris ---------- */
function wrapText(t, w) {
  var out = [], words = String(t).split(/\s+/).filter(Boolean), cur = '';
  if (!words.length) return [''];
  words.forEach(function (wd) {
    while (wd.length > w) { if (cur) { out.push(cur); cur = ''; } out.push(wd.slice(0, w)); wd = wd.slice(w); }
    if (!cur) cur = wd; else if ((cur + ' ' + wd).length <= w) cur += ' ' + wd; else { out.push(cur); cur = wd; }
  });
  if (cur) out.push(cur);
  return out;
}
function alignPad(t, w, al) {
  if (t.length >= w) return t;
  if (al === 'C') return ' '.repeat(Math.floor((w - t.length) / 2)) + t;
  if (al === 'R') return ' '.repeat(w - t.length) + t;
  return t;
}
var TAG = /^\[(C|L|R|B|2|H|LR|-|=|BOX|QR|BAR|LOGO|FEED|CUT)\]/;

/**
 * render(isiTemplate, data, {cols}) → [{k:'t',text,b,sz}, {k:'qr',v}, {k:'bar',v}, {k:'logo'}, {k:'box',text}, {k:'cut'}]
 * sz: 1 normal, 2 lebar+tinggi ganda, 'h' tinggi ganda saja. text sudah diratakan (dipad spasi).
 */
function render(isi, data, opt) {
  opt = opt || {};
  var cols = opt.cols || 32, flags = opt.flags || {};
  var lines = expand(String(isi || '').replace(/\r/g, '').split('\n'), [data || {}], []);
  var res = [];
  lines.forEach(function (ln) {
    if (/^\s*\/\//.test(ln)) return;                  // komentar
    var al = 'L', b = false, sz = 1, kind = 't', rest = ln, tags = [], mt;
    while ((mt = TAG.exec(rest))) { tags.push(mt[1]); rest = rest.slice(mt[0].length); }
    tags.forEach(function (t) {
      if (t === 'C' || t === 'L' || t === 'R') al = t; else if (t === 'B') b = true; else if (t === '2') sz = 2; else if (t === 'H') sz = 'h'; else kind = t;
    });
    var w = sz === 2 ? Math.floor(cols / 2) : cols;
    switch (kind) {
      case '-': res.push({ k: 't', text: '-'.repeat(cols), b: false, sz: 1 }); return;
      case '=': res.push({ k: 't', text: '='.repeat(cols), b: false, sz: 1 }); return;
      case 'FEED': { var n = Math.max(1, Math.min(6, parseInt(rest, 10) || 1)); for (var i = 0; i < n; i++) res.push({ k: 't', text: '', b: false, sz: 1 }); return; }
      case 'CUT': if (flags.potong !== false) res.push({ k: 'cut' }); return;
      case 'LOGO': if (flags.logo !== false) res.push({ k: 'logo' }); return;
      case 'QR': { var q = rest.trim(); if (!q) q = String((data || {}).URL_VERIFIKASI || ''); if (q && flags.qr !== false) res.push({ k: 'qr', v: q }); return; }
      case 'BAR': { var bv = rest.trim(); if (bv && flags.barcode !== false) res.push({ k: 'bar', v: bv }); return; }
      case 'BOX': wrapText(rest.trim(), w).forEach(function (t) { res.push({ k: 'box', text: alignPad(' ' + t + ' ', cols, 'C').slice(0, cols), b: true, sz: 1 }); }); return;
      case 'LR': {
        var p = rest.split('||'), l = (p[0] || '').replace(/\s+$/, ''), r = (p.length > 1 ? p.slice(1).join('||') : '').trim();
        if (l.length + r.length + 1 <= w) { res.push({ k: 't', text: l + ' '.repeat(w - l.length - r.length) + r, b: b, sz: sz }); return; }
        var lead2 = (/^ */.exec(l)[0]), rw = Math.min(r.length, Math.floor(w / 2)), lw = w - rw - 1, lw2 = wrapText(l, lw).map(function (t, i) { return i === 0 ? lead2 + t : t; });
        lw2.forEach(function (t, i) { var last = i === lw2.length - 1; res.push({ k: 't', text: last ? t + ' '.repeat(Math.max(1, w - t.length - r.length)) + r : t, b: b, sz: sz }); });
        return;
      }
      default: break;
    }
    if (rest.trim() === '') { res.push({ k: 't', text: '', b: false, sz: 1 }); return; }
    var lead = al === 'L' ? (/^ */.exec(rest)[0]).slice(0, Math.floor(w / 2)) : '';   // pertahankan indentasi
    wrapText(rest.replace(/\s+$/, ''), w - lead.length).forEach(function (t) { res.push({ k: 't', text: lead + alignPad(t, w - lead.length, al), b: b, sz: sz }); });
  });
  // hemat kertas: buang baris kosong beruntun bila mode hemat
  if (flags.hemat) { var o = []; res.forEach(function (x) { var e = x.k === 't' && !x.text.trim(); if (e && o.length && o[o.length - 1].k === 't' && !o[o.length - 1].text.trim()) return; o.push(x); }); res = o; }
  return res;
}

/** Teks polos (untuk WhatsApp / salin). QR/barcode/logo diabaikan. */
function toText(lines) {
  return lines.filter(function (x) { return x.k === 't' || x.k === 'box'; }).map(function (x) { return x.text.replace(/\s+$/, ''); }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- template bawaan (58 mm = 32 kolom, 80 mm = 48 kolom: otomatis) ---------- */
var DEFAULTS = {
  STRUK: { nama: 'Struk Penjualan', isi: [
    '// Struk KasirKu — ubah lewat Pengaturan → Editor template',
    '[LOGO]',
    '[C][B]{{TOKO_NAMA}}',
    '[C]{{TOKO_ALAMAT}}',
    '{{?TOKO_TELP}}',
    '[C]Telp: {{TOKO_TELP}}',
    '{{/TOKO_TELP}}',
    '[-]',
    '[LR]No||{{NOTA}}',
    '[LR]Tanggal||{{TANGGAL|tgl}} {{JAM}}',
    '[LR]Kasir||{{KASIR}}',
    '[-]',
    '{{#ITEM}}',
    '[L]{{NAMA}}',
    '[LR]  {{QTY}} x {{HARGA|angka}}||{{SUB|angka}}',
    '{{?CATATAN}}',
    '[L]  * {{CATATAN}}',
    '{{/CATATAN}}',
    '{{/ITEM}}',
    '[-]',
    '[LR]Subtotal||{{SUBTOTAL|rp}}',
    '{{?PAJAK}}',
    '[LR]Pajak ({{PAJAK_PERSEN}}%)||{{PAJAK|rp}}',
    '{{/PAJAK}}',
    '[B][LR]TOTAL||{{TOTAL|rp}}',
    '[LR]Bayar ({{METODE}})||{{DITERIMA|rp}}',
    '{{?TUNAI}}',
    '[LR]Kembali||{{KEMBALI|rp}}',
    '{{/TUNAI}}',
    '[-]',
    '{{?LUNAS}}',
    '[BOX]LUNAS',
    '{{/LUNAS}}',
    '{{?BATAL}}',
    '[BOX]DIBATALKAN',
    '{{/BATAL}}',
    '[C]Terima kasih atas kunjungan Anda!',
    '[QR]',
    '[C]Powered by KasirKu',
    '[FEED]3',
    '[CUT]'].join('\n') },
  RESI: { nama: 'Resi / Nota Ringkas', isi: [
    '[C][B]{{TOKO_NAMA}}', '[C]{{TOKO_ALAMAT}}', '[=]',
    '[C][B]{{NOTA}}', '[BAR]{{NOTA}}', '[=]',
    '[LR]Tanggal||{{TANGGAL|tgl}} {{JAM}}', '[LR]Pelanggan||{{PELANGGAN}}', '[LR]Item||{{JUMLAH_ITEM}}',
    '[B][LR]TOTAL||{{TOTAL|rp}}', '[L]{{TOTAL|terbilang:rupiah|kapital}}', '[-]', '[C]Terima kasih', '[FEED]3', '[CUT]'].join('\n') },
  TIKET: { nama: 'Tiket Antrean', isi: [
    '[C][B]{{TOKO_NAMA}}', '[-]', '[C]Nomor Antrean', '[C][2]{{NOTA}}', '[C]{{TANGGAL|tgl}} {{JAM}}', '[FEED]3', '[CUT]'].join('\n') }
};

/** Contoh data untuk pratinjau editor. */
function contohData() {
  var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
  return {
    TOKO_NAMA: 'Toko Saya', TOKO_ALAMAT: 'Jl. Contoh No. 1', TOKO_WA: '081234567890', TOKO_TELP: '081234567890',
    NOTA: 'TRX-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-0001', TANGGAL: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), JAM: p(d.getHours()) + ':' + p(d.getMinutes()),
    KASIR: 'Kasir', PELANGGAN: 'Umum',
    ITEM: [{ NAMA: 'Cappuccino', QTY: 1, HARGA: 28000, SUB: 28000, CATATAN: '' }, { NAMA: 'Bagel Keju', QTY: 2, HARGA: 22000, SUB: 44000, CATATAN: 'Panaskan' }, { NAMA: 'Caesar Salad', QTY: 1, HARGA: 35000, SUB: 35000, CATATAN: '' }],
    JUMLAH_ITEM: 4, SUBTOTAL: 107000, DISKON: 0, PAJAK: 10700, PAJAK_PERSEN: 10, TOTAL: 117700, METODE: 'Tunai', DITERIMA: 150000, KEMBALI: 32300,
    STATUS: 'LUNAS', LUNAS: 'YA', TEMPO: '', BATAL: '', TUNAI: 'YA', URL_VERIFIKASI: 'https://contoh.github.io/kasirku/verifikasi.html?n=TRX-0001&s=0123456789abcdef', CATATAN: ''
  };
}

/** Kunci yang boleh dipakai di template (untuk tombol sisip di editor). */
var KUNCI = ['TOKO_NAMA', 'TOKO_ALAMAT', 'TOKO_TELP', 'NOTA', 'TANGGAL', 'JAM', 'KASIR', 'PELANGGAN', 'JUMLAH_ITEM', 'SUBTOTAL', 'PAJAK', 'PAJAK_PERSEN', 'TOTAL', 'METODE', 'DITERIMA', 'KEMBALI', 'STATUS', 'URL_VERIFIKASI'];

root.StrukEngine = { render: render, toText: toText, DEFAULTS: DEFAULTS, contohData: contohData, KUNCI: KUNCI, fmt: { rp: rp, angka: angka, tgl: tgl, terbilang: terbilang }, _expand: function (isi, data) { return expand(String(isi).split('\n'), [data], []); } };
if (typeof module !== 'undefined' && module.exports) module.exports = root.StrukEngine;
})(typeof window !== 'undefined' ? window : globalThis);
