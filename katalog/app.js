(function () {
  'use strict';

  // Veriler Supabase'de durur (ayar: config.js). Liste (sepet) ve proforma taslağı cihazda kalır.
  var CFG = window.KATALOG_AYAR || {};
  var DATA = { kategoriler: [], urunler: [], silinen: [], kurallar: window.KURALLAR || [] };
  var sb = null;
  var app = document.getElementById('app');
  var PAGE = 48;

  // ------------------------------------------------------------ yardımcılar
  var byId = {};
  var katBySlug = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var trMap = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i' };
  function norm(s) {
    return String(s).toLocaleLowerCase('tr').replace(/[çğıöşüâî]/g, function (c) { return trMap[c]; });
  }
  function indexle() {
    katBySlug = {};
    DATA.kategoriler.forEach(function (k) { katBySlug[k.slug] = k; });
    byId = {};
    DATA.urunler.forEach(function (u) {
      byId[u.id] = u;
      u._s = norm(u.ad + ' ' + u.kod + ' ' + u.barkod);
    });
  }
  function imgSrc(f, size) { return CFG.url + '/storage/v1/object/public/urunler/' + size + '/' + f; }

  var money = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function tl(n) { return money.format(n || 0) + ' ₺'; }
  function fiyatHtml(u) {
    return u.fiyat ? tl(u.fiyat) : '<span class="ask">Fiyat sorunuz</span>';
  }
  // alış fiyatı + tedarikçi: yalnızca ekranda, proforma belgesine yazılmaz
  function icHtml(u) {
    if (!u.ted && !u.alis) return '';
    return '<div class="ic">' + (u.ted ? '<span>' + esc(u.ted) + '</span>' : '') +
      (u.alis ? '<span>Alış: ' + tl(u.alis) + ' + KDV</span>' : '') + '</div>';
  }
  function imgTag(u, size, i) {
    var f = u.img[i || 0];
    if (!f) return '<div class="noimg">Görsel yok</div>';
    return '<img loading="lazy" src="' + imgSrc(f, size) + '" alt="' + esc(u.ad) + '">';
  }
  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }
  var toastT;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove('on'); }, 1800);
  }

  // ------------------------------------------------------------------ liste
  // [{id, adet, fiyat?}]  fiyat: proforma için elle değiştirilen birim fiyat
  var cart = store('liste') || [];
  function saveCart() {
    store('liste', cart);
    var n = cart.reduce(function (a, c) { return a + c.adet; }, 0);
    document.getElementById('cartCount').textContent = n;
  }
  function cartItem(id) {
    for (var i = 0; i < cart.length; i++) if (cart[i].id === id) return cart[i];
    return null;
  }
  function addToCart(id, adet) {
    var c = cartItem(id);
    if (c) c.adet += adet; else cart.push({ id: id, adet: adet });
    saveCart();
    toast('Listeye eklendi');
  }
  var KDV_ORANLARI = [20, 10];
  function kdvOran(c) { return c.kdv === 10 ? 10 : 20; }
  function unitPrice(c) { return c.fiyat != null ? c.fiyat : byId[c.id].fiyat; }

  // ---------------------------------------------------------------- indirim
  // taslakta: iskontoTip 'yuzde' | 'tutar', iskonto: sayı
  function iskontoTutar(sum, pf) {
    var v = Math.max(0, parseFloat(pf && pf.iskonto) || 0);
    var t = pf && pf.iskontoTip === 'tutar' ? v : sum * Math.min(100, v) / 100;
    return Math.min(sum, t);
  }
  function iskontoEtiket(pf) {
    var v = parseFloat(pf.iskonto) || 0;
    return pf.iskontoTip === 'tutar' ? 'İndirim' : 'İndirim (%' + v.toLocaleString('tr-TR') + ')';
  }
  function cartSum() {
    return cart.reduce(function (a, c) { return a + unitPrice(c) * c.adet; }, 0);
  }
  function indirimSatirlari(sum, pf) {
    var t = iskontoTutar(sum, pf);
    return '<div class="sumrow"><span>Ara toplam</span><b>' + tl(sum) + '</b></div>' +
      '<div class="sumrow disc"><span>' + iskontoEtiket(pf) + '</span><b>−' + tl(t) + '</b></div>' +
      '<div class="sumrow after"><span>İndirim sonrası toplam</span><b>' + tl(sum - t) + '</b></div>';
  }
  function indirimDialog(onDone) {
    var pf = store('pfTaslak') || {};
    var sum = cartSum();
    var d = document.createElement('dialog');
    d.className = 'dlg';
    d.innerHTML = '<form method="dialog"><h2>İndirim yapılacak mı?</h2>' +
      '<div class="dlg-choice"><label><input type="radio" name="var" value="0"> Hayır, indirim yok</label>' +
      '<label><input type="radio" name="var" value="1"> Evet, indirim uygula</label></div>' +
      '<div class="dlg-body" id="dlgBody"><div class="two">' +
      '<label>İndirim türü<select id="dTip"><option value="yuzde">Yüzde (%)</option><option value="tutar">Tutar (₺)</option></select></label>' +
      '<label>İndirim<input id="dVal" type="number" min="0" step="0.01" inputmode="decimal"></label></div>' +
      '<div class="dlg-sum" id="dSum"></div></div>' +
      '<div class="dlg-actions"><button type="button" class="btn ghost" id="dCancel">Vazgeç</button>' +
      '<button type="button" class="btn" id="dOk">Proformaya geç →</button></div></form>';
    document.body.appendChild(d);
    var tip = d.querySelector('#dTip'), val = d.querySelector('#dVal'), body = d.querySelector('#dlgBody');
    var radios = d.querySelectorAll('[name=var]');
    var has = (parseFloat(pf.iskonto) || 0) > 0;
    radios[has ? 1 : 0].checked = true;
    tip.value = pf.iskontoTip === 'tutar' ? 'tutar' : 'yuzde';
    val.value = has ? pf.iskonto : '';
    function sumDraw() {
      d.querySelector('#dSum').innerHTML = indirimSatirlari(sum, { iskontoTip: tip.value, iskonto: val.value });
    }
    function draw() {
      var on = radios[1].checked;
      body.style.display = on ? '' : 'none';
      sumDraw();
      if (on) val.focus();
    }
    radios.forEach(function (r) { r.onchange = draw; });
    tip.onchange = draw;
    val.oninput = sumDraw;
    function close() { d.close(); d.remove(); }
    d.querySelector('#dCancel').onclick = close;
    d.addEventListener('cancel', function () { d.remove(); });
    d.querySelector('#dOk').onclick = function () {
      var on = radios[1].checked;
      pf.iskontoTip = tip.value;
      pf.iskonto = on ? Math.max(0, parseFloat(val.value) || 0) : 0;
      store('pfTaslak', pf);
      close();
      onDone();
    };
    d.showModal();
    draw();
  }

  // ----------------------------------------------------------------- router
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('?');
    var q = {};
    (parts[1] || '').split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
    });
    return { path: parts[0].split('/').filter(Boolean), q: q };
  }
  function listHash(q) {
    var s = [];
    ['k', 'a', 'q', 's'].forEach(function (key) {
      if (q[key]) s.push(key + '=' + encodeURIComponent(q[key]));
    });
    return '#/' + (s.length ? '?' + s.join('&') : '');
  }
  var listState = {};   // hash -> {shown, scroll}
  var lastHash = null;

  function route() {
    if (lastHash !== null && listState[lastHash]) listState[lastHash].scroll = window.scrollY;
    var r = parseHash();
    lastHash = location.hash;
    document.body.className = '';
    if (r.path[0] === 'urun') viewProduct(parseInt(r.path[1], 10));
    else if (r.path[0] === 'liste') viewCart();
    else if (r.path[0] === 'proforma') viewProforma();
    else if (r.path[0] === 'yonetim') viewAdmin();
    else if (r.path[0] === 'duzenle') viewEdit(parseInt(r.path[1], 10));
    else viewList(r.q);
  }

  // ------------------------------------------------------------ ürün listesi
  function card(u) {
    return '<article class="card">' +
      '<a class="card-img" href="#/urun/' + u.id + '">' + imgTag(u, 'k') + '</a>' +
      '<div class="card-body">' +
      '<a class="card-name" href="#/urun/' + u.id + '">' + esc(u.ad) + '</a>' +
      '<div class="card-code">' + esc(u.kod || '—') + '</div>' +
      icHtml(u) +
      '<div class="card-foot"><span class="price">' + fiyatHtml(u) + '</span>' +
      '<button class="btn small" data-add="' + u.id + '">Listeye ekle</button></div>' +
      '</div></article>';
  }

  function viewList(q) {
    var key = location.hash;
    var st = listState[key] || (listState[key] = { shown: PAGE, scroll: 0 });
    var kat = katBySlug[q.k];
    var items = DATA.urunler;
    if (kat) items = items.filter(function (u) { return u.kat === kat.slug; });
    var inKat = items;
    if (kat && q.a) items = items.filter(function (u) { return u.alt === q.a; });
    if (q.q) {
      var toks = norm(q.q).split(/\s+/).filter(Boolean);
      var f = function (u) { return toks.every(function (t) { return u._s.indexOf(t) >= 0; }); };
      items = items.filter(f);
      inKat = inKat.filter(f);
    }
    var sort = q.s || '';
    items = items.slice();
    if (sort === 'artan') items.sort(function (a, b) { return (a.fiyat || 1e12) - (b.fiyat || 1e12); });
    else if (sort === 'azalan') items.sort(function (a, b) { return b.fiyat - a.fiyat; });
    else if (sort === 'ad') items.sort(function (a, b) { return a.ad.localeCompare(b.ad, 'tr'); });

    document.getElementById('q').value = q.q || '';

    // arama varsa kategori sayıları aramaya göre
    var base = DATA.urunler;
    if (q.q) {
      var tk = norm(q.q).split(/\s+/).filter(Boolean);
      base = base.filter(function (u) { return tk.every(function (t) { return u._s.indexOf(t) >= 0; }); });
    }
    var counts = {};
    base.forEach(function (u) { counts[u.kat] = (counts[u.kat] || 0) + 1; });

    var side = '<nav class="side"><h3>Kategoriler</h3><ul>' +
      '<li><a class="' + (!kat ? 'on' : '') + '" href="' + listHash({ q: q.q, s: q.s }) + '">Tüm Ürünler<span>' + base.length + '</span></a></li>' +
      DATA.kategoriler.map(function (k) {
        return '<li><a class="' + (kat === k ? 'on' : '') + '" href="' + listHash({ k: k.slug, q: q.q, s: q.s }) + '">' +
          esc(k.ad) + '<span>' + (counts[k.slug] || 0) + '</span></a></li>';
      }).join('') + '</ul></nav>';

    var chips = '';
    if (kat && kat.alt.length > 1) {
      var ac = {};
      inKat.forEach(function (u) { ac[u.alt] = (ac[u.alt] || 0) + 1; });
      chips = '<div class="chips">' +
        '<a class="chip ' + (!q.a ? 'on' : '') + '" href="' + listHash({ k: kat.slug, q: q.q, s: q.s }) + '">Tümü</a>' +
        kat.alt.map(function (a) {
          return '<a class="chip ' + (q.a === a.slug ? 'on' : '') + '" href="' +
            listHash({ k: kat.slug, a: a.slug, q: q.q, s: q.s }) + '">' + esc(a.ad) + ' <em>' + (ac[a.slug] || 0) + '</em></a>';
        }).join('') + '</div>';
    }

    var title = kat ? kat.ad : 'Tüm Ürünler';
    if (q.q) title = '“' + q.q + '” için sonuçlar' + (kat ? ' · ' + kat.ad : '');

    app.innerHTML = '<div class="layout">' + side +
      '<section class="content">' +
      '<div class="list-head"><div><h1>' + esc(title) + '</h1><p class="muted">' + items.length + ' ürün</p></div>' +
      '<select id="sort" aria-label="Sırala">' +
      '<option value="">Varsayılan sıralama</option>' +
      '<option value="ad">Ada göre (A–Z)</option>' +
      '<option value="artan">Fiyat: düşükten yükseğe</option>' +
      '<option value="azalan">Fiyat: yüksekten düşüğe</option></select></div>' +
      chips +
      (items.length ? '<div class="grid" id="grid"></div><div id="more"></div>'
        : '<p class="empty">Bu kriterlere uygun ürün bulunamadı.</p>') +
      '</section></div>';

    var sel = document.getElementById('sort');
    sel.value = sort;
    sel.onchange = function () {
      location.hash = listHash({ k: q.k, a: q.a, q: q.q, s: sel.value });
    };

    var grid = document.getElementById('grid');
    var more = document.getElementById('more');
    var drawn = 0;
    function draw() {
      if (!grid) return;
      var n = Math.min(st.shown, items.length);
      grid.insertAdjacentHTML('beforeend', items.slice(drawn, n).map(card).join(''));
      drawn = n;
      more.innerHTML = drawn < items.length
        ? '<button class="btn ghost" id="moreBtn">Daha fazla göster (' + (items.length - drawn) + ')</button>' : '';
      var b = document.getElementById('moreBtn');
      if (b) {
        b.onclick = function () { st.shown += PAGE; draw(); };
        if (window.IntersectionObserver) {
          var io = new IntersectionObserver(function (en) {
            if (en[0].isIntersecting) { io.disconnect(); st.shown += PAGE; draw(); }
          }, { rootMargin: '600px' });
          io.observe(b);
        }
      }
    }
    draw();
    window.scrollTo(0, st.scroll || 0);
  }

  // ------------------------------------------------------------- ürün detay
  function viewProduct(id) {
    var u = byId[id];
    if (!u) { app.innerHTML = '<p class="empty">Ürün bulunamadı. <a href="#/">Kataloğa dön</a></p>'; return; }
    var kat = katBySlug[u.kat];
    var alt = kat.alt.filter(function (a) { return a.slug === u.alt; })[0];
    var benzer = DATA.urunler.filter(function (x) { return x.alt === u.alt && x.kat === u.kat && x.id !== u.id; });
    // aynı ürün ailesinden olanlar (adın ilk iki kelimesi) öne
    var pre = u.ad.split(' ').slice(0, 2).join(' ');
    benzer.sort(function (a, b) { return (b.ad.indexOf(pre) === 0) - (a.ad.indexOf(pre) === 0); });
    benzer = benzer.slice(0, 8);
    var inCart = cartItem(u.id);

    var rows = [
      ['Ürün kodu', u.kod], ['Barkod', u.barkod], ['Ölçü', u.olcu],
      ['Kategori', kat.ad + (alt && alt.ad !== kat.ad ? ' › ' + alt.ad : '')],
      ['Tedarikçi', u.ted],
      ['Alış (KDV hariç)', u.alis ? tl(u.alis) : ''],
      ['Alış (KDV dahil)', u.alisKdv ? tl(u.alisKdv) : '']
    ].filter(function (r) { return r[1]; }).map(function (r) {
      return '<tr><th>' + r[0] + '</th><td>' + esc(r[1]) + '</td></tr>';
    }).join('');

    app.innerHTML = '<div class="detail-wrap">' +
      '<p class="crumbs"><a href="#/">Katalog</a> › <a href="' + listHash({ k: kat.slug }) + '">' + esc(kat.ad) + '</a>' +
      (alt ? ' › <a href="' + listHash({ k: kat.slug, a: alt.slug }) + '">' + esc(alt.ad) + '</a>' : '') + '</p>' +
      '<div class="detail">' +
      '<div class="gallery"><div class="main-img" id="mainImg">' + imgTag(u, 'b') + '</div>' +
      (u.img.length > 1 ? '<div class="thumbs">' + u.img.map(function (f, i) {
        return '<button class="' + (i ? '' : 'on') + '" data-i="' + i + '"><img src="' + imgSrc(f, 'k') + '" alt=""></button>';
      }).join('') + '</div>' : '') + '</div>' +
      '<div class="info"><h1>' + esc(u.ad) + '</h1>' +
      '<div class="price big">' + fiyatHtml(u) + (u.fiyat ? ' <small>KDV dahil</small>' : '') + '</div>' +
      '<table class="specs">' + rows + '</table>' +
      '<div class="buy"><div class="qty"><button data-q="-1" aria-label="Azalt">−</button>' +
      '<input id="adet" type="number" min="1" value="1" aria-label="Adet"><button data-q="1" aria-label="Artır">+</button></div>' +
      '<button class="btn" id="addBtn">Listeye ekle</button></div>' +
      '<p class="muted" id="inCart">' + (inCart ? 'Listenizde bu üründen ' + inCart.adet + ' adet var. ' : '') +
      '<a href="#/liste">Listeye git →</a></p>' +
      '<p class="acts"><a class="link" href="#/duzenle/' + u.id + '">Ürünü düzenle</a>' +
      '<button class="link danger" id="delBtn">Katalogdan sil</button></p>' +
      '</div></div>' +
      (benzer.length ? '<h2 class="sec">Benzer ürünler</h2><div class="grid">' + benzer.map(card).join('') + '</div>' : '') +
      '</div>';

    var adet = document.getElementById('adet');
    app.querySelectorAll('[data-q]').forEach(function (b) {
      b.onclick = function () { adet.value = Math.max(1, (parseInt(adet.value, 10) || 1) + parseInt(b.dataset.q, 10)); };
    });
    document.getElementById('addBtn').onclick = function () {
      addToCart(u.id, Math.max(1, parseInt(adet.value, 10) || 1));
      document.getElementById('inCart').innerHTML = 'Listenizde bu üründen ' + cartItem(u.id).adet +
        ' adet var. <a href="#/liste">Listeye git →</a>';
    };
    document.getElementById('delBtn').onclick = function () { urunSil(u, '#/'); };
    app.querySelectorAll('.thumbs button').forEach(function (b) {
      b.onclick = function () {
        document.getElementById('mainImg').innerHTML = imgTag(u, 'b', parseInt(b.dataset.i, 10));
        app.querySelectorAll('.thumbs button').forEach(function (x) { x.classList.toggle('on', x === b); });
      };
    });
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ listem
  function viewCart() {
    if (!cart.length) {
      app.innerHTML = '<div class="narrow"><h1>Listem</h1><p class="empty">Listeniz boş. ' +
        '<a href="#/">Kataloğa göz atın</a> ve ürünleri “Listeye ekle” ile ekleyin.</p></div>';
      return;
    }
    var total = 0;
    var taslak = store('pfTaslak') || {};
    var hasIsk = (parseFloat(taslak.iskonto) || 0) > 0;
    var rows = cart.map(function (c) {
      var u = byId[c.id];
      var line = unitPrice(c) * c.adet;
      total += line;
      return '<tr><td class="c-img"><a href="#/urun/' + u.id + '">' + imgTag(u, 'k') + '</a></td>' +
        '<td><a class="card-name" href="#/urun/' + u.id + '">' + esc(u.ad) + '</a><div class="card-code">' + esc(u.kod) + '</div>' + icHtml(u) + '</td>' +
        '<td class="num">' + (unitPrice(c) ? tl(unitPrice(c)) : fiyatHtml(u)) + '</td>' +
        '<td><div class="qty sm"><button data-dec="' + u.id + '" aria-label="Azalt">−</button>' +
        '<input type="number" min="1" value="' + c.adet + '" data-set="' + u.id + '" aria-label="Adet">' +
        '<button data-inc="' + u.id + '" aria-label="Artır">+</button></div></td>' +
        '<td class="num strong">' + tl(line) + '</td>' +
        '<td><button class="x" data-del="' + u.id + '" title="Listeden çıkar" aria-label="Listeden çıkar">×</button></td></tr>';
    }).join('');
    var adet = cart.reduce(function (a, c) { return a + c.adet; }, 0);
    app.innerHTML = '<div class="narrow"><div class="list-head"><div><h1>Listem</h1><p class="muted">' +
      cart.length + ' kalem, ' + adet + ' adet</p></div>' +
      '<button class="btn ghost" id="clearBtn">Listeyi boşalt</button></div>' +
      '<div class="table-wrap"><table class="cart"><thead><tr><th></th><th>Ürün</th><th class="num">Birim fiyat</th><th>Adet</th>' +
      '<th class="num">Tutar</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="cart-foot"><div class="cart-sum">' +
      (hasIsk ? indirimSatirlari(total, taslak) +
        '<button class="link" id="iskEdit">İndirimi değiştir</button> · <button class="link" id="iskDel">İndirimi kaldır</button>'
        : '<div class="total">Toplam (KDV dahil) <strong>' + tl(total) + '</strong></div>' +
          '<button class="link" id="iskEdit">İndirim ekle</button>') + '</div>' +
      '<div><a class="btn ghost" href="#/">Alışverişe devam</a> <button class="btn" id="pfBtn">Proforma faturaya çevir →</button></div></div></div>';

    document.getElementById('pfBtn').onclick = function () {
      indirimDialog(function () { location.hash = '#/proforma'; });
    };
    document.getElementById('iskEdit').onclick = function () { indirimDialog(viewCart); };
    if (hasIsk) document.getElementById('iskDel').onclick = function () {
      taslak.iskonto = 0; store('pfTaslak', taslak); viewCart();
    };

    function upd(id, fn) {
      var c = cartItem(id);
      if (!c) return;
      c.adet = Math.max(1, fn(c.adet) || 1);
      saveCart(); viewCart();
    }
    app.onclick = null;
    app.querySelectorAll('[data-inc]').forEach(function (b) { b.onclick = function () { upd(+b.dataset.inc, function (n) { return n + 1; }); }; });
    app.querySelectorAll('[data-dec]').forEach(function (b) { b.onclick = function () { upd(+b.dataset.dec, function (n) { return n - 1; }); }; });
    app.querySelectorAll('[data-set]').forEach(function (i) { i.onchange = function () { upd(+i.dataset.set, function () { return parseInt(i.value, 10); }); }; });
    app.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        cart = cart.filter(function (c) { return c.id !== +b.dataset.del; });
        saveCart(); viewCart();
      };
    });
    document.getElementById('clearBtn').onclick = function () {
      if (confirm('Listedeki tüm ürünler silinsin mi?')) { cart = []; saveCart(); viewCart(); }
    };
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- proforma
  function today(offset) {
    var d = new Date();
    d.setDate(d.getDate() + (offset || 0));
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function trDate(iso) {
    var p = (iso || '').split('-');
    return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : '';
  }
  function nextNo() {
    var d = today().replace(/-/g, '');
    var s = store('pfSayac') || {};
    var n = s.gun === d ? s.n : 1;
    return 'PF-' + d + '-' + ('00' + n).slice(-3);
  }
  function bumpNo() {
    var d = today().replace(/-/g, '');
    var s = store('pfSayac') || {};
    store('pfSayac', { gun: d, n: (s.gun === d ? s.n : 1) + 1 });
  }

  var FIRMA_FIELDS = [['ad', 'Firma adı'], ['adres', 'Adres'], ['tel', 'Telefon'], ['eposta', 'E-posta'],
    ['vd', 'Vergi dairesi / no'], ['iban', 'Banka / IBAN']];
  var MUSTERI_FIELDS = [['ad', 'Müşteri / firma adı'], ['yetkili', 'Yetkili'], ['adres', 'Adres'],
    ['tel', 'Telefon'], ['vd', 'Vergi dairesi / no']];

  function viewProforma() {
    if (!cart.length) {
      app.innerHTML = '<div class="narrow"><h1>Proforma Fatura</h1><p class="empty">Proforma oluşturmak için önce listenize ürün ekleyin. ' +
        '<a href="#/">Kataloğa dön</a></p></div>';
      return;
    }
    document.body.className = 'pf-page';
    var firma = store('pfFirma') || {};
    var pf = store('pfTaslak') || {};
    pf.musteri = pf.musteri || {};
    if (!pf.no) pf.no = nextNo();
    if (!pf.tarih) pf.tarih = today();
    if (!pf.gecerlilik) pf.gecerlilik = pf.tarih;
    if (pf.kdv == null) pf.kdv = 20;
    if (pf.dahil == null) pf.dahil = true;
    if (pf.iskonto == null) pf.iskonto = 0;
    if (pf.iskontoTip !== 'tutar') pf.iskontoTip = 'yuzde';
    if (pf.gorsel == null) pf.gorsel = true;
    if (pf.not == null) pf.not = 'Bu belge proforma fatura olup mali değeri yoktur. Fiyatlar belirtilen geçerlilik tarihine kadar geçerlidir.';

    function field(obj, f, grp) {
      return '<label>' + f[1] + '<input data-g="' + grp + '" data-f="' + f[0] + '" value="' + esc(obj[f[0]] || '') + '"></label>';
    }
    app.innerHTML = '<div class="pf-layout">' +
      '<aside class="pf-form no-print">' +
      '<h1>Proforma Fatura</h1>' +
      '<fieldset><legend>Belge</legend>' +
      '<label>Proforma no<input data-g="pf" data-f="no" value="' + esc(pf.no) + '"></label>' +
      '<div class="two"><label>Tarih<input type="date" data-g="pf" data-f="tarih" value="' + pf.tarih + '"></label>' +
      '<label>Geçerlilik<input type="date" data-g="pf" data-f="gecerlilik" value="' + pf.gecerlilik + '"></label></div>' +
      '<div class="two"><label>İndirim türü<select data-g="pf" data-f="iskontoTip">' +
      '<option value="yuzde"' + (pf.iskontoTip === 'yuzde' ? ' selected' : '') + '>Yüzde (%)</option>' +
      '<option value="tutar"' + (pf.iskontoTip === 'tutar' ? ' selected' : '') + '>Tutar (₺)</option></select></label>' +
      '<label>İndirim<input type="number" min="0" step="0.01" data-g="pf" data-f="iskonto" value="' + pf.iskonto + '"></label></div>' +
      '<label class="chk"><input type="checkbox" data-g="pf" data-f="dahil"' + (pf.dahil ? ' checked' : '') + '> Birim fiyatlara KDV dahil</label>' +
      '<label class="chk"><input type="checkbox" data-g="pf" data-f="gorsel"' + (pf.gorsel ? ' checked' : '') + '> Ürün görsellerini göster</label>' +
      '</fieldset>' +
      '<fieldset><legend>Müşteri</legend>' + MUSTERI_FIELDS.map(function (f) { return field(pf.musteri, f, 'musteri'); }).join('') + '</fieldset>' +
      '<fieldset><legend>Satıcı firma <small>(bir kez girin, hatırlanır)</small></legend>' + FIRMA_FIELDS.map(function (f) { return field(firma, f, 'firma'); }).join('') + '</fieldset>' +
      '<fieldset><legend>Not / koşullar</legend><textarea data-g="pf" data-f="not" rows="4">' + esc(pf.not) + '</textarea></fieldset>' +
      '<div class="pf-actions"><button class="btn" id="printBtn">Yazdır / PDF kaydet</button>' +
      '<a class="btn ghost" href="#/liste">← Listeye dön</a>' +
      '<button class="btn ghost" id="newBtn" title="Listeyi ve müşteri bilgisini temizler">Yeni proforma</button></div>' +
      '<p class="muted">Birim fiyat ve adetleri sağdaki belgede doğrudan değiştirebilirsiniz. PDF için yazdırma penceresinde “PDF olarak kaydet” seçin.</p>' +
      '</aside>' +
      '<section class="doc" id="doc"></section></div>';

    function lines(val) {
      return esc(val || '').replace(/\n/g, '<br>');
    }
    function drawDoc() {
      var sum = 0;
      var rows = cart.map(function (c, i) {
        var u = byId[c.id];
        var p = unitPrice(c);
        var line = p * c.adet;
        sum += line;
        return '<tr><td class="num">' + (i + 1) + '</td>' +
          (pf.gorsel ? '<td class="d-img">' + (u.img[0] ? '<img src="' + imgSrc(u.img[0], 'k') + '" alt="">' : '') + '</td>' : '') +
          '<td>' + esc(u.kod) + '</td><td>' + esc(u.ad) + '</td>' +
          '<td class="num"><input class="cell" type="number" min="1" value="' + c.adet + '" data-adet="' + u.id + '" aria-label="Adet"></td>' +
          '<td class="num"><input class="cell wide" type="number" min="0" step="0.01" value="' + p.toFixed(2) + '" data-fiyat="' + u.id + '" aria-label="Birim fiyat"></td>' +
          '<td class="num"><select class="cell kdvsel" data-kdv="' + u.id + '" aria-label="KDV oranı">' +
          KDV_ORANLARI.map(function (o) {
            return '<option value="' + o + '"' + (kdvOran(c) === o ? ' selected' : '') + '>%' + o + '</option>';
          }).join('') + '</select></td>' +
          '<td class="num">' + money.format(line) + '</td></tr>';
      }).join('');
      var iskTutar = iskontoTutar(sum, pf);
      var isk = iskTutar > 0;
      var after = sum - iskTutar;
      // indirim kalemlere tutarı oranında dağıtılır, KDV her kalemin kendi oranıyla hesaplanır
      var pay = sum ? after / sum : 1;
      var net = 0, kdvGrup = {};
      cart.forEach(function (c) {
        var o = kdvOran(c), t = unitPrice(c) * c.adet * pay;
        var n = pf.dahil ? t / (1 + o / 100) : t;
        net += n;
        kdvGrup[o] = (kdvGrup[o] || 0) + (pf.dahil ? t - n : t * o / 100);
      });
      var kdv = 0;
      var kdvSatir = KDV_ORANLARI.filter(function (o) { return kdvGrup[o] != null; }).map(function (o) {
        kdv += kdvGrup[o];
        return '<tr><th>KDV (%' + o + ')</th><td>' + tl(kdvGrup[o]) + '</td></tr>';
      }).join('');
      var genel = net + kdv;
      var m = pf.musteri;

      document.getElementById('doc').innerHTML =
        '<div class="doc-head"><div class="seller"><h2>' + esc(firma.ad || 'Firma Adı') + '</h2>' +
        '<p>' + [lines(firma.adres), firma.tel && 'Tel: ' + esc(firma.tel), esc(firma.eposta), firma.vd && 'V.D. / No: ' + esc(firma.vd)]
          .filter(Boolean).join('<br>') + '</p></div>' +
        '<div class="doc-meta"><h1>PROFORMA FATURA</h1><table>' +
        '<tr><th>No</th><td>' + esc(pf.no) + '</td></tr>' +
        '<tr><th>Tarih</th><td>' + trDate(pf.tarih) + '</td></tr>' +
        '<tr><th>Geçerlilik</th><td>' + trDate(pf.gecerlilik) + '</td></tr></table></div></div>' +
        '<div class="buyer"><h3>Sayın</h3><p><strong>' + esc(m.ad || '—') + '</strong>' +
        [m.yetkili && esc(m.yetkili), lines(m.adres), m.tel && 'Tel: ' + esc(m.tel), m.vd && 'V.D. / No: ' + esc(m.vd)]
          .filter(Boolean).map(function (x) { return '<br>' + x; }).join('') + '</p></div>' +
        '<table class="items"><thead><tr><th class="num">#</th>' + (pf.gorsel ? '<th></th>' : '') +
        '<th>Kod</th><th>Ürün</th><th class="num">Adet</th><th class="num">Birim fiyat (₺)</th><th class="num">KDV</th><th class="num">Tutar (₺)</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        '<div class="doc-foot"><div class="notes">' + (pf.not ? '<h3>Not</h3><p>' + lines(pf.not) + '</p>' : '') +
        (firma.iban ? '<h3>Banka bilgileri</h3><p>' + lines(firma.iban) + '</p>' : '') + '</div>' +
        '<table class="totals">' +
        '<tr><th>Ara toplam' + (pf.dahil ? ' (KDV dahil)' : '') + '</th><td>' + tl(sum) + '</td></tr>' +
        (isk ? '<tr><th>' + iskontoEtiket(pf) + '</th><td>−' + tl(iskTutar) + '</td></tr>' +
          '<tr class="after"><th>İndirim sonrası toplam' + (pf.dahil ? ' (KDV dahil)' : '') + '</th><td>' + tl(after) + '</td></tr>' : '') +
        '<tr><th>KDV hariç toplam</th><td>' + tl(net) + '</td></tr>' +
        kdvSatir +
        '<tr class="grand"><th>GENEL TOPLAM</th><td>' + tl(genel) + '</td></tr></table></div>' +
        '<div class="sign"><div>Satıcı<br>Kaşe / İmza</div><div>Müşteri<br>Onay / İmza</div></div>';

      document.querySelectorAll('#doc [data-adet]').forEach(function (i) {
        i.onchange = function () {
          cartItem(+i.dataset.adet).adet = Math.max(1, parseInt(i.value, 10) || 1);
          saveCart(); drawDoc();
        };
      });
      document.querySelectorAll('#doc [data-kdv]').forEach(function (i) {
        i.onchange = function () {
          cartItem(+i.dataset.kdv).kdv = parseInt(i.value, 10);
          saveCart(); drawDoc();
        };
      });
      document.querySelectorAll('#doc [data-fiyat]').forEach(function (i) {
        i.onchange = function () {
          var c = cartItem(+i.dataset.fiyat);
          var v = parseFloat(i.value);
          if (isNaN(v) || v < 0 || v === byId[c.id].fiyat) delete c.fiyat; else c.fiyat = v;
          saveCart(); drawDoc();
        };
      });
    }
    drawDoc();

    app.querySelectorAll('.pf-form [data-g]').forEach(function (el) {
      el.oninput = function () {
        var v = el.type === 'checkbox' ? el.checked : el.value;
        if (el.dataset.g === 'firma') {
          firma[el.dataset.f] = v;
          store('pfFirma', firma);
          setBrand();
        } else if (el.dataset.g === 'musteri') pf.musteri[el.dataset.f] = v;
        else pf[el.dataset.f] = v;
        store('pfTaslak', pf);
        drawDoc();
      };
    });
    document.getElementById('printBtn').onclick = function () {
      var old = document.title;
      document.title = pf.no + (pf.musteri.ad ? ' - ' + pf.musteri.ad : '');
      window.print();
      document.title = old;
    };
    document.getElementById('newBtn').onclick = function () {
      if (!confirm('Liste ve müşteri bilgileri temizlenip yeni bir proforma başlatılsın mı?')) return;
      bumpNo();
      cart = []; saveCart();
      store('pfTaslak', null);
      location.hash = '#/';
    };
    window.scrollTo(0, 0);
  }

  // --------------------------------------------------------------- supabase
  function hata(r) {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  }
  function satirdanUrun(r) {
    return {
      id: r.id, ad: r.ad, kod: r.kod || '', barkod: r.barkod || '', fiyat: +r.fiyat || 0,
      kat: r.kat, alt: r.alt, olcu: r.olcu || '', img: r.gorseller || [],
      alis: +r.alis || 0, alisKdv: +r.alis_kdv || 0, ted: r.tedarikci || '', silindi: r.silindi
    };
  }
  function veriYukle() {
    function sayfa(a, acc) {       // API tek seferde en çok 1000 satır döndürür
      return sb.from('urunler').select('*').order('id').range(a, a + 999).then(function (r) {
        var d = hata(r);
        acc = acc.concat(d);
        return d.length === 1000 ? sayfa(a + 1000, acc) : acc;
      });
    }
    return Promise.all([
      sb.from('kategoriler').select('*').order('sira').then(hata),
      sb.from('alt_kategoriler').select('*').order('sira').then(hata),
      sayfa(0, [])
    ]).then(function (r) {
      DATA.kategoriler = r[0].map(function (k) {
        return {
          ad: k.ad, slug: k.slug, sira: k.sira,
          alt: r[1].filter(function (a) { return a.kat === k.slug; })
            .map(function (a) { return { ad: a.ad, slug: a.slug, sira: a.sira }; })
        };
      });
      // menüde kategoriler ve alt kategoriler alfabetik sıralanır
      function adaGore(x, y) { return x.ad.localeCompare(y.ad, 'tr'); }
      DATA.kategoriler.sort(adaGore);
      DATA.kategoriler.forEach(function (k) { k.alt.sort(adaGore); });
      var hepsi = r[2].map(satirdanUrun);
      DATA.urunler = hepsi.filter(function (u) { return !u.silindi; });
      DATA.silinen = hepsi.filter(function (u) { return u.silindi; });
      indexle();
    });
  }
  function yenile(hash) {
    if (hash != null) location.hash = hash;
    location.reload();
  }
  function slugYap(t) {
    return norm(t).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function kategoriBul(ad) {
    var n = ad.toLocaleUpperCase('tr').replace(/\s+/g, ' ').trim();
    var k = DATA.kurallar;
    for (var i = 0; i < k.length; i++) {
      var kat = katBySlug[k[i][0]];
      if (!kat || !kat.alt.some(function (a) { return a.slug === k[i][1]; })) continue;
      if (!k[i][2] || new RegExp(k[i][2]).test(n)) return [k[i][0], k[i][1]];
    }
    return null;
  }
  function olcuBul(ad) {
    var n = ad.toLocaleUpperCase('tr'), out = [];
    var m = n.match(/(\d+(?:,\d+)?(?:\s*\*\s*\d+(?:,\d+)?)+)/);
    if (m) out.push(m[1].replace(/\s*\*\s*/g, ' × ') + ' cm');
    else if ((m = n.match(/(\d+(?:,\d+)?)\s*CM\b/))) out.push(m[1] + ' cm');
    if ((m = n.match(/(\d+)\s*(ML|CC)\b/))) out.push(m[1] + ' ' + m[2].toLowerCase());
    return out.join(' · ');
  }

  // ---- görseller: tarayıcıda iki boya küçültülür, Supabase deposuna yüklenir
  function boyutla(im, max) {
    return new Promise(function (res, rej) {
      var k = Math.min(1, max / Math.max(im.width, im.height));
      var c = document.createElement('canvas');
      c.width = Math.round(im.width * k);
      c.height = Math.round(im.height * k);
      var x = c.getContext('2d');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, c.width, c.height);
      x.drawImage(im, 0, 0, c.width, c.height);
      c.toBlob(function (b) { b ? res(b) : rej(new Error('Görsel işlenemedi')); }, 'image/jpeg', 0.82);
    });
  }
  function gorselHazirla(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onerror = function () { rej(new Error('Görsel okunamadı: ' + file.name)); };
      im.onload = function () {
        Promise.all([boyutla(im, 440), boyutla(im, 1400)]).then(function (b) {
          res({ k: b[0], b: b[1], url: url });
        }, rej);
      };
      im.src = url;
    });
  }
  function gorselYukle(g) {
    var ad = Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.jpg';
    var depo = sb.storage.from('urunler');
    var ayar = { contentType: 'image/jpeg', cacheControl: '31536000' };
    return Promise.all([depo.upload('k/' + ad, g.k, ayar), depo.upload('b/' + ad, g.b, ayar)]).then(function (r) {
      r.forEach(hata);
      return ad;
    });
  }

  function urunSil(u, sonra) {
    if (!confirm('“' + u.ad + '” katalogdan silinsin mi?\n(Yönetim ekranından geri alabilirsiniz.)')) return;
    sb.from('urunler').update({ silindi: new Date().toISOString() }).eq('id', u.id).then(hata).then(function () {
      cart = cart.filter(function (c) { return c.id !== u.id; });
      saveCart();
      yenile(sonra);
    }).catch(function (e) { alert(e.message); });
  }

  // ---- ürün formu (ekleme ve düzenleme ortak)
  function urunFormu(u) {
    var katOpts = (u ? '' : '<option value="">Otomatik (ürün adına göre)</option>') + DATA.kategoriler.map(function (k) {
      return '<optgroup label="' + esc(k.ad) + '">' + k.alt.map(function (a) {
        return '<option value="' + k.slug + '|' + a.slug + '"' +
          (u && u.kat === k.slug && u.alt === a.slug ? ' selected' : '') + '>' + esc(a.ad) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    var teds = {};
    DATA.urunler.forEach(function (x) { if (x.ted) teds[x.ted] = 1; });
    function v(x) { return u ? ' value="' + esc(x) + '"' : ''; }
    return '<form class="panel" id="urunForm"><h2>' + (u ? 'Ürünü düzenle' : 'Ürün ekle') + '</h2>' +
      '<label>Ürün adı *<input name="ad" required placeholder="ör. VAZO BEYAZ SERAMİK 20*35 CM"' + v(u && u.ad) + '></label>' +
      '<div class="two"><label>Ürün kodu<input name="kod"' + v(u && u.kod) + '></label>' +
      '<label>Barkod<input name="barkod" inputmode="numeric"' + v(u && u.barkod) + '></label></div>' +
      '<label>Tedarikçi<input name="ted" list="tedList"' + v(u && u.ted) + '><datalist id="tedList">' +
      Object.keys(teds).sort().map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist></label>' +
      '<div class="two"><label>Alış fiyatı (KDV hariç, ₺)<input name="alis" type="number" min="0" step="0.01" inputmode="decimal"' + v(u && (u.alis || '')) + '></label>' +
      '<label>Satış fiyatı (KDV dahil, ₺)<input name="fiyat" type="number" min="0" step="0.01" inputmode="decimal"' + v(u && (u.fiyat || '')) + '></label></div>' +
      '<p class="muted">Satış fiyatını boş bırakırsanız Excel’deki formülle hesaplanır: alış × 1,2 × 2 × 1,2</p>' +
      (u ? '<label>Ölçü<input name="olcu"' + v(u.olcu) + '></label>' : '') +
      '<label>Kategori<select name="kat">' + katOpts + '</select></label>' +
      '<label>Görseller (fotoğraf çekebilir veya galeriden seçebilirsiniz)<input name="img" type="file" accept="image/*" multiple></label>' +
      '<div class="previews" id="previews"></div>' +
      '<div class="form-acts"><button class="btn" type="submit">' + (u ? 'Değişiklikleri kaydet' : 'Ürünü ekle') + '</button>' +
      (u ? '<a class="btn ghost" href="#/urun/' + u.id + '">Vazgeç</a>' : '') + '</div></form>';
  }
  function urunFormuBagla(u) {
    var form = document.getElementById('urunForm');
    var mevcut = u ? u.img.slice() : [], yeni = [], hazir = Promise.resolve();
    var box = document.getElementById('previews');
    function onizle() {
      box.innerHTML = mevcut.map(function (f, i) {
        return '<span><img src="' + imgSrc(f, 'k') + '" alt=""><button type="button" data-m="' + i + '" aria-label="Görseli kaldır">×</button></span>';
      }).join('') + yeni.map(function (g, i) {
        return '<span><img src="' + g.url + '" alt=""><button type="button" data-y="' + i + '" aria-label="Görseli kaldır">×</button></span>';
      }).join('');
      box.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { mevcut.splice(+b.dataset.m, 1); onizle(); }; });
      box.querySelectorAll('[data-y]').forEach(function (b) { b.onclick = function () { yeni.splice(+b.dataset.y, 1); onizle(); }; });
    }
    onizle();
    form.img.onchange = function () {
      hazir = Promise.all(Array.prototype.map.call(form.img.files, gorselHazirla)).then(function (list) {
        yeni = yeni.concat(list);
        form.img.value = '';
        onizle();
      }).catch(function (e) { alert(e.message || 'Görsel okunamadı'); });
    };
    form.alis.oninput = function () {
      var a = parseFloat(form.alis.value) || 0;
      form.fiyat.placeholder = a ? (a * 1.2 * 2 * 1.2).toFixed(2) : '';
    };
    form.onsubmit = function (e) {
      e.preventDefault();
      var ad = form.ad.value.replace(/\s+/g, ' ').trim();
      var a = parseFloat(form.alis.value) || 0;
      var kat = form.kat.value ? form.kat.value.split('|') : kategoriBul(ad);
      if (!kat) { alert('Kategori otomatik bulunamadı, lütfen listeden seçin.'); return; }
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Kaydediliyor…';
      hazir.then(function () { return Promise.all(yeni.map(gorselYukle)); }).then(function (adlar) {
        var satir = {
          ad: ad, kod: form.kod.value.trim(), barkod: form.barkod.value.trim(), tedarikci: form.ted.value.trim(),
          olcu: u ? form.olcu.value.trim() : olcuBul(ad),
          alis: Math.round(a * 100) / 100, alis_kdv: Math.round(a * 120) / 100,
          fiyat: Math.round((form.fiyat.value !== '' ? parseFloat(form.fiyat.value) || 0 : a * 1.2 * 2 * 1.2) * 100) / 100,
          kat: kat[0], alt: kat[1], gorseller: mevcut.concat(adlar)
        };
        return u
          ? sb.from('urunler').update(satir).eq('id', u.id).then(hata).then(function () { return u.id; })
          : sb.from('urunler').insert(satir).select('id').single().then(hata).then(function (d) { return d.id; });
      }).then(function (id) { yenile('#/urun/' + id); })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = u ? 'Değişiklikleri kaydet' : 'Ürünü ekle';
          alert(err.message);
        });
    };
  }

  function viewEdit(id) {
    var u = byId[id];
    if (!u) { app.innerHTML = '<p class="empty">Ürün bulunamadı. <a href="#/">Kataloğa dön</a></p>'; return; }
    app.innerHTML = '<div class="narrow admin tek"><p class="crumbs"><a href="#/urun/' + u.id + '">← ' + esc(u.ad) + '</a></p>' +
      urunFormu(u) + '</div>';
    urunFormuBagla(u);
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- yönetim
  function viewAdmin() {
    app.innerHTML = '<div class="narrow admin"><h1>Yönetim</h1>' +
      '<div class="admin-grid">' +
      '<div>' + urunFormu(null) +

      '<form class="panel mt" id="katForm"><h2>Kategori ekle</h2>' +
      '<label>Nereye eklensin?<select name="ana"><option value="">Yeni ana kategori olarak</option>' +
      DATA.kategoriler.map(function (k) {
        return '<option value="' + k.slug + '">“' + esc(k.ad) + '” altına alt kategori olarak</option>';
      }).join('') + '</select></label>' +
      '<label>Kategori adı *<input name="ad" required placeholder="ör. Halı & Kilim"></label>' +
      '<div class="form-acts"><button class="btn" type="submit">Kategoriyi ekle</button></div></form></div>' +

      '<div class="panel"><h2>Ürün düzenle / sil</h2>' +
      '<input id="delQ" type="search" placeholder="Ürünü ad, kod veya barkod ile arayın…">' +
      '<div id="delList" class="del-list"><p class="muted">Aramak için yazmaya başlayın. Ürünü detay sayfasından da düzenleyip silebilirsiniz.</p></div>' +
      '<h2 class="mt">Silinen ürünler</h2><div id="silList" class="del-list"></div>' +
      '</div></div></div>';

    urunFormuBagla(null);

    var kf = document.getElementById('katForm');
    kf.onsubmit = function (e) {
      e.preventDefault();
      var ad = kf.ad.value.replace(/\s+/g, ' ').trim(), sl = slugYap(ad), ana = kf.ana.value;
      if (!sl) return;
      var is;
      if (ana) {
        var k = katBySlug[ana];
        if (k.alt.some(function (a) { return a.slug === sl; })) { alert('Bu alt kategori zaten var.'); return; }
        is = sb.from('alt_kategoriler').insert({ kat: ana, slug: sl, ad: ad, sira: k.alt.length + 1 }).then(hata);
      } else {
        if (katBySlug[sl]) { alert('Bu kategori zaten var.'); return; }
        var sira = DATA.kategoriler.reduce(function (m, x) { return Math.max(m, x.sira || 0); }, 0) + 1;
        is = sb.from('kategoriler').insert({ slug: sl, ad: ad, sira: sira }).then(hata).then(function () {
          return sb.from('alt_kategoriler').insert({ kat: sl, slug: sl, ad: ad, sira: 1 }).then(hata);
        });
      }
      kf.querySelector('button').disabled = true;
      is.then(function () { yenile(listHash({ k: ana || sl, a: ana ? sl : '' })); })
        .catch(function (err) { kf.querySelector('button').disabled = false; alert(err.message); });
    };

    function satir(u) {
      return '<div class="del-row">' + (u.img[0] ? '<img src="' + imgSrc(u.img[0], 'k') + '" alt="">' : '<span class="ph"></span>') +
        '<a href="#/urun/' + u.id + '"><b>' + esc(u.ad) + '</b><small>' + esc(u.kod) + '</small></a>' +
        '<a class="btn small ghost" href="#/duzenle/' + u.id + '">Düzenle</a>' +
        '<button class="btn small danger" data-del="' + u.id + '">Sil</button></div>';
    }
    var dq = document.getElementById('delQ'), dl = document.getElementById('delList');
    dq.oninput = function () {
      var toks = norm(dq.value).split(/\s+/).filter(Boolean);
      if (!toks.length) { dl.innerHTML = ''; return; }
      var res = DATA.urunler.filter(function (u) { return toks.every(function (t) { return u._s.indexOf(t) >= 0; }); });
      dl.innerHTML = res.length ? res.slice(0, 30).map(satir).join('') +
        (res.length > 30 ? '<p class="muted">' + (res.length - 30) + ' sonuç daha var, aramayı daraltın.</p>' : '')
        : '<p class="muted">Sonuç yok.</p>';
      dl.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () { urunSil(byId[+b.dataset.del], '#/yonetim'); };
      });
    };

    var sl = document.getElementById('silList');
    var list = DATA.silinen.slice().sort(function (a, b) { return a.silindi < b.silindi ? 1 : -1; });
    sl.innerHTML = list.length ? list.map(function (x) {
      return '<div class="del-row">' + (x.img[0] ? '<img src="' + imgSrc(x.img[0], 'k') + '" alt="">' : '<span class="ph"></span>') +
        '<span class="grow"><b>' + esc(x.ad) + '</b><small>' + esc(x.kod) + ' · ' + trDate(String(x.silindi).slice(0, 10)) +
        '</small></span><button class="btn small ghost" data-geri="' + x.id + '">Geri al</button></div>';
    }).join('') : '<p class="muted">Silinen ürün yok.</p>';
    sl.querySelectorAll('[data-geri]').forEach(function (b) {
      b.onclick = function () {
        b.disabled = true;
        sb.from('urunler').update({ silindi: null }).eq('id', +b.dataset.geri).then(hata)
          .then(function () { yenile('#/yonetim'); })
          .catch(function (e) { b.disabled = false; alert(e.message); });
      };
    });
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ giriş
  function epostaYap(kullanici) {
    var k = kullanici.trim();
    return k.indexOf('@') > 0 ? k : norm(k).replace(/[^a-z0-9._-]/g, '') + '@' + (CFG.girisAlani || 'gokhanabi-katalog.com');
  }
  function viewLogin() {
    delete document.documentElement.dataset.giris;
    app.innerHTML = '<form class="panel login" id="loginForm"><h1>Giriş</h1>' +
      '<label>Kullanıcı adı<input name="k" required autocomplete="username" autocapitalize="none"></label>' +
      '<label>Şifre<input name="s" type="password" required autocomplete="current-password"></label>' +
      '<p class="err" id="loginErr"></p>' +
      '<div class="form-acts"><button class="btn" type="submit">Giriş yap</button></div></form>';
    var f = document.getElementById('loginForm');
    f.onsubmit = function (e) {
      e.preventDefault();
      var b = f.querySelector('button');
      b.disabled = true;
      sb.auth.signInWithPassword({ email: epostaYap(f.k.value), password: f.s.value }).then(function (r) {
        if (r.error) throw r.error;
        basla();
      }).catch(function () {
        b.disabled = false;
        document.getElementById('loginErr').textContent = 'Kullanıcı adı veya şifre hatalı.';
      });
    };
  }
  function basla() {
    document.documentElement.dataset.giris = '1';
    app.innerHTML = '<p class="empty">Katalog yükleniyor…</p>';
    veriYukle().then(function () {
      cart = cart.filter(function (c) { return byId[c.id]; });
      saveCart();
      lastHash = null;
      route();
    }).catch(function (e) {
      app.innerHTML = '<p class="empty">Veriler yüklenemedi: ' + esc(e.message) +
        '<br><button class="btn ghost" onclick="location.reload()">Tekrar dene</button></p>';
    });
  }

  // ------------------------------------------------------------------ genel
  function setBrand() {
    var f = store('pfFirma') || {};
    document.getElementById('brandName').textContent = f.ad || 'Ürün Kataloğu';
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-add]');
    if (b) addToCart(+b.dataset.add, 1);
  });
  document.getElementById('searchForm').onsubmit = function (e) {
    e.preventDefault();
    var r = parseHash();
    var onList = !r.path.length;
    location.hash = listHash({ k: onList ? r.q.k : '', q: document.getElementById('q').value.trim() });
  };
  var typeT;
  document.getElementById('q').oninput = function () {
    clearTimeout(typeT);
    typeT = setTimeout(function () {
      var r = parseHash();
      if (r.path.length) return;       // yalnızca liste görünümünde anlık ara
      var h = listHash({ k: r.q.k, a: r.q.a, s: r.q.s, q: document.getElementById('q').value.trim() });
      if (h !== location.hash) history.replaceState(null, '', h), route();
    }, 250);
  };

  document.getElementById('cikis').onclick = function (e) {
    e.preventDefault();
    sb.auth.signOut().then(function () { location.hash = '#/'; location.reload(); });
  };
  window.addEventListener('hashchange', function () {
    if (document.documentElement.dataset.giris) route();
  });
  setBrand();

  // başlangıç: oturum varsa kataloğu yükle, yoksa giriş ekranı
  if (!CFG.url || !CFG.anahtar || !window.supabase) {
    app.innerHTML = '<p class="empty">Kurulum tamamlanmadı: <b>config.js</b> içine Supabase adresi ve anahtarı yazılmalı.</p>';
  } else {
    sb = window.supabase.createClient(CFG.url, CFG.anahtar);
    sb.auth.getSession().then(function (r) {
      if (r.data && r.data.session) basla(); else viewLogin();
    });
  }
})();
