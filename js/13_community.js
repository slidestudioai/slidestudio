(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var tok = function () { try { return (typeof supabaseToken !== 'undefined') ? supabaseToken : 'dev-token'; } catch (e) { return 'dev-token'; } };
  var loggedIn = function () { var t = tok(); return !!t && t !== 'dev-token'; };
  var toast = function (m, t) { try { showToast(m, t); } catch (e) { console.log(m); } };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function icon(name) { var s = el('span', 'material-symbols-outlined', name); return s; }
  async function api(path, opts) {
    var res = await fetch(path, opts);
    var data = null;
    try { data = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, data: data || {} };
  }
  async function post(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ token: tok() }, body)) });
  }
  function askLogin(msg) {
    toast(msg || 'Avval tizimga kiring', 'error');
    try { if (typeof handleGoogleLogin === 'function') handleGoogleLogin(); } catch (e) {}
  }
  function timeAgo(iso) {
    try {
      var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
      if (s < 60) return 'hozir';
      if (s < 3600) return Math.floor(s / 60) + ' daq';
      if (s < 86400) return Math.floor(s / 3600) + ' soat';
      if (s < 86400 * 30) return Math.floor(s / 86400) + ' kun';
      return new Date(iso).toLocaleDateString();
    } catch (e) { return ''; }
  }
  var COLORS = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626', '#0891b2', '#db2777', '#4f46e5'];
  function avatar(name) {
    var a = el('div', 'fb-avatar', (name || '?').trim().charAt(0).toUpperCase() || '?');
    var h = 0; for (var i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    a.style.background = COLORS[h % COLORS.length];
    return a;
  }
  function modalShell(id, title) {
    var ov = $(id);
    if (ov) { ov.remove(); }
    ov = el('div', 'cm-overlay'); ov.id = id;
    var card = el('div', 'cm-card');
    var head = el('div', 'cm-head');
    head.appendChild(el('h3', null, title));
    var x = el('button', 'cm-close'); x.type = 'button'; x.setAttribute('aria-label', 'Yopish'); x.appendChild(icon('close'));
    x.onclick = function () { ov.classList.remove('open'); setTimeout(function () { ov.remove(); }, 200); };
    head.appendChild(x);
    var body = el('div', 'cm-body');
    card.appendChild(head); card.appendChild(body); ov.appendChild(card);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) x.onclick(); });
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('open'); });
    return { overlay: ov, body: body, close: x.onclick };
  }

  var REF_KEY = 'ss_pending_ref';
  var Referral = {
    open: async function () {
      var m = modalShell('referralModal', 'Do\'st taklif qiling');
      var b = m.body;
      var hero = el('div', 'ref-hero');
      hero.appendChild(el('div', 'ref-emoji', '🎁'));
      hero.appendChild(el('div', 'ref-big', 'Har bir do\'st uchun +15 varaq'));
      hero.appendChild(el('div', 'ref-sub', 'Do\'stingiz sizning havolangiz orqali kirib akkaunt ochsa — sizning balansingizga 15 ta pullik varaq qo\'shiladi.'));
      b.appendChild(hero);
      if (!loggedIn()) {
        var btn = el('button', 'cm-primary', 'Google bilan kirish va havola olish'); btn.type = 'button';
        btn.onclick = function () { m.close(); askLogin(); };
        b.appendChild(btn);
        return;
      }
      var loading = el('div', 'cm-muted', 'Havola tayyorlanmoqda…'); b.appendChild(loading);
      var r = await api('/api/referral/me?token=' + encodeURIComponent(tok()));
      loading.remove();
      if (!r.ok || !r.data.code) {
        b.appendChild(el('div', 'cm-error', (r.data && r.data.error) || 'Havolani olib bo\'lmadi. Keyinroq urinib ko\'ring.'));
        return;
      }
      try { if (typeof loadUserStats === 'function') loadUserStats(); } catch (e) {}
      var link = location.origin + '/?ref=' + r.data.code;
      var row = el('div', 'ref-linkrow');
      var inp = el('input', 'ref-input'); inp.type = 'text'; inp.readOnly = true; inp.value = link;
      inp.onfocus = function () { inp.select(); };
      var copy = el('button', 'ref-copy'); copy.type = 'button'; copy.appendChild(icon('content_copy')); copy.appendChild(document.createTextNode(' Nusxa'));
      copy.onclick = async function () {
        try { await navigator.clipboard.writeText(link); } catch (e) { inp.select(); try { document.execCommand('copy'); } catch (_) {} }
        toast('Havola nusxalandi');
      };
      row.appendChild(inp); row.appendChild(copy); b.appendChild(row);
      if (navigator.share) {
        var sh = el('button', 'cm-primary', 'Do\'stlarga yuborish'); sh.type = 'button';
        sh.onclick = function () { navigator.share({ title: 'Slide Studio — AI', text: 'AI bilan slaydlarni bir zumda yarating:', url: link }).catch(function () {}); };
        b.appendChild(sh);
      }
      var stats = el('div', 'ref-stats');
      var s1 = el('div', 'ref-stat'); s1.appendChild(el('b', null, String(r.data.invited))); s1.appendChild(el('span', null, 'taklif qilingan do\'st'));
      var s2 = el('div', 'ref-stat'); s2.appendChild(el('b', null, '+' + r.data.bonus_total)); s2.appendChild(el('span', null, 'olingan bonus varaq'));
      stats.appendChild(s1); stats.appendChild(s2); b.appendChild(stats);
      b.appendChild(el('div', 'cm-muted', 'Bonus faqat yangi akkaunt ochgan, boshqa odamlar uchun hisoblanadi. O\'zingizning havolangiz bilan kirish bonus bermaydi.'));
    },
  };

  (function captureRef() {
    try {
      var u = new URL(location.href);
      var code = (u.searchParams.get('ref') || '').trim().toUpperCase();
      if (/^[A-Z0-9]{6,12}$/.test(code)) {
        window.__ssRefMem = code;
        u.searchParams.delete('ref');
        history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
      }
    } catch (e) {}
  })();
  var claiming = false;
  async function tryClaim() {
    if (claiming || !loggedIn()) return;
    var code = window.__ssRefMem || null;
    if (!code) return;
    claiming = true;
    try {
      var r = await post('/api/referral/claim', { code: code });

      if (r.status !== 503 && r.status !== 401 && r.status !== 0) { window.__ssRefMem = null; }
      if (r.data && r.data.ok) {
        toast('Do\'stingiz taklifi orqali kirdingiz — rahmat! 🎉');
        try { if (typeof loadUserStats === 'function') loadUserStats(); } catch (e) {}
      }
    } catch (e) {  }
    claiming = false;
  }
  setInterval(tryClaim, 3000);
  window.Referral = Referral;

  var Feedback = {
    state: { posts: [], total: 0, offset: 0 },
    root: null,
    open: function () {
      var m = modalShell('feedbackModal', 'Izohlar');
      this.root = m.body;
      this.state = { posts: [], total: 0, offset: 0 };
      this.render(true);
      this.load(true);
    },
    composer: function (placeholder, onSend, opts) {
      opts = opts || {};
      var wrap = el('div', 'fb-composer' + (opts.small ? ' small' : ''));
      var ta = el('textarea', 'fb-input'); ta.placeholder = placeholder; ta.rows = opts.small ? 1 : 3; ta.maxLength = 1000;
      var foot = el('div', 'fb-comp-foot');
      var cnt = el('span', 'fb-count', '0/1000');
      var send = el('button', 'fb-send', opts.small ? 'Javob' : 'Yuborish'); send.type = 'button';
      ta.addEventListener('input', function () {
        cnt.textContent = ta.value.length + '/1000';
        if (!opts.small) { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; }
      });
      ta.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send.click(); } e.stopPropagation(); });

      ['keyup', 'keypress'].forEach(function (n) { ta.addEventListener(n, function (e) { e.stopPropagation(); }); });
      send.onclick = async function () {
        var v = ta.value.trim();
        if (v.length < 2) { toast('Matn juda qisqa', 'error'); return; }
        if (!loggedIn()) { askLogin('Fikr yozish uchun avval tizimga kiring'); return; }
        send.disabled = true;
        var ok = await onSend(v);
        send.disabled = false;
        if (ok) { ta.value = ''; cnt.textContent = '0/1000'; ta.style.height = 'auto'; }
      };
      foot.appendChild(cnt); foot.appendChild(send);
      wrap.appendChild(ta); wrap.appendChild(foot);
      return wrap;
    },
    render: function (initial) {
      var self = this, root = this.root;
      if (!root) return;
      root.textContent = '';
      var intro = el('div', 'fb-intro', 'Taklif, shikoyat yoki fikringizni yozing — hamma ko\'ra oladi, layk bosishi va javob yozishi mumkin.');
      root.appendChild(intro);
      root.appendChild(this.composer('Fikringizni yozing…', function (text) { return self.createPost(text, null); }));
      var list = el('div', 'fb-list'); list.id = 'fbList';
      root.appendChild(list);
      if (initial) { list.appendChild(el('div', 'cm-muted', 'Yuklanmoqda…')); return; }
      if (!this.state.posts.length) list.appendChild(el('div', 'cm-muted', 'Hali fikrlar yo\'q. Birinchi bo\'lib yozing!'));
      this.state.posts.forEach(function (p) { list.appendChild(self.renderPost(p)); });
      if (this.state.posts.length < this.state.total) {
        var more = el('button', 'fb-more', 'Yana ko\'rsatish'); more.type = 'button';
        more.onclick = function () { self.load(false); };
        list.appendChild(more);
      }
    },
    load: async function (reset) {
      var self = this;
      if (reset) this.state = { posts: [], total: 0, offset: 0 };
      var r = await api('/api/feedback/list?limit=15&offset=' + this.state.posts.length + '&token=' + encodeURIComponent(tok()));
      if (!r.ok) {
        if (this.root) { this.root.textContent = ''; this.root.appendChild(el('div', 'cm-error', (r.data && r.data.error) || 'Fikrlarni yuklab bo\'lmadi')); }
        return;
      }
      this.state.total = r.data.total || 0;
      this.state.posts = this.state.posts.concat(r.data.posts || []);
      this.render(false);
    },
    createPost: async function (text, parentId) {
      var r = await post('/api/feedback/post', { body: text, parent_id: parentId || undefined });
      if (!r.ok) { toast((r.data && r.data.error) || 'Yuborib bo\'lmadi', 'error'); return false; }
      var np = r.data.post;
      if (parentId) {

        var top = this.findTop(parentId);
        if (top) top.replies.push(np);
      } else {
        this.state.posts.unshift(np); this.state.total++;
      }
      this.render(false);
      return true;
    },
    findTop: function (id) {
      for (var i = 0; i < this.state.posts.length; i++) {
        var p = this.state.posts[i];
        if (p.id === id) return p;
        for (var j = 0; j < p.replies.length; j++) if (p.replies[j].id === id) return p;
      }
      return null;
    },
    topOf: function (id) {
      for (var i = 0; i < this.state.posts.length; i++) {
        var p = this.state.posts[i];
        if (p.id === id) return p;
        for (var j = 0; j < p.replies.length; j++) if (p.replies[j].id === id) return p;
      }
      return null;
    },
    renderPost: function (p, isReply, topId) {
      var self = this;
      var row = el('div', 'fb-post' + (isReply ? ' reply' : ''));
      row.appendChild(avatar(p.author));
      var main = el('div', 'fb-main');
      var head = el('div', 'fb-head');
      head.appendChild(el('b', 'fb-author', p.author));
      head.appendChild(el('span', 'fb-time', timeAgo(p.created_at)));
      main.appendChild(head);
      main.appendChild(el('div', 'fb-body', p.body));
      var act = el('div', 'fb-actions');
      var like = el('button', 'fb-act fb-like' + (p.liked ? ' on' : '')); like.type = 'button';
      var likeIcon = icon('favorite');
      like.appendChild(likeIcon);
      likeIcon.style.fontVariationSettings = p.liked ? "'FILL' 1" : "'FILL' 0";

      var lc = el('span', 'fb-like-count', String(p.likes || 0));
      like.appendChild(lc);

      var paintLike = function () {
        var n = Math.max(0, Number(p.likes) || 0);
        p.likes = n;
        lc.textContent = String(n);
        like.classList.toggle('on', !!p.liked);
        likeIcon.style.fontVariationSettings = p.liked ? "'FILL' 1" : "'FILL' 0";
        like.setAttribute('aria-pressed', p.liked ? 'true' : 'false');
        like.title = p.liked ? 'Laykni bekor qilish' : 'Layk bosish';
      };
      paintLike();
      var likeBusy = false;
      like.onclick = async function () {
        if (!loggedIn()) { askLogin('Layk bosish uchun avval tizimga kiring'); return; }
        if (likeBusy) return;
        likeBusy = true;
        var was = !!p.liked;
        var prevLikes = Math.max(0, Number(p.likes) || 0);

        p.liked = !was;
        p.likes = Math.max(0, prevLikes + (was ? -1 : 1));
        paintLike();
        var r = await post('/api/feedback/like', { id: p.id, liked: p.liked });
        if (!r.ok) {
          p.liked = was; p.likes = prevLikes; paintLike();
          toast((r.data && r.data.error) || 'Layk saqlanmadi', 'error');
        } else {

          p.liked = !!r.data.liked;
          p.likes = Math.max(0, Number(r.data.likes) || 0);
          paintLike();
        }
        likeBusy = false;
      };
      act.appendChild(like);
      var rep = el('button', 'fb-act', 'Javob berish'); rep.type = 'button';
      var replyBox = el('div', 'fb-replybox');
      rep.onclick = function () {
        if (replyBox.firstChild) { replyBox.textContent = ''; return; }
        var target = isReply ? topId : p.id;
        var c = self.composer(isReply ? '@' + p.author + ' ga javob…' : 'Javob yozing…', function (text) {
          return self.createPost(isReply ? ('@' + p.author + ' ' + text) : text, target);
        }, { small: true });
        replyBox.appendChild(c);
        var ta = c.querySelector('textarea'); if (ta) ta.focus();
      };
      act.appendChild(rep);
      if (p.mine) {
        var del = el('button', 'fb-act danger', 'O\'chirish'); del.type = 'button';
        del.onclick = async function () {
          var okDel = true;
          try {
            if (window.Swal) { var res = await Swal.fire({ title: 'O\'chirilsinmi?', text: isReply ? 'Javobingiz o\'chiriladi.' : 'Izohingiz va unga yozilgan barcha javoblar o\'chiriladi.', icon: 'warning', showCancelButton: true, confirmButtonText: 'O\'chirish', cancelButtonText: 'Bekor', confirmButtonColor: '#dc2626', heightAuto: false }); okDel = !!res.isConfirmed; }
            else okDel = confirm('O\'chirilsinmi?');
          } catch (e) {}
          if (!okDel) return;
          var r = await post('/api/feedback/delete', { id: p.id });
          if (!r.ok) { toast((r.data && r.data.error) || 'O\'chirib bo\'lmadi', 'error'); return; }
          if (isReply) { var t = self.topOf(topId); if (t) t.replies = t.replies.filter(function (x) { return x.id !== p.id; }); }
          else { self.state.posts = self.state.posts.filter(function (x) { return x.id !== p.id; }); self.state.total = Math.max(0, self.state.total - 1); }
          self.render(false);
          toast('O\'chirildi');
        };
        act.appendChild(del);
      }
      main.appendChild(act);
      main.appendChild(replyBox);
      if (!isReply && p.replies && p.replies.length) {
        var rw = el('div', 'fb-replies');
        p.replies.forEach(function (r2) { rw.appendChild(self.renderPost(r2, true, p.id)); });
        main.appendChild(rw);
      }
      row.appendChild(main);
      return row;
    },
  };
  window.Feedback = Feedback;

  function addHeaderButtons() {
    var ha = document.querySelector('.header-actions');
    if (!ha || $('btnFeedback')) return;
    var gift = el('button', 'btn-community btn-gift'); gift.id = 'btnReferral'; gift.type = 'button';
    gift.title = 'Do\'st taklif qiling (+15 varaq)';
    gift.appendChild(icon('card_giftcard')); gift.appendChild(el('span', 'cm-label', ' +15'));
    gift.onclick = function () { Referral.open(); };
    var fb = el('button', 'btn-community btn-feedback'); fb.id = 'btnFeedback'; fb.type = 'button';
    fb.title = 'Izohlar'; fb.appendChild(icon('forum')); fb.appendChild(el('span', 'cm-label', ' Izohlar'));
    fb.onclick = function () { Feedback.open(); };
    ha.insertBefore(fb, ha.firstChild);
    ha.insertBefore(gift, ha.firstChild);

    var fm = $('viewMenu');
    if (fm) {
      var a = document.createElement('div'); a.innerHTML = '<span class="material-symbols-outlined">forum</span> Izohlar'; a.onclick = function () { Feedback.open(); }; fm.appendChild(a);
      var b = document.createElement('div'); b.innerHTML = '<span class="material-symbols-outlined">card_giftcard</span> Do\'st taklif qil (+15 varaq)'; b.onclick = function () { Referral.open(); }; fm.appendChild(b);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addHeaderButtons);
  else addHeaderButtons();
})();
