/* KasirKu — PWA: daftar service worker, tombol "Pasang di HP", petunjuk iPhone, banner pembaruan. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var lsGet = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var lsSet = function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } };
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  var ua = navigator.userAgent || '';
  var iOS = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var safari = iOS && /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
  var deferred = null, bar = null;

  function tutup(simpan) { if (bar) { bar.remove(); bar = null; } if (simpan) lsSet('kk_pwa_tutup', String(Date.now())); }
  function barBaru(html) {
    tutup(false);
    bar = document.createElement('div'); bar.className = 'pwa-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Pasang aplikasi');
    bar.innerHTML = html; document.body.appendChild(bar); return bar;
  }
  /* jangan ganggu lagi selama 14 hari setelah ditutup */
  function bolehTampil() { var t = Number(lsGet('kk_pwa_tutup')) || 0; return !standalone && Date.now() - t > 14 * 864e5; }

  function tawarkan() {
    if (!bolehTampil() || !deferred) return;
    var b = barBaru('<div class="pwa-txt"><b>Pasang KasirKu di HP</b><span>Buka dari layar utama, layar penuh, tetap terbuka saat sinyal lemah.</span></div>' +
      '<button type="button" class="btn primary sm" id="pwaPasang">Pasang</button><button type="button" class="btn ghost sm" id="pwaNanti" aria-label="Tutup">Nanti</button>');
    b.querySelector('#pwaPasang').onclick = function () {
      var p = deferred; deferred = null; tutup(false);
      p.prompt(); p.userChoice.then(function (r) { if (r.outcome !== 'accepted') lsSet('kk_pwa_tutup', String(Date.now())); });
    };
    b.querySelector('#pwaNanti').onclick = function () { tutup(true); };
  }
  function tawarkanIOS() {
    if (!bolehTampil() || !safari) return;
    var b = barBaru('<div class="pwa-txt"><b>Pasang KasirKu di iPhone</b><span>Ketuk tombol <b>Bagikan</b> (kotak berpanah ke atas) di Safari, lalu pilih <b>Tambahkan ke Layar Utama</b>.</span></div>' +
      '<button type="button" class="btn ghost sm" id="pwaNanti">Mengerti</button>');
    b.querySelector('#pwaNanti').onclick = function () { tutup(true); };
  }

  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; setTimeout(tawarkan, 4000); });
  window.addEventListener('appinstalled', function () { deferred = null; tutup(false); lsSet('kk_pwa_tutup', String(Date.now())); if (window.KK) KK.toast('KasirKu terpasang di layar utama.', 'ok'); });
  if (iOS && !standalone) setTimeout(tawarkanIOS, 6000);

  /* dipakai tombol di Pengaturan bila ada */
  window.KKPwa = {
    terpasang: function () { return standalone; },
    bisaPasang: function () { return !!deferred; },
    pasang: function () { if (deferred) { var p = deferred; deferred = null; p.prompt(); return p.userChoice; } return Promise.resolve(null); }
  };

  /* ---------- service worker + pembaruan ---------- */
  if (!('serviceWorker' in navigator) || !/^https:$|^http:$/.test(location.protocol)) return;
  if (location.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  var reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () { if (reloading) return; reloading = true; location.reload(); });
  function tawarkanPembaruan(w) {
    var b = barBaru('<div class="pwa-txt"><b>Versi baru siap</b><span>Muat ulang untuk memakai pembaruan. Transaksi yang belum terkirim tetap aman.</span></div>' +
      '<button type="button" class="btn primary sm" id="pwaMuat">Muat ulang</button><button type="button" class="btn ghost sm" id="pwaNanti">Nanti</button>');
    b.querySelector('#pwaMuat').onclick = function () { w.postMessage('SKIP_WAITING'); };
    b.querySelector('#pwaNanti').onclick = function () { tutup(false); };
  }
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (reg) {
      if (reg.waiting && navigator.serviceWorker.controller) tawarkanPembaruan(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing; if (!w) return;
        w.addEventListener('statechange', function () { if (w.state === 'installed' && navigator.serviceWorker.controller) tawarkanPembaruan(w); });
      });
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') reg.update().catch(function () { }); });
    }).catch(function () { /* tanpa SW aplikasi tetap jalan seperti biasa */ });
  });
})();
