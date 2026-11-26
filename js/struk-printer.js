/* =============================================================================
   struk-printer.js — keluaran struk: pratinjau HTML, ESC/POS, Web Bluetooth,
   RawBT, dialog cetak browser (fallback), PNG, teks WhatsApp.
   Semua dirender di perangkat; server tidak dipakai saat mencetak.
   ============================================================================= */
(function (root) {
'use strict';
var E = root.StrukEngine;
var DOTS = { '58': 384, '80': 576 }, COLS = { '58': 32, '80': 48 };
var BASE = { lebar: '', metode: 'auto', salinan: 1, hemat: false, potong: true, beep: false, qr: true, barcode: false, logo: false };
var ST = { templates: {}, server: {}, logoUrl: '', appUrl: '', logoBm: null, logoFor: '' };
var BT = { dev: null, ch: null };

function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } }

/* ---------- konfigurasi bertingkat: bawaan → server → perangkat → sesaat ---------- */
function pasang(o) {
  o = o || {};
  if (o.templates) {
    ST.templates = {};
    o.templates.forEach(function (t) { ST.templates[t.kode] = t; });
    lsSet('kk_st_tpl', o.templates);
  }
  if (o.server) { ST.server = o.server; lsSet('kk_st_srv', ST.server); }
  if (o.logoUrl !== undefined && o.logoUrl !== ST.logoUrl) { ST.logoUrl = o.logoUrl || ''; ST.logoBm = null; }
  if (o.appUrl) ST.appUrl = o.appUrl;
}
function pulihOffline() {
  if (Object.keys(ST.templates).length) return;
  (lsGet('kk_st_tpl', []) || []).forEach(function (t) { ST.templates[t.kode] = t; });
  ST.server = lsGet('kk_st_srv', {}) || {};
}
function opsi(sesaat, lebarToko) {
  pulihOffline();
  var o = Object.assign({}, BASE, ST.server, lsGet('kk_printer', {}) || {}, sesaat || {});
  if (o.lebar !== '58' && o.lebar !== '80') o.lebar = lebarToko === '58' ? '58' : (lebarToko === '80' ? '80' : '80');
  return o;
}
function simpanLokal(o) { lsSet('kk_printer', o || {}); }
function templateIsi(kode) {
  pulihOffline();
  if (ST.templates[kode]) return ST.templates[kode].isi;
  return (E.DEFAULTS[kode] || E.DEFAULTS.STRUK).isi;
}
function susun(kode, data, o, isiOverride) {
  var cols = COLS[o.lebar] || 32;
  return E.render(isiOverride != null ? isiOverride : templateIsi(kode), data, { cols: cols, flags: { hemat: o.hemat, potong: o.potong, logo: o.logo, qr: o.qr, barcode: o.barcode } });
}

/* ---------- bitmap: QR, Code128, logo ---------- */
function bmNew(w, h) { return { w: w, h: h, px: new Uint8Array(w * h) }; }
function qrBitmap(text, maxDots) {
  if (!root.qrcode) return null;
  var q; try { q = root.qrcode(0, 'M'); q.addData(String(text)); q.make(); } catch (e) { return null; }
  var n = q.getModuleCount(), quiet = 2, mod = Math.max(2, Math.min(6, Math.floor(maxDots / (n + quiet * 2)))), size = (n + quiet * 2) * mod, b = bmNew(size, size);
  for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) for (var y = 0; y < mod; y++) for (var x = 0; x < mod; x++) b.px[((r + quiet) * mod + y) * size + (c + quiet) * mod + x] = 1;
  return b;
}
/* Code128: pola lebar bar-spasi (6 angka; stop = 7 angka). Indeks 0..106. */
var C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
function code128Codes(text) {
  text = String(text); var codes = [], i = 0, set = null;
  function digits(at) { var n = 0; while (at + n < text.length && /\d/.test(text[at + n])) n++; return n; }
  while (i < text.length) {
    var d = digits(i);
    if (set !== 'C' && (d >= 4 || (d >= 2 && i === 0 && d === text.length))) { codes.push(set === null ? 105 : 99); set = 'C'; }
    if (set === 'C') {
      if (digits(i) >= 2) { codes.push(parseInt(text.substr(i, 2), 10)); i += 2; continue; }
      codes.push(100); set = 'B';   // geser ke set B
    }
    if (set === null) { codes.push(104); set = 'B'; }
    var ch = text.charCodeAt(i); if (ch < 32 || ch > 126) ch = 63;
    codes.push(ch - 32); i++;
  }
  var sum = codes[0]; for (var k = 1; k < codes.length; k++) sum += codes[k] * k;
  codes.push(sum % 103); codes.push(106);
  return codes;
}
function barBitmap(text, maxDots) {
  var codes = code128Codes(text), mods = [];
  codes.forEach(function (c) { var p = C128[c]; for (var i = 0; i < p.length; i++) { var w = +p[i]; for (var j = 0; j < w; j++) mods.push(i % 2 === 0 ? 1 : 0); } });
  var m = Math.max(1, Math.min(3, Math.floor(maxDots / (mods.length + 20)))), W = (mods.length + 20) * m, H = 64, b = bmNew(W, H);
  for (var x = 0; x < mods.length; x++) if (mods[x]) for (var xx = 0; xx < m; xx++) for (var y = 0; y < H; y++) b.px[y * W + (10 + x) * m + xx] = 1;
  return b;
}
function logoBitmap(url, maxDots) {
  if (!url) return Promise.resolve(null);
  if (ST.logoBm && ST.logoFor === url + '|' + maxDots) return Promise.resolve(ST.logoBm);
  return new Promise(function (res) {
    var img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var w = Math.min(maxDots, 200, img.width), h = Math.max(1, Math.round(img.height * w / img.width)), c = document.createElement('canvas'); c.width = w; c.height = h;
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
        var d = g.getImageData(0, 0, w, h).data, b = bmNew(w, h);
        for (var i = 0; i < w * h; i++) b.px[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) < 140 ? 1 : 0;
        ST.logoBm = b; ST.logoFor = url + '|' + maxDots; res(b);
      } catch (e) { res(null); }
    };
    img.onerror = function () { res(null); }; img.src = url;
  });
}
/** Siapkan semua bitmap yang diminta baris (QR, barcode, logo). */
function siapkanBitmap(lines, o) {
  var dots = DOTS[o.lebar] || 384, jobs = lines.map(function (l) {
    if (l.k === 'qr') return Promise.resolve(qrBitmap(l.v, Math.min(dots, 240)));
    if (l.k === 'bar') return Promise.resolve(barBitmap(l.v, dots));
    if (l.k === 'logo') return logoBitmap(ST.logoUrl, dots);
    return Promise.resolve(null);
  });
  return Promise.all(jobs).then(function (bms) { return lines.map(function (l, i) { return bms[i] ? Object.assign({}, l, { bm: bms[i] }) : l; }); });
}

/* ---------- ESC/POS ---------- */
function ascii(t) { return String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?'); }
function escpos(lines, o) {
  var dots = DOTS[o.lebar] || 384, out = [];
  function push() { for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; if (typeof a === 'number') out.push(a & 255); else for (var j = 0; j < a.length; j++) out.push(a[j] & 255); } }
  function txt(s) { push(Array.prototype.map.call(ascii(s), function (c) { return c.charCodeAt(0); })); }
  function raster(b) {
    var wb = Math.ceil(dots / 8), left = Math.floor((dots - b.w) / 2), rows = b.h;
    push(0x1d, 0x76, 0x30, 0, wb & 255, wb >> 8, rows & 255, rows >> 8);
    for (var y = 0; y < rows; y++) for (var xb = 0; xb < wb; xb++) { var v = 0; for (var k = 0; k < 8; k++) { var x = xb * 8 + k - left; if (x >= 0 && x < b.w && b.px[y * b.w + x]) v |= 0x80 >> k; } out.push(v); }
  }
  push(0x1b, 0x40, 0x1b, 0x74, 0);                 // init, code page 0
  if (o.beep) push(0x1b, 0x42, 2, 1);
  lines.forEach(function (l) {
    if (l.k === 't') {
      push(0x1b, 0x45, l.b ? 1 : 0, 0x1d, 0x21, l.sz === 2 ? 0x11 : l.sz === 'h' ? 0x01 : 0); txt(l.text); push(0x0a); push(0x1b, 0x45, 0, 0x1d, 0x21, 0);
    } else if (l.k === 'box') {
      push(0x1d, 0x42, 1, 0x1b, 0x45, 1); txt(l.text); push(0x1d, 0x42, 0, 0x1b, 0x45, 0, 0x0a);
    } else if (l.bm) { raster(l.bm); push(0x0a); }
    else if (l.k === 'cut') push(0x1b, 0x64, 3, 0x1d, 0x56, 66, 0);
  });
  return new Uint8Array(out);
}

/* ---------- pengiriman ---------- */
var BT_SVC = ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ffe0-0000-1000-8000-00805f9b34fb', '0000fff0-0000-1000-8000-00805f9b34fb', '00001101-0000-1000-8000-00805f9b34fb'];
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function btConnect(reuse) {
  if (!navigator.bluetooth) throw new Error('Web Bluetooth tidak didukung di browser ini.');
  if (reuse && BT.ch && BT.dev && BT.dev.gatt && BT.dev.gatt.connected) return BT.ch;
  if (!BT.dev) BT.dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SVC });
  var srv = await BT.dev.gatt.connect(), svcs = await srv.getPrimaryServices();
  for (var i = 0; i < svcs.length; i++) {
    var chs = await svcs[i].getCharacteristics();
    for (var j = 0; j < chs.length; j++) if (chs[j].properties.write || chs[j].properties.writeWithoutResponse) { BT.ch = chs[j]; return BT.ch; }
  }
  throw new Error('Printer tidak memiliki karakteristik tulis yang dikenali.');
}
async function kirimBT(bytes) {
  var ch; try { ch = await btConnect(true); } catch (e) { BT.dev = e && e.name === 'NotFoundError' ? null : BT.dev; throw e; }
  for (var i = 0; i < bytes.length; i += 100) {
    var part = bytes.slice(i, i + 100);
    if (ch.properties.writeWithoutResponse) await ch.writeValueWithoutResponse(part); else await ch.writeValue(part);
    await sleep(25);
  }
}
function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(s); }
function kirimRawBT(bytes) {
  var a = document.createElement('a'); a.href = 'intent:base64,' + b64(bytes) + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- pratinjau HTML & dialog cetak browser ---------- */
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function bmCanvas(b, dots) {
  var c = document.createElement('canvas'); c.width = b.w; c.height = b.h; var g = c.getContext('2d'), im = g.createImageData(b.w, b.h);
  for (var i = 0; i < b.px.length; i++) { var v = b.px[i] ? 0 : 255; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0); c.style.width = (b.w / dots * 100) + '%'; c.style.margin = '4px auto'; return c;
}
function htmlPaper(lines, o) {
  var cols = COLS[o.lebar] || 32, dots = DOTS[o.lebar] || 384, wrap = document.createElement('div');
  wrap.className = 'st-paper'; wrap.style.width = cols + 'ch'; wrap.style.fontSize = '12px';
  lines.forEach(function (l) {
    if (l.k === 't' || l.k === 'box') {
      var d = document.createElement('div'); d.textContent = l.text || ' ';
      if (l.b) d.className += ' b'; if (l.k === 'box') d.className += ' box b'; if (l.sz === 2) d.className += ' big'; else if (l.sz === 'h') d.style.cssText = 'transform:scaleY(2);transform-origin:top;margin-bottom:1em';
      wrap.appendChild(d);
    } else if (l.bm) wrap.appendChild(bmCanvas(l.bm, dots));
    else if (l.k === 'cut') { var h = document.createElement('div'); h.style.cssText = 'border-top:1px dashed #999;margin:8px 0;height:0'; h.setAttribute('data-nopr', '1'); wrap.appendChild(h); }
  });
  return wrap;
}
function cetakBrowser(lines, o) {
  var area = document.getElementById('printArea'); if (!area) throw new Error('Area cetak tidak ditemukan.');
  var st = document.getElementById('stPageStyle'); if (!st) { st = document.createElement('style'); st.id = 'stPageStyle'; document.head.appendChild(st); }
  st.textContent = '@media print{@page{size:' + o.lebar + 'mm auto;margin:0}#printArea{width:' + o.lebar + 'mm}#printArea .st-paper{width:' + (o.lebar === '58' ? '48mm' : '72mm') + '!important;margin:0 auto;font-size:' + (o.lebar === '58' ? '10px' : '12px') + '!important}[data-nopr]{display:none}}';
  area.innerHTML = ''; for (var i = 0; i < Math.max(1, o.salinan); i++) { var p = htmlPaper(lines, o); if (i) p.style.pageBreakBefore = 'always'; area.appendChild(p); }
  return new Promise(function (res) { setTimeout(function () { try { root.print(); } catch (e) { /* abaikan */ } res(); }, 80); });
}

/* ---------- PNG & WhatsApp ---------- */
function pngCanvas(lines, o) {
  var dots = DOTS[o.lebar] || 384, cols = COLS[o.lebar] || 32, cw = dots / cols, lh = 26, c = document.createElement('canvas'), pad = 8;
  var H = pad * 2; lines.forEach(function (l) { H += l.bm ? l.bm.h + 8 : (l.k === 'cut' ? 0 : (l.sz === 2 || l.sz === 'h' ? lh * 2 : lh)); });
  c.width = dots; c.height = H; var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, dots, H); g.textBaseline = 'top';
  var y = pad;
  lines.forEach(function (l) {
    if (l.k === 't' || l.k === 'box') {
      var s = l.sz === 2 ? 2 : 1, hh = (l.sz === 2 || l.sz === 'h') ? lh * 2 : lh;
      if (l.k === 'box') { g.fillStyle = '#000'; g.fillRect(0, y, dots, hh); g.fillStyle = '#fff'; } else g.fillStyle = '#000';
      g.font = (l.b ? 'bold ' : '') + Math.round(cw * 1.65 * (l.sz === 2 ? 2 : 1)) + 'px "Courier New", monospace';
      for (var i = 0; i < l.text.length; i++) g.fillText(l.text[i], i * cw * s, y + 2, cw * s);
      y += hh;
    } else if (l.bm) {
      var im = g.createImageData(l.bm.w, l.bm.h); for (var k = 0; k < l.bm.px.length; k++) { var v = l.bm.px[k] ? 0 : 255; im.data[k * 4] = im.data[k * 4 + 1] = im.data[k * 4 + 2] = v; im.data[k * 4 + 3] = 255; }
      g.putImageData(im, Math.floor((dots - l.bm.w) / 2), y + 4); y += l.bm.h + 8;
    }
  });
  return c;
}
function unduhPNG(lines, o, nama) {
  var c = pngCanvas(lines, o);
  return new Promise(function (res) { c.toBlob(function (b) { var u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = (nama || 'struk') + '.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); res(); }, 'image/png'); });
}
function linkWA(lines, nomor) {
  var t = E.toText(lines), n = String(nomor || '').replace(/\D/g, '');
  if (n.charAt(0) === '0') n = '62' + n.slice(1);
  return 'https://wa.me/' + n + '?text=' + encodeURIComponent('```\n' + t + '\n```');
}

/* ---------- cetak: metode dipilih + fallback otomatis ---------- */
async function cetak(lines, o) {
  var withBm = await siapkanBitmap(lines, o), tries = [];
  var m = o.metode, android = /Android/i.test(navigator.userAgent);
  if (m === 'bluetooth' || (m === 'auto' && navigator.bluetooth)) tries.push('bluetooth');
  if (m === 'rawbt' || (m === 'auto' && android)) tries.push('rawbt');
  tries.push('browser');
  var salinan = Math.max(1, Math.min(3, o.salinan | 0 || 1)), gagal = [];
  for (var i = 0; i < tries.length; i++) {
    var t = tries[i];
    try {
      if (t === 'browser') { await cetakBrowser(withBm, o); return { metode: 'browser', ok: true, catatan: gagal.join(' ') }; }
      var bytes = escpos(withBm, o), all = new Uint8Array(bytes.length * salinan);
      for (var s = 0; s < salinan; s++) all.set(bytes, s * bytes.length);
      if (t === 'bluetooth') await kirimBT(all); else kirimRawBT(all);
      return { metode: t, ok: true, catatan: '' };
    } catch (e) {
      if (e && e.name === 'NotFoundError' && t === 'bluetooth') return { metode: t, ok: false, batal: true, catatan: 'Pemilihan printer dibatalkan.' };
      gagal.push(t + ': ' + (e && e.message ? e.message : 'gagal') + '.');
    }
  }
  return { metode: 'none', ok: false, catatan: gagal.join(' ') };
}
function lupakanBT() { try { if (BT.dev && BT.dev.gatt && BT.dev.gatt.connected) BT.dev.gatt.disconnect(); } catch (e) { /* abaikan */ } BT = { dev: null, ch: null }; }

root.StrukPrinter = {
  pasang: pasang, opsi: opsi, simpanLokal: simpanLokal, templateIsi: templateIsi, susun: susun, siapkanBitmap: siapkanBitmap,
  escpos: escpos, htmlPaper: htmlPaper, cetak: cetak, unduhPNG: unduhPNG, linkWA: linkWA, lupakanBT: lupakanBT, COLS: COLS, DOTS: DOTS,
  _code128: code128Codes, _C128: C128, _barBitmap: barBitmap
};
if (typeof module !== 'undefined' && module.exports) module.exports = root.StrukPrinter;
})(typeof window !== 'undefined' ? window : globalThis);
