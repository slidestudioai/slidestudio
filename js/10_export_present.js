    function _presProxyUrl(url) {
      if (!url || typeof url !== 'string') return '';
      if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/')) return url;
      if (/^https?:\/\//i.test(url)) return '/api/proxy-image?raw=1&url=' + encodeURIComponent(url);
      return url;
    }
    let _presGifGen = 0;
    function clearPresentationGifs() {
      const gifLayer = document.getElementById('presentationGifOverlay');
      const gifBgLayer = document.getElementById('presentationGifBg');
      if (gifLayer) gifLayer.innerHTML = '';
      if (gifBgLayer) {
        gifBgLayer.innerHTML = '';
        gifBgLayer.style.display = 'none';
      }
    }
    function renderPresentationGifs(slide, gen) {
      const gifLayer = document.getElementById('presentationGifOverlay');
      const gifBgLayer = document.getElementById('presentationGifBg');
      const imgEl = document.getElementById('presentationImage');
      const stage = document.getElementById('presStage') || (imgEl && imgEl.parentElement);
      if (!gifLayer || !imgEl || !stage) return;
      gifLayer.innerHTML = '';
      if (gifBgLayer) { gifBgLayer.innerHTML = ''; gifBgLayer.style.display = 'none'; }
      let parsed = {};
      try { parsed = JSON.parse((slide && slide.json) || '{}'); } catch (e) { return; }
      const gifs = (parsed.objects || []).filter(o => o && (o.isGif || o.type === 'gifImage'));
      const bgGifUrl = (parsed.backgroundGif && (parsed.backgroundGif.src || parsed.backgroundGif.url)) || '';
      if (!gifs.length && !bgGifUrl) return;

      const layoutLayer = (layerEl) => {
        layerEl.style.position = 'absolute';
        layerEl.style.left = '0';
        layerEl.style.top = '0';
        layerEl.style.width = '100%';
        layerEl.style.height = '100%';
        layerEl.style.pointerEvents = 'none';
        layerEl.style.overflow = 'hidden';
      };
      layoutLayer(gifLayer);
      gifLayer.style.zIndex = '3';
      if (gifBgLayer && bgGifUrl) {
        layoutLayer(gifBgLayer);
        gifBgLayer.style.zIndex = '1';
        gifBgLayer.style.display = 'block';
        const bgIm = document.createElement('img');
        bgIm.alt = '';
        bgIm.decoding = 'async';
        bgIm.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        const proxied = _presProxyUrl(bgGifUrl);
        gifBgLayer.appendChild(bgIm);
        try { MediaSkeleton.attach(gifBgLayer, bgIm, { kind: 'gif', src: proxied }); } catch (e) {}
        bgIm.src = proxied;
        try { imgEl.style.background = 'transparent'; } catch (e) {}
      }
      gifs.forEach((g) => {
        if (gen != null && gen !== _presGifGen) return;
        const url = g.gifUrl || g.src;
        if (!url) return;
        const w = (g.width || 300) * (g.scaleX != null ? g.scaleX : 1);
        const h = (g.height || 200) * (g.scaleY != null ? g.scaleY : 1);
        let left = (g.left || 0);
        let top = (g.top || 0);
        const ox = g.originX || 'left';
        const oy = g.originY || 'top';
        if (ox === 'center') left -= w / 2;
        else if (ox === 'right') left -= w;
        if (oy === 'center') top -= h / 2;
        else if (oy === 'bottom') top -= h;
        const wrap = document.createElement('div');
        wrap.className = 'gif-overlay-item';
        wrap.style.position = 'absolute';
        wrap.style.left = (left / 960 * 100) + '%';
        wrap.style.top = (top / 540 * 100) + '%';
        wrap.style.width = (w / 960 * 100) + '%';
        wrap.style.height = (h / 540 * 100) + '%';
        wrap.style.transform = 'rotate(' + (g.angle || 0) + 'deg)';
        wrap.style.transformOrigin = 'center center';
        const im = document.createElement('img');
        im.alt = '';
        im.decoding = 'async';
        im.style.cssText = 'width:100%;height:100%;object-fit:fill;display:block;';
        wrap.appendChild(im);
        gifLayer.appendChild(wrap);
        const proxied = _presProxyUrl(url);
        try { MediaSkeleton.attach(wrap, im, { kind: 'gif', src: proxied }); } catch (e) {}
        im.src = proxied;
      });
    }
    let _presTransitionDir = 'next';
    async function renderPresentationSlide() {
      const imgEl = document.getElementById('presentationImage');
      const slide = slides[presentationIndex];
      if (!imgEl || !slide) return;
      const myGen = ++_presGifGen;

      clearPresentationGifs();
      document.getElementById('presCounter').innerText = `${presentationIndex + 1} / ${slides.length}`;
      imgEl.classList.remove('loaded');

      let waitEl = document.getElementById('presWaitHint');
      if (!waitEl) {
        waitEl = document.createElement('div');
        waitEl.id = 'presWaitHint';
        waitEl.style.cssText = 'position:absolute;bottom:70px;left:50%;transform:translateX(-50%);color:#fff;background:rgba(0,0,0,.55);padding:6px 14px;border-radius:16px;font-size:13px;z-index:20;pointer-events:none;';
        const cont = document.querySelector('.pres-canvas-container') || document.getElementById('presentationOverlay');
        if (cont) cont.appendChild(waitEl);
      }
      waitEl.textContent = '⏳ Yuklanmoqda...';
      waitEl.style.display = 'block';
      let finalSrc = slide.thumb;
      try {

        finalSrc = await renderSlideToOptimizedDataURL(slide.json, { skipElementGifs: true, segment: 0 });
      } catch (e) {  }
      try {
        window.__presSegCache = { slide: slide, urls: (typeof presRenderSegments === 'function' || window.presRenderSegments) ? await window.presRenderSegments(slide) : [] };
      } catch (e) { window.__presSegCache = { slide: slide, urls: [] }; }
      if (myGen !== _presGifGen) return;
      const pre = new Image();
      const applySrc = () => {
        if (myGen !== _presGifGen) return;
        if (presentationIndex >= 0 && slides[presentationIndex] === slide) {
          imgEl.src = finalSrc || slide.thumb || '';
          try {
            const _tgt = document.getElementById('presStage') || imgEl;   // v27: butun sahna (video, GIF, qatlamlar) birga o'tadi
            _tgt.classList.remove('pres-anim-next', 'pres-anim-prev');
            void _tgt.offsetWidth;
            _tgt.classList.add(_presTransitionDir === 'prev' ? 'pres-anim-prev' : 'pres-anim-next');
            try { if (window.ssApplyPresTransition) window.ssApplyPresTransition(_tgt, slide); } catch (e) {}   // v48: slayd o'tish animatsiyasi
          } catch (e) {  }
          requestAnimationFrame(() => {
            imgEl.classList.add('loaded');
            try {
              const w = document.getElementById('presWaitHint');
              if (w) w.style.display = 'none';
            } catch (e) {}
          });
          try { renderPresentationGifs(slide, myGen); } catch (e) {  }
        }
      };
      pre.onload = applySrc;
      pre.onerror = () => {
        if (myGen !== _presGifGen) return;
        imgEl.src = finalSrc || slide.thumb || '';
        imgEl.classList.add('loaded');
        try { const w = document.getElementById('presWaitHint'); if (w) w.style.display = 'none'; } catch (e) {}
        try { renderPresentationGifs(slide, myGen); } catch (e) {}
      };
      if (finalSrc) pre.src = finalSrc;
      else applySrc();
    }
    function nextPresentationSlide() {
      if (presentationIndex < slides.length - 1) {
        _presTransitionDir = 'next';
        presentationIndex++;
        renderPresentationSlide();
      }
    }
    function prevPresentationSlide() {
      if (presentationIndex > 0) {
        _presTransitionDir = 'prev';
        presentationIndex--;
        renderPresentationSlide();
      }
    }
    window.openExportModal = function openExportModal() { document.getElementById('exportModal').style.display = 'flex'; }
    window.closeExportModal = function closeExportModal() { document.getElementById('exportModal').style.display = 'none'; }
    function openImportModal() {
      closeContextMenus();
      document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none');
      openSmartImportDialog();
    }
    async function openSmartImportDialog() {
      const result = await Swal.fire({
        title: '📂 Fayl ochish',
        html: '<div style="text-align:left;font-size:13px;line-height:1.7;color:#3c4043;">' +
              '<div style="margin-bottom:8px;"><b>.pptx</b> — PowerPoint (qayta tahrirlash)</div>' +
              '<div style="margin-bottom:8px;"><b>.pdf</b> — har sahifa alohida slayd</div>' +
              '<div><b>.html</b> — namoyish + qayta tahrirlash</div>' +
              '</div>',
        input: 'file',
        inputAttributes: { accept: '.html,.htm,.pptx,.pdf' },
        showCancelButton: true,
        confirmButtonText: 'Ochish',
        cancelButtonText: 'Bekor',
        confirmButtonColor: '#0b57d0',
        cancelButtonColor: '#6b7280',
        heightAuto: false,
        inputValidator: (file) => (!file ? 'Faylni tanlang!' : null),
      });
      if (!result.isConfirmed || !result.value) return;
      await processImportFile(result.value);
    }
    window.openSmartImportDialog = openSmartImportDialog;
    async function processImportFile(file) {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (ext === 'json' || ext === 'slide') {
        Swal.fire('Eslatma', 'JSON format endi qo\'llab-quvvatlanmaydi. PPTX yoki HTML dan foydalaning.', 'info');
        return;
      }
      if (ext === 'json' || ext === 'slide') {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          const list = data.slides || data.slides_data || [];
          if (!Array.isArray(list) || list.length === 0) {
            Swal.fire('Xato', 'JSON ichida slayd topilmadi.', 'error');
            return;
          }
          saveCurrentSlideState();
          if (data.title) {
            projectTitle = data.title;
            const titleEl = document.getElementById('presentationTitle');
            if (titleEl) titleEl.innerText = projectTitle;
          }
          slides = list.map(s => ({
            json: s.json || '{}',
            thumb: s.thumb || '',
            imageNumbers: s.imageNumbers || []
          }));
          activeIndex = 0;
          bumpObjectIdCounterFromSlides();
          renderSidebar();
          await loadSlideCanvasAsync(0);
          try { GifBackground.applyFromSlide(slides[0].json); } catch (e) {}
          updateSlideCounterUI();
          updateAllImageBadges();

          try {
            await Promise.all(slides.map((_, i) => refreshSlideThumb(i)));
          } catch (e) {}
          recordGlobalState();
          Swal.fire({
            icon: 'success', title: 'Tayyor!',
            text: list.length + " ta slayd loyihaga yuklandi. Endi tahrirlashingiz mumkin.",
            timer: 2200, showConfirmButton: false
          });
        } catch (e) {
          Swal.fire('JSON xato', "Fayl buzilgan yoki noto'g'ri format: " + e.message, 'error');
        }
        return;
      }
      if (ext === 'html' || ext === 'htm') {
        try {
          const text = await file.text();

          let projectData = null;
          // v49.2: bot yasagan HTML — ichida PPTX nusxasi bor: shuni muharrirga ochamiz
          const mp = text.match(/<script[^>]*id=["']ss-pptx["'][^>]*>([\s\S]*?)<\/script>/i);
          if (mp && mp[1] && typeof importPptxClient === 'function') {
            try {
              const bin = atob(mp[1].trim()), u8 = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
              await importPptxClient(new File([u8], (file.name || 'taqdimot').replace(/\.html?$/i, '') + '.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
              return;
            } catch (e) { console.warn('ss-pptx:', e); }
          }
          const m1 = text.match(/<script[^>]*id=["']project-data["'][^>]*>([\s\S]*?)<\/script>/i);
          if (m1 && m1[1]) {
            try { projectData = JSON.parse(m1[1].trim()); } catch (e) {}
          }
          if (!projectData) {
            const m2 = text.match(/<!--SLIDE_STUDIO_DATA:([\s\S]*?)-->/);
            if (m2 && m2[1]) {
              try { projectData = JSON.parse(m2[1].trim()); } catch (e) {}
            }
          }
          if (!projectData) {
            // v33: project-data topilmasa ham, namoyish ma'lumoti (slide-data) dan tahrirlanadigan slaydlar tiklanadi
            const m3 = text.match(/<script[^>]*id=["']slide-data["'][^>]*>([\s\S]*?)<\/script>/i);
            if (m3 && m3[1]) {
              try {
                const arr = JSON.parse(m3[1].trim());
                if (Array.isArray(arr) && arr.length && arr.every(function (p) { return p && typeof p === 'object'; })) {
                  const tm = text.match(/<title>([^<]*)<\/title>/i);
                  projectData = { title: tm ? tm[1].trim() : '', slides: arr.map(function (p) { return { json: JSON.stringify(p) }; }) };
                }
              } catch (e) {}
            }
          }
          if (projectData && (projectData.slides || projectData.slides_data)) {
            // v31: Slide Studio HTML fayli har doim to'g'ridan-to'g'ri tahrirlash rejimida ochiladi (savol berilmaydi)
            const choice = { isConfirmed: true, isDenied: false };
            if (choice.isConfirmed) {
              const list = projectData.slides || projectData.slides_data || [];
              saveCurrentSlideState();
              if (projectData.title) {
                projectTitle = projectData.title;
                const titleEl = document.getElementById('presentationTitle');
                if (titleEl) titleEl.innerText = projectTitle;
              }
              slides = list.map(s => ({
                json: s.json || '{}',
                thumb: s.thumb || '',
                imageNumbers: s.imageNumbers || [],
                transition: s.transition || ''
              }));
              activeIndex = 0;
              bumpObjectIdCounterFromSlides();
              renderSidebar();
              await loadSlideCanvasAsync(0);
              try { GifBackground.applyFromSlide(slides[0].json); } catch (e) {}
              updateSlideCounterUI();
              updateAllImageBadges();
              recordGlobalState();

              try { await Promise.all(slides.map((_, i) => refreshSlideThumb(i))); } catch (e) {}
              Swal.fire({ icon: 'success', title: 'Tayyor!', text: list.length + ' ta slayd tahrirlash uchun ochildi.', timer: 2000, showConfirmButton: false });
              return;
            }
            if (choice.isDenied) {
              const blob = new Blob([text], { type: 'text/html' });
              const url = URL.createObjectURL(blob);
              const win = window.open(url, '_blank');
              setTimeout(() => URL.revokeObjectURL(url), 20000);
              if (!win) Swal.fire('Bloklangan', "Pop-up bloklangan.", 'warning');
              return;
            }
            return;
          }

          const blob = new Blob([text], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          const win = window.open(url, '_blank');
          setTimeout(() => URL.revokeObjectURL(url), 20000);
          if (!win) Swal.fire('Bloklangan', "Pop-up bloklangan.", 'warning');
        } catch (e) {
          Swal.fire('HTML xato', e.message, 'error');
        }
        return;
      }

      if (ext === 'pdf') {
        await importPdfClient(file);
        return;
      }
      if (ext === 'pptx') {
        await importPptxClient(file);
        return;
      }
      Swal.fire('Xato', "Qo'llab-quvvatlanmaydigan fayl turi: ." + ext, 'error');
    }

    // ===== v27: PDF ichidagi tahrirlash ma'lumotini ishonchli topish =====
    const SS_META_BEGIN = '%%SS-META-BEGIN:';
    const SS_META_END = ':SS-META-END%%';
    function ssBytesToB64(bytes) {
      let bin = '';
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      return btoa(bin);
    }
    function ssB64ToBytes(b64) {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    function ssAppendMetaTrailer(pdfBytes, metaStr) {
      // %%EOF dan KEYIN yozish ba'zi PDF o'quvchilarda (Adobe, mobil) "fayl buzilgan" xatosini beradi.
      // Meta ni oxirgi %%EOF DAN OLDIN PDF comment sifatida qo'yamiz — struktura to'g'ri qoladi.
      const b64 = ssBytesToB64(new TextEncoder().encode(metaStr));
      const comment = new TextEncoder().encode('\n% ' + SS_META_BEGIN + b64 + SS_META_END + '\n');
      const eofMark = new TextEncoder().encode('%%EOF');
      let pos = -1;
      for (let i = pdfBytes.length - eofMark.length; i >= 0; i--) {
        let ok = true;
        for (let j = 0; j < eofMark.length; j++) {
          if (pdfBytes[i + j] !== eofMark[j]) { ok = false; break; }
        }
        if (ok) { pos = i; break; }
      }
      if (pos < 0) {
        const out = new Uint8Array(pdfBytes.length + comment.length);
        out.set(pdfBytes, 0);
        out.set(comment, pdfBytes.length);
        return out;
      }
      const out = new Uint8Array(pdfBytes.length + comment.length);
      out.set(pdfBytes.subarray(0, pos), 0);
      out.set(comment, pos);
      out.set(pdfBytes.subarray(pos), pos + comment.length);
      return out;
    }
    async function ssExtractMeta(pdfDoc, buf) {
      // 1) PDF oxiriga qo'shilgan (siqilmagan) nusxa — eng ishonchli
      try {
        const u8 = new Uint8Array(buf);
        const endMark = new TextEncoder().encode(SS_META_END);
        const begMark = new TextEncoder().encode(SS_META_BEGIN);
        const find = (hay, needle, from, backwards) => {
          const n = needle.length;
          if (backwards) { for (let i = from - n; i >= 0; i--) { let ok = true; for (let j = 0; j < n; j++) if (hay[i + j] !== needle[j]) { ok = false; break; } if (ok) return i; } }
          else { for (let i = from; i <= hay.length - n; i++) { let ok = true; for (let j = 0; j < n; j++) if (hay[i + j] !== needle[j]) { ok = false; break; } if (ok) return i; } }
          return -1;
        };
        const e = find(u8, endMark, u8.length, true);
        if (e > 0) {
          const b = find(u8, begMark, e, true);
          if (b >= 0) {
            const b64 = new TextDecoder('latin1').decode(u8.subarray(b + begMark.length, e));
            return ssB64ToBytes(b64);
          }
        }
      } catch (err) { console.warn('SS trailer:', err); }
      // 2) Biriktirilgan fayl (EmbeddedFile) — siqilgan oqimni ochib o'qiymiz
      try {
        if (pdfDoc && window.PDFLib && PDFLib.decodePDFRawStream && pdfDoc.context && pdfDoc.context.enumerateIndirectObjects) {
          for (const [, obj] of pdfDoc.context.enumerateIndirectObjects()) {
            try {
              if (!obj || !obj.contents || !obj.dict) continue;
              const type = obj.dict.get(PDFLib.PDFName.of('Type'));
              if (!type || String(type) !== '/EmbeddedFile') continue;
              const bytes = PDFLib.decodePDFRawStream(obj).decode();
              const txt = new TextDecoder().decode(bytes);
              if (txt.indexOf('slide-studio-layout') >= 0) return bytes;
            } catch (_) {}
          }
        }
      } catch (err) { console.warn('SS embedded:', err); }
      return null;
    }
    async function importPdfClient(file) {
      if (!window.pdfjsLib && !(window.PDFLib && window.PDFLib.PDFDocument)) {
        Swal.fire('Xato', 'PDF kutubxonasi yuklanmadi. Internetni tekshiring.', 'error');
        return;
      }
      Swal.fire({ title: 'PDF ochilmoqda...', html: 'Editable metadata qidirilmoqda...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      try {
        const buf = await file.arrayBuffer();

        // v46.1: Eng birinchi — raw baytlardan SS-META trailer / comment ni qidiramiz (pdf-lib dan oldin)
        try {
          const early = await ssExtractMeta(null, buf);
          if (early) {
            let jsonString = new TextDecoder().decode(early);
            const fmtIdx = jsonString.indexOf('"format"');
            if (fmtIdx > 0) {
              const brace = jsonString.lastIndexOf('{', fmtIdx);
              if (brace >= 0) jsonString = jsonString.slice(brace);
            }
            const meta = JSON.parse(jsonString);
            if (meta && meta.format === 'slide-studio-layout' && Array.isArray(meta.slides) && meta.slides.length) {
              slides = meta.slides.map((s) => ({
                json: s.json || JSON.stringify({ objects: [], background: '#ffffff' }),
                thumb: '',
                imageNumbers: s.imageNumbers || []
              }));
              activeIndex = 0;
              try { bumpObjectIdCounterFromSlides(); recalculateGlobalImageCounter(); } catch (e) {}
              for (let i = 0; i < slides.length; i++) { try { await refreshSlideThumb(i); } catch (e) {} }
              await loadSlideCanvasAsync(0);
              renderSidebar(); updateSlideCounterUI(); recordGlobalState();
              Swal.close();
              showToast('PDF hybrid metadata: tahrirlanadigan slaydlar tiklandi');
              return;
            }
          }
        } catch (earlyErr) { console.warn('early meta:', earlyErr); }

        try {
          if (window.PDFLib && window.PDFLib.PDFDocument) {
            const { PDFDocument } = window.PDFLib;
            const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
            let metaBytes = null;

            try {
              const attachments = pdfDoc.getAttachments ? pdfDoc.getAttachments() : null;
              if (attachments && typeof attachments === 'object') {
                const names = Object.keys(attachments);
                const key = names.find((n) =>
                  /slide_studio_project\.json/i.test(n) ||
                  /slide-studio-layout\.json/i.test(n) ||
                  /slide.studio.*\.json/i.test(n) ||
                  /\.json$/i.test(n)
                );
                if (key) {
                  const entry = attachments[key];
                  if (entry instanceof Uint8Array) metaBytes = entry;
                  else if (entry && entry.data instanceof Uint8Array) metaBytes = entry.data;
                  else if (entry && entry instanceof ArrayBuffer) metaBytes = new Uint8Array(entry);
                  else if (entry && typeof entry === 'object' && entry.buffer) metaBytes = new Uint8Array(entry.buffer);
                }
              }
            } catch (attErr) { console.warn('getAttachments:', attErr); }

            if (!metaBytes) { try { metaBytes = await ssExtractMeta(pdfDoc, buf); } catch (_) {} }
            if (!metaBytes) {
              try {
                const ctx = pdfDoc.context;
                const catalog = pdfDoc.catalog;
                const namesDict = catalog.lookup && catalog.lookup(PDFLib.PDFName.of('Names'));
                if (namesDict) {
                  const ef = namesDict.lookup && namesDict.lookup(PDFLib.PDFName.of('EmbeddedFiles'));

                  if (ctx && ctx.enumerateIndirectObjects) {
                    const objs = ctx.enumerateIndirectObjects();
                    for (const [, obj] of objs) {
                      try {
                        if (obj && obj.contents) {
                          const txt = new TextDecoder().decode(obj.contents);
                          if (txt.includes('"format":"slide-studio-layout"') || txt.includes('"format": "slide-studio-layout"')) {
                            metaBytes = obj.contents;
                            break;
                          }
                        }
                      } catch (_) {}
                    }
                  }
                }
              } catch (_) {}
            }
            if (metaBytes) {
              let jsonString = '';
              try { jsonString = new TextDecoder().decode(metaBytes); } catch (_) {
                jsonString = String.fromCharCode.apply(null, metaBytes);
              }

              const fmtIdx = jsonString.indexOf('"format"');
              if (fmtIdx > 0) {
                const brace = jsonString.lastIndexOf('{', fmtIdx);
                if (brace >= 0) jsonString = jsonString.slice(brace);
              }
              const meta = JSON.parse(jsonString);
              if (meta && meta.format === 'slide-studio-layout' && Array.isArray(meta.slides) && meta.slides.length) {
                slides = meta.slides.map((s) => ({
                  json: s.json || JSON.stringify({ objects: [], background: '#ffffff' }),
                  thumb: '',
                  imageNumbers: s.imageNumbers || []
                }));
                activeIndex = 0;
                try { bumpObjectIdCounterFromSlides(); recalculateGlobalImageCounter(); } catch (e) {}
                for (let i = 0; i < slides.length; i++) {
                  try { await refreshSlideThumb(i); } catch (e) {}
                }
                await loadSlideCanvasAsync(0);
                renderSidebar();
                updateSlideCounterUI();
                recordGlobalState();
                Swal.close();
                showToast('PDF hybrid metadata: tahrirlanadigan slaydlar + GIF tiklandi');
                return;
              }
            }
          }
        } catch (e) {
          console.warn('pdf-lib attachment read:', e);
        }

        try {
          const asText = new TextDecoder('latin1').decode(buf);
          const marker = '"format":"slide-studio-layout"';
          const idx = asText.indexOf(marker);
          if (idx > 0) {
            let start = asText.lastIndexOf('{', idx);
            if (start >= 0) {
              let depth = 0, end = -1;
              for (let k = start; k < Math.min(asText.length, start + 8e6); k++) {
                const ch = asText[k];
                if (ch === '{') depth++;
                else if (ch === '}') { depth--; if (depth === 0) { end = k; break; } }
              }
              if (end > start) {
                const meta = JSON.parse(asText.slice(start, end + 1));
                if (meta && meta.format === 'slide-studio-layout' && Array.isArray(meta.slides) && meta.slides.length) {
                  slides = meta.slides.map((s) => ({
                    json: s.json || JSON.stringify({ objects: [], background: '#ffffff' }),
                    thumb: '',
                    imageNumbers: s.imageNumbers || []
                  }));
                  activeIndex = 0;
                  for (let i = 0; i < slides.length; i++) {
                    try { await refreshSlideThumb(i); } catch (e) {}
                  }
                  await loadSlideCanvasAsync(0);
                  renderSidebar();
                  updateSlideCounterUI();
                  recordGlobalState();
                  Swal.close();
                  showToast('PDF metadata (fallback) dan tahrirlanadigan slaydlar tiklandi');
                  return;
                }
              }
            }
          }
        } catch (e) {  }

        if (!window.pdfjsLib) {
          Swal.fire('Xato', 'Oddiy PDF uchun pdf.js kerak.', 'error');
          return;
        }

        const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
        // v31: pdf.js orqali biriktirilgan Slide Studio loyihasini ham qidiramiz (pdf-lib o'qiy olmagan holatlar uchun)
        try {
          const att = pdf.getAttachments ? await pdf.getAttachments() : null;
          if (att) {
            for (const k of Object.keys(att)) {
              if (!/\.json$/i.test(k) && !/slide/i.test(k)) continue;
              const meta = JSON.parse(new TextDecoder().decode(att[k].content));
              if (meta && meta.format === 'slide-studio-layout' && Array.isArray(meta.slides) && meta.slides.length) {
                slides = meta.slides.map((sl) => ({ json: sl.json || JSON.stringify({ objects: [], background: '#ffffff' }), thumb: '', imageNumbers: sl.imageNumbers || [] }));
                activeIndex = 0;
                try { bumpObjectIdCounterFromSlides(); recalculateGlobalImageCounter(); } catch (e) {}
                for (let i = 0; i < slides.length; i++) { try { await refreshSlideThumb(i); } catch (e) {} }
                await loadSlideCanvasAsync(0);
                renderSidebar(); updateSlideCounterUI(); recordGlobalState();
                Swal.close();
                showToast('PDF: tahrirlanadigan slaydlar tiklandi');
                return;
              }
            }
          }
        } catch (e) { console.warn('pdf.js attachments:', e); }
        // v49: PDF ni serverda tahlil qilamiz — shakl, rasm va matn ALOHIDA, tahrirlanadigan obyektlar bo'lib ochiladi
        try {
          const sres = await fetch('/api/import/pdf', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: buf });
          if (sres.ok) {
            const sj = await sres.json();
            if (sj && Array.isArray(sj.slides) && sj.slides.length && window.ssApplyImportedSlides) {
              const list = sj.slides.map(function (s) {
                let j = s.json; if (typeof j !== 'string') j = JSON.stringify(j);
                try { if (window.ssAdaptImported) j = window.ssAdaptImportedPdf ? window.ssAdaptImportedPdf(j) : j; } catch (e) {}
                return { json: j, thumb: '', imageNumbers: [] };
              });
              await window.ssApplyImportedSlides(list, sj.title || (file.name || '').replace(/\.pdf$/i, ''));
              Swal.close();
              Swal.fire({ icon: 'success', title: 'PDF ochildi', text: list.length + ' ta sahifa: shakl, rasm va matnlar alohida tahrirlanadi.' + (sj.fallback_pages ? ' (' + sj.fallback_pages + ' ta murakkab sahifa fon rasmi bilan)' : ''), timer: 2800, showConfirmButton: false });
              return;
            }
          }
        } catch (e) { console.warn('PDF server import:', e); }
        // v46.1: Agar bu Slide Studio o'zi yozgan PDF bo'lsa (meta topilmasa ham),
        // ko'rinmas text-layer dan chiqqan "kichik matnlar pastki burchakda" muammosini oldini olamiz.
        // Faqat sahifa rasmini slayd qilib ochamiz — dublikat / kichik matn yo'q.
        let isSlideStudioPdf = false;
        try {
          const raw = new TextDecoder('latin1').decode(buf.slice(0, Math.min(buf.byteLength || buf.length, 2e6)));
          if (raw.indexOf('slide-studio-layout') >= 0 || raw.indexOf('SS-META-BEGIN') >= 0 ||
              raw.indexOf('Slide Studio') >= 0 || raw.indexOf('slide_studio_project') >= 0) {
            isSlideStudioPdf = true;
          }
        } catch (_) {}
        try {
          if (!isSlideStudioPdf && pdf.getMetadata) {
            const md = await pdf.getMetadata();
            const info = (md && md.info) || {};
            const subj = String(info.Subject || info.subject || '');
            const creator = String(info.Creator || info.creator || '');
            const keywords = String(info.Keywords || info.keywords || '');
            if (/slide-studio/i.test(subj + creator + keywords)) isSlideStudioPdf = true;
          }
        } catch (_) {}

        const n = pdf.numPages;
        const newSlides = [];
        for (let i = 1; i <= n; i++) {
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(2.5, Math.max(1.5, 1600 / base.width));
          const viewport = page.getViewport({ scale });
          const c = document.createElement('canvas');
          c.width = viewport.width;
          c.height = viewport.height;
          await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
          const dataUrl = c.toDataURL('image/jpeg', 0.92);

          // v46.5: Yaxshilangan matn ajratish — pozitsiya to'g'ri, elementlar tahrirlanadi.
          // Sahifa rasmi orqa fon, matnlar ustida to'g'ri joyda (dublikat ko'rinmasligi uchun).
          const objects = [];
          try {
            const textContent = await page.getTextContent();
            const items = textContent.items || [];
            const sx = 960 / viewport.width;
            const sy = 540 / viewport.height;

            // Bir xil qatordagi matnlarni birlashtirish
            const raw = [];
            items.forEach((it) => {
              const str = (it.str || '').replace(/\s+/g, ' ').trim();
              if (!str) return;
              const t = it.transform || [1, 0, 0, 1, 0, 0];
              // PDF koordinatasi: transform[4]=x, transform[5]=y (pastki chap)
              // Canvas: yuqoridan pastga
              const fontH = Math.abs(t[3] || t[0] || 12);
              const x = t[4] * sx;
              const y = (viewport.height - t[5] - fontH * 0.15) * sy;
              const fontSize = Math.max(8, Math.min(72, fontH * sy * 0.95));
              raw.push({ text: str, left: x, top: y, fontSize: fontSize, w: (it.width || str.length * fontH * 0.5) * sx });
            });

            // Qator bo'yicha guruhlash
            raw.sort((a, b) => a.top - b.top || a.left - b.left);
            const lines = [];
            raw.forEach((it) => {
              const last = lines[lines.length - 1];
              if (last && Math.abs(last.top - it.top) < last.fontSize * 0.45 &&
                  it.left - (last.left + last.w) < last.fontSize * 1.8) {
                last.text += (last.text.endsWith(' ') || it.text.startsWith(' ') ? '' : ' ') + it.text;
                last.w = (it.left + it.w) - last.left;
                last.fontSize = Math.max(last.fontSize, it.fontSize);
              } else {
                lines.push({ text: it.text, left: it.left, top: it.top, fontSize: it.fontSize, w: it.w });
              }
            });

            lines.forEach((ln) => {
              if (!ln.text.trim()) return;
              const fs = Math.round(ln.fontSize * 10) / 10;
              const left = Math.max(0, Math.min(920, ln.left));
              const top = Math.max(0, Math.min(520, ln.top));
              const width = Math.max(40, Math.min(940 - left, ln.w + fs * 0.5));
              objects.push({
                type: 'textbox',
                text: ln.text,
                left: left,
                top: top,
                width: width,
                fontSize: fs,
                fill: '#111827',
                fontFamily: 'Arial',
                originX: 'left',
                originY: 'top',
                selectable: true,
                evented: true,
                // Rasm ustida aniq o'tirmasin deb biroz shaffof (ixtiyoriy)
                opacity: 0.92
              });
            });
          } catch (e) { console.warn('PDF text extract:', e); }

          const slideJson = {
            objects: objects,
            background: '#ffffff',
            backgroundImage: {
              type: 'image',
              src: dataUrl,
              left: 0,
              top: 0,
              scaleX: 960 / (c.width || 960),
              scaleY: 540 / (c.height || 540),
              originX: 'left',
              originY: 'top'
            }
          };
          newSlides.push({ json: JSON.stringify(slideJson), thumb: dataUrl, imageNumbers: [] });
        }
        if (!newSlides.length) { Swal.fire('Xato', 'PDF sahifa topilmadi.', 'error'); return; }
        saveCurrentSlideState();
        slides = newSlides;
        activeIndex = 0;
        try { bumpObjectIdCounterFromSlides(); } catch(e) {}
        renderSidebar();
        await loadSlideCanvasAsync(0);
        updateSlideCounterUI();
        try { updateAllImageBadges(); } catch(e) {}
        recordGlobalState();
        Swal.fire({ icon: 'success', title: 'PDF ochildi (v46.5)', text: n + ' ta sahifa + tahrirlanadigan matnlar.', timer: 2600, showConfirmButton: false });
      } catch (e) {
        Swal.fire('PDF xato', e.message || String(e), 'error');
      }
    }
    window.importPdfClient = importPdfClient;

    window.processImportFile = processImportFile;
    function closeImportModal() { document.getElementById('importModal').style.display = 'none'; }
    async function performImport() {
      const fileInput = document.getElementById('importFileInput');
      const file = fileInput && fileInput.files ? fileInput.files[0] : null;
      if (!file) { showToast("Avval faylni tanlang!", 'error'); return; }
      closeImportModal();
      await processImportFile(file);
    }
    function reindexAllSlideImages() {
      let counter = 0;
      slides.forEach((s) => {
        try {
          const parsed = JSON.parse(s.json || '{}');
          const nums = [];
          (parsed.objects || []).forEach((obj) => {
            if (isImageLike(obj)) {
              counter++;
              obj.imageNumber = counter;
              nums.push(counter);
            }
          });
          s.json = JSON.stringify(parsed);
          s.imageNumbers = nums;
        } catch (e) {}
      });
      globalImageCounter = Math.max(globalImageCounter, counter);
    }
    async function fetchAvailableModels() {
      try {
        const res = await fetch('/api/config/models');
        if (!res.ok) return;
        const data = await res.json();
        const select = document.getElementById('aiModelSelect');
        if (data.models && data.models.length > 0) {
          select.innerHTML = data.models.map(m =>
            `<option value="${m.value}" ${m.value === data.default ? 'selected' : ''}>${m.label}</option>`
          ).join('');
        }
      } catch (e) {}
    }
    async function drawGifsOnCanvas(canvasObj, parsed) {
      if (parsed.backgroundGif && parsed.backgroundGif.src) {
        try {
          const bgImg = await withTimeout(new Promise((resolve) => {
            const im = new Image();
            im.crossOrigin = 'anonymous';
            im.onload = () => resolve(im);
            im.onerror = () => resolve(null);
            im.src = parsed.backgroundGif.src;
          }), 8000, null);
          if (bgImg) {
            const bgF = new fabric.Image(bgImg, {
              left: 0, top: 0, originX: 'left', originY: 'top',
              scaleX: 960 / (bgImg.naturalWidth || 960),
              scaleY: 540 / (bgImg.naturalHeight || 540),
            });
            canvasObj.add(bgF);
            canvasObj.sendToBack(bgF);
          }
        } catch (e) {  }
      }
      const gifs = (parsed.objects || []).filter(o => o && (o.isGif || o.type === 'gifImage'));
      if (!gifs.length) return;
      for (const g of gifs) {
        const url = g.gifUrl || g.src;
        if (!url) continue;
        try {
          const img = await withTimeout(new Promise((resolve) => {
            const im = new Image();
            im.crossOrigin = 'anonymous';
            im.onload = () => resolve(im);
            im.onerror = () => resolve(null);
            im.src = url;
          }), 8000, null);
          if (!img) continue;
          const w = g.width || img.naturalWidth || 300;
          const h = g.height || img.naturalHeight || 200;
          const fImg = new fabric.Image(img, {
            left: g.left || 0, top: g.top || 0,
            originX: g.originX || 'left', originY: g.originY || 'top',
            scaleX: g.scaleX != null ? g.scaleX : 1,
            scaleY: g.scaleY != null ? g.scaleY : 1,
            angle: g.angle || 0,
            opacity: g.opacity != null ? g.opacity : 1,
          });
          canvasObj.add(fImg);
        } catch (e) {  }
      }
      try { canvasObj.renderAll(); } catch (e) {}
    }
    function renderSlideToOptimizedDataURL(slideJson, opts) {
      opts = opts || {};
      return new Promise((resolve) => {
        const tempEl = document.createElement('canvas');
        tempEl.width = 960; tempEl.height = 540;
        let parsed = {};
        try { parsed = JSON.parse(slideJson || '{}'); } catch (e) {}
        const hasBgGif = !!(parsed.backgroundGif && (parsed.backgroundGif.src || parsed.backgroundGif.url));
        // v27: taqdimotda orqa fon video ostida turadi -> PNG shaffof bo'lishi kerak
        const hasBgVid = !!(opts.skipElementGifs && parsed.backgroundVideo && parsed.backgroundVideo.url && !hasBgGif);

        const segIdx = (opts.skipElementGifs && opts.segment != null) ? opts.segment : null;
        const bgColor = (hasBgGif || hasBgVid || (segIdx != null && segIdx > 0)) ? null : (parsed.background || parsed.backgroundColor || '#ffffff');
        const tempCanvas = new fabric.Canvas(tempEl, { backgroundColor: bgColor || 'rgba(0,0,0,0)' });
        if (opts.skipElementGifs) tempCanvas.__holes = true;   // video joyi shaffof "teshik" bo'ladi

        let jsonForLoad = slideJson;
        if (opts.skipElementGifs) {
          try {
            const p2 = JSON.parse(slideJson || '{}');
            // animatsiyali obyektlar taqdimotda alohida sprite sifatida chiziladi
            if (segIdx != null && typeof window.presLayout === 'function') {
              const L = window.presLayout(p2.objects || []);
              p2.objects = (p2.objects || []).filter((o, i) => L.lay[i] && !L.lay[i].sp && L.lay[i].seg === segIdx);
            } else {
              p2.objects = (p2.objects || []).filter((o) => !(o && (o.isGif || o.type === 'gifImage' || (o.animName && o.type !== 'embedVideo'))));
            }
            jsonForLoad = JSON.stringify(p2);
          } catch (e) {}
        }
        tempCanvas.loadFromJSON(jsonForLoad, () => {
          applyBackgroundToCanvas(tempCanvas, parsed, async () => {
            if (hasBgGif || hasBgVid || (segIdx != null && segIdx > 0)) {
              try {
                tempCanvas.setBackgroundColor('rgba(0,0,0,0)', () => {});
                tempCanvas.setBackgroundImage(null, () => {});
              } catch (e) {}
            }
            if (!opts.skipElementGifs) {
              try { await drawGifsOnCanvas(tempCanvas, parsed); } catch (e) {}
            }
            // v43: PDF uchun JPEG x2 (1920x1080) — PNG x3 dan ~10 baravar yengil
            const needPng = hasBgGif || hasBgVid || opts.skipElementGifs;
            const mult = 2;
            const dataUrl = needPng
              ? safeToDataURL(tempCanvas, { format: 'png', multiplier: mult })
              : safeToDataURL(tempCanvas, { format: 'jpeg', quality: opts.highRes ? 0.88 : 0.92, multiplier: mult });
            tempCanvas.dispose();
            resolve(dataUrl);
          });
        });
      });
    }
        async function exportProjectJSON() {
      saveCurrentSlideState();
      try {
        const payload = {
          version: 2,
          format: 'slide-studio',
          title: projectTitle || 'presentation',
          slides: slides.map(s => ({
            json: s.json,
            thumb: s.thumb || '',
            imageNumbers: s.imageNumbers || []
          })),
          exportedAt: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        downloadBlob(blob, makeSafeFileName(projectTitle || 'presentation', 'json'));
        showToast('Loyiha .json sifatida saqlandi (qayta ochib tahrirlash mumkin)');
      } catch (e) {
        showToast("Loyiha export xatolik: " + e.message, 'error');
      }
    }
    window.exportProjectJSON = exportProjectJSON;

    // v40: HTML eksport js/29_v40_html_export.js ichida (haqiqiy matn, animatsiya, oflayn, Fullscreen)
    async function exportHTML() {
      if (typeof window.ssExportHTMLv40 === 'function') return window.ssExportHTMLv40.apply(this, arguments);
      showToast("HTML eksport moduli yuklanmadi — sahifani yangilang", 'error');
    }
    window.exportHTML = exportHTML;
    function countGifsInDeck() {
      let count = 0;
      (slides || []).forEach((s) => {
        try {
          const p = JSON.parse(s.json || '{}');
          if (p.backgroundGif && p.backgroundGif.src) count++;
          (p.objects || []).forEach((o) => {
            if (o && (o.isGif || o.type === 'gifImage')) count++;
          });
        } catch (e) {  }
      });
      return count;
    }
    async function confirmGifExport(kind) {
      const gifCount = countGifsInDeck();
      if (gifCount <= 0) return true;

      const k = String(kind || '').toUpperCase();
      if (k === 'HTML' || k === 'PPTX') return true;

      const res = await Swal.fire({
        icon: 'info',
        title: 'Jonli GIF aniqlandi',
        html: `Slaydlaringizda <b>${gifCount} ta jonli GIF</b> bor.<br><br>` +
              `<b>PDF</b> formatida GIF <b>statik</b> (faqat birinchi kadr) bo'lib chiqadi.<br>` +
              `Animatsiyani saqlash uchun <b>PPTX</b> yoki <b>HTML</b> formatini tanlang.<br><br>Baribir PDF qilamizmi?`,
        showCancelButton: true,
        confirmButtonText: 'PDF davom etish',
        cancelButtonText: 'Bekor qilish',
        confirmButtonColor: '#2563eb',
        heightAuto: false,
      });
      return !!res.isConfirmed;
    }
    async function exportPDF() {
      saveCurrentSlideState();
      // v40: ogohlantirish bitta umumiy oynada (ssExportNotice)
      showToast("PDF tayyorlanmoqda (asl ko'rinish)...");

      const meta = {
        format: 'slide-studio-layout',
        version: 3,
        title: projectTitle || 'presentation',
        canvas: { w: 960, h: 540 },
        slides: slides.map((s) => ({
          json: s.json,
          imageNumbers: s.imageNumbers || [],
          hasBackgroundGif: !!(function () {
            try {
              const p = JSON.parse(s.json || '{}');
              return !!(p.backgroundGif && (p.backgroundGif.src || p.backgroundGif.url));
            } catch (e) { return false; }
          })(),
          gifCount: (function () {
            try {
              const p = JSON.parse(s.json || '{}');
              return (p.objects || []).filter((o) => o && (o.isGif || o.type === 'gifImage')).length;
            } catch (e) { return 0; }
          })()
        })),
        exportedAt: new Date().toISOString()
      };
      const metaStr = JSON.stringify(meta);

      const dataUrlToBytes = (dataUrl) => {
        const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl || '');
        if (!m) return null;
        const bin = atob(m[2]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return { bytes: arr, mime: m[1], isPng: /png/i.test(m[1]) };
      };

      const pageImages = [];
      for (let i = 0; i < slides.length; i++) {
        try {
          const dataUrl = await renderSlideToOptimizedDataURL(slides[i].json, {
            skipElementGifs: false,
            highRes: true
          });
          pageImages.push(dataUrl || null);
        } catch (e) {
          console.warn('PDF render slide', i, e);
          pageImages.push(null);
        }
      }

      try {
        if (window.PDFLib && window.PDFLib.PDFDocument) {
          const { PDFDocument } = window.PDFLib;
          const pdfDoc = await PDFDocument.create();
          pdfDoc.setTitle(projectTitle || 'Slide Studio');
          pdfDoc.setSubject('slide-studio-layout-v4');
          pdfDoc.setCreator('Slide Studio');
          pdfDoc.setKeywords(['slide-studio', 'editable-layout']);

          const pageW = 720, pageH = 405;

          for (let i = 0; i < pageImages.length; i++) {
            const page = pdfDoc.addPage([pageW, pageH]);
            const du = pageImages[i];
            if (!du) continue;
            let parsed = dataUrlToBytes(du);
            if (!parsed) continue;
            let img = null;
            try {
              img = parsed.isPng
                ? await pdfDoc.embedPng(parsed.bytes)
                : await pdfDoc.embedJpg(parsed.bytes);
            } catch (e1) {

              try {
                const pngUrl = await new Promise((resolve) => {
                  const im = new Image();
                  im.crossOrigin = 'anonymous';
                  im.onload = () => {
                    try {
                      const c = document.createElement('canvas');
                      c.width = im.naturalWidth || 1920;
                      c.height = im.naturalHeight || 1080;
                      c.getContext('2d').drawImage(im, 0, 0);
                      resolve(c.toDataURL('image/png'));
                    } catch (e) { resolve(null); }
                  };
                  im.onerror = () => resolve(null);
                  im.src = du;
                });
                const p2 = dataUrlToBytes(pngUrl);
                if (p2) img = await pdfDoc.embedPng(p2.bytes);
              } catch (e2) {
                console.warn('PDF embed page', i, e2);
              }
            }
            if (img) {
              page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
            }
            // v31: ko'rinmas, ammo belgilanadigan/qidiriladigan matn qatlami (rasm ustida)
            try { if (window.ssPdfTextLayer) await window.ssPdfTextLayer(pdfDoc, page, slides[i].json, pageW, pageH); } catch (e) { console.warn('PDF text layer:', e); }
          }

          try {
            const metadataBytes = new TextEncoder().encode(metaStr);
            await pdfDoc.attach(metadataBytes, 'slide_studio_project.json', {
              mimeType: 'application/json',
              description: 'Slide Studio Editable Native Canvas Metadata (includes GIF urls)',
              creationDate: new Date(),
              modificationDate: new Date()
            });
          } catch (e) {
            console.warn('PDF attach metadata:', e);
          }

          let pdfBytes = await pdfDoc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
          try { pdfBytes = ssAppendMetaTrailer(pdfBytes, metaStr); } catch (e) { console.warn('PDF trailer:', e); }
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          downloadBlob(blob, makeSafeFileName(projectTitle || 'presentation', 'pdf'));
          showToast("PDF yuklab olindi (asl ko'rinish + tahrirlash metadata)");
          return;
        }
      } catch (e) {
        console.warn('pdf-lib export failed, fallback jsPDF:', e);
      }

      try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [10, 5.625], compress: true });
        for (let idx = 0; idx < pageImages.length; idx++) {
          if (idx > 0) doc.addPage([10, 5.625], 'landscape');
          const dataUrl = pageImages[idx];
          if (dataUrl) {
            const fmt = dataUrl.indexOf('image/png') >= 0 ? 'PNG' : 'JPEG';
            doc.addImage(dataUrl, fmt, 0, 0, 10, 5.625, undefined, 'MEDIUM');
          }
        }
        try {
          if (typeof doc.setProperties === 'function') {
            doc.setProperties({
              title: projectTitle || 'Slide Studio',
              subject: 'slide-studio-layout-v3',
              keywords: 'slide-studio,editable-layout',
              creator: 'Slide Studio'
            });
          }
        } catch (e) {}
        doc.save(makeSafeFileName(projectTitle || 'presentation', 'pdf'));
        showToast("PDF yuklab olindi (visual; pdf-lib yo'q)");
      } catch (e) {
        showToast('PDF saqlash xato: ' + e.message, 'error');
      }
    }
    function extractSlideBackgroundHex(parsed) {
      if (!parsed) return 'FFFFFF';
      let bg = parsed.background || parsed.backgroundColor || '#ffffff';
      if (typeof bg === 'object' && bg !== null) {
        if (Array.isArray(bg.colorStops) && bg.colorStops[0]) bg = bg.colorStops[0].color;
        else bg = '#ffffff';
      }
      if (typeof bg !== 'string') return 'FFFFFF';
      bg = bg.trim();
      if (bg.startsWith('#')) {
        let hex = bg.slice(1);
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        if (hex.length === 8) hex = hex.slice(2);
        return hex.toUpperCase();
      }
      const m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      if (m) return ((+m[1] << 16) | (+m[2] << 8) | +m[3]).toString(16).padStart(6, '0').toUpperCase();
      return 'FFFFFF';
    }
    function applyBackgroundToCanvas(canvasObj, parsed, done) {
      const bgGifSrc = parsed.backgroundGif && (parsed.backgroundGif.src || parsed.backgroundGif.url);
      if (bgGifSrc) {
        canvasObj.setBackgroundColor('rgba(0,0,0,0)', () => {
          canvasObj.setBackgroundImage(null, () => { canvasObj.renderAll(); done && done(); });
        });
        return;
      }

      let bgColor = parsed.background || parsed.backgroundColor || '#ffffff';
      if (bgColor && typeof bgColor === 'object') {
        bgColor = bgColor.color || bgColor.source || '#ffffff';
      }
      if (typeof bgColor !== 'string') bgColor = '#ffffff';
      const _gen = (canvasObj === canvas && typeof _canvasLoadGeneration !== 'undefined') ? _canvasLoadGeneration : null;
      const _stale = () => _gen !== null && _gen !== _canvasLoadGeneration;
      canvasObj.setBackgroundColor(bgColor, async () => {
        if (parsed.backgroundImage && (parsed.backgroundImage.src || parsed.backgroundImage._src)) {
          const first = parsed.backgroundImage.src || parsed.backgroundImage._src;
          const alt = parsed.backgroundImage._src || parsed.backgroundImage.src;
          const toRaw = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u))
            ? ('/api/proxy-image?raw=1&url=' + encodeURIComponent(u)) : u;
          const cands = [];
          const addC = (u) => { if (u && typeof u === 'string' && cands.indexOf(u) < 0) cands.push(u); };
          addC(toRaw(first));
          if (alt && alt !== first) addC(toRaw(alt));
          if (typeof first === 'string' && /^https?:\/\//i.test(first)) addC(first);
          const loadOne = (trySrc) => new Promise((resolve) => {
            let settled = false;
            const t = setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, 15000);
            try {
              fabric.Image.fromURL(trySrc, (img) => {
                if (settled) return;
                settled = true; clearTimeout(t);
                resolve(img && img.width ? img : null);
              }, { crossOrigin: 'anonymous' });
            } catch (e) { if (!settled) { settled = true; clearTimeout(t); resolve(null); } }
          });
          let bgImg = null;
          for (let ci = 0; ci < cands.length && !bgImg; ci++) {
            bgImg = await loadOne(cands[ci]);
          }
          if (!bgImg && typeof first === 'string' && /^https?:\/\//i.test(first)) {
            try {
              const got = await resolveRemoteToDataUrl(first);
              if (got && String(got).startsWith('data:')) bgImg = await loadOne(got);
            } catch (e) {}
          }
          if (_stale()) { done && done(); return; }
          if (!bgImg) {
            canvasObj.renderAll();
            done && done();
            return;
          }
          const iw = bgImg.width || 960;
          const ih = bgImg.height || 540;
          const sx = parsed.backgroundImage.scaleX;
          const sy = parsed.backgroundImage.scaleY;
          const looksUnscaled = (sx === 1 && sy === 1) || (sx == null) || (sy == null);
          const useStored = !looksUnscaled &&
                            (typeof sx === 'number' && sx > 0) &&
                            (typeof sy === 'number' && sy > 0);
          bgImg.set({
            left: parsed.backgroundImage.left || 0,
            top: parsed.backgroundImage.top || 0,
            scaleX: useStored ? sx : (960 / iw),
            scaleY: useStored ? sy : (540 / ih),
            originX: 'left',
            originY: 'top',
          });
          canvasObj.setBackgroundImage(bgImg, () => { canvasObj.renderAll(); done && done(); });
        } else {
          canvasObj.setBackgroundImage(null, () => { canvasObj.renderAll(); done && done(); });
        }
      });
    }
    function renderSingleObjectDataUrl(el) {
      return new Promise((resolve) => {
        try {
          const tmpEl = document.createElement('canvas');
          tmpEl.width = 960; tmpEl.height = 540;
          const tc = new fabric.Canvas(tmpEl, { backgroundColor: null });
          fabric.util.enlivenObjects([el], (objs) => {
            objs.forEach((o) => tc.add(o));
            tc.renderAll();
            try {
              const url = tc.toDataURL({ format: 'png', multiplier: 2 });
              tc.dispose();
              resolve(url);
            } catch (e) { tc.dispose(); resolve(null); }
          }, '');
        } catch (e) { resolve(null); }
      });
    }
    function openLightbox(src) {
      if (!src) return;

      let displaySrc = src;
      try {
        if (typeof src === 'string' && /^https?:\/\//i.test(src) && !src.startsWith(location.origin)) {
          displaySrc = '/api/proxy-image?raw=1&url=' + encodeURIComponent(src);
        }
      } catch (e) {  }
      let lb = document.getElementById('imageLightboxOverlay');
      if (!lb) {
        lb = document.createElement('div');
        lb.id = 'imageLightboxOverlay';
        lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);display:none;align-items:center;justify-content:center;z-index:999999;cursor:zoom-out;';
        const im = document.createElement('img');
        im.id = 'imageLightboxImg';
        im.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:10px;box-shadow:0 0 40px rgba(0,0,0,0.6);background:transparent;';
        im.onclick = (e) => e.stopPropagation();
        im.onerror = function () {

          if (this.dataset.triedFallback) return;
          this.dataset.triedFallback = '1';
          if (displaySrc !== src) this.src = src;
        };
        const closeBtn = document.createElement('span');
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = 'position:absolute;top:16px;right:26px;color:#fff;font-size:38px;line-height:1;cursor:pointer;user-select:none;';
        closeBtn.onclick = () => { lb.style.display = 'none'; };
        lb.appendChild(im);
        lb.appendChild(closeBtn);
        lb.onclick = () => { lb.style.display = 'none'; };
        document.body.appendChild(lb);
      }
      const imgEl = document.getElementById('imageLightboxImg');
      if (imgEl) {
        imgEl.removeAttribute('data-tried-fallback');
        imgEl.src = displaySrc;
      }
      lb.style.display = 'flex';
    }
    window.openLightbox = openLightbox;
    function appendAiChatMessage(sender, text, attachedImages = []) {
      const chatBody = document.getElementById('aiChatBody');
      const msgDiv = document.createElement('div');
      const id = 'msg_' + Date.now() + Math.random().toString(36).substr(2, 4);
      msgDiv.id = id;
      msgDiv.className = `ai-msg ${sender}`;
      msgDiv.dataset.sender = sender;
      const textSpan = document.createElement('span');
      textSpan.className = 'msg-text';

      let displayText = text;
      if (sender === 'bot' && typeof text === 'string' && /DSML|tool_call|function_call|invoke\s+name/i.test(text)) {
        try {
          displayText = (typeof _stripAiText === 'function' ? _stripAiText(text) : text);
          if (!displayText || /DSML|invoke\s+name|tool_call/i.test(displayText)) {
            displayText = '✨ [Bajarildi]';
          }
        } catch (e) { displayText = '✨ [Bajarildi]'; }
      }
      textSpan.innerText = displayText;
      if (attachedImages && attachedImages.length > 0) {
        const imgWrap = document.createElement('div');
        imgWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;';
        attachedImages.forEach(imgObj => {
          const imgEl = document.createElement('img');
          imgEl.src = imgObj.base64 || imgObj.src;
          imgEl.className = 'chat-img-thumb';
          imgEl.style.cssText = 'width:80px;height:80px;object-fit:cover;border-radius:10px;cursor:pointer;border:1px solid rgba(255,255,255,0.2);';
          const imgN = (imgObj.globalNum != null ? imgObj.globalNum : imgObj.number);
          imgEl.title = imgN != null ? `#${imgN}-rasm` : 'Rasm';
          imgEl.onclick = () => openFullImageViewer(imgObj.base64 || imgObj.src);
          imgWrap.appendChild(imgEl);
        });
        msgDiv.appendChild(imgWrap);
      }
      msgDiv.appendChild(textSpan);
          if (attachedImages && attachedImages.length > 0) {
            try {
              msgDiv.dataset.attachedImages = JSON.stringify(
                attachedImages.map((im) => ({
                  id: im.id, type: im.type || 'ai',
                  base64: im.base64 || im.src,
                  globalNum: (im.globalNum != null ? im.globalNum : im.number),
                  width: im.width, height: im.height,
                  hash: im.hash, description: im.description || '',
                }))
              );
            } catch (e) {  }
          }
          chatBody.appendChild(msgDiv);
      refreshChatMessageActions();
      chatBody.scrollTop = chatBody.scrollHeight;
      return id;
    }
    function appendChatMessageActions(msgDiv, sender, id) {
      let actions = msgDiv.querySelector('.ai-msg-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'ai-msg-actions';
        msgDiv.appendChild(actions);
      }
      actions.innerHTML = '';
      const copyBtn = document.createElement('button');
      copyBtn.className = 'ai-action-btn';
      copyBtn.type = 'button';
      copyBtn.dataset.role = 'copy';
      copyBtn.innerHTML = '<span class="material-symbols-outlined">content_copy</span> Nusxalash';
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        const txt = (msgDiv.querySelector('.msg-text') || {}).innerText || '';
        copyToClipboard(txt, copyBtn);
      };
      actions.appendChild(copyBtn);
      if (sender === 'bot' && msgDiv === getLastMessageDiv('bot')) {
        const regBtn = document.createElement('button');
        regBtn.className = 'ai-action-btn';
        regBtn.type = 'button';
        regBtn.innerHTML = '<span class="material-symbols-outlined">refresh</span> Qayta yaratish';
        regBtn.onclick = (e) => { e.stopPropagation(); regenerateLastResponse(); };
        actions.appendChild(regBtn);
        if (window._preAiSlidesSnapshot) {
          const undoAiBtn = document.createElement('button');
          undoAiBtn.className = 'ai-action-btn';
          undoAiBtn.type = 'button';
          undoAiBtn.innerHTML = '<span class="material-symbols-outlined">undo</span> Bekor qilish';
          undoAiBtn.onclick = (e) => { e.stopPropagation(); undoAiChanges(); };
          actions.appendChild(undoAiBtn);
        }
      }
      if (sender === 'user' && msgDiv === getLastMessageDiv('user')) {
        const editBtn = document.createElement('button');
        editBtn.className = 'ai-action-btn';
        editBtn.type = 'button';
        editBtn.innerHTML = '<span class="material-symbols-outlined">edit</span> Tahrirlash';
        editBtn.onclick = (e) => { e.stopPropagation(); editUserMessage(msgDiv); };
        actions.appendChild(editBtn);
      }
      if (sender === 'bot') { try { addInterruptedButtons(actions, msgDiv); } catch (e) {  } }
    }
    function getLastMessageDiv(sender) {
      const chatBody = document.getElementById('aiChatBody');
      const all = chatBody.querySelectorAll('.ai-msg');
      for (let i = all.length - 1; i >= 0; i--) {
        if (all[i].dataset.sender === sender) return all[i];
      }
      return null;
    }
    function refreshChatMessageActions() {
      const chatBody = document.getElementById('aiChatBody');
      if (!chatBody) return;
      chatBody.querySelectorAll('.ai-msg').forEach((m) => {
        appendChatMessageActions(m, m.dataset.sender, m.id);
      });
    }
    function copyToClipboard(text, btnEl) {
      const done = () => {
        if (!btnEl) { showToast('Nusxalandi!'); return; }
        const original = btnEl.innerHTML;
        btnEl.classList.add('copied');
        btnEl.innerHTML = '<span class="material-symbols-outlined">check</span> Nusxalandi!';
        setTimeout(() => {
          btnEl.classList.remove('copied');
          btnEl.innerHTML = original;
        }, 1500);
      };
      const fallback = () => {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.top = '-9999px';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          done();
        } catch (err) {
          console.error('Nusxalashda xatolik (fallback):', err);
          if (btnEl) { btnEl.classList.remove('copied'); }
        }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallback());
      } else {
        fallback();
      }
    }
    function regenerateLastResponse() {
      if (isAiStreaming) { showToast("AI hali javob bermoqda...", 'error'); return; }
      const lastUser = getLastMessageDiv('user');
      if (!lastUser) { showToast("Qayta yaratish uchun xabar topilmadi.", 'error'); return; }
      const userText = (lastUser.querySelector('.msg-text') || {}).innerText || '';
      if (!userText.trim()) { showToast("Xabar matni bo'sh.", 'error'); return; }
      const lastBot = getLastMessageDiv('bot');
      if (lastBot) lastBot.remove();
      const restoredImgs = restoreImagesFromMessage(lastUser);
      void restoredImgs;
      if (lastUser && lastUser.parentNode) lastUser.remove();
      refreshChatMessageActions();
      trimLocalHistoryForRegenerate();
      reSendUserPrompt(userText, restoredImgs);
  }
  window.regenerateLastResponse = regenerateLastResponse;
      function restoreImagesFromMessage(msgDiv) {
        if (!msgDiv || !msgDiv.dataset || !msgDiv.dataset.attachedImages) return [];
        let saved = [];
        try { saved = JSON.parse(msgDiv.dataset.attachedImages) || []; } catch (e) { saved = []; }
        if (!Array.isArray(saved) || saved.length === 0) return [];
        const restored = [];
        saved.forEach((im) => {
          const src = im.base64 || im.src;
          if (!src) return;
          const existing = (uploadedImagesStore || []).find((x) => (x.base64 || x.src) === src);
          if (existing) { restored.push(existing); return; }
          const obj = {
            id: im.id || `img_ai_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            type: im.type || 'ai',
            base64: src,
            globalNum: (im.globalNum != null ? im.globalNum : im.number),
            width: im.width,
            height: im.height,
            hash: im.hash || '',
            description: im.description || '',
          };
          uploadedImagesStore.push(obj);
          restored.push(obj);
        });
        try { renderChatPreviews(); updateAttachButtonsUI(); } catch (e) {}
        return restored;
      }
window.restoreImagesFromMessage = restoreImagesFromMessage;
      function collectChatHistory(maxMessages) {
        const limit = (typeof maxMessages === 'number' && maxMessages > 0)
          ? maxMessages
          : MAX_HISTORY_COUNT;
        return getLocalChatHistory().slice(-limit);
      }
      window.collectChatHistory = collectChatHistory;
function resetChatOnLoad() {
        inMemoryChatHistory = [];
        const chatBody = document.getElementById('aiChatBody');
        if (chatBody) chatBody.innerHTML = '';
        appendAiChatMessage('bot', 'Salom! Men AI intellektual assistentiman. Menga istalgan mavzuda slayd yaratishni yoki tahrirlashni buyurishingiz mumkin.');
      }
      window.resetChatOnLoad = resetChatOnLoad;
      window.restoreChatHistoryFromLocal = typeof restoreChatHistoryFromLocal === 'function' ? restoreChatHistoryFromLocal : function() {};
      window.collectChatHistory = typeof collectChatHistory === 'function' ? collectChatHistory : function() { return []; };
      let preEditBackupState = null;
      let isInEditPreview = false;
      function showTemporaryEditBanner(show) {
        let banner = document.getElementById('editPreviewBanner');
        if (!show) {
          if (banner) banner.remove();
          return;
        }
        if (banner) return;
        banner = document.createElement('div');
        banner.id = 'editPreviewBanner';
        banner.style.cssText = [
          'position:fixed', 'top:64px', 'left:50%', 'transform:translateX(-50%)',
          'z-index:99999', 'background:rgba(255,152,0,0.96)', 'color:#fff',
          'padding:8px 16px', 'border-radius:20px', 'font-size:12px',
          'font-weight:600', 'box-shadow:0 4px 14px rgba(0,0,0,0.25)',
          'display:flex', 'align-items:center', 'gap:8px', 'pointer-events:none',
          'max-width:90vw', 'text-align:center'
        ].join(';');
        banner.textContent = "⚠️ Vaqtinchalik ko'rinish: prompt yuborilgan paytdagi holat. Saqlash yoki Bekor qilishni tanlang.";
        document.body.appendChild(banner);
      }
      window.showTemporaryEditBanner = showTemporaryEditBanner;
      function editUserMessage(msgDiv) {
        if (isAiStreaming) { showToast("AI hali javob bermoqda...", 'error'); return; }
        if (msgDiv.querySelector('.ai-edit-box')) return;
        const textSpan = msgDiv.querySelector('.msg-text');
        const originalText = textSpan ? textSpan.innerText : '';
        const originalChildren = Array.from(msgDiv.children);
        const actions = msgDiv.querySelector('.ai-msg-actions');
        if (actions) actions.style.display = 'none';
        try {
          preEditBackupState = JSON.stringify({
            slides: (slides || []).map(s => ({
              json: s.json,
              thumb: s.thumb,
              imageNumbers: (s.imageNumbers || []).slice(),
            })),
            activeIndex: activeIndex,
          });
        } catch (e) {
          preEditBackupState = null;
        }
        if (window._preAiSlidesSnapshot && msgDiv === getLastMessageDiv('user')) {
          try {
            const snap = JSON.parse(window._preAiSlidesSnapshot);
            if (snap && Array.isArray(snap.slides) && snap.slides.length > 0) {
              isInEditPreview = true;
              slides = snap.slides;
              activeIndex = Math.min(Math.max(snap.activeIndex || 0, 0), slides.length - 1);
              try { recalculateGlobalImageCounter(); } catch (e) {}
              loadSlideCanvas(activeIndex, () => {
                renderSidebar();
                updateSlideCounterUI();
                updateAllImageBadges();
              });
              showTemporaryEditBanner(true);
              showToast("Vaqtinchalik: prompt yuborilgan paytdagi holat ko'rsatilmoqda");
            }
          } catch (e) {
            console.warn('Edit preview snapshot xato:', e);
          }
        }
        const box = document.createElement('div');
        box.className = 'ai-edit-box';
        box.innerHTML = `
          <textarea class="ai-edit-input"></textarea>
          <div class="ai-edit-actions">
            <button type="button" class="ai-edit-cancel">Bekor qilish</button>
            <button type="button" class="ai-edit-save">Saqlash</button>
          </div>
        `;
        const ta = box.querySelector('.ai-edit-input');
        ta.value = originalText;
        msgDiv.appendChild(box);
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        autoGrowTextarea(ta, 220);
        ta.addEventListener('input', () => autoGrowTextarea(ta, 220));
        box.querySelector('.ai-edit-cancel').onclick = () => {
          if (isInEditPreview && preEditBackupState) {
            try {
              const backup = JSON.parse(preEditBackupState);
              if (backup && Array.isArray(backup.slides) && backup.slides.length > 0) {
                slides = backup.slides;
                activeIndex = Math.min(Math.max(backup.activeIndex || 0, 0), slides.length - 1);
                try { recalculateGlobalImageCounter(); } catch (e) {}
                loadSlideCanvas(activeIndex, () => {
                  renderSidebar();
                  updateSlideCounterUI();
                  updateAllImageBadges();
                });
              }
            } catch (e) {
              console.warn('Cancel restore failed:', e);
            }
          }
          isInEditPreview = false;
          preEditBackupState = null;
          showTemporaryEditBanner(false);
          box.remove();
          originalChildren.forEach(c => { c.style.display = ''; });
          if (actions) actions.style.display = '';
          showToast("Tahrirlash bekor qilindi (asl holat tiklandi)");
        };
        box.querySelector('.ai-edit-save').onclick = () => {
          const newText = ta.value.trim();
          if (!newText) { showToast("Matn bo'sh bo'lmasligi kerak", 'error'); return; }
          isInEditPreview = false;
          preEditBackupState = null;
          showTemporaryEditBanner(false);
          submitEditedUserMessage(msgDiv, newText);
        };
      }
    function removeMessagesAfter(msgDiv) {
      if (!msgDiv || !msgDiv.parentNode) return;
      let next = msgDiv.nextSibling;
      while (next) {
        const toRemove = next;
        next = next.nextSibling;
        try { toRemove.remove(); } catch (e) {}
      }
    }
    window.removeMessagesAfter = removeMessagesAfter;
    function submitEditedUserMessage(msgDiv, newText) {
      let restoredImgs = [];
      try { restoredImgs = restoreImagesFromMessage(msgDiv) || []; } catch (e) { restoredImgs = []; }
      if (window._preAiSlidesSnapshot) {
        try {
          const backup = JSON.parse(window._preAiSlidesSnapshot);
          if (backup && Array.isArray(backup.slides) && backup.slides.length > 0) {
            slides = backup.slides;
            activeIndex = Math.min(Math.max(backup.activeIndex || 0, 0), slides.length - 1);
            try { recalculateGlobalImageCounter(); } catch (e) {  }
            loadSlideCanvas(activeIndex, () => {
              renderSidebar();
              updateSlideCounterUI();
              updateAllImageBadges();
            });
          }
        } catch (e) {
          console.warn("Rollback failed:", e);
        }
      }
      removeMessagesAfter(msgDiv);
      msgDiv.remove();
      refreshChatMessageActions();
      if (typeof trimLocalHistoryForRegenerate === 'function') {
        trimLocalHistoryForRegenerate();
      }
      reSendUserPrompt(newText, restoredImgs);
    }
    function reSendUserPrompt(text, images) {
      const input = document.getElementById('aiSidebarInput');
      if (input) {
        input.value = text;
        autoGrowSidebarInput(input);
      }
      if (images && images.length && Array.isArray(window.attachedImages)) {
        window.attachedImages = images;
      }
      sendSidebarAiPrompt();
    }
    function autoGrowTextarea(ta, maxH) {
      if (!ta) return;
      const limit = maxH || 150;
      ta.style.height = 'auto';
      const scrollH = ta.scrollHeight;
      ta.style.height = Math.min(scrollH, limit) + 'px';
      ta.style.overflowY = scrollH > limit ? 'auto' : 'hidden';
    }
    window.autoGrowTextarea = autoGrowTextarea;
    function autoGrowSidebarInput(ta) {
      autoGrowTextarea(ta, 150);
    }
    window.autoGrowSidebarInput = autoGrowSidebarInput;
    function handleSidebarInputKey(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();

        if (typeof isAiStreaming !== 'undefined' && isAiStreaming) {
          try { showToast("AI hali javob bermoqda…", 'error'); } catch (e) {}
          return;
        }
        sendSidebarAiPrompt();
      }
    }
    window.handleSidebarInputKey = handleSidebarInputKey;
    window.updateSendButtons = updateSendButtons;
    window.startAiStream = startAiStream;
    window.finishAiStream = finishAiStream;
    window.stopAiStream = stopAiStream;
    window.editUserMessage = editUserMessage;
    window.openEditUserMessage = editUserMessage;
    window.undo = undo;
    window.redo = redo;
    window.saveCurrentSlideState = saveCurrentSlideState;
    window.recordGlobalState = recordGlobalState;
    window.switchSlide = switchSlide;
    window.loadSlideCanvas = loadSlideCanvas;
    window.syncUiAfterAiChange = syncUiAfterAiChange;
    window.addEventListener('beforeunload', (e) => {
      if (!hasUnsavedChanges || isSavingOrAuthenticating) return;
      e.preventDefault();
      e.returnValue = '';
    });

try { if (typeof addSlide === 'function') window.addSlide = addSlide; } catch(e) {}
try { if (typeof openImportModal === 'function') window.openImportModal = openImportModal; } catch(e) {}
try { if (typeof saveProjectToSupabase === 'function') window.saveProjectToSupabase = saveProjectToSupabase; } catch(e) {}
try { if (typeof exportPDF === 'function') window.exportPDF = exportPDF; } catch(e) {}
try { if (typeof exportPPTX === 'function') window.exportPPTX = exportPPTX; } catch(e) {}
try { if (typeof copyObject === 'function') window.copyObject = copyObject; } catch(e) {}
try { if (typeof pasteObject === 'function') window.pasteObject = pasteObject; } catch(e) {}
try { if (typeof selectAll === 'function') window.selectAll = selectAll; } catch(e) {}
try { if (typeof addTextBox === 'function') window.addTextBox = addTextBox; } catch(e) {}
try { if (typeof triggerDirectImageUpload === 'function') window.triggerDirectImageUpload = triggerDirectImageUpload; } catch(e) {}
try { if (typeof toggleShapesMenu === 'function') window.toggleShapesMenu = toggleShapesMenu; } catch(e) {}
try { if (typeof startPresentation === 'function') window.startPresentation = startPresentation; } catch(e) {}
try { if (typeof toggleFitFullScreen === 'function') window.toggleFitFullScreen = toggleFitFullScreen; } catch(e) {}
try { if (typeof duplicateSlide === 'function') window.duplicateSlide = duplicateSlide; } catch(e) {}
try { if (typeof deleteSlide === 'function') window.deleteSlide = deleteSlide; } catch(e) {}
try { if (typeof bringToFront === 'function') window.bringForward = bringToFront; } catch(e) {}   // v36: 1 bosish = eng tepaga
try { if (typeof sendToBack === 'function') window.sendBackward = sendToBack; } catch(e) {}   // v36: 1 bosish = eng pastga
try { if (typeof deleteSelected === 'function') window.deleteSelected = deleteSelected; } catch(e) {}
try { if (typeof onTitleChange === 'function') window.onTitleChange = onTitleChange; } catch(e) {}
try { if (typeof nextPresentationSlide === 'function') window.nextPresentationSlide = nextPresentationSlide; } catch(e) {}
try { if (typeof prevPresentationSlide === 'function') window.prevPresentationSlide = prevPresentationSlide; } catch(e) {}
