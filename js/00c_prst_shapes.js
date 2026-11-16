/* js/00c_prst_shapes.js (v68) — PowerPoint'ning 187 ta tayyor shakli (ECMA-376 «preset geometry»).
 *
 * Geometriya js/data/prst_shapes.json dan olinadi (ECMA-376 presetShapeDefinitions.xml, Apache POI orqali).
 * PowerPoint va LibreOffice aynan shu formulalar bilan chizadi — shuning uchun:
 *   - saytda: fabric.PrstShape — formulalar shu yerda hisoblanadi (o'lcham o'zgarsa qayta hisoblanadi, cho'zilmaydi);
 *   - PPTX'da: <a:prstGeom prst="NAME"> — PowerPoint/LibreOffice'ning O'Z shakli (tahrirlanadi, sariq tutqichlar ishlaydi).
 * Chegara (stroke) qalinligi shakl kattalashganda o'zgarmaydi — PowerPoint'dagidek (strokeUniform).
 */
(function () {
  'use strict';
  if (typeof fabric === 'undefined' || fabric.PrstShape) return;

  var DATA = null, loading = null;
  function load() {
    if (DATA) return Promise.resolve(DATA);
    if (loading) return loading;
    var base = '';
    try { var me = document.querySelector('script[src*="00c_prst_shapes"]'); if (me) base = me.getAttribute('src').replace(/00c_prst_shapes\.js.*$/, ''); } catch (e) {}
    loading = fetch(base + 'data/prst_shapes.json').then(function (r) { if (!r.ok) throw new Error('prst ' + r.status); return r.json(); })
      .then(function (j) { DATA = j; try { document.dispatchEvent(new Event('ss-prst-ready')); } catch (e) {} return j; })
      .catch(function (e) { loading = null; console.warn('[prst] geometriya yuklanmadi:', e); throw e; });
    return loading;
  }

  /* ---------------- ECMA-376 formulalari (20.1.9.11 «gd») ---------------- */
  var DEG = 60000, RAD = Math.PI / 180 / DEG;
  function builtins(w, h) {
    var ss = Math.min(w, h), ls = Math.max(w, h);
    var v = { w: w, h: h, l: 0, t: 0, r: w, b: h, hc: w / 2, vc: h / 2, ss: ss, ls: ls,
      cd2: 10800000, cd4: 5400000, cd8: 2700000, '3cd4': 16200000, '3cd8': 8100000, '5cd8': 13500000, '7cd8': 18900000 };
    [2, 3, 4, 5, 6, 8, 10, 12, 32].forEach(function (k) { v['wd' + k] = w / k; v['hd' + k] = h / k; });
    [2, 4, 6, 8, 16, 32].forEach(function (k) { v['ssd' + k] = ss / k; });
    return v;
  }
  function evalFmla(f, V) {
    var a = f.split(/\s+/), op = a[0];
    var x = function (i) { var s = a[i]; if (s == null) return 0; var n = Number(s); return isFinite(n) ? n : (V[s] != null ? V[s] : 0); };
    switch (op) {
      case 'val': return x(1);
      case '*/': return x(3) === 0 ? 0 : x(1) * x(2) / x(3);
      case '+-': return x(1) + x(2) - x(3);
      case '+/': return x(3) === 0 ? 0 : (x(1) + x(2)) / x(3);
      case '?:': return x(1) > 0 ? x(2) : x(3);
      case 'abs': return Math.abs(x(1));
      case 'at2': return Math.atan2(x(2), x(1)) / RAD;
      case 'cat2': return x(1) * Math.cos(Math.atan2(x(3), x(2)));
      case 'sat2': return x(1) * Math.sin(Math.atan2(x(3), x(2)));
      case 'cos': return x(1) * Math.cos(x(2) * RAD);
      case 'sin': return x(1) * Math.sin(x(2) * RAD);
      case 'tan': return x(1) * Math.tan(x(2) * RAD);
      case 'max': return Math.max(x(1), x(2));
      case 'min': return Math.min(x(1), x(2));
      case 'mod': return Math.sqrt(x(1) * x(1) + x(2) * x(2) + x(3) * x(3));
      case 'pin': return x(2) < x(1) ? x(1) : (x(2) > x(3) ? x(3) : x(2));
      case 'sqrt': return Math.sqrt(Math.max(0, x(1)));
      default: return 0;
    }
  }
  function defaults(name) {
    var d = DATA && DATA[name], o = {};
    if (d) d.av.forEach(function (g) { o[g[0]] = evalFmla(g[1], {}); });
    return o;
  }
  /**
   * Geometriya: [{ fill: 'norm'|'none'|'darken'|…, stroke: bool, cmds: [[op, …]] }] — px, quti (0,0)-(w,h).
   * adj: { adj: 25000, … } — PowerPoint sozlash qiymatlari (yo'q bo'lsa standart).
   */
  function geometry(name, w, h, adj) {
    var d = DATA && DATA[name];
    if (!d) return null;
    var V = builtins(w, h);
    d.av.forEach(function (g) { V[g[0]] = adj && adj[g[0]] != null && isFinite(+adj[g[0]]) ? +adj[g[0]] : evalFmla(g[1], V); });
    d.gd.forEach(function (g) { V[g[0]] = evalFmla(g[1], V); });
    var num = function (s) { var n = Number(s); return isFinite(n) ? n : (V[s] != null ? V[s] : 0); };
    return d.p.map(function (p) {
      var kx = p.w ? w / p.w : 1, ky = p.h ? h / p.h : 1;
      var cmds = [], cx = 0, cy = 0, sx = 0, sy = 0;
      p.c.forEach(function (c) {
        switch (c[0]) {
          case 'M': cx = num(c[1]) * kx; cy = num(c[2]) * ky; sx = cx; sy = cy; cmds.push(['M', cx, cy]); break;
          case 'L': cx = num(c[1]) * kx; cy = num(c[2]) * ky; cmds.push(['L', cx, cy]); break;
          case 'Q': cmds.push(['Q', num(c[1]) * kx, num(c[2]) * ky, num(c[3]) * kx, num(c[4]) * ky]); cx = num(c[3]) * kx; cy = num(c[4]) * ky; break;
          case 'C': cmds.push(['C', num(c[1]) * kx, num(c[2]) * ky, num(c[3]) * kx, num(c[4]) * ky, num(c[5]) * kx, num(c[6]) * ky]); cx = num(c[5]) * kx; cy = num(c[6]) * ky; break;
          case 'A': {
            // OOXML burchagi «ko'rinadigan» burchak — ellips parametriga o'tkaziladi (Apache POI / LibreOffice bilan bir xil)
            var rx = num(c[1]) * kx, ry = num(c[2]) * ky, st = num(c[3]) / DEG * Math.PI / 180, sw = num(c[4]) / DEG * Math.PI / 180;
            var par = function (a) { return Math.atan2(rx * Math.sin(a), ry * Math.cos(a)); };
            var t1 = par(st), t2 = par(st + sw), dt = t2 - t1;
            if (Math.abs(sw) >= 2 * Math.PI - 1e-9) dt = sw > 0 ? 2 * Math.PI : -2 * Math.PI;
            else if (sw > 0 && dt < 0) dt += 2 * Math.PI;
            else if (sw < 0 && dt > 0) dt -= 2 * Math.PI;
            var ocx = cx - rx * Math.cos(t1), ocy = cy - ry * Math.sin(t1);
            cmds.push(['E', ocx, ocy, Math.abs(rx), Math.abs(ry), t1, t1 + dt, dt < 0]);
            cx = ocx + rx * Math.cos(t1 + dt); cy = ocy + ry * Math.sin(t1 + dt);
            break;
          }
          case 'Z': cmds.push(['Z']); cx = sx; cy = sy; break;
        }
      });
      return { fill: p.f || 'norm', stroke: p.s !== 0, cmds: cmds };
    });
  }
  function trace(ctx, cmds) {
    cmds.forEach(function (c) {
      switch (c[0]) {
        case 'M': ctx.moveTo(c[1], c[2]); break;
        case 'L': ctx.lineTo(c[1], c[2]); break;
        case 'Q': ctx.quadraticCurveTo(c[1], c[2], c[3], c[4]); break;
        case 'C': ctx.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]); break;
        case 'E': if (c[3] > 0 && c[4] > 0) ctx.ellipse(c[1], c[2], c[3], c[4], 0, c[5], c[6], c[7]); break;
        case 'Z': ctx.closePath(); break;
      }
    });
  }
  /** SVG yo'li (menyu ikonlari va HTML eksport uchun) */
  function toSvgPath(geom) {
    var f = function (v) { return Math.round(v * 100) / 100; }, out = [];
    geom.forEach(function (p) {
      p.cmds.forEach(function (c) {
        if (c[0] === 'E') {
          var cx = c[1], cy = c[2], rx = c[3], ry = c[4], a0 = c[5], a1 = c[6];
          var segs = Math.max(1, Math.ceil(Math.abs(a1 - a0) / Math.PI));
          if (out.length === 0) out.push('M', f(cx + rx * Math.cos(a0)), f(cy + ry * Math.sin(a0)));
          else out.push('L', f(cx + rx * Math.cos(a0)), f(cy + ry * Math.sin(a0)));
          for (var i = 1; i <= segs; i++) {
            var a = a0 + (a1 - a0) * i / segs, prev = a0 + (a1 - a0) * (i - 1) / segs;
            out.push('A', f(rx), f(ry), 0, Math.abs(a - prev) > Math.PI ? 1 : 0, a > prev ? 1 : 0, f(cx + rx * Math.cos(a)), f(cy + ry * Math.sin(a)));
          }
        } else out.push.apply(out, [c[0]].concat(c.slice(1).map(f)));
      });
    });
    return out.join(' ');
  }
  var SHADE = { darken: 'rgba(0,0,0,0.4)', darkenLess: 'rgba(0,0,0,0.2)', lighten: 'rgba(255,255,255,0.4)', lightenLess: 'rgba(255,255,255,0.2)' };

  fabric.PrstShape = fabric.util.createClass(fabric.Object, {
    type: 'prstShape',
    prst: 'rect',
    adj: null,
    strokeUniform: true,
    initialize: function (options) {
      options = options || {};
      this.callSuper('initialize', options);
      this.prst = options.prst || 'rect';
      this.adj = options.adj || null;
      if (options.strokeUniform == null) this.strokeUniform = true;
      if (!DATA) { var self = this; load().then(function () { self.dirty = true; if (self.canvas) self.canvas.requestRenderAll(); }).catch(function () {}); }
    },
    _render: function (ctx) {
      var sx = Math.abs(this.scaleX) || 1, sy = Math.abs(this.scaleY) || 1;
      var W = this.width * sx, H = this.height * sy;
      var g = geometry(this.prst, W, H, this.adj);
      ctx.save();
      ctx.scale(1 / sx, 1 / sy);                       // geometriya HAQIQIY o'lchamda hisoblanadi (PowerPoint kabi)
      ctx.translate(-W / 2, -H / 2);
      if (!g) { ctx.beginPath(); ctx.rect(0, 0, W, H); g = [{ fill: 'norm', stroke: true, cmds: null }]; }
      // PowerPoint / LibreOffice kabi: avval HAMMA to'ldirishlar, keyin HAMMA chiziqlar (ichki chiziqlar yopilib qolmaydi)
      var i, p;
      if (this.fill) for (i = 0; i < g.length; i++) {
        p = g[i];
        if (p.fill === 'none') continue;
        ctx.beginPath();
        if (p.cmds) trace(ctx, p.cmds); else ctx.rect(0, 0, W, H);
        this._setFillStyles(ctx, this);
        ctx.fill(this.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
        if (SHADE[p.fill]) { var fs = ctx.fillStyle; ctx.fillStyle = SHADE[p.fill]; ctx.fill(); ctx.fillStyle = fs; }
      }
      if (this.stroke && this.strokeWidth > 0) for (i = 0; i < g.length; i++) {
        p = g[i];
        if (!p.stroke) continue;
        ctx.beginPath();
        if (p.cmds) trace(ctx, p.cmds); else ctx.rect(0, 0, W, H);
        this._setStrokeStyles(ctx, this);
        ctx.stroke();
      }
      ctx.restore();
    },
    toObject: function (props) {
      return fabric.util.object.extend(this.callSuper('toObject', props), { prst: this.prst, adj: this.adj });
    }
  });
  fabric.PrstShape.fromObject = function (object, callback) {
    var make = function () { return fabric.Object._fromObject('PrstShape', object, callback); };
    load().then(make, make);
  };

  window.SS_PRST = {
    load: load, geometry: geometry, toSvgPath: toSvgPath, defaults: defaults,
    has: function (n) { return !!(DATA && DATA[n]); },
    names: function () { return DATA ? Object.keys(DATA) : []; },
    get ready() { return !!DATA; },
    /** Saytga qo'shish uchun obyekt */
    create: function (name, o) {
      o = o || {};
      return new fabric.PrstShape(Object.assign({ prst: name, left: 380, top: 200, width: 200, height: 140, fill: '#3b82f6', stroke: '#1e3a8a', strokeWidth: 2 }, o));
    }
  };
  load().catch(function () {});
})();
