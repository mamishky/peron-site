// Peron web · Akademi: giriş, okuma, harita, arama, makale ekleme ve düzenleme, içe aktarma, hat yönetimi.
// Veri: Supabase 'academies' satırı (tek JSON). Yazma her zaman mutate() ile: sunucudaki en güncel kaydı okur,
// değişikliği uygular, kayıt değişmediyse yazar (telefon araya yazdıysa yeniden okuyup dener).
(function () {
  'use strict';
  var db = window.supabase.createClient('https://arxwwekjxgrgyruopvzp.supabase.co', 'sb_publishable_sPMEqz96nenj0LYJyGUB8g_4YeLFx-Z');
  var root = document.getElementById('uygulama');
  var state = { data: null, line: null, paper: null, uid: null, view: 'liste', labels: true, q: '' };
  try { state.labels = localStorage.getItem('akademiHaritaEtiket') !== '0'; } catch (e) {}
  var PALETTE = ['#d9a21b', '#2f7d50', '#2c4f9b', '#8a5734', '#4b98c4', '#a6435c', '#7a4f9a', '#2b8a8a'];
  var PREFIXES = ['TEZ:', 'LİTERATÜR:', 'DERS:', 'PROJE:', 'MAKALE:'];
  var KIND_LIST = [['makale', 'Makale'], ['bildiri', 'Bildiri'], ['bolum', 'Kitap bölümü'], ['kitap', 'Kitap'], ['tez', 'Tez'], ['rapor', 'Rapor'], ['proje', 'Proje']];

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k]; else if (k === 'text') n.textContent = attrs[k]; else if (k === 'value') n.value = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]); else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function toast(l1, l2) {
    var t = el('div', { class: 'tost' }, [l1, el('small', { text: l2 || '' })]);
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 1300);
  }
  function tint(hex) { return hex || '#6e6350'; }
  function hex7() { var s = ''; for (var i = 0; i < 7; i++) s += Math.floor(Math.random() * 16).toString(16); return s; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function emptyData() { return { papers: [], lines: [], backs: {} }; }
  function normData(d) { d = d || emptyData(); d.papers = d.papers || []; d.lines = d.lines || []; d.backs = d.backs || {}; return d; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function who(p, lis) {
    var l = (lis || p.authors || []).map(function (a) { return a.name || (a.given ? a.given + ' ' + a.family : a.family); });
    return l.join(', ');
  }

  // ---- Yazma: sunucudaki en güncel kaydı oku, fn(data) ile değiştir, kayıt değişmediyse yaz.
  // fn her denemede baştan çalışır, yalnızca verilen data'ya dokunmalı. Hata fırlatırsa yazılmaz.
  function mutate(fn, attempt) {
    attempt = attempt || 0;
    if (attempt > 3) return Promise.reject(new Error('busy'));
    return db.from('academies').select('data,stamp').eq('user_id', state.uid).maybeSingle().then(function (q) {
      if (q.error) throw new Error('network');
      var row = q.data, data = normData(row && row.data);
      var result = fn(data);
      var stamp = Date.now() / 1000; if (row && stamp <= row.stamp + 0.05) stamp = row.stamp + 0.05;
      var done = function () { state.data = data; refreshShares(); return result; };
      if (!row) {
        return db.from('academies').insert({ user_id: state.uid, data: data, stamp: stamp }).then(function (r) {
          if (r.error) return mutate(fn, attempt + 1);
          return done();
        });
      }
      // Kesin eşitlik yerine ±0,01 sn aralığı: ondalık sayı sunucuda kesinlik kaybedebilir, telefon yazışları saniyelerce uzaktır.
      return db.from('academies').update({ data: data, stamp: stamp }).eq('user_id', state.uid)
        .gte('stamp', row.stamp - 0.01).lte('stamp', row.stamp + 0.01).select('stamp').then(function (r) {
          if (r.error) throw new Error('network');
          if (!r.data || !r.data.length) return mutate(fn, attempt + 1);
          return done();
        });
    });
  }
  function errText(e) {
    var m = e && e.message;
    return m === 'busy' ? 'Kayıt başka yerden değişiyor. Yeniden dene.' : m === 'network' ? 'Bağlantı kurulamadı. Biraz sonra yeniden dene.' :
      m === 'dup' ? 'Bu makale zaten akademinde.' : m === 'limit' ? 'Sınıra ulaşıldı.' : 'Kaydedilemedi. Bağlantını kontrol edip yeniden dene.';
  }
  function fail(e) { toast('HATA', errText(e)); }
  function pById(data, id) { return data.papers.filter(function (p) { return p.id === id; })[0]; }
  function lById(data, id) { return data.lines.filter(function (l) { return l.id === id; })[0]; }

  var ops = {
    addPaper: function (paper, lineIDs) {
      return mutate(function (data) {
        var dup = PA.findDuplicate(data, paper);
        if (dup) { var e = new Error('dup'); e.paper = dup; throw e; }
        var p = clone(paper); p.added = today(); p.status = p.status || 'toread';
        data.papers.push(p);
        (lineIDs || []).forEach(function (id) { var l = lById(data, id); if (l) { l.stops = l.stops || []; if (l.stops.indexOf(p.id) < 0) l.stops.push(p.id); } });
        return p;
      });
    },
    updatePaper: function (id, patch) {
      return mutate(function (data) {
        var p = pById(data, id); if (!p) throw new Error('missing');
        Object.keys(patch).forEach(function (k) { if (patch[k] === undefined || patch[k] === null || patch[k] === '' || (Array.isArray(patch[k]) && !patch[k].length)) delete p[k]; else p[k] = patch[k]; });
        return p;
      });
    },
    deletePaper: function (id) {
      return mutate(function (data) {
        data.papers = data.papers.filter(function (p) { return p.id !== id; });
        data.lines.forEach(function (l) { l.stops = (l.stops || []).filter(function (s) { return s !== id; }); });
        delete data.backs[id];
      });
    },
    setLines: function (id, ids) {
      return mutate(function (data) {
        data.lines.forEach(function (l) {
          l.stops = l.stops || []; var has = l.stops.indexOf(id) >= 0, want = ids.indexOf(l.id) >= 0;
          if (want && !has) l.stops.push(id); else if (!want && has) l.stops = l.stops.filter(function (s) { return s !== id; });
        });
      });
    },
    trip: function (id, fields) {
      return mutate(function (data) {
        var p = pById(data, id); if (!p) throw new Error('missing');
        ['status', 'dep', 'date', 'stars'].forEach(function (k) { if (k in fields) { if (fields[k] === null || fields[k] === '' || fields[k] === 0 && k === 'stars') delete p[k]; else p[k] = fields[k]; } });
        if (!('stars' in fields) && fields.status !== 'read') delete p.stars;
      });
    },
    note: function (id, text) {
      return mutate(function (data) {
        var b = data.backs[id] || { quotes: [] }; b.quotes = b.quotes || [];
        var t = String(text || '').slice(0, 4000);
        if (t.trim()) b.note = t; else delete b.note;
        if (!b.quotes.length && !b.note) delete data.backs[id]; else data.backs[id] = b;
      });
    },
    quote: function (id, q) {
      return mutate(function (data) {
        var b = data.backs[id] || { quotes: [] }; b.quotes = b.quotes || [];
        var i = -1; b.quotes.forEach(function (x, k) { if (x.id === q.id) i = k; });
        var rec = { id: q.id, text: String(q.text).slice(0, 1200) }; if (q.page) rec.page = q.page;
        if (i >= 0) b.quotes[i] = rec; else if (b.quotes.length < 10) b.quotes.push(rec); else throw new Error('limit');
        data.backs[id] = b;
      });
    },
    deleteQuote: function (id, qid) {
      return mutate(function (data) {
        var b = data.backs[id]; if (!b) return;
        b.quotes = (b.quotes || []).filter(function (x) { return x.id !== qid; });
        if (!b.quotes.length && !(b.note || '').trim()) delete data.backs[id];
      });
    },
    newLine: function (name, color) {
      var id = 'h-' + hex7();
      return mutate(function (data) { data.lines.push({ id: id, name: name, color: color, stops: [] }); return id; });
    },
    saveLine: function (id, name, color) {
      return mutate(function (data) { var l = lById(data, id); if (!l) throw new Error('missing'); l.name = name; l.color = color; });
    },
    deleteLine: function (id) {
      var code;
      return mutate(function (data) {
        var s = data.shares && data.shares[id]; code = s && s.code;
        data.lines = data.lines.filter(function (l) { return l.id !== id; });
        if (data.shares) delete data.shares[id];
      }).then(function () { return code ? db.from('shared_lines').delete().eq('code', code).then(function () {}, function () {}) : null; });
    },
    moveStop: function (lineID, pid, delta) {
      return mutate(function (data) {
        var l = lById(data, lineID); if (!l) return; var s = l.stops || [], i = s.indexOf(pid), j = i + delta;
        if (i < 0 || j < 0 || j >= s.length) return;
        s.splice(i, 1); s.splice(j, 0, pid);
      });
    },
    removeStop: function (lineID, pid) {
      return mutate(function (data) { var l = lById(data, lineID); if (l) l.stops = (l.stops || []).filter(function (s) { return s !== pid; }); });
    },
    stopShare: function (lineID) {
      var code;
      return mutate(function (data) { var s = data.shares && data.shares[lineID]; code = s && s.code; if (data.shares) delete data.shares[lineID]; })
        .then(function () { return code ? db.from('shared_lines').delete().eq('code', code).then(function () {}, function () {}) : null; });
    },
    // records: [{paper, groups, note}], opts: {target: lineID|null, newLineName, openFromGroups}
    importRecords: function (records, opts) {
      return mutate(function (data) {
        var res = { added: 0, skipped: 0, lines: 0 }, byName = {};
        data.lines.forEach(function (l) { byName[String(l.name).toLowerCase()] = l; });
        var target = opts.target && lById(data, opts.target);
        if (opts.newLineName) {
          target = { id: 'h-' + hex7(), name: opts.newLineName, color: PALETTE[data.lines.length % PALETTE.length], stops: [] };
          data.lines.push(target); byName[target.name.toLowerCase()] = target; res.lines++;
        }
        records.forEach(function (r) {
          var id, dup = PA.findDuplicate(data, r.paper);
          if (dup) { id = dup.id; res.skipped++; }
          else {
            var p = clone(r.paper); p.added = today(); p.status = 'toread'; data.papers.push(p); id = p.id; res.added++;
            if ((r.note || '').trim()) data.backs[id] = { quotes: [], note: r.note };
          }
          var targets = [];
          (r.groups || []).forEach(function (g) {
            var l = byName[g.toLowerCase()];
            if (!l && opts.openFromGroups) { l = { id: 'h-' + hex7(), name: g, color: PALETTE[data.lines.length % PALETTE.length], stops: [] }; data.lines.push(l); byName[g.toLowerCase()] = l; res.lines++; }
            if (l) targets.push(l);
          });
          if (!targets.length && target) targets.push(target);
          targets.forEach(function (l) { l.stops = l.stops || []; if (l.stops.indexOf(id) < 0) l.stops.push(id); });
        });
        return res;
      });
    }
  };


  // ---- Hat paylaşma (Swift: ShareLine.swift ile aynı): herkese açık kopya shared_lines tablosunda durur.
  var CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  function snapshotOf(data, line, notes) {
    var ps = (line.stops || []).map(function (id) { return pById(data, id); }).filter(Boolean).map(function (p) {
      var q = clone(p); q.stars = 0; delete q.dep; delete q.date; delete q.userURL; delete q.added; return q;
    });
    var snap = { name: line.name, color: line.color, papers: ps };
    if (notes) { var b = {}; ps.forEach(function (p) { var x = data.backs[p.id]; if (x && ((x.quotes || []).length || (x.note || '').trim())) b[p.id] = x; }); snap.backs = b; }
    return snap;
  }
  function newCode(len) { var c = ''; for (var i = 0; i < len; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]; return c; }
  // Sahip bir şey değiştirince herkese açık kopya da yenilenir (en iyi çaba)
  function refreshShares() {
    var d = state.data; if (!d || !d.shares) return;
    d.lines.forEach(function (l) {
      var s = d.shares[l.id]; if (!s || !s.code) return;
      db.from('shared_lines').update({ snapshot: snapshotOf(d, l, !!s.notes) }).eq('code', s.code).then(function () {}, function () {});
    });
  }
  ops.startShare = function (lineID, notes) {
    var made = null;
    function attempt(i) {
      var codeLen = [6, 6, 7][i]; if (!codeLen) return Promise.reject(new Error('network'));
      var code = newCode(codeLen), data = state.data, line = lById(data, lineID); if (!line) return Promise.reject(new Error('missing'));
      return db.from('shared_lines').insert({ code: code, owner: state.uid, line_id: lineID, snapshot: snapshotOf(data, line, notes), notes_open: notes }).then(function (r) {
        if (r.error) return attempt(i + 1);
        made = code; return code;
      });
    }
    return attempt(0).then(function (code) {
      return mutate(function (d) { d.shares = d.shares || {}; d.shares[lineID] = { code: code, notes: !!notes }; }).then(function () { return code; }, function (e) {
        db.from('shared_lines').delete().eq('code', code).then(function () {}, function () {}); throw e; });
    });
  };
  ops.shareNotes = function (lineID, on) {
    var code;
    return mutate(function (d) { var s = d.shares && d.shares[lineID]; if (!s) throw new Error('missing'); s.notes = !!on; code = s.code; }).then(function () {
      return db.from('shared_lines').update({ notes_open: !!on }).eq('code', code).then(function () { refreshShares(); });
    });
  };

  // ---- Pencere (modal)
  var openModals = [];
  function modal(label, heading, kids, opts) {
    opts = opts || {};
    var perde = el('div', { class: 'perde' });
    var win = el('div', { class: 'pencere' + (opts.wide ? ' genis' : ''), role: 'dialog', 'aria-label': heading }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [el('div', { class: 'etiket', text: label }), el('button', { class: 'kapat', text: 'Vazgeç', onclick: close })]),
      el('h2', { class: 'eser', text: heading, style: 'font-size:30px;margin:4px 0 12px' })].concat(kids));
    function close() { perde.remove(); document.removeEventListener('keydown', esc); openModals = openModals.filter(function (m) { return m !== close; }); }
    function esc(e) { if (e.key === 'Escape' && openModals[openModals.length - 1] === close) close(); }
    document.addEventListener('keydown', esc); openModals.push(close);
    perde.addEventListener('mousedown', function (e) { if (e.target === perde && !opts.sticky) close(); });
    perde.appendChild(win); document.body.appendChild(perde);
    return { close: close, win: win };
  }
  function askConfirm(heading, text, okText, onOk) {
    var m = modal('Emin misin', heading, [
      el('p', { text: text, style: 'margin:0 0 16px' }),
      el('div', { style: 'display:flex;gap:8px' }, [
        el('button', { class: 'dugme', text: okText, onclick: function () { m.close(); onOk(); } }),
        el('button', { class: 'dugme bos', text: 'Vazgeç', onclick: function () { m.close(); } })])]);
  }
  function field(label, input, hint) {
    return el('label', { class: 'alan' }, [el('span', { class: 'etiket', text: label }), input, hint ? el('small', { class: 'soluk', text: hint }) : null]);
  }
  // İşlem düğmesi: bitene kadar kapalı, hata olursa mesaj yazar
  function run(btn, msgEl, job, ok) {
    var label = btn.textContent; btn.disabled = true; btn.textContent = 'Kaydediliyor…'; if (msgEl) msgEl.textContent = '';
    job().then(function (r) { btn.disabled = false; btn.textContent = label; ok(r); }, function (e) {
      btn.disabled = false; btn.textContent = label;
      if (msgEl) msgEl.textContent = errText(e); else fail(e);
    });
  }

  // ---- Giriş
  function appleLogin() {
    db.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: location.origin + location.pathname } }).then(function (r) {
      if (r.error) showLogin('Apple ile giriş başlatılamadı. Biraz sonra yeniden dene.');
    });
  }
  function showLogin(msg) {
    document.getElementById('hesap').textContent = ''; document.getElementById('damga').hidden = true;
    var email = el('input', { type: 'email', autocomplete: 'username', inputmode: 'email', placeholder: 'e-posta' });
    var pass = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'şifre' });
    var err = el('p', { class: 'hata', text: msg || '' });
    var go = el('button', { class: 'dugme', text: 'Giriş yap', style: 'width:100%' });
    function submit() {
      go.disabled = true; err.textContent = '';
      db.auth.signInWithPassword({ email: email.value.trim(), password: pass.value }).then(function (r) {
        go.disabled = false;
        if (r.error) { err.textContent = 'E-posta ya da şifre yanlış.'; return; }
        load();
      });
    }
    go.addEventListener('click', submit);
    pass.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    root.replaceChildren(el('form', { class: 'giris', onsubmit: function (e) { e.preventDefault(); } }, [
      el('div', { class: 'etiket', text: 'Aynı hesapla gir' }),
      el('h1', { class: 'eser', text: 'Peron Akademi', style: 'font-size:34px;margin:6px 0 4px' }),
      el('p', { class: 'italik soluk', text: 'Hatlarını, biletlerini ve alıntılarını bilgisayarda gör, düzenle. DOI yapıştırarak ya da dosyadan makale ekle.', style: 'font-size:18px;margin:0 0 20px' }),
      email, pass, go, err,
      el('div', { class: 'etiket', text: 'ya da', style: 'text-align:center;margin:14px 0 10px' }),
      el('button', { class: 'dugme bos', type: 'button', style: 'width:100%', text: 'Apple ile gir', onclick: appleLogin }),
      el('p', { class: 'soluk', text: 'Apple ile üye olduysan aynı hesaba girersin. Girişte bir sorun olursa uygulamadan Şifremi unuttum ile bir şifre de belirleyebilirsin.', style: 'font-size:12px;margin-top:14px' })
    ]));
  }

  // ---- Veri
  function load() {
    db.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      if (!s) { showLogin(); return; }
      state.uid = s.user.id;
      document.getElementById('hesap').textContent = s.user.email + ' · ';
      var out = el('a', { href: '#', text: 'çıkış', onclick: function (e) { e.preventDefault(); db.auth.signOut().then(function () { showLogin(); }); } });
      document.getElementById('hesap').appendChild(out);
      document.getElementById('damga').hidden = false;
      db.from('academies').select('data').eq('user_id', s.user.id).maybeSingle().then(function (q) {
        if (q.error) { root.replaceChildren(el('p', { class: 'hata', text: 'Akademi okunamadı. Sayfayı yenile.', style: 'padding:32px' })); return; }
        state.data = normData(q.data && q.data.data);
        state.line = state.data.lines.length ? state.data.lines[0].id : null; state.paper = null;
        render();
      });
    });
  }

  function paperById(id) { return state.data.papers.filter(function (p) { return p.id === id; })[0]; }
  function linesOf(p) { return state.data.lines.filter(function (l) { return (l.stops || []).indexOf(p.id) >= 0; }); }
  function papersIn(l) { return (l.stops || []).map(paperById).filter(Boolean); }
  function unlined() { var on = {}; state.data.lines.forEach(function (l) { (l.stops || []).forEach(function (s) { on[s] = 1; }); }); return state.data.papers.filter(function (p) { return !on[p.id]; }); }
  function fileName(ext, name) { return 'peron-' + (name || 'akademi').toLowerCase().replace(/[^a-z0-9çğıöşü]+/gi, '-').replace(/^-|-$/g, '') + '-' + new Date().toISOString().slice(0, 10) + '.' + ext; }
  function linesNames(p) { return linesOf(p).map(function (l) { return l.name; }); }
  function refresh() { if (state.view === 'harita') render(); else render(); }

  // ---- Arama: başlık, yazar, dergi, DOI, yıl, hat adı, alıntı ve notlarda. Türkçe harf ve büyük/küçük harf farkı yok sayılır.
  function norm(s) { return String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function search(q) {
    var terms = norm(q).split(/\s+/).filter(Boolean); if (!terms.length) return [];
    var out = [];
    state.data.papers.forEach(function (p) {
      var back = state.data.backs[p.id] || {};
      var core = norm([p.title, who(p), who(p, p.editors), p.container, p.publisher, p.doi, p.year, linesNames(p).join(' ')].join(' '));
      var deep = norm([(back.quotes || []).map(function (x) { return x.text; }).join(' '), back.note || ''].join(' '));
      var inCore = terms.every(function (t) { return core.indexOf(t) >= 0; });
      var inAll = terms.every(function (t) { return (core + ' ' + deep).indexOf(t) >= 0; });
      if (!inAll) return;
      var snippet = null;
      if (!inCore) {
        var src = ((back.quotes || []).map(function (x) { return x.text; }).concat([back.note || ''])).filter(function (t) { return norm(t).indexOf(terms[0]) >= 0; })[0] || '';
        var at = norm(src).indexOf(terms[0]); snippet = src ? (at > 40 ? '…' : '') + src.slice(Math.max(0, at - 40), at + 80) + '…' : null;
      }
      out.push({ paper: p, snippet: snippet });
    });
    return out;
  }

  // ---- Harita (Swift: AcademyMapView)
  var SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, kids) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k]; else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]); else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function wrapTitle(t, max) {
    var words = String(t).split(/\s+/), lines = [''];
    words.forEach(function (w) {
      var cur = lines[lines.length - 1];
      if ((cur + ' ' + w).trim().length <= max) lines[lines.length - 1] = (cur + ' ' + w).trim();
      else if (lines.length < 2) lines.push(w); else lines[1] = lines[1].replace(/…$/, '') + '…';
    });
    if (lines[1] && lines[1].length > max) lines[1] = lines[1].slice(0, max - 1) + '…';
    return lines;
  }
  function renderMap() {
    var d = state.data, m = PA.mapLayout(d), year = new Date().getFullYear();
    var dark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
    function col(l) { var c = l.color || '#6e6350'; return dark ? PA.mixHex(c, 0.35) : c; }
    var LW = 190, RH = 72, TOP = 58, SIDE = 28;
    function x(lane) { return SIDE + LW * lane + 30; }
    function y(row) { return TOP + row * RH + 14; }
    var W = Math.max(m.lines.length * LW + SIDE * 2, 420), H = TOP + Math.max(m.rows, 1) * RH + (m.unlined.length ? 130 : 24);
    var svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'group', 'aria-label': 'Akademi haritası', style: 'display:block' });
    var onWay = d.papers.filter(function (p) { return p.status === 'reading'; });
    var transfers = d.papers.filter(function (p) { return linesOf(p).length > 1; }).length;
    var stateOf = function (p) { return p.status === 'read' ? 'arrived' : p.status === 'reading' ? 'onway' : 'toread'; };

    // şeritler
    m.lines.forEach(function (l, li) {
      var pts = l.stops.map(function (id) { return m.nodes.filter(function (n) { return n.paper.id === id; })[0]; }).filter(Boolean);
      if (pts.length > 1) svg.appendChild(sv('path', { d: pts.map(function (n, i) { return (i ? 'L' : 'M') + x(li) + ' ' + y(n.row); }).join(' '), fill: 'none', stroke: col(l), 'stroke-width': 6 }));
      svg.appendChild(sv('text', { x: x(li) - 26, y: 24, text: PA.up((l.name || '').split(':')[0]), fill: col(l), style: "font:700 12px 'Archivo Narrow',sans-serif;letter-spacing:.1em" }));
    });
    // duraklar
    m.nodes.forEach(function (n) {
      var xs = n.lanes.map(function (z) { return x(z.lane); }), minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), cy = y(n.row), st = stateOf(n.paper);
      var g = sv('g', { tabindex: 0, role: 'button', 'aria-label': n.paper.title, style: 'cursor:pointer;outline:none' });
      var pick = function () { state.paper = n.paper.id; state.line = m.lines[n.lanes[0].lane].id; keepScroll(); renderMap(); };
      g.addEventListener('click', pick); g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      if (state.paper === n.paper.id) g.appendChild(sv('rect', { x: minX - 24, y: cy - 24, width: maxX - minX + 48, height: 48, rx: 24, fill: 'none', stroke: 'var(--murekkep)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
      g.appendChild(sv('rect', { x: minX - 22, y: cy - 22, width: maxX - minX + 44, height: 44, fill: 'transparent' }));
      if (n.transfer) {
        g.appendChild(sv('rect', { x: minX - 15, y: cy - 15, width: maxX - minX + 30, height: 30, rx: 15, fill: 'var(--kagit-acik)', stroke: st === 'onway' ? 'var(--mavi)' : 'var(--murekkep)', 'stroke-width': 3 }));
        n.lanes.forEach(function (z) {
          var l = m.lines[z.lane], arrived = st === 'arrived';
          g.appendChild(sv('circle', { cx: x(z.lane), cy: cy, r: 9, fill: arrived ? col(l) : 'var(--kagit-acik)', stroke: arrived ? 'none' : col(l), 'stroke-width': 2.5 }));
          g.appendChild(sv('text', { x: x(z.lane), y: cy + 3.5, 'text-anchor': 'middle', text: String(z.no), fill: arrived ? PA.textOn(col(l)) : 'var(--murekkep)', style: "font:700 10px 'Courier Prime',monospace" }));
        });
      } else {
        var l0 = m.lines[n.lanes[0].lane], c0 = col(l0), arrived = st === 'arrived';
        g.appendChild(sv('circle', { cx: minX, cy: cy, r: 13, fill: arrived ? c0 : 'var(--kagit)', stroke: arrived ? 'none' : st === 'onway' ? 'var(--mavi)' : c0, 'stroke-width': 3 }));
        g.appendChild(sv('text', { x: minX, y: cy + 4, 'text-anchor': 'middle', text: String(n.lanes[0].no), fill: arrived ? PA.textOn(c0) : st === 'onway' ? 'var(--mavi)' : 'var(--murekkep)', style: "font:700 11px 'Courier Prime',monospace" }));
        if (st === 'onway') g.appendChild(sv('rect', { x: minX + 14, y: cy - 11, width: 12, height: 22, rx: 6, fill: 'var(--mavi)', stroke: 'var(--kagit)', 'stroke-width': 2 }));
      }
      if (state.labels) {
        var lines = wrapTitle(n.paper.title, 24), tx = maxX + 32;
        var t = sv('text', { x: tx, y: cy - (lines.length > 1 ? 5 : -4), fill: st === 'onway' ? 'var(--mavi)' : st === 'arrived' ? 'var(--murekkep)' : 'var(--soluk)', style: "font:700 12px 'Archivo Narrow',sans-serif;pointer-events:none" });
        lines.forEach(function (s, i) { t.appendChild(sv('tspan', { x: tx, dy: i ? 14 : 0, text: s })); });
        g.appendChild(t);
      }
      svg.appendChild(g);
    });
    // hatsızlar
    if (m.unlined.length) {
      var top = H - 118;
      svg.appendChild(sv('rect', { x: 18, y: top, width: W - 36, height: 100, fill: 'none', stroke: 'var(--kenar-soluk)', 'stroke-width': 1.5, 'stroke-dasharray': '5 3' }));
      svg.appendChild(sv('text', { x: 32, y: top + 22, text: 'HATSIZ · ' + m.unlined.length, fill: 'var(--soluk)', style: "font:700 11px 'Archivo Narrow',sans-serif;letter-spacing:.16em" }));
      m.unlined.forEach(function (p, i) {
        var per = Math.max(1, Math.floor((W - 80) / 36)), cx = 40 + (i % per) * 36, cy = top + 52 + Math.floor(i / per) * 30;
        var g = sv('g', { tabindex: 0, role: 'button', 'aria-label': p.title, style: 'cursor:pointer;outline:none' });
        var pick = function () { state.paper = p.id; state.line = '__un'; keepScroll(); renderMap(); };
        g.addEventListener('click', pick); g.addEventListener('keydown', function (e) { if (e.key === 'Enter') pick(); });
        g.appendChild(sv('rect', { x: cx - 18, y: cy - 18, width: 36, height: 36, fill: 'transparent' }));
        g.appendChild(sv('rect', { x: cx - 8, y: cy - 8, width: 16, height: 16, fill: 'var(--kagit)', stroke: state.paper === p.id ? 'var(--murekkep)' : 'var(--soluk)', 'stroke-width': 2 }));
        svg.appendChild(g);
      });
    }

    var cur = state.paper ? paperById(state.paper) : null;
    var scroller = el('div', { class: 'harita-alan', id: 'harita-alan' }, [svg]);
    var legend = el('div', { class: 'cipler', style: 'margin-top:10px' }, d.lines.map(function (l) {
      var ps = papersIn(l), read = ps.filter(function (p) { return p.status === 'read'; }).length;
      return el('span', { class: 'cip', style: 'cursor:default' }, [el('span', { class: 'rozet', style: 'background:' + col(l) + ';width:10px;height:10px;border-radius:50%' }), (l.name || '').split(':')[0], el('small', { class: 'soluk', text: ' ' + read + '/' + ps.length })]);
    }));
    var head = el('div', { class: 'harita-ust' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:12px' }, [
        el('div', {}, [el('div', { class: 'etiket', text: 'Akademi haritası' }),
          el('h1', { class: 'eser', text: 'Akademi ' + year, style: 'font-size:34px;margin:2px 0 4px' }),
          el('div', { class: 'soluk', style: 'font-size:12px', text: d.papers.length + ' DURAK · ' + d.lines.length + ' HAT · ' + transfers + ' AKTARMA · ' + onWay.length + ' YOLDA' })]),
        el('button', { class: 'dugme bos', text: 'Aa', title: 'Durak adları', 'aria-pressed': String(state.labels), style: 'min-width:48px;text-transform:none;font-size:16px;opacity:' + (state.labels ? 1 : .5),
          onclick: function () { state.labels = !state.labels; try { localStorage.setItem('akademiHaritaEtiket', state.labels ? '1' : '0'); } catch (e) {} keepScroll(); renderMap(); } })]),
      legend]);
    var sag = el('aside', { class: 'sag' });
    if (cur) sag.appendChild(detail(cur)); else sag.appendChild(el('p', { class: 'soluk', text: 'Bir durak seç. Bileti burada açılır.' }));
    root.replaceChildren(el('div', { class: 'harita-sayfa' }, [el('section', { class: 'harita-sol' }, [head, scroller]), sag]));
    var a = document.getElementById('harita-alan'); if (a && state.scroll) { a.scrollLeft = state.scroll[0]; a.scrollTop = state.scroll[1]; }
  }
  function keepScroll() { var a = document.getElementById('harita-alan'); if (a) state.scroll = [a.scrollLeft, a.scrollTop]; }
  [].forEach.call(document.querySelectorAll('.sekme[data-v]'), function (b) {
    b.addEventListener('click', function () { state.view = b.getAttribute('data-v'); if (state.data) render(); });
  });
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (state.view === 'harita' && state.data) render(); });


  // ---- Çizim
  var searchInput = el('input', { type: 'search', class: 'ara', placeholder: 'Ara  ( / )', 'aria-label': 'Akademide ara', autocomplete: 'off' });
  searchInput.addEventListener('input', function () { state.q = searchInput.value; if (state.view === 'harita') { state.view = 'liste'; } render(); });
  searchInput.addEventListener('keydown', function (e) { if (e.key === 'Escape') { searchInput.value = ''; state.q = ''; searchInput.blur(); render(); } });

  function render() {
    var d = state.data, had = document.activeElement === searchInput;
    [].forEach.call(document.querySelectorAll('.sekme[data-v]'), function (b) { b.classList.toggle('acik', b.getAttribute('data-v') === state.view); });
    if (state.view === 'harita' && (d.papers.length || d.lines.length)) { renderMap(); return; }
    if (!d.papers.length && !d.lines.length) {
      root.replaceChildren(el('div', { class: 'giris' }, [
        el('h1', { class: 'eser', text: 'Henüz hat yok.', style: 'font-size:34px' }),
        el('p', { class: 'soluk', text: 'Bir DOI yapıştırarak ya da RIS ve BibTeX dosyasından makale ekle. Uygulamada açtığın hatlar burada da görünür.' }),
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
          el('button', { class: 'dugme', text: '+ Makale ekle', onclick: openAdd }),
          el('button', { class: 'dugme bos', text: 'Dosyadan al', onclick: openImport }),
          el('button', { class: 'dugme bos', text: '+ Yeni hat', onclick: function () { openLineForm(null); } })])])); return;
    }
    var year = new Date().getFullYear();
    var arrived = d.papers.filter(function (p) { return p.status === 'read' && String(p.date || '').indexOf(String(year)) === 0; }).length;
    var sol = el('aside', { class: 'sol' }, [
      el('div', { class: 'kart', style: 'padding:10px 12px;transform:rotate(-1.2deg);margin-bottom:10px' }, [
        el('div', { class: 'etiket', text: 'Sefer defteri' }),
        el('div', { style: 'font-weight:700;font-size:12px', text: year + ' · ' + arrived + ' MAKALE · ' + d.lines.length + ' HAT' })]),
      searchInput,
      el('button', { class: 'dugme', text: '+ Makale ekle', onclick: openAdd, style: 'width:100%;margin:8px 0 6px' }),
      el('div', { style: 'display:flex;gap:6px;margin-bottom:8px' }, [
        el('button', { class: 'dugme bos', text: 'İçe aktar', onclick: openImport, style: 'flex:1;padding:0 8px' }),
        el('button', { class: 'dugme bos', text: '+ Hat', onclick: function () { openLineForm(null); }, style: 'flex:1;padding:0 8px' })]),
      el('div', { class: 'etiket', text: 'Hatlar', style: 'margin:6px 0' })
    ]);
    d.lines.forEach(function (l) {
      var ps = papersIn(l), read = ps.filter(function (p) { return p.status === 'read'; }).length, way = ps.filter(function (p) { return p.status === 'reading'; }).length;
      sol.appendChild(el('button', { class: 'hat-satir' + (state.line === l.id && !state.q ? ' secili' : ''), onclick: function () { state.q = ''; searchInput.value = ''; state.line = l.id; state.paper = null; render(); } }, [
        el('span', { class: 'rozet', text: PA.up((l.name || '?').charAt(0)), style: 'background:' + tint(l.color) }),
        el('span', { class: 'hat-ad', text: l.name }),
        el('span', { class: way ? 'mavi' : 'soluk', text: way ? way + ' yolda · ' : '' }),
        el('b', { text: ('0' + read).slice(-2) + '/' + ('0' + ps.length).slice(-2) })]));
    });
    var un = unlined();
    if (un.length) sol.appendChild(el('button', { class: 'hat-satir' + (state.line === '__un' && !state.q ? ' secili' : ''), onclick: function () { state.q = ''; searchInput.value = ''; state.line = '__un'; state.paper = null; render(); } }, [
      el('span', { class: 'rozet', text: '·', style: 'background:var(--soluk)' }), el('span', { class: 'hat-ad', text: 'Hatsız' }), el('b', { text: String(un.length) })]));
    sol.appendChild(el('div', { class: 'etiket', text: 'Tüm akademi', style: 'margin:18px 0 6px' }));
    sol.appendChild(el('div', { style: 'display:flex;gap:6px' }, [
      el('button', { class: 'dugme bos', text: '.ris', onclick: function () { PA.download(fileName('ris'), PA.risFile(d.papers, linesNames, d.backs)); } }),
      el('button', { class: 'dugme bos', text: '.bib', onclick: function () { PA.download(fileName('bib'), PA.bibFile(d.papers, linesNames, d.backs)); } })]));

    var orta = state.q ? resultsView() : lineView();
    var sag = el('aside', { class: 'sag' });
    var cur = state.paper ? paperById(state.paper) : null;
    if (cur) sag.appendChild(detail(cur));
    else sag.appendChild(el('p', { class: 'soluk', text: 'Bir durak seç. Bileti burada açılır.' }));
    root.replaceChildren(el('div', { class: 'izgara' }, [sol, orta, sag]));
    if (had) { searchInput.focus(); try { searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length); } catch (e) {} }
  }

  function stopRow(p, i, line, canMove, snippet) {
    var st = p.status === 'read' ? el('span', { class: 'varis', text: p.date ? PA.stamp(p.date) : 'VARIŞ' }) : p.status === 'reading' ? el('span', { class: 'yolda', text: 'YOLDA' }) : null;
    var open = el('button', { class: 'durak' + (state.paper === p.id ? ' secili' : ''), onclick: function () { state.paper = p.id; if (line) state.line = line.id; render(); } }, [
      el('span', { class: 'no', text: i == null ? '·' : ('0' + (i + 1)).slice(-2) }),
      el('span', {}, [el('span', { class: 'baslik', text: p.title }), el('br'), el('span', { class: 'meta', text: [PA.shortAuthors(p), p.year].filter(Boolean).join(' · ') }),
        snippet ? el('span', { class: 'meta', style: 'display:block;font-style:italic', text: snippet }) : null]), st]);
    if (!canMove) return open;
    var ctrl = el('div', { class: 'siralama' }, [
      el('button', { text: '↑', title: 'Yukarı taşı', 'aria-label': 'Yukarı taşı', onclick: function () { ops.moveStop(line.id, p.id, -1).then(render, fail); } }),
      el('button', { text: '↓', title: 'Aşağı taşı', 'aria-label': 'Aşağı taşı', onclick: function () { ops.moveStop(line.id, p.id, 1).then(render, fail); } }),
      el('button', { text: '×', title: 'Hattan çıkar', 'aria-label': 'Hattan çıkar', onclick: function () { ops.removeStop(line.id, p.id).then(render, fail); } })]);
    return el('div', { class: 'durak-satir' }, [open, ctrl]);
  }

  function resultsView() {
    var res = search(state.q), ps = res.map(function (r) { return r.paper; });
    return el('section', { class: 'orta' }, [
      el('div', { class: 'etiket', text: 'Arama' }),
      el('h1', { text: '“' + state.q + '”', style: "font:700 34px/1.05 'Archivo Narrow',sans-serif;margin:4px 0 6px;word-break:break-word" }),
      el('div', { class: 'italik', style: 'font-size:18px', text: res.length ? res.length + ' sonuç' : 'Sonuç yok. Başlık, yazar, DOI, alıntı ve notlarda arandı.' }),
      res.length ? el('div', { style: 'display:flex;gap:8px;margin:14px 0 18px;flex-wrap:wrap' }, [
        el('button', { class: 'dugme', text: 'Sonuçların kaynakçası · kopyala', onclick: function () { PA.copyRich(PA.bibliography(ps)).then(function () { toast('KOPYALANDI', ps.length + ' KAYNAK'); }); } })]) : null,
      el('div', { style: 'border-top:1.5px solid var(--murekkep)' }, res.map(function (r) { return stopRow(r.paper, null, linesOf(r.paper)[0] || null, false, r.snippet); }))]);
  }

  function lineView() {
    var d = state.data, line = d.lines.filter(function (l) { return l.id === state.line; })[0];
    var isUn = state.line === '__un' || (!line && unlined().length);
    var ps = isUn ? unlined() : line ? papersIn(line) : [];
    var title = isUn ? 'Hatsız' : line ? line.name : '';
    var read = ps.filter(function (p) { return p.status === 'read'; }).length, way = ps.filter(function (p) { return p.status === 'reading'; }).length;
    var share = line && d.shares && d.shares[line.id];
    var kids = [
      el('div', { class: 'etiket', text: 'Hat · Akademi' }),
      el('h1', { text: PA.up(title), style: "font:700 44px/1.05 'Archivo Narrow',sans-serif;margin:4px 0 6px;text-transform:uppercase" }),
      el('div', { class: 'italik', style: 'font-size:18px', text: ps.length + ' durak · ' + read + ' okundu' + (way ? ' · ' + way + ' okunuyor' : '') }),
      el('div', { style: 'display:flex;gap:8px;margin:14px 0 18px;flex-wrap:wrap' }, [
        el('button', { class: 'dugme', text: 'Hattın kaynakçası · kopyala', onclick: function () { PA.copyRich(PA.bibliography(ps)).then(function () { toast('KOPYALANDI', ps.length + ' KAYNAK'); }); } }),
        el('button', { class: 'dugme bos', text: '.ris', onclick: function () { PA.download(fileName('ris', title), PA.risFile(ps, linesNames, d.backs)); } }),
        el('button', { class: 'dugme bos', text: '.bib', onclick: function () { PA.download(fileName('bib', title), PA.bibFile(ps, linesNames, d.backs)); } }),
        line ? el('button', { class: 'dugme bos', text: 'Hattı düzenle', onclick: function () { openLineForm(line); } }) : null])
    ];
    if (share && share.code) {
      var url = 'https://getperon.app/h/' + share.code;
      kids.push(el('div', { class: 'kart', style: 'padding:10px 14px;margin:0 0 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [
        el('span', { class: 'etiket', text: 'Paylaşılıyor' }), el('span', { style: 'font-size:13px;word-break:break-all', text: 'getperon.app/h/' + share.code }),
        el('span', { style: 'flex:1' }),
        el('label', { style: 'display:flex;gap:6px;align-items:center;font-size:12px' }, [
          el('input', { type: 'checkbox', checked: share.notes ? 'checked' : undefined, onchange: function (e) {
            var box = e.target; box.disabled = true; ops.shareNotes(line.id, box.checked).then(function () { box.disabled = false; toast(box.checked ? 'AÇILDI' : 'KAPANDI', 'ALINTI VE NOT'); render(); }, function (er) { box.disabled = false; box.checked = !box.checked; fail(er); });
          } }), 'alıntılar ve notlar açık']),
        el('button', { class: 'kapat', text: 'kopyala', onclick: function () { PA.copyText(url).then(function () { toast('KOPYALANDI', 'BAĞLANTI'); }); } }),
        el('button', { class: 'kapat', text: 'durdur', onclick: function () { askConfirm('Paylaşım durdurulsun mu?', 'Bağlantıyı açan kimse hattı artık göremez.', 'Durdur', function () { ops.stopShare(line.id).then(function () { toast('DURDU', 'PAYLAŞIM'); render(); }, fail); }); } })]));
    } else if (line && !isUn && ps.length) {
      kids.push(el('div', { style: 'margin:-6px 0 16px' }, [el('button', { class: 'kapat', text: 'Hattı paylaş (bağlantıyla) ›', onclick: function () { openShare(line); } })]));
    }
    if (!ps.length) kids.push(el('p', { class: 'soluk', text: isUn ? 'Hatsız makale yok.' : 'Bu hatta henüz durak yok. “+ Makale ekle” ile bu hatta ekleyebilirsin.' }));
    kids.push(el('div', { style: 'border-top:1.5px solid var(--murekkep)' }, ps.map(function (p, i) { return stopRow(p, i, line, !!line && !isUn); })));
    return el('section', { class: 'orta' }, kids);
  }

  // ---- Bilet (sağ panel)
  function starPicker(value, onpick) {
    var box = el('span', { class: 'yildiz', role: 'group', 'aria-label': 'Puan' });
    function draw(v) { box.replaceChildren(); for (var i = 1; i <= 5; i++) (function (n) { box.appendChild(el('button', { type: 'button', text: n <= v ? '★' : '☆', 'aria-label': n + ' yıldız', onclick: function () { v = (v === n ? 0 : n); draw(v); onpick(v); } })); })(i); }
    draw(value || 0); return box;
  }
  function dateInput(value, onchange) {
    return el('input', { type: 'date', value: value || '', onchange: function (e) { onchange(e.target.value); } });
  }
  function tripBlock(p) {
    var st = p.status || 'toread', box = el('div', { class: 'yolculuk' });
    function go(job, ok) { job.then(function () { if (ok) toast(ok[0], ok[1]); render(); }, fail); }
    if (st === 'toread') {
      var dep = today();
      box.appendChild(el('div', { class: 'etiket', text: 'Peronda' }));
      box.appendChild(el('div', { class: 'satir' }, [el('span', { class: 'soluk', text: 'Kalkış' }), dateInput(dep, function (v) { dep = v || today(); }),
        el('button', { class: 'dugme', text: 'Yola çık', onclick: function () { go(ops.trip(p.id, { status: 'reading', dep: dep, date: null }), ['YOLDA', PA.stamp(dep)]); } })]));
    } else if (st === 'reading') {
      var arr = today(), stars = 0;
      box.appendChild(el('div', { class: 'etiket', text: 'Yolda', style: 'color:var(--mavi)' }));
      box.appendChild(el('div', { class: 'satir' }, [el('span', { class: 'soluk', text: 'Kalkış' }), dateInput(p.dep, function (v) { go(ops.trip(p.id, { dep: v || null })); })]));
      box.appendChild(el('div', { class: 'satir' }, [el('span', { class: 'soluk', text: 'Varış' }), dateInput(arr, function (v) { arr = v || today(); }), starPicker(0, function (v) { stars = v; })]));
      box.appendChild(el('div', { class: 'satir' }, [
        el('button', { class: 'dugme', text: 'Zımbala', onclick: function () { go(ops.trip(p.id, { status: 'read', date: arr, stars: stars }), ['VARIŞ', PA.stamp(arr)]); } }),
        el('button', { class: 'kapat', text: 'Peronda’ya geri', onclick: function () { go(ops.trip(p.id, { status: 'toread', dep: null, date: null, stars: 0 })); } })]));
    } else {
      box.appendChild(el('div', { class: 'etiket', text: 'Varıldı', style: 'color:var(--mercan)' }));
      box.appendChild(el('div', { class: 'satir' }, [el('span', { class: 'soluk', text: 'Kalkış' }), dateInput(p.dep, function (v) { go(ops.trip(p.id, { dep: v || null })); })]));
      box.appendChild(el('div', { class: 'satir' }, [el('span', { class: 'soluk', text: 'Varış' }), dateInput(p.date, function (v) { if (v) go(ops.trip(p.id, { date: v })); }),
        starPicker(p.stars || 0, function (v) { ops.trip(p.id, { stars: v }).then(function () {}, fail); })]));
      box.appendChild(el('div', { class: 'satir' }, [el('button', { class: 'kapat', text: 'Varışı geri al', onclick: function () { go(ops.trip(p.id, { status: p.dep ? 'reading' : 'toread', date: null, stars: 0 })); } })]));
    }
    return box;
  }
  function lineChips(p) {
    var d = state.data, on = {}; linesOf(p).forEach(function (l) { on[l.id] = 1; });
    var box = el('div', { class: 'cipler' });
    if (!d.lines.length) return el('span', { class: 'soluk', text: 'Henüz hat yok.' });
    d.lines.forEach(function (l) {
      box.appendChild(el('button', { class: 'cip' + (on[l.id] ? ' acik' : ''), 'aria-pressed': String(!!on[l.id]), onclick: function () {
        if (on[l.id]) delete on[l.id]; else on[l.id] = 1;
        ops.setLines(p.id, Object.keys(on)).then(render, fail);
      } }, [el('span', { class: 'rozet', text: PA.up((l.name || '?').charAt(0)), style: 'background:' + tint(l.color) + ';width:16px;height:16px;font-size:10px' }), l.name]));
    });
    return box;
  }
  function backEditor(p) {
    var back = state.data.backs[p.id] || {}, kids = [];
    kids.push(el('div', { class: 'etiket', text: 'Biletin arkası' }));
    // Literatür notu
    var note = el('textarea', { rows: '5', maxlength: '4000', placeholder: 'Literatür notu: amaç, yöntem, bulgu, benim için…', value: back.note || '' });
    var save = el('button', { class: 'dugme', text: 'Notu kaydet', disabled: 'disabled' });
    var count = el('small', { class: 'soluk', text: (back.note || '').length + ' / 4000' });
    note.addEventListener('input', function () { save.disabled = note.value === (back.note || ''); count.textContent = note.value.length + ' / 4000'; });
    save.addEventListener('click', function () { run(save, null, function () { return ops.note(p.id, note.value); }, function () { toast('KAYDEDİLDİ', 'NOT'); render(); }); });
    kids.push(el('div', { style: 'margin:8px 0' }, [note, el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px' }, [count, save])]));
    // Alıntılar
    var qs = back.quotes || [];
    qs.forEach(function (q) {
      var card = el('div', { class: 'alinti' });
      function view() {
        card.replaceChildren(
          el('b', { class: 'soluk', style: 'font-size:12px', text: q.page ? 's. ' + q.page : '' }),
          el('div', {}, [el('q', { text: q.text }), el('div', { style: 'display:flex;gap:12px' }, [
            el('a', { href: '#', text: 'kopyala', style: 'font-size:12px', onclick: function (e) { e.preventDefault(); PA.copyText('“' + q.text + '” ' + PA.inText(p, q.page)).then(function () { toast('KOPYALANDI', 'ALINTI'); }); } }),
            el('a', { href: '#', text: 'düzenle', style: 'font-size:12px', onclick: function (e) { e.preventDefault(); edit(); } }),
            el('a', { href: '#', text: 'sil', style: 'font-size:12px', onclick: function (e) { e.preventDefault(); ops.deleteQuote(p.id, q.id).then(render, fail); } })])]));
      }
      function edit() { card.replaceChildren(quoteForm(p, q, function () { render(); }, view)); }
      view(); kids.push(card);
    });
    if (qs.length < 10) {
      var slot = el('div', { style: 'margin:10px 0' });
      var add = el('button', { class: 'dugme bos', text: '+ Alıntı ekle', onclick: function () { slot.replaceChildren(quoteForm(p, null, function () { render(); }, function () { slot.replaceChildren(add); })); } });
      slot.appendChild(add); kids.push(slot);
    } else kids.push(el('p', { class: 'soluk', style: 'font-size:12px', text: 'En çok 10 alıntı.' }));
    if (!qs.length && !(back.note || '').trim()) kids.push(el('p', { class: 'soluk', style: 'font-size:12px;margin:4px 0', text: 'Arka yüz boş.' }));
    return el('div', {}, kids);
  }
  function quoteForm(p, q, done, cancel) {
    var text = el('textarea', { rows: '4', maxlength: '1200', placeholder: 'Alıntı', value: q ? q.text : '' });
    var page = el('input', { type: 'text', placeholder: 'sayfa (isteğe bağlı)', value: q && q.page ? q.page : '', style: 'max-width:160px' });
    var msg = el('p', { class: 'hata', style: 'margin:4px 0;min-height:18px' });
    var save = el('button', { class: 'dugme', text: 'Kaydet' });
    save.addEventListener('click', function () {
      if (!text.value.trim()) { msg.textContent = 'Alıntıyı yaz.'; return; }
      run(save, msg, function () { return ops.quote(p.id, { id: q ? q.id : 'q-' + hex7(), text: text.value.trim(), page: page.value.trim() }); }, done);
    });
    return el('div', { class: 'alinti-form' }, [text, el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap' }, [page, save, el('button', { class: 'kapat', text: 'Vazgeç', onclick: cancel })]), msg]);
  }

  function detail(p) {
    var kids = [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [el('div', { class: 'etiket', text: 'Ödünç kartı' }),
        el('button', { class: 'kapat', text: 'Künyeyi düzenle', onclick: function () { openPaperForm(p); } })]),
      el('div', { class: 'kart', style: 'margin:10px 0 16px' }, [
        el('div', { class: 'blok' }, [
          el('div', { class: 'etiket', text: (PA.KINDS[p.kind] || 'makale') + (p.year ? ' · ' + p.year : '') }),
          el('div', { class: 'eser', style: 'font-size:21px;line-height:1.15;margin:4px 0', text: p.title }),
          el('div', { text: who(p) || (who(p, p.editors) ? who(p, p.editors) + ' (ed.)' : '') }),
          p.container ? el('div', {}, [el('i', { class: 'italik', style: 'font-size:16px', text: p.container }), ' ' + [p.volume ? p.volume + (p.issue ? '(' + p.issue + ')' : '') : '', p.pages || ''].filter(Boolean).join(' · ')]) : null,
          p.kind === 'tez' && p.institution ? el('div', { class: 'italik', style: 'font-size:16px', text: p.institution }) : null,
          p.advisor ? el('div', { class: 'soluk', style: 'font-size:12px', text: 'Danışman: ' + p.advisor }) : null,
          p.doi ? el('div', { class: 'soluk', style: 'font-size:12px;margin-top:4px;word-break:break-all', text: 'DOI ' + p.doi }) : null]),
        el('div', { style: 'padding:10px 14px;font-size:13px' }, [
          p.oaURL || p.url || p.doi || p.userURL ? el('div', {}, [el('a', { href: p.userURL || p.oaURL || (p.doi ? 'https://doi.org/' + p.doi : p.url), target: '_blank', rel: 'noopener noreferrer', text: 'Makaleyi aç ↗' })]) : null])]),
      tripBlock(p),
      el('div', { class: 'etiket', text: 'Hatlar', style: 'margin:16px 0 6px' }), lineChips(p),
      el('div', { style: 'height:16px' }), backEditor(p)
    ];
    var ref = PA.reference(p);
    kids.push(el('div', { class: 'etiket', text: 'Kaynak · APA 7', style: 'margin-top:18px' }));
    kids.push(el('div', { class: 'kart kaynakca', style: 'padding:12px 14px;margin:8px 0;border-top:1.5px solid var(--murekkep)' }, [el('p', {}, [PA.runsToEl(ref)])]));
    kids.push(el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
      el('button', { class: 'dugme', text: 'Kaynağı kopyala', onclick: function () { PA.copyRich([ref]).then(function () { toast('KOPYALANDI', 'APA 7 · PANODA'); }); } }),
      el('button', { class: 'dugme bos', text: 'Metin içi atıf', onclick: function () { PA.copyText(PA.inText(p)).then(function () { toast('KOPYALANDI', PA.inText(p)); }); } })]));
    kids.push(el('div', { style: 'margin-top:26px;padding-top:12px;border-top:1px solid var(--kart-kenar)' }, [
      el('button', { class: 'kapat', style: 'color:var(--mercan-metin)', text: 'Makaleyi sil', onclick: function () {
        askConfirm('Makale silinsin mi?', '“' + p.title + '” bütün hatlardan, alıntıları ve notlarıyla birlikte silinir. Bu geri alınamaz.', 'Sil', function () {
          ops.deletePaper(p.id).then(function () { state.paper = null; toast('SİLİNDİ', ''); render(); }, fail); }); } })]));
    return el('div', {}, kids);
  }

  // ---- Makale ekleme: DOI ya da başlıkla
  function openAdd() {
    if (openModals.length) return;
    var chosen = {}; if (state.line && state.line !== '__un') chosen[state.line] = 1;
    var found = null, busy = false;
    var input = el('input', { type: 'text', placeholder: 'DOI, doi.org bağlantısı ya da makalenin adı', autocomplete: 'off', spellcheck: 'false' });
    var msg = el('p', { class: 'hata', style: 'min-height:20px;margin:8px 0 0' });
    var card = el('div'), chips = el('div', { class: 'cipler' });
    var save = el('button', { class: 'dugme', text: 'Perona koy', disabled: 'disabled' });
    var go = el('button', { class: 'dugme bos', text: 'Ara' });
    var m;
    function drawChips() {
      chips.replaceChildren();
      if (!state.data.lines.length) { chips.appendChild(el('span', { class: 'soluk', text: 'Henüz hat yok. Makale hatsız eklenir.' })); return; }
      state.data.lines.forEach(function (l) {
        chips.appendChild(el('button', { class: 'cip' + (chosen[l.id] ? ' acik' : ''), onclick: function () { if (chosen[l.id]) delete chosen[l.id]; else chosen[l.id] = 1; drawChips(); } }, [
          el('span', { class: 'rozet', text: PA.up((l.name || '?').charAt(0)), style: 'background:' + tint(l.color) + ';width:16px;height:16px;font-size:10px' }), l.name]));
      });
    }
    function drawCard(p, dup) {
      card.replaceChildren();
      if (!p) return;
      var by = who(p) || (who(p, p.editors) ? who(p, p.editors) + ' (ed.)' : '');
      card.appendChild(el('div', { class: 'kart', style: 'margin:14px 0' }, [el('div', { class: 'blok' }, [
        el('div', { class: 'etiket', text: (PA.KINDS[p.kind] || 'makale') + (p.year ? ' · ' + p.year : '') + (dup ? ' · ZATEN PERONDA' : ' · BULUNDU') }),
        el('div', { class: 'eser', style: 'font-size:21px;line-height:1.15;margin:4px 0', text: p.title }),
        el('div', { text: by }),
        p.container ? el('i', { class: 'italik', style: 'font-size:16px', text: p.container }) : null,
        p.doi ? el('div', { class: 'soluk', style: 'font-size:12px;word-break:break-all', text: 'DOI ' + p.doi }) : null])]));
    }
    function doSearch() {
      var t = input.value.trim(); if (!t || busy) return;
      busy = true; msg.textContent = ''; found = null; save.disabled = true; drawCard(null);
      go.textContent = 'Aranıyor…';
      var job = PA.extractDOI(t) ? PA.lookupDOI(t) : PA.lookupTitle(t);
      job.then(function (p) {
        var dup = PA.findDuplicate(state.data, p);
        found = p; drawCard(p, dup);
        if (dup) {
          var where = state.data.lines.filter(function (l) { return (l.stops || []).indexOf(dup.id) >= 0; }).map(function (l) { return l.name; });
          msg.textContent = 'Bu makale zaten akademinde' + (where.length ? ': ' + where.join(', ') + ' hattında.' : ' (hatsız).');
        } else {
          save.disabled = false;
          PA.openAccess(p.doi || '').then(function (u) { if (u && found === p) p.oaURL = u; });
        }
      }).catch(function (e) {
        msg.textContent = e.message === 'noDOI' ? 'DOI bulunamadı.' : e.message === 'network' ? 'Bağlantı kurulamadı. Biraz sonra yeniden dene.' : 'Makale bulunamadı. DOI’yi ya da adı kontrol et. DOI’si yoksa elle ekleyebilirsin.';
      }).then(function () { busy = false; go.textContent = 'Ara'; });
    }
    function put() {
      if (!found || save.disabled) return;
      run(save, msg, function () { return ops.addPaper(found, Object.keys(chosen)); }, function (p) {
        m.close(); var first = Object.keys(chosen)[0];
        state.q = ''; searchInput.value = ''; state.view = 'liste'; state.line = first || '__un'; state.paper = p.id; render(); toast('PERONDA', PA.up(p.title.slice(0, 28)));
      });
    }
    go.addEventListener('click', doSearch); save.addEventListener('click', function () { if (save.disabled) return; put(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
    input.addEventListener('paste', function () { setTimeout(function () { if (PA.extractDOI(input.value)) doSearch(); }, 0); });
    drawChips();
    m = modal('Yeni kaynak', 'Makale ekle', [
      el('div', { style: 'display:flex;gap:8px' }, [input, go]), msg, card,
      el('div', { class: 'etiket', text: 'Hangi hatta', style: 'margin:6px 0' }), chips,
      el('div', { style: 'margin-top:18px;display:flex;gap:12px;align-items:center;flex-wrap:wrap' }, [save,
        el('button', { class: 'kapat', text: 'DOI’si yok mu? Elle ekle ›', onclick: function () { m.close(); openPaperForm(null, 'makale', Object.keys(chosen)); } })]),
      el('p', { class: 'soluk', style: 'font-size:12px;margin:12px 0 0', text: 'Telefondaki Peron kaydı birkaç saniyede güncellenir. Tez, kitap ve bildiriyi de “Elle ekle” ile girebilirsin.' })
    ]);
    input.focus();
  }

  // ---- Makale formu: elle ekleme ve künye düzenleme
  function personsToText(list) { return (list || []).map(function (a) { return a.name || (a.given ? a.family + ', ' + a.given : a.family); }).join('\n'); }
  function textToPersons(t) {
    return String(t).split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
      var c = s.indexOf(','); return c >= 0 ? { family: s.slice(0, c).trim(), given: s.slice(c + 1).trim() } : { family: '', given: '', name: s };
    });
  }
  function openPaperForm(existing, kind0, lineIDs0) {
    if (openModals.length) return;
    var p0 = existing || {};
    var v = { kind: p0.kind || kind0 || 'makale', title: p0.title || '', authors: personsToText(p0.authors), editors: personsToText(p0.editors), container: p0.container || '', publisher: p0.publisher || '',
      year: p0.year ? String(p0.year) : '', volume: p0.volume || '', issue: p0.issue || '', pages: p0.pages || p0.articleNo || '', doi: p0.doi || '', userURL: p0.userURL || '',
      institution: p0.institution || '', degree: p0.degree || 'yukseklisans', thesisNo: p0.thesisNo || '', advisor: p0.advisor || '' };
    var chosen = {}; (lineIDs0 || []).forEach(function (id) { chosen[id] = 1; });
    var area = el('div'), msg = el('p', { class: 'hata', style: 'min-height:20px;margin:8px 0 0' }), m;
    function txt(key, label, hint, ph) { return field(label, el('input', { type: 'text', value: v[key], placeholder: ph || '', oninput: function (e) { v[key] = e.target.value; } }), hint); }
    function area2(key, label, rows, hint, ph) { return field(label, el('textarea', { rows: String(rows), value: v[key], placeholder: ph || '', oninput: function (e) { v[key] = e.target.value; } }), hint); }
    function draw() {
      var k = v.kind, tez = k === 'tez', kids = [];
      var sel = el('select', { onchange: function (e) { v.kind = e.target.value; draw(); } }, KIND_LIST.map(function (kv) { return el('option', { value: kv[0], text: kv[1] }); }));
      sel.value = k; kids.push(field('Tür', sel));
      kids.push(area2('title', tez ? 'Tezin adı' : 'Başlık', 2));
      kids.push(area2('authors', tez ? 'Yazar' : 'Yazarlar', 3, 'Her satıra bir kişi: Soyad, Ad. Kurum adı virgülsüz yazılır.', 'Yılmaz, Ayşe'));
      if (!tez && k !== 'makale') kids.push(area2('editors', 'Editörler', 2, 'Yazarı olmayan kitapta editörler yazar yerine geçer.', 'Koç, Ahmet'));
      if (tez) {
        kids.push(txt('institution', 'Üniversite', null, 'Ankara Üniversitesi'));
        var deg = el('select', { onchange: function (e) { v.degree = e.target.value; } }, [el('option', { value: 'yukseklisans', text: 'Yüksek lisans' }), el('option', { value: 'doktora', text: 'Doktora' })]);
        deg.value = v.degree; kids.push(field('Düzey', deg));
        kids.push(txt('thesisNo', 'YÖK tez numarası')); kids.push(txt('advisor', 'Danışman', null, 'Prof. Dr. Ayşe Yılmaz')); kids.push(txt('year', 'Yıl'));
      } else {
        if (k === 'makale') kids.push(txt('container', 'Dergi'));
        if (k === 'bildiri') kids.push(txt('container', 'Bildiri kitabı ya da etkinlik'));
        if (k === 'bolum') kids.push(txt('container', 'Kitap adı'));
        if (k !== 'makale') kids.push(txt('publisher', k === 'rapor' || k === 'proje' ? 'Kurum ya da yayıncı' : 'Yayıncı'));
        var row = [txt('year', 'Yıl')];
        if (k === 'makale') { row.push(txt('volume', 'Cilt')); row.push(txt('issue', 'Sayı')); }
        if (k === 'makale' || k === 'bildiri' || k === 'bolum') row.push(txt('pages', 'Sayfa', null, '145–168'));
        kids.push(el('div', { class: 'alan-satir' }, row));
        kids.push(txt('doi', 'DOI', null, '10.0000/…'));
      }
      kids.push(txt('userURL', 'Bağlantı', 'Kütüphane ya da Drive. “Makaleyi aç” önce bunu kullanır.', 'https://'));
      if (!existing) {
        var chips = el('div', { class: 'cipler' });
        state.data.lines.forEach(function (l) {
          chips.appendChild(el('button', { type: 'button', class: 'cip' + (chosen[l.id] ? ' acik' : ''), onclick: function (e) { if (chosen[l.id]) delete chosen[l.id]; else chosen[l.id] = 1; e.currentTarget.classList.toggle('acik'); } }, [
            el('span', { class: 'rozet', text: PA.up((l.name || '?').charAt(0)), style: 'background:' + tint(l.color) + ';width:16px;height:16px;font-size:10px' }), l.name]));
        });
        if (state.data.lines.length) { kids.push(el('div', { class: 'etiket', text: 'Hangi hatta', style: 'margin:10px 0 6px' })); kids.push(chips); }
      }
      area.replaceChildren.apply(area, kids);
    }
    function build() {
      var k = v.kind, tez = k === 'tez', t = function (s) { s = String(s).trim(); return s || undefined; };
      var pg = t(v.pages), p = { kind: k, title: v.title.trim(), authors: textToPersons(v.authors), editors: (!tez && k !== 'makale') ? textToPersons(v.editors) : [], year: parseInt(v.year, 10) || undefined, userURL: t(v.userURL) };
      if (tez) {
        Object.assign(p, { institution: t(v.institution), degree: v.degree, thesisNo: t(v.thesisNo), advisor: t(v.advisor), container: undefined, publisher: undefined, volume: undefined, issue: undefined, pages: undefined, articleNo: undefined, doi: undefined });
      } else {
        Object.assign(p, { container: (k === 'makale' || k === 'bildiri' || k === 'bolum') ? t(v.container) : undefined, publisher: k !== 'makale' ? t(v.publisher) : undefined,
          volume: k === 'makale' ? t(v.volume) : undefined, issue: k === 'makale' ? t(v.issue) : undefined, doi: PA.extractDOI(v.doi) || t(v.doi), advisor: undefined, institution: undefined, degree: undefined, thesisNo: undefined });
        if (k === 'makale' && pg && !/[-–—]/.test(pg) && /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(pg)) { p.articleNo = pg; p.pages = undefined; } else { p.pages = (k === 'makale' || k === 'bildiri' || k === 'bolum') ? pg : undefined; p.articleNo = undefined; }
      }
      return p;
    }
    var save = el('button', { class: 'dugme', text: existing ? 'Kaydet' : 'Perona koy' });
    save.addEventListener('click', function () {
      if (!v.title.trim()) { msg.textContent = v.kind === 'tez' ? 'Tezin adını yaz.' : 'Başlığı yaz.'; return; }
      var built = build();
      if (existing) run(save, msg, function () { return ops.updatePaper(existing.id, built); }, function () { m.close(); toast('KAYDEDİLDİ', ''); render(); });
      else {
        var paper = Object.assign({ id: PA.newId(), status: 'toread' }, built);
        run(save, msg, function () { return ops.addPaper(paper, Object.keys(chosen)); }, function (p) {
          m.close(); var first = Object.keys(chosen)[0]; state.q = ''; searchInput.value = ''; state.view = 'liste'; state.line = first || '__un'; state.paper = p.id; render(); toast('PERONDA', PA.up(p.title.slice(0, 28)));
        });
      }
    });
    draw();
    m = modal(existing ? 'Künye' : 'Yeni kaynak', existing ? 'Künyeyi düzenle' : 'Elle ekle', [area, msg, el('div', { style: 'margin-top:14px;display:flex;gap:10px;align-items:center' }, [save])], { wide: true, sticky: true });
  }

  // ---- Dosyadan içe aktarma: RIS ve BibTeX (Zotero, Mendeley, EndNote)
  function openImport() {
    if (openModals.length) return;
    var file = el('input', { type: 'file', accept: '.ris,.bib,.bibtex,.txt,text/plain' });
    var info = el('div'), msg = el('p', { class: 'hata', style: 'min-height:20px;margin:8px 0 0' }), m, recs = null, baseName = 'İçe aktarılan';
    var save = el('button', { class: 'dugme', text: 'Hepsini Perona koy', disabled: 'disabled' });
    var target = el('select'), newName = el('input', { type: 'text', placeholder: 'Yeni hattın adı' }), fromGroups = el('input', { type: 'checkbox' });
    function show() {
      var fresh = recs.filter(function (r) { return !PA.findDuplicate(state.data, r.paper); });
      var groups = {}; recs.forEach(function (r) { (r.groups || []).forEach(function (g) { groups[g] = 1; }); });
      var gl = Object.keys(groups);
      target.replaceChildren(el('option', { value: '', text: 'Hatsız' }));
      state.data.lines.forEach(function (l) { target.appendChild(el('option', { value: l.id, text: l.name })); });
      target.appendChild(el('option', { value: '__new', text: 'Yeni hat aç…' }));
      target.value = state.line && state.line !== '__un' ? state.line : '';
      newName.value = baseName; newName.style.display = target.value === '__new' ? '' : 'none';
      target.onchange = function () { newName.style.display = target.value === '__new' ? '' : 'none'; };
      fromGroups.checked = false;
      info.replaceChildren(
        el('p', { style: 'margin:10px 0' }, [el('b', { text: recs.length + ' kayıt' }), ' · ' + fresh.length + ' yeni · ' + (recs.length - fresh.length) + ' zaten akademinde (atlanır)']),
        el('div', { class: 'kart', style: 'padding:8px 12px;max-height:150px;overflow:auto;font-size:13px' }, recs.slice(0, 40).map(function (r) {
          var dup = !!PA.findDuplicate(state.data, r.paper);
          return el('div', { style: 'padding:2px 0;' + (dup ? 'opacity:.5' : '') }, [(PA.KINDS[r.paper.kind] || 'makale') + ' · ' + r.paper.title.slice(0, 80) + (dup ? '  (var)' : '')]);
        }).concat(recs.length > 40 ? [el('div', { class: 'soluk', text: '… ve ' + (recs.length - 40) + ' kayıt daha' })] : [])),
        el('div', { class: 'etiket', text: 'Hangi hatta', style: 'margin:14px 0 6px' }), el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [target, newName]),
        gl.length ? el('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px' }, [fromGroups, 'Dosyadaki anahtar sözcükleri hat olarak aç (' + gl.slice(0, 4).join(', ') + (gl.length > 4 ? '…' : '') + ')']) : null,
        gl.length ? el('p', { class: 'soluk', style: 'font-size:12px;margin:4px 0 0', text: 'Adı mevcut bir hatla aynı olan anahtar sözcükler o hatta durak olur.' }) : null);
      save.disabled = !fresh.length && !gl.length;
    }
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return;
      baseName = f.name.replace(/\.[^.]+$/, '') || baseName; msg.textContent = '';
      var rd = new FileReader();
      rd.onload = function () {
        try { recs = PA.parseImport(String(rd.result)); } catch (e) { recs = []; }
        if (!recs.length) { info.replaceChildren(); msg.textContent = 'Dosyada kaynak bulunamadı. RIS ya da BibTeX dosyası seç.'; save.disabled = true; return; }
        show();
      };
      rd.onerror = function () { msg.textContent = 'Dosya okunamadı.'; };
      rd.readAsText(f, 'utf-8');
    });
    save.addEventListener('click', function () {
      if (!recs || save.disabled) return;
      var opts = { target: target.value && target.value !== '__new' ? target.value : null, newLineName: target.value === '__new' ? (newName.value.trim() || baseName) : null, openFromGroups: fromGroups.checked };
      run(save, msg, function () { return ops.importRecords(recs, opts); }, function (res) {
        m.close(); state.q = ''; searchInput.value = ''; state.view = 'liste'; if (!state.line || state.line === '__un') state.line = state.data.lines.length ? state.data.lines[state.data.lines.length - 1].id : '__un';
        toast('EKLENDİ', res.added + ' YENİ · ' + res.skipped + ' ATLANDI'); render();
      });
    });
    m = modal('Dosyadan', 'Kaynakları içe aktar', [
      el('p', { class: 'soluk', style: 'margin:0 0 10px;font-size:13px', text: 'Zotero, Mendeley ya da EndNote’tan dışa aktardığın .ris veya .bib dosyasını seç.' }), file, info, msg,
      el('div', { style: 'margin-top:14px' }, [save])], { wide: true });
  }

  // ---- Hat formu
  function openLineForm(line) {
    if (openModals.length) return;
    var name = line ? line.name : '', color = line ? line.color : PALETTE[state.data.lines.length % PALETTE.length], m;
    var input = el('input', { type: 'text', value: name, placeholder: 'Tez: Siber zorbalık', maxlength: '60' });
    input.addEventListener('input', function () { name = input.value; });
    var chips = el('div', { class: 'cipler' }), pal = el('div', { class: 'cipler' }), msg = el('p', { class: 'hata', style: 'min-height:20px;margin:8px 0 0' });
    PREFIXES.forEach(function (px) {
      chips.appendChild(el('button', { type: 'button', class: 'cip', text: px, onclick: function () {
        var rest = input.value; PREFIXES.forEach(function (q) { if (rest.indexOf(q) === 0) rest = rest.slice(q.length); });
        input.value = px + ' ' + rest.replace(/^\s+/, ''); name = input.value; input.focus();
      } }));
    });
    function drawPal() {
      pal.replaceChildren();
      PALETTE.forEach(function (c) { pal.appendChild(el('button', { type: 'button', class: 'renk' + (c === color ? ' secili' : ''), 'aria-label': 'Renk', 'aria-pressed': String(c === color), style: 'background:' + c, onclick: function () { color = c; drawPal(); } })); });
    }
    drawPal();
    var save = el('button', { class: 'dugme', text: line ? 'Kaydet' : 'Hattı aç' });
    save.addEventListener('click', function () {
      var n = input.value.trim(); if (!n) { msg.textContent = 'Hattın adını yaz.'; return; }
      if (line) run(save, msg, function () { return ops.saveLine(line.id, n, color); }, function () { m.close(); toast('KAYDEDİLDİ', ''); render(); });
      else run(save, msg, function () { return ops.newLine(n, color); }, function (id) { m.close(); state.q = ''; searchInput.value = ''; state.view = 'liste'; state.line = id; state.paper = null; toast('HAT AÇILDI', PA.up(n.slice(0, 24))); render(); });
    });
    var kids = [field('Hattın adı', input), el('div', { class: 'etiket', text: 'Ön ek', style: 'margin:8px 0 6px' }), chips, el('div', { class: 'etiket', text: 'Renk', style: 'margin:12px 0 6px' }), pal, msg,
      el('div', { style: 'margin-top:14px;display:flex;gap:10px;align-items:center' }, [save,
        line ? el('button', { class: 'kapat', style: 'color:var(--mercan-metin)', text: 'Hattı sil', onclick: function () {
          askConfirm('Hat silinsin mi?', '“' + line.name + '” hattı silinir, makaleler akademide kalır (hatsız olurlar).' + (state.data.shares && state.data.shares[line.id] ? ' Paylaşım bağlantısı da kapanır.' : ''), 'Sil', function () {
            m.close(); ops.deleteLine(line.id).then(function () { state.line = state.data.lines.length ? state.data.lines[0].id : null; state.paper = null; toast('SİLİNDİ', ''); render(); }, fail); }); } }) : null])];
    m = modal(line ? 'Hat' : 'Yeni hat', line ? 'Hattı düzenle' : 'Yeni hat', kids);
    input.focus();
  }


  function openShare(line) {
    if (openModals.length) return;
    var notes = false, msg = el('p', { class: 'hata', style: 'min-height:20px;margin:8px 0 0' }), m;
    var box = el('input', { type: 'checkbox', onchange: function (e) { notes = e.target.checked; } });
    var go = el('button', { class: 'dugme', text: 'Bağlantı oluştur' });
    go.addEventListener('click', function () {
      run(go, msg, function () { return ops.startShare(line.id, notes); }, function (code) {
        m.close(); var url = 'https://getperon.app/h/' + code;
        PA.copyText(url).then(function () { toast('KOPYALANDI', 'BAĞLANTI'); }, function () {}); render();
      });
    });
    m = modal('Hat paylaşma', '“' + line.name + '” paylaşılsın mı?', [
      el('p', { style: 'margin:0 0 10px;font-size:14px', text: 'Bağlantıyı bilen herkes hattı görür, üye olması gerekmez. Adın ve e-postan görünmez. Puanların, kalkış ve varış günlerin ve kendi bağlantıların paylaşılmaz.' }),
      el('label', { style: 'display:flex;gap:8px;align-items:center;margin:10px 0;font-size:14px' }, [box, 'Alıntılarım ve notlarım da görünsün']),
      msg, el('div', { style: 'margin-top:12px' }, [go])]);
  }

  // ---- Kısayollar: / ara, n yeni makale
  document.addEventListener('keydown', function (e) {
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.metaKey || e.ctrlKey || e.altKey || openModals.length || !state.data) return;
    if (e.key === '/') { e.preventDefault(); searchInput.focus(); }
    else if (e.key === 'n') { e.preventDefault(); openAdd(); }
  });

  load();
})();
