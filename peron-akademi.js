// Peron · Akademi: web için ortak kod. APA 7, RIS ve BibTeX üretimi Swift'teki Cite.swift ile aynı kuralları izler.
(function () {
  'use strict';
  var TR = 'tr';

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function up(s) { return String(s).toLocaleUpperCase('tr-TR'); }

  var KINDS = { makale: 'makale', bildiri: 'bildiri', bolum: 'kitap bölümü', kitap: 'kitap', tez: 'tez', rapor: 'rapor' };

  // ---- Kişiler
  function initials(given) {
    return String(given || '').replace(/\./g, ' ').split(/\s+/).filter(Boolean).map(function (tok) {
      return tok.split('-').map(function (p) { return p ? p[0] + '.' : ''; }).filter(Boolean).join('-');
    }).filter(Boolean).join(' ');
  }
  function isOrg(p) { return !p.family && p.name; }
  function inverted(p) { if (isOrg(p)) return p.name; var i = initials(p.given); return i ? p.family + ', ' + i : p.family; }
  function direct(p) { if (isOrg(p)) return p.name; var i = initials(p.given); return i ? i + ' ' + p.family : p.family; }
  function authorList(ps) {
    var n = ps.map(inverted);
    if (n.length === 0) return '';
    if (n.length === 1) return n[0];
    if (n.length === 2) return n[0] + ', & ' + n[1];
    if (n.length <= 20) return n.slice(0, -1).join(', ') + ', & ' + n[n.length - 1];
    return n.slice(0, 19).join(', ') + ', . . . ' + n[n.length - 1];
  }
  function editorList(ps) {
    var n = ps.map(direct), l;
    if (!n.length) return '';
    if (n.length === 1) l = n[0]; else if (n.length === 2) l = n[0] + ' & ' + n[1]; else l = n.slice(0, -1).join(', ') + ', & ' + n[n.length - 1];
    return l + ' (Ed.)';
  }
  function closed(s) { var t = String(s).trim(); if (!t) return t; return '.?!'.indexOf(t[t.length - 1]) >= 0 ? t : t + '.'; }
  function pageRange(s) { return String(s).replace(/\s*[-–—]+\s*/g, '–'); }
  function link(p) { if (p.doi) return 'https://doi.org/' + p.doi; return p.url || null; }
  function pubIfDiff(p) {
    if (!p.publisher) return null;
    if ((p.authors || []).some(function (a) { return isOrg(a) && a.name === p.publisher; })) return null;
    return p.publisher;
  }

  // ---- APA 7 satırı: [{t, i}] parçaları (i: italik)
  function reference(p) {
    var out = [];
    function add(s, it) { if (s) out.push({ t: s, i: !!it }); }
    var italicTitle = ['kitap', 'tez', 'rapor'].indexOf(p.kind) >= 0;
    var year = p.year ? String(p.year) : 't.y.';
    var titleDone = false;
    var authors = p.authors || [], editors = p.editors || [];
    if (authors.length) add(closed(authorList(authors)) + ' (' + year + '). ');
    else if (editors.length && p.kind === 'kitap') add(authorList(editors) + ' (Ed.). (' + year + '). ');
    else { add(closed(p.title), italicTitle); add(' (' + year + '). '); titleDone = true; }
    var style = p.kind === 'bildiri' ? (p.volume ? 'makale' : 'bolum') : p.kind;
    if (style === 'bolum') {
      if (!titleDone) add(closed(p.title) + ' ');
      var book = p.container || '', pages = p.pages ? pageRange(p.pages) : null;
      add(editors.length ? editorList(editors) + ', ' : '');
      if (book) { add(book, true); add(' içinde'); }
      if (pages) add(' (ss. ' + pages + ')');
      if (book || pages) add('. ');
      var pub = pubIfDiff(p); if (pub) add(closed(pub) + ' ');
    } else if (style === 'kitap' || style === 'rapor') {
      if (!titleDone) { add(p.title, true); add('. '); }
      var pb = pubIfDiff(p); if (pb) add(closed(pb) + ' ');
    } else if (style === 'tez') {
      if (!titleDone) add(p.title, true);
      var deg = p.degree === 'doktora' ? 'Doktora tezi' : p.degree === 'yukseklisans' ? 'Yüksek lisans tezi' : 'Tez';
      var inst = p.institution || p.publisher;
      add(' [' + deg + (inst ? ', ' + inst : '') + ']. ');
      if (p.thesisNo) add('YÖK Ulusal Tez Merkezi. (Tez No. ' + p.thesisNo + ') ');
    } else {
      if (!titleDone) add(closed(p.title) + ' ');
      if (p.container) {
        add(p.container, true);
        if (p.volume) { add(', '); add(p.volume, true); }
        if (p.issue) add('(' + p.issue + ')');
        if (p.pages) add(', ' + pageRange(p.pages)); else if (p.articleNo) add(', Makale ' + p.articleNo);
        add('. ');
      } else { var pu = pubIfDiff(p); if (pu) add(closed(pu) + ' '); }
    }
    var l = link(p); if (l) add(l);
    if (out.length) { out[out.length - 1].t = out[out.length - 1].t.replace(/\s+$/, ''); if (!out[out.length - 1].t) out.pop(); }
    return out;
  }
  function plain(runs) { return runs.map(function (r) { return r.t; }).join(''); }
  function html(runs) { return runs.map(function (r) { return r.i ? '<i>' + esc(r.t) + '</i>' : esc(r.t); }).join(''); }
  function bibliography(papers) {
    function key(p) { var a = (p.authors && p.authors[0]) ? inverted(p.authors[0]) : (p.editors && p.editors[0]) ? inverted(p.editors[0]) : p.title; return a + ' ' + (p.year || 0) + ' ' + p.title; }
    return papers.slice().sort(function (a, b) { return key(a).localeCompare(key(b), 'tr', { sensitivity: 'base' }); }).map(reference);
  }

  // ---- Metin içi atıf
  function inText(p, page, narrative) {
    var n = (p.authors || []).map(function (a) { return isOrg(a) ? a.name : a.family; });
    var and = narrative ? 've' : '&', who;
    if (n.length === 0) who = String(p.title).split(' ').slice(0, 3).join(' ');
    else if (n.length === 1) who = n[0];
    else if (n.length === 2) who = n[0] + ' ' + and + ' ' + n[1];
    else who = n[0] + ' ve ark.';
    var year = p.year ? String(p.year) : 't.y.';
    var pg = page ? (/[-–]/.test(page) ? 'ss. ' : 's. ') + pageRange(page) : null;
    if (narrative) return pg ? who + ' (' + year + ', ' + pg + ')' : who + ' (' + year + ')';
    return '(' + who + ', ' + year + (pg ? ', ' + pg : '') + ')';
  }

  function shortAuthors(p) {
    var n = (p.authors || []).map(function (a) { return isOrg(a) ? a.name : a.family; });
    if (n.length === 0) return '';
    if (n.length === 1) return n[0];
    if (n.length === 2) return n[0] + ' ve ' + n[1];
    if (n.length === 3) return n[0] + ', ' + n[1] + ' ve ' + n[2];
    return n[0] + ' ve ark.';
  }

  // ---- Notlar, RIS, BibTeX
  function noteLines(b) {
    if (!b) return [];
    var flat = function (s) { return String(s).split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean).join(' '); };
    var out = (b.quotes || []).map(function (q) { return '“' + flat(q.text) + '”' + (q.page ? ' (s. ' + q.page + ')' : ''); });
    if (b.note && b.note.trim()) out.push('Not: ' + flat(b.note));
    return out;
  }
  var RIS_T = { bildiri: 'CPAPER', bolum: 'CHAP', kitap: 'BOOK', tez: 'THES', rapor: 'RPRT' };
  function personFull(p) { return isOrg(p) ? p.name : (p.given ? p.family + ', ' + p.given : p.family); }
  function risEntry(p, lines, back) {
    var f = [['TY', RIS_T[p.kind] || 'JOUR']];
    (p.authors || []).forEach(function (a) { f.push(['AU', personFull(a)]); });
    (p.editors || []).forEach(function (a) { f.push(['ED', personFull(a)]); });
    f.push(['TI', p.title]);
    if (p.container) f.push(['T2', p.container]);
    if (p.year) f.push(['PY', String(p.year)]);
    if (p.volume) f.push(['VL', p.volume]);
    if (p.issue) f.push(['IS', p.issue]);
    if (p.pages) { var parts = String(p.pages).split(/[-–—]/).map(function (x) { return x.trim(); }); if (parts[0]) f.push(['SP', parts[0]]); if (parts.length > 1) f.push(['EP', parts[1]]); }
    else if (p.articleNo) f.push(['SP', p.articleNo]);
    if (p.kind === 'tez') { var inst = p.institution || p.publisher; if (inst) f.push(['PB', inst]); if (p.degree) f.push(['M3', p.degree === 'doktora' ? 'Doktora tezi' : 'Yüksek lisans tezi']); }
    else if (p.publisher) f.push(['PB', p.publisher]);
    if (p.doi) f.push(['DO', p.doi]);
    var u = p.url || p.oaURL; if (u) f.push(['UR', u]);
    (lines || []).forEach(function (l) { f.push(['KW', l]); });
    noteLines(back).forEach(function (n) { f.push(['N1', n]); });
    f.push(['ER', '']);
    return f.map(function (kv) { return kv[0] + '  - ' + String(kv[1]).replace(/\r?\n/g, ' '); }).join('\r\n');
  }
  function risFile(papers, linesOf, backs) {
    return papers.map(function (p) { return risEntry(p, linesOf ? linesOf(p) : [], backs && backs[p.id]); }).join('\r\n\r\n') + '\r\n';
  }
  function bibEsc(s) {
    return String(s).replace(/[\\{}&%$#_~^]/g, function (c) {
      return c === '\\' ? '\\textbackslash{}' : c === '~' ? '\\textasciitilde{}' : c === '^' ? '\\textasciicircum{}' : '\\' + c;
    });
  }
  var BIB_T = { bildiri: 'inproceedings', bolum: 'incollection', kitap: 'book', rapor: 'techreport' };
  function bibType(p) { if (p.kind === 'tez') return p.degree === 'yukseklisans' ? 'mastersthesis' : 'phdthesis'; return BIB_T[p.kind] || 'article'; }
  function fold(s) {
    var m = { 'ı': 'i', 'İ': 'I', 'ş': 's', 'Ş': 'S', 'ğ': 'g', 'Ğ': 'G', 'ç': 'c', 'Ç': 'C', 'ö': 'o', 'Ö': 'O', 'ü': 'u', 'Ü': 'U' };
    return String(s).split('').map(function (c) { return m[c] || c; }).join('').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function bibPerson(p) { return isOrg(p) ? '{' + bibEsc(p.name) + '}' : bibEsc(p.family) + (p.given ? ', ' + bibEsc(p.given) : ''); }
  function bibKeys(papers) {
    var skip = ['the', 'and', 'with', 'from', 'bir', 'ile', 'icin', 'uzerine', 'uzerinde', 'olan'];
    var bases = papers.map(function (p) {
      var who = (p.authors && p.authors[0]) || (p.editors && p.editors[0]);
      var name = who ? (isOrg(who) ? who.name.split(' ')[0] : who.family) : 'anon';
      var word = fold(p.title).toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 3 && skip.indexOf(w) < 0; })[0] || '';
      return (fold(name).toLowerCase() + (p.year || 'ty') + word).replace(/[^a-z0-9]/g, '');
    });
    var count = {}; bases.forEach(function (b) { count[b] = (count[b] || 0) + 1; });
    var seen = {};
    return bases.map(function (b) { if (count[b] < 2) return b; var n = seen[b] || 0; seen[b] = n + 1; return b + String.fromCharCode(97 + Math.min(n, 25)); });
  }
  function bibEntry(p, key, lines, back) {
    var f = [];
    if ((p.authors || []).length) f.push(['author', p.authors.map(bibPerson).join(' and ')]);
    if ((p.editors || []).length) f.push(['editor', p.editors.map(bibPerson).join(' and ')]);
    f.push(['title', bibEsc(p.title)]);
    if (p.container) f.push([p.kind === 'bildiri' || p.kind === 'bolum' ? 'booktitle' : 'journal', bibEsc(p.container)]);
    if (p.year) f.push(['year', String(p.year)]);
    if (p.volume) f.push(['volume', bibEsc(p.volume)]);
    if (p.issue) f.push(['number', bibEsc(p.issue)]);
    if (p.pages) f.push(['pages', String(p.pages).replace(/\s*[-–—]+\s*/g, '--')]); else if (p.articleNo) f.push(['eid', bibEsc(p.articleNo)]);
    if (p.kind === 'tez') { var s = p.institution || p.publisher; if (s) f.push(['school', bibEsc(s)]); }
    else if (p.kind === 'rapor') { if (p.publisher) f.push(['institution', bibEsc(p.publisher)]); }
    else if (p.publisher) f.push(['publisher', bibEsc(p.publisher)]);
    if (p.doi) f.push(['doi', p.doi]);
    var u = p.url || p.oaURL; if (u) f.push(['url', u]);
    if (lines && lines.length) f.push(['keywords', lines.map(bibEsc).join(', ')]);
    var notes = noteLines(back); if (notes.length) f.push(['note', notes.map(bibEsc).join(' · ')]);
    return '@' + bibType(p) + '{' + key + ',\n' + f.map(function (kv) { return '  ' + kv[0] + ' = {' + kv[1] + '}'; }).join(',\n') + '\n}';
  }
  function bibFile(papers, linesOf, backs) {
    var keys = bibKeys(papers);
    return papers.map(function (p, i) { return bibEntry(p, keys[i], linesOf ? linesOf(p) : [], backs && backs[p.id]); }).join('\n\n') + '\n';
  }

  // ---- Arayüz yardımcıları
  function copyRich(runsList) {
    var txt = runsList.map(plain).join('\n'), h = runsList.map(function (r) { return '<p>' + html(r) + '</p>'; }).join('\n');
    return copyText(txt, h);
  }
  function copyText(txt, h) {
    try {
      if (navigator.clipboard && window.ClipboardItem && h) {
        return navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([txt], { type: 'text/plain' }), 'text/html': new Blob([h], { type: 'text/html' }) })]);
      }
      return navigator.clipboard.writeText(txt);
    } catch (e) { return Promise.reject(e); }
  }
  function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function runsToEl(runs) {
    var span = document.createElement('span');
    runs.forEach(function (r) { var n = r.i ? document.createElement('i') : document.createElement('span'); n.textContent = r.t; span.appendChild(n); });
    return span;
  }
  function stamp(d) {
    var a = ['OCA', 'ŞUB', 'MAR', 'NİS', 'MAY', 'HAZ', 'TEM', 'AĞU', 'EYL', 'EKİ', 'KAS', 'ARA'], p = String(d).split('-');
    return p.length === 3 ? p[2] + ' ' + a[+p[1] - 1] + ' ' + p[0] : d;
  }
  var LINE_HEX = function (c, dark) { return c; };

  window.PA = { esc: esc, up: up, KINDS: KINDS, reference: reference, plain: plain, html: html, bibliography: bibliography, inText: inText,
    shortAuthors: shortAuthors, risFile: risFile, bibFile: bibFile, copyRich: copyRich, copyText: copyText, download: download,
    runsToEl: runsToEl, stamp: stamp, noteLines: noteLines };
})();
