    // v58: AI slaydlarni ketma-ket yaratganda har bir slayd tayyor bo'lgach ekranda 1 soniya QOLADI
    // (yuklanish effekti bilan), shundan keyingina keyingi slaydga o'tiladi.
    const SS_SLIDE_HOLD_MS = 1000;
    window._ssLastDoneAt = 0;
    async function ssPaceBeforeSlide(targetIdx) {
      try {
        if (!isAiStreaming || !window._ssLastDoneAt) return;
        if (targetIdx === activeIndex) return;           // o'sha slaydning o'zi to'ldirilyapti — kutish shart emas
        const wait = SS_SLIDE_HOLD_MS - (Date.now() - window._ssLastDoneAt);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      } catch (e) {}
    }
    function ssMarkSlideDone(slide) {
      try { if (slide) slide._ssFilled = true; } catch (e) {}
      window._ssLastDoneAt = Date.now();
    }
    window.ssMarkSlideDone = ssMarkSlideDone;

    async function executeAiCommands(payload) {
      isAiApplyingCommands = true;
      let raw = payload;
      if (raw && !Array.isArray(raw) && typeof raw === 'object' && Array.isArray(raw.actions)) {
        raw = raw.actions;
      }
      const commands = Array.isArray(raw) ? raw : [raw];
      try { if (commands.some((c) => c && c._occ === undefined)) stampActionOccurrences(commands); } catch (e) {}
      if (!isAiStreaming || lastActionReport.length === 0) lastActionReport = [];

      const _batchReportStart = lastActionReport.length;
      try {
        const hasReset = commands.some((c) => c && (c.action === 'reset_deck' || c.action === 'delete_extra_slides'));
        const hasClearAll = commands.filter((c) => c && c.action === 'clear_slide').length >= Math.max(1, slides.length - 1);
        if (hasReset) {

          if (_resetDeckAppliedThisStream || executedActionSignatures.has('RESET_DECK')) {

            _resetDeckAppliedThisStream = true;
          } else {

            try { executedActionSignatures.clear(); } catch (e) {}
            if (slides.length > 1) {
              slides.splice(1);
              if (activeIndex > 0) activeIndex = 0;
            }
          }
        }
        if (hasClearAll && !hasReset) {
          try { GifOverlay.clear(); } catch (e) {}
          try { GifBackground.clear(); } catch (e) {}
        }
      } catch (e) {  }
      for (const cmd of commands) {
        if (!cmd || !cmd.action) continue;
        const _actionSig = stableActionSignature(cmd);
        if (executedActionSignatures.has(_actionSig)) continue;
        executedActionSignatures.add(_actionSig);
        if (!cmd || !cmd.action) continue;
        let _liveSk = null;
        try {
          // v34: yangi slayd yaratuvchi amal balansdan oshsa — bajarilmaydi, foydalanuvchiga aniq aytiladi
          if (cmd.action === 'insert_slide' && window.__ssTurnBal > 0) {
            if ((window.__ssTurnSlides | 0) >= window.__ssTurnBal) {
              if (!window.__ssTurnWarned) {
                window.__ssTurnWarned = true;
                try { showToast('Balans tugadi: ' + window.__ssTurnBal + ' ta yangi slayd yaratildi, qolganlari uchun varaq yetmadi. 24 soat kuting yoki varaq sotib oling.', 'error'); } catch (e) {}
              }
              continue;
            }
            window.__ssTurnSlides = (window.__ssTurnSlides | 0) + 1;
          }
          _liveSk = beginMediaPlaceholder(cmd);
          switch (cmd.action) {
            case 'create_slides':
            case 'add_slide':
            case 'add_slides':
            case 'new_slide':
            case 'new_slides': {

              let count = Math.max(1, Math.min(50, parseInt(cmd.count, 10) || 1));
              try {
                if (typeof Monitoring !== 'undefined' && Monitoring.totalCredits) {
                  const left = Monitoring.totalCredits();
                  if (left > 0 && count > left) {
                    showToast('Balans: faqat ' + left + ' varaq qoldi — shuncha slayd yaratiladi.', 'error');
                    count = left;
                  }
                }
              } catch (e) {}
              try { if (slides.length > 0) saveCurrentSlideState(); } catch (e) {}

              try { GifOverlay.clear(); } catch (e) {}
              try { GifBackground.clear(); } catch (e) {}
              const firstNewIndex = slides.length;
              for (let i = 0; i < count; i++) {
                const tmpEl = document.createElement('canvas');
                tmpEl.width = 960; tmpEl.height = 540;
                let tmpCanvas = null;
                try {
                  tmpCanvas = new fabric.Canvas(tmpEl, { backgroundColor: '#ffffff' });
                  const title = new fabric.Textbox('Slayd ' + (slides.length + 1), {
                    left: 80, top: 50, width: 800, fontSize: 32,
                    fontWeight: 'bold', fill: '#1f1f1f', fontFamily: 'Montserrat',
                  });
                  try { configureTextbox(title); } catch (e) {}
                  try { ensureObjectId(title); } catch (e) {}
                  tmpCanvas.add(title);
                  tmpCanvas.renderAll();
                  const _newSlide = {
                    json: JSON.stringify(tmpCanvas.toJSON(SERIALIZE_PROPS)),
                    thumb: safeToDataURL(tmpCanvas, { format: 'png', multiplier: 0.3 }),
                    imageNumbers: [],
                  };
                  markSlideAsNew(_newSlide);
                  slides.push(_newSlide);
                } catch (e) {
                  console.error('create_slides item error:', e);

                  slides.push({
                    json: JSON.stringify({ objects: [], background: '#ffffff' }),
                    thumb: '',
                    imageNumbers: [],
                  });
                } finally {
                  try { if (tmpCanvas) tmpCanvas.dispose(); } catch (e) {}
                }
              }
              activeIndex = Math.max(0, Math.min(firstNewIndex, slides.length - 1));
              try { renderSidebar(); } catch (e) {}
              try { updateSlideCounterUI(); } catch (e) {}
              try { await loadSlideCanvasAsync(activeIndex); } catch (e) {
                console.warn('create_slides loadSlideCanvas:', e);
              }
              showToast(count + ' ta yangi slayd yaratildi');
              break;
            }
            case 'move_object': {
              const found = findObjectByGlobalId(cmd.id);
              if (!found) break;
              const dest = (cmd.target_slide || 1) - 1;
              if (dest < 0 || dest >= slides.length) break;
              const srcParsed = JSON.parse(slides[found.slideIndex].json);
              const dstParsed = JSON.parse(slides[dest].json);
              srcParsed.objects = (srcParsed.objects || []).filter((o) => o._oid !== cmd.id);
              dstParsed.objects = dstParsed.objects || [];
              dstParsed.objects.push(found.obj);
              slides[found.slideIndex].json = JSON.stringify(srcParsed);
              slides[dest].json = JSON.stringify(dstParsed);
              if (found.obj.imageNumber) {
                if (slides[found.slideIndex].imageNumbers)
                  slides[found.slideIndex].imageNumbers = slides[found.slideIndex].imageNumbers.filter((n) => n !== found.obj.imageNumber);
                if (!slides[dest].imageNumbers) slides[dest].imageNumbers = [];
                if (!slides[dest].imageNumbers.includes(found.obj.imageNumber))
                  slides[dest].imageNumbers.push(found.obj.imageNumber);
              }
              await refreshSlideThumb(found.slideIndex);
              await refreshSlideThumb(dest);
              break;
            }
            case 'copy_object': {

              let found = null;
              if (cmd.id != null) found = findObjectByGlobalId(cmd.id);
              if (!found && cmd.image_number != null) {
                found = findObjectByImageNumber(cmd.image_number, (cmd.from_slide || cmd.source_slide) ? (cmd.from_slide || cmd.source_slide) - 1 : undefined);
              }
              if (!found) { showToast('Nusxalanadigan obyekt topilmadi', 'error'); break; }

              let targets = [];
              if (Array.isArray(cmd.target_slides)) {
                targets = cmd.target_slides.map((n) => parseInt(n, 10) - 1);
              } else if (Array.isArray(cmd.targets)) {
                targets = cmd.targets.map((n) => parseInt(n, 10) - 1);
              } else if (cmd.target_slide != null || cmd.slide != null) {
                targets = [((cmd.target_slide != null ? cmd.target_slide : cmd.slide) || 1) - 1];
              } else {

                targets = slides.map((_, i) => i).filter((i) => i !== found.slideIndex);
              }
              targets = targets.filter((i) => i >= 0 && i < slides.length && i !== found.slideIndex);
              if (!targets.length) { showToast('Nusxalash uchun maqsad slayd yo\'q', 'error'); break; }
              const srcObj = JSON.parse(JSON.stringify(found.obj));
              for (const t of targets) {
                const dstParsed = JSON.parse(slides[t].json || '{}');
                dstParsed.objects = dstParsed.objects || [];
                const clone = JSON.parse(JSON.stringify(srcObj));
                clone._oid = nextObjectId();

                if (isImageLike(clone)) {
                  const newNum = assignNextImageNumber();
                  clone.imageNumber = newNum;
                  if (!slides[t].imageNumbers) slides[t].imageNumbers = [];
                  if (!slides[t].imageNumbers.includes(newNum)) slides[t].imageNumbers.push(newNum);
                }

                if (typeof clone.left === 'number') clone.left = Math.min(900, clone.left + 20);
                if (typeof clone.top === 'number') clone.top = Math.min(500, clone.top + 20);
                dstParsed.objects.push(clone);
                slides[t].json = JSON.stringify(dstParsed);
                await refreshSlideThumb(t);
              }
              showToast(`Obyekt ${targets.length} ta slaydga nusxalandi`);
              break;
            }
            case 'place_image': {
              const dest = ((cmd.target_slide || cmd.slide) || (activeIndex + 1)) - 1;
              if (dest < 0 || dest >= slides.length) break;
              const candidates = [cmd.image_number, cmd.image_index, cmd.number, cmd.used_image_number]
                .filter((v) => v != null && v !== '');
              let num = candidates.length ? candidates[0] : null;
              const findStored = (n) => (n == null) ? null
                : (pendingImagesStore || []).find((i) => (i.globalNum === n || i.number === n) && (i.base64 || i.src))
                  || (uploadedImagesStore || []).find((i) => (i.globalNum === n || i.number === n) && (i.base64 || i.src))
                  || (bottomAiImages || []).find((i) => (i.globalNum === n || i.number === n) && (i.base64 || i.src));
              let stored = null;
              for (const c of candidates) {
                stored = findStored(c);
                if (stored) { num = c; break; }
              }
              const src = stored ? (stored.base64 || stored.src) : null;
              if (!src) { showToast(`#${num} rasm topilmadi`, 'error'); break; }
              consumePendingImageByNumber(num);
              const already = (num != null) ? findObjectByImageNumber(num) : null;
              if (already) num = assignNextImageNumber();
              if (num == null) num = assignNextImageNumber();
              const oid = nextObjectId();
              const isGifSrc = (typeof urlLooksLikeGif === 'function')
                ? urlLooksLikeGif(src) || cmd.isGif === true || cmd.is_gif === true || cmd.type === 'gif' || cmd.type === 'gifImage'
                : (/^data:image\/gif/i.test(src) || /\.gif(\?|#|$)/i.test(src)
                  || /media\.tenor\.com|c\.tenor\.com|media\.giphy\.com|i\.giphy\.com|[\w.-]*klipy\.com|giphy\.com\/media/i.test(src)
                  || cmd.isGif === true || cmd.is_gif === true);
              if (isGifSrc) {

                placeGifImmediate(dest, cmd, src, num, oid);
                break;
              }
              const newEl = await buildImageElementFromUrl(src, oid, cmd);
              if (!newEl) break;
              newEl.imageNumber = num;
              const parsed = JSON.parse(slides[dest].json);
              parsed.objects = parsed.objects || [];
              parsed.objects.push(newEl);
              slides[dest].json = JSON.stringify(parsed);
              slides[dest].imageNumbers = slides[dest].imageNumbers || [];
              if (!slides[dest].imageNumbers.includes(num)) slides[dest].imageNumbers.push(num);
              await refreshSlideThumb(dest);
              if (dest === activeIndex) {
                try {
                  const el = await parseElementToFabric(newEl);
                  if (el) { canvas.add(el); canvas.requestRenderAll(); updateAllImageBadges(); }
                } catch (e) { console.warn('place_image canvas add:', e); }
              }
              break;
            }
            case 'move_image': {
              const found = findObjectByImageNumber(cmd.image_number, (cmd.from_slide || cmd.slide) ? (cmd.from_slide || cmd.slide) - 1 : undefined);
              if (!found) break;
              const parsed = JSON.parse(slides[found.slideIndex].json);
              const obj = (parsed.objects || []).find((o) => o._oid === found.obj._oid);
              if (!obj) break;
              if (cmd.left != null) obj.left = cmd.left;
              if (cmd.top != null) obj.top = cmd.top;
              slides[found.slideIndex].json = JSON.stringify(parsed);
              await refreshSlideThumb(found.slideIndex);
              if (found.slideIndex === activeIndex) {
                try { await loadSlideCanvasAsync(activeIndex); } catch (e) {}
              }
              break;
            }
            case 'resize_image': {
              const found = findObjectByImageNumber(cmd.image_number, (cmd.from_slide || cmd.slide) ? (cmd.from_slide || cmd.slide) - 1 : undefined);
              if (!found) break;
              const parsed = JSON.parse(slides[found.slideIndex].json);
              const obj = (parsed.objects || []).find((o) => o._oid === found.obj._oid);
              if (!obj) break;
              if (cmd.width != null) {
                const factor = cmd.width / ((obj.width || 1) * (obj.scaleX || 1));
                obj.scaleX = (obj.scaleX || 1) * factor;
              }
              if (cmd.height != null) {
                const factor = cmd.height / ((obj.height || 1) * (obj.scaleY || 1));
                obj.scaleY = (obj.scaleY || 1) * factor;
              }
              slides[found.slideIndex].json = JSON.stringify(parsed);
              await refreshSlideThumb(found.slideIndex);
              if (found.slideIndex === activeIndex) {
                try { await loadSlideCanvasAsync(activeIndex); } catch (e) {}
              }
              break;
            }
            case 'add_image':
            case 'place_image_url': {
              const dest = (cmd.target_slide || cmd.slide || 1) - 1;
              const url = sanitizeImageUrl(cmd.url || cmd.src);
              if (dest < 0 || dest >= slides.length || !url) break;
              const oid = nextObjectId();
              const isGifUrl = (typeof urlLooksLikeGif === 'function')
                ? (urlLooksLikeGif(url) || cmd.isGif === true || cmd.is_gif === true || cmd.type === 'gif' || cmd.type === 'gifImage')
                : (cmd.isGif === true || cmd.is_gif === true || /\.gif(\?|#|$)/i.test(url) ||
                  /media\.tenor\.com|c\.tenor\.com|media\.giphy\.com|i\.giphy\.com|[\w.-]*klipy\.com|giphy\.com/i.test(url));
              if (isGifUrl) {
                let num = cmd.image_number ?? cmd.image_index ?? null;
                if (num == null || findObjectByImageNumber(num)) num = assignNextImageNumber();

                placeGifImmediate(dest, cmd, url, num, oid);
                break;
              }
              let newEl = null;
              try {
                newEl = await buildImageElementFromUrl(url, oid, cmd);
              } catch (e) {
                console.warn('place_image_url: rasm yuklanmadi:', e);
                newEl = null;
              }
              if (!newEl) {
                const w = cmd.width || 300, h = cmd.height || 200;
                newEl = {
                  type: 'rect', left: cmd.left ?? 60, top: cmd.top ?? 60,
                  width: w, height: h, fill: '#e2e8f0', rx: 8, ry: 8,
                  _oid: oid, _placeholder: true,
                };
                showToast('Rasm yuklanmadi — zaxira blok qo\'yildi.', 'error');
              }
              let num = cmd.image_number ?? cmd.image_index ?? null;
              if (num == null || findObjectByImageNumber(num)) num = assignNextImageNumber();
              newEl.imageNumber = num;
              newEl.imageHash = newEl.imageHash || ('url_' + num);
              const parsed = JSON.parse(slides[dest].json);
              parsed.objects = parsed.objects || [];
              parsed.objects.push(newEl);
              slides[dest].json = JSON.stringify(parsed);
              slides[dest].imageNumbers = slides[dest].imageNumbers || [];
              if (!slides[dest].imageNumbers.includes(num)) slides[dest].imageNumbers.push(num);
              await refreshSlideThumb(dest);
              if (dest === activeIndex) {
                try {
                  const el = await parseElementToFabric(newEl);
                  if (el) { canvas.add(el); canvas.requestRenderAll(); updateAllImageBadges(); }
                } catch (e) { console.warn('place_image_url canvas add:', e); }
              }
              break;
            }
            case 'set_background': {
              const dest = ((cmd.target_slide || cmd.slide) || 1) - 1;
              if (dest < 0 || dest >= slides.length) break;
              const parsed = JSON.parse(slides[dest].json);
              if (cmd.image_number != null || cmd.id != null) {
                let found = null;
                if (cmd.id != null) found = findObjectByGlobalId(cmd.id);
                else found = findObjectByImageNumber(cmd.image_number, (cmd.from_slide || cmd.slide) ? (cmd.from_slide || cmd.slide) - 1 : undefined);
                if (!found && cmd.image_number != null) {
                  const pend = (pendingImagesStore || []).find(
                    (i) => String(i.globalNum) === String(cmd.image_number)
                  );
                  if (pend && pend.base64) {
                    parsed.backgroundImage = {
                      type: 'image', src: pend.base64, left: 0, top: 0,
                      scaleX: 960 / (pend.width || 960),
                      scaleY: 540 / (pend.height || 540),
                    };
                    delete parsed.backgroundGif;
                    delete parsed.backgroundVideo;
                    consumePendingImageByNumber(cmd.image_number);
                    slides[dest].json = JSON.stringify(parsed);
                    slides[dest].bgType = 'image';
                    slides[dest].bgVal = null;
                    await refreshSlideThumb(dest);
                    if (dest === activeIndex) {
                      try {
                        applyBackgroundToCanvas(canvas, parsed, () => {
                          try { canvas.requestRenderAll(); } catch (e) {}
                        });
                        GifBackground.clear();
                      } catch (e) {}
                    }
                    break;
                  }
                }
                if (!found) break;
                const imgEl = found.obj;
                const iw = (imgEl.width || 960) * (imgEl.scaleX || 1);
                const ih = (imgEl.height || 540) * (imgEl.scaleY || 1);
                parsed.backgroundImage = {
                  type: 'image', src: imgEl.src, left: 0, top: 0,
                  scaleX: 960 / (iw || 960), scaleY: 540 / (ih || 540),
                };
                if (cmd.remove_original) {
                  const srcParsed = JSON.parse(slides[found.slideIndex].json);
                  srcParsed.objects = (srcParsed.objects || []).filter((o) => (o._oid !== found.obj._oid));
                  slides[found.slideIndex].json = JSON.stringify(srcParsed);
                  if (found.obj.imageNumber && slides[found.slideIndex].imageNumbers) {
                    slides[found.slideIndex].imageNumbers = slides[found.slideIndex].imageNumbers.filter(n => n !== found.obj.imageNumber);
                  }
                  await refreshSlideThumb(found.slideIndex);
                }
              } else if (cmd.url) {
                const safeBg = await resolveRemoteToDataUrl(cmd.url);
                const usable = safeBg && typeof safeBg === 'string' &&
                  (safeBg.startsWith('data:image') || /^https?:\/\//i.test(safeBg));
                if (usable) {
                  const dims = await withTimeout(new Promise((resolve) => {
                    try {
                      fabric.Image.fromURL(safeBg, (img) => {
                        if (!img || !img.width) return resolve(null);
                        resolve({ w: img.width || 960, h: img.height || 540 });
                      }, { crossOrigin: 'anonymous' });
                    } catch (e) { resolve(null); }
                  }), 6000, null);
                  parsed.backgroundImage = {
                    type: 'image', src: safeBg, left: 0, top: 0,
                    scaleX: 960 / ((dims && dims.w) || 960),
                    scaleY: 540 / ((dims && dims.h) || 540),
                  };
                }
              } else if (cmd.color) {
                parsed.background = cmd.color;
                delete parsed.backgroundImage;
                delete parsed.backgroundGif;
                delete parsed.backgroundVideo;
              }

              if (parsed.backgroundImage) {
                delete parsed.backgroundGif;
                delete parsed.backgroundVideo;
                if (dest === activeIndex) { try { GifBackground.clear(); } catch (e) {} }
              }
              if (parsed.backgroundGif) {
                delete parsed.backgroundImage;
              }
              if (!parsed.backgroundImage && !parsed.backgroundGif && cmd.color) {
                if (dest === activeIndex) { try { GifBackground.clear(); } catch (e) {} }
              }

              if (parsed.backgroundGif) {
                slides[dest].bgType = 'gif';
                slides[dest].bgVal = null;
              } else if (parsed.backgroundImage) {
                slides[dest].bgType = 'image';
                slides[dest].bgVal = null;
              } else if (cmd.color) {
                slides[dest].bgType = 'color';
                slides[dest].bgVal = cmd.color;
              }
              slides[dest].json = JSON.stringify(parsed);
              await refreshSlideThumb(dest);
              if (dest === activeIndex) {
                try {

                  applyBackgroundToCanvas(canvas, parsed, () => {
                    try { canvas.requestRenderAll(); } catch (e) {}
                  });
                  if (parsed.backgroundGif) GifBackground.applyFromSlide(slides[dest].json);
                  else GifBackground.clear();
                } catch (e) {}
              }
              break;
            }
            case 'delete_image':
            case 'delete_object': {
              let found = null;
              if (cmd.image_number != null) found = findObjectByImageNumber(cmd.image_number, (cmd.from_slide || cmd.slide) ? (cmd.from_slide || cmd.slide) - 1 : undefined);
              else if (cmd.id != null) found = findObjectByGlobalId(cmd.id);
              if (!found) break;
              const parsed = JSON.parse(slides[found.slideIndex].json);
              parsed.objects = (parsed.objects || []).filter((o) => o._oid !== found.obj._oid);
              if (found.obj.imageNumber && slides[found.slideIndex].imageNumbers) {
                slides[found.slideIndex].imageNumbers = slides[found.slideIndex].imageNumbers.filter(n => n !== found.obj.imageNumber);
              }
              slides[found.slideIndex].json = JSON.stringify(parsed);
              await refreshSlideThumb(found.slideIndex);
              if (found.slideIndex === activeIndex) {
                try {
                  const canvasObj = canvas.getObjects().find((c) => c && c._oid === found.obj._oid);
                  if (canvasObj) { canvas.remove(canvasObj); canvas.requestRenderAll(); }
                  try { GifOverlay.scheduleSync(); } catch (e) {}
                } catch (e) {}
              }
              break;
            }
            case 'bring_to_front':
            case 'send_to_back': {
              const found = findObjectByImageNumber(cmd.image_number, (cmd.from_slide || cmd.slide) ? (cmd.from_slide || cmd.slide) - 1 : undefined);
              if (!found) break;
              const parsed = JSON.parse(slides[found.slideIndex].json);
              const arr = parsed.objects || [];
              let idx = found.obj._oid != null
                ? arr.findIndex((o) => o._oid === found.obj._oid)
                : -1;
              if (idx < 0 && found.obj.imageNumber != null) {
                idx = arr.findIndex((o) => isImageLike(o) && String(o.imageNumber) === String(found.obj.imageNumber));
              }
              if (idx < 0) break;
              const [item] = arr.splice(idx, 1);
              if (cmd.action === 'bring_to_front') arr.push(item);
              else arr.unshift(item);
              parsed.objects = arr;
              slides[found.slideIndex].json = JSON.stringify(parsed);
              await refreshSlideThumb(found.slideIndex);
              break;
            }
            case 'update_object': {
              const found = findObjectByGlobalId(cmd.id);
              if (!found) break;
              const parsed = JSON.parse(slides[found.slideIndex].json);
              const target = (parsed.objects || []).find((o) => o._oid === cmd.id);
              if (target && cmd.props) Object.assign(target, cmd.props);
              slides[found.slideIndex].json = JSON.stringify(parsed);
              await refreshSlideThumb(found.slideIndex);
              break;
            }
            case 'move_image_to_slide': {
              const fromIdx = (cmd.from_slide != null) ? cmd.from_slide - 1 : activeIndex;
              const toIdx = (cmd.to_slide != null) ? cmd.to_slide - 1 : null;
              if (toIdx == null || toIdx < 0 || toIdx >= slides.length) break;
              const found = findObjectByImageNumber(cmd.image_number, fromIdx);
              if (!found) { showToast(`#${cmd.image_number}-rasm topilmadi`, 'error'); break; }
              const srcParsed = JSON.parse(slides[found.slideIndex].json || '{}');
              const dstParsed = JSON.parse(slides[toIdx].json || '{}');
              const movedObj = (srcParsed.objects || []).find((o) => o._oid === found.obj._oid);
              if (!movedObj) break;
              srcParsed.objects = (srcParsed.objects || []).filter((o) => o._oid !== movedObj._oid);
              if (cmd.left != null) movedObj.left = cmd.left;
              if (cmd.top != null) movedObj.top = cmd.top;
              if (cmd.width != null && movedObj.width) {
                movedObj.scaleX = cmd.width / movedObj.width;
              }
              if (cmd.height != null && movedObj.height) {
                movedObj.scaleY = cmd.height / movedObj.height;
              }
              dstParsed.objects = dstParsed.objects || [];
              dstParsed.objects.push(movedObj);
              slides[found.slideIndex].json = JSON.stringify(srcParsed);
              slides[toIdx].json = JSON.stringify(dstParsed);
              if (movedObj.imageNumber != null) {
                if (slides[found.slideIndex].imageNumbers) {
                  slides[found.slideIndex].imageNumbers = slides[found.slideIndex].imageNumbers.filter(n => String(n) !== String(movedObj.imageNumber));
                }
                slides[toIdx].imageNumbers = slides[toIdx].imageNumbers || [];
                if (!slides[toIdx].imageNumbers.some(n => String(n) === String(movedObj.imageNumber))) {
                  slides[toIdx].imageNumbers.push(movedObj.imageNumber);
                }
              }
              await refreshSlideThumb(found.slideIndex);
              await refreshSlideThumb(toIdx);
              showToast(`#${movedObj.imageNumber}-rasm ${found.slideIndex + 1}-varoqdan ${toIdx + 1}-varoqqa ko'chirildi`);
              break;
            }
            case 'swap_images': {

              const findSlideOfImage = (num) => {
                if (num == null) return -1;
                for (let i = 0; i < slides.length; i++) {
                  try {
                    const p = JSON.parse(slides[i].json || '{}');
                    if ((p.objects || []).some((o) => isImageLike(o) && String(o.imageNumber) === String(num))) return i;
                  } catch (e) {  }
                }
                return -1;
              };
              let aIdx = (cmd.slide_a != null) ? cmd.slide_a - 1 : findSlideOfImage(cmd.image_a);
              let bIdx = (cmd.slide_b != null) ? cmd.slide_b - 1 : findSlideOfImage(cmd.image_b);
              if (aIdx < 0) aIdx = activeIndex;
              if (bIdx < 0) bIdx = activeIndex;
              if (aIdx < 0 || aIdx >= slides.length || bIdx < 0 || bIdx >= slides.length) {
                showToast('Almashtirish uchun slaydlar topilmadi', 'error');
                break;
              }
              let fa = findObjectByImageNumber(cmd.image_a, aIdx);
              let fb = findObjectByImageNumber(cmd.image_b, bIdx);

              if (!fa) fa = findObjectByImageNumber(cmd.image_a);
              if (!fb) fb = findObjectByImageNumber(cmd.image_b);
              if (!fa || !fb) {
                showToast(`Almashtirish uchun rasmlardan biri topilmadi (#${cmd.image_a} yoki #${cmd.image_b})`, 'error');
                break;
              }
              if (fa.obj._oid === fb.obj._oid) {
                showToast('Bir xil rasmni o\'zini almashtirib bo\'lmaydi', 'error');
                break;
              }
              const pa = JSON.parse(slides[fa.slideIndex].json || '{}');
              const pb = JSON.parse(slides[fb.slideIndex].json || '{}');
              const objA = (pa.objects || []).find(o => o._oid === fa.obj._oid);
              const objB = (pb.objects || []).find(o => o._oid === fb.obj._oid);
              if (!objA || !objB) {
                showToast('Almashtirish uchun rasm ma\'lumotlari topilmadi', 'error');
                break;
              }
              const swapContent = cmd.swap_position !== false;
              const CONTENT_KEYS = ['src', 'gifUrl', 'videoUrl', 'imageHash', 'imageNumber', 'width', 'height', 'isGif', 'isVideo'];
              const POS_KEYS = ['left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle'];
              const keys = swapContent ? CONTENT_KEYS : POS_KEYS;
              keys.forEach((k) => {
                const t = objA[k]; objA[k] = objB[k]; objB[k] = t;
              });
              if (!swapContent) {
                const tmpNum = objA.imageNumber;
                objA.imageNumber = objB.imageNumber;
                objB.imageNumber = tmpNum;
              }
              slides[fa.slideIndex].json = JSON.stringify(pa);
              slides[fb.slideIndex].json = JSON.stringify(pb);
              slides[fa.slideIndex].imageNumbers = (pa.objects || []).filter(o => isImageLike(o) && o.imageNumber != null).map(o => o.imageNumber);
              slides[fb.slideIndex].imageNumbers = (pb.objects || []).filter(o => isImageLike(o) && o.imageNumber != null).map(o => o.imageNumber);
              await refreshSlideThumb(fa.slideIndex);
              if (fb.slideIndex !== fa.slideIndex) await refreshSlideThumb(fb.slideIndex);
              showToast(`#${cmd.image_a} va #${cmd.image_b} rasmlar almashtirildi`);
              break;
            }
            case 'duplicate_image': {
              const fromIdx = (cmd.from_slide != null) ? cmd.from_slide - 1 : activeIndex;

              let toList = [];
              if (Array.isArray(cmd.to_slides)) toList = cmd.to_slides.map((n) => parseInt(n, 10) - 1);
              else if (Array.isArray(cmd.target_slides)) toList = cmd.target_slides.map((n) => parseInt(n, 10) - 1);
              else if (cmd.to_slide != null) toList = [parseInt(cmd.to_slide, 10) - 1];
              else if (cmd.target_slide != null) toList = [parseInt(cmd.target_slide, 10) - 1];
              else toList = slides.map((_, i) => i).filter((i) => i !== fromIdx);
              toList = toList.filter((i) => i >= 0 && i < slides.length && i !== fromIdx);
              if (!toList.length) { showToast('Nusxalash uchun maqsad slayd yo\'q', 'error'); break; }
              const found = findObjectByImageNumber(cmd.image_number, fromIdx);
              if (!found) {
                const _num = String(cmd.image_number);
                const pend = (pendingImagesStore || []).find((i) => String(i.globalNum) === _num || String(i.number) === _num)
                  || (uploadedImagesStore || []).find((i) => String(i.globalNum) === _num || String(i.number) === _num)
                  || (bottomAiImages || []).find((i) => String(i.globalNum) === _num || String(i.number) === _num);
                if (pend && (pend.base64 || pend.src)) {
                  const srcData = pend.base64 || pend.src;
                  let done = 0;
                  for (const toIdx of toList) {
                    const oid = nextObjectId();
                    const newNum = assignNextImageNumber();
                    const newEl = await buildImageElementFromUrl(srcData, oid, cmd);
                    if (!newEl) continue;
                    newEl.imageNumber = newNum;
                    newEl.imageHash = newEl.imageHash || ('pend_' + newNum);
                    const dstP = JSON.parse(slides[toIdx].json || '{}');
                    dstP.objects = dstP.objects || [];
                    dstP.objects.push(newEl);
                    slides[toIdx].json = JSON.stringify(dstP);
                    slides[toIdx].imageNumbers = slides[toIdx].imageNumbers || [];
                    if (!slides[toIdx].imageNumbers.some(n => String(n) === String(newNum))) {
                      slides[toIdx].imageNumbers.push(newNum);
                    }
                    await refreshSlideThumb(toIdx);
                    done++;
                  }
                  consumePendingImageByNumber(cmd.image_number);
                  showToast(`#${cmd.image_number}-rasm ${done} ta slaydga nusxalandi`);
                  break;
                }
                showToast(`#${cmd.image_number}-rasm topilmadi`, 'error');
                break;
              }
              let copied = 0;
              for (const toIdx of toList) {
                const dstParsed = JSON.parse(slides[toIdx].json || '{}');
                const clone = JSON.parse(JSON.stringify(found.obj));
                clone._oid = nextObjectId();
                const newNum = assignNextImageNumber();
                clone.imageNumber = newNum;
                if (cmd.left != null) clone.left = cmd.left;
                if (cmd.top != null) clone.top = cmd.top;
                if (cmd.width != null && clone.width) clone.scaleX = cmd.width / clone.width;
                if (cmd.height != null && clone.height) clone.scaleY = cmd.height / clone.height;
                dstParsed.objects = dstParsed.objects || [];
                dstParsed.objects.push(clone);
                slides[toIdx].json = JSON.stringify(dstParsed);
                slides[toIdx].imageNumbers = slides[toIdx].imageNumbers || [];
                if (!slides[toIdx].imageNumbers.some(n => String(n) === String(newNum))) {
                  slides[toIdx].imageNumbers.push(newNum);
                }
                await refreshSlideThumb(toIdx);
                copied++;
              }
              showToast(`#${found.obj.imageNumber}-rasm ${copied} ta slaydga nusxalandi`);
              break;
            }
            case 'add_gif': {
              const dest = (cmd.target_slide || cmd.slide || 1) - 1;
              let url = sanitizeImageUrl(cmd.url || cmd.src);
              if (dest < 0 || dest >= slides.length || !url) break;
              const oid = nextObjectId();
              let num = cmd.image_number ?? cmd.image_index ?? null;
              if (num == null || findObjectByImageNumber(num)) num = assignNextImageNumber();

              placeGifImmediate(dest, cmd, url, num, oid);
              break;
            }
            case 'add_video':
            case 'place_video':
            case 'set_background_video': {
              await aiVideoAction(cmd);
              break;
            }
            case 'add_link':
            case 'link_button': {
              await aiLinkAction(cmd);
              break;
            }
            case 'add_button':
            case 'create_button': {
              await aiButtonAction(cmd);
              break;
            }
            case 'style_media':
            case 'round_image':
            case 'crop_image': {
              await aiStyleMedia(cmd);
              break;
            }
            case 'set_transition':
            case 'slide_transition': {
              // v48: butun slayd o'tish animatsiyasi: {"action":"set_transition","slide":N | "target":"all","transition":"fade|zoom|flip|up|blur|none"}
              try {
                const _raw = String(cmd.transition || cmd.type || cmd.name || '').trim();
                const _lc = _raw.toLowerCase().replace(/[\s_-]+/g, '');
                let _tr = '';
                if (_lc && _lc !== 'default' && window.SS_TR) {
                  const _hit = window.SS_TR.list.find(function (x) { return x.k.toLowerCase() === _lc; });
                  _tr = _hit ? _hit.k : (_lc === 'none' || _lc === 'off' ? 'none' : (_lc === 'dissolve' ? 'blur' : (_lc === 'pushup' ? 'up' : (_lc === 'pushdown' ? 'down' : (_lc === 'pushleft' ? 'left' : (_lc === 'pushright' ? 'right' : _raw.toLowerCase()))))));
                }
                const _o = {};
                if (cmd.duration != null || cmd.dur != null) _o.dur = cmd.duration != null ? cmd.duration : cmd.dur;
                if (cmd.auto != null || cmd.advance != null) _o.auto = cmd.auto != null ? cmd.auto : cmd.advance;
                if (cmd.target === 'all' || cmd.all === true) {
                  const cur = slides[activeIndex];
                  if (cur) { cur.transition = _tr; if (_o.dur != null) cur.transDur = window.SS_TR.clampDur(_o.dur, 0.7); if (_o.auto != null) cur.transAuto = Math.max(0, parseFloat(_o.auto) || 0); }
                  window.ssSetTransition && window.ssSetTransition(cur ? cur.transition : _tr, true);
                } else {
                  const _ti = ((cmd.slide != null ? cmd.slide : (activeIndex + 1)) || 1) - 1;
                  if (_ti >= 0 && _ti < slides.length) window.ssSetTransition && window.ssSetTransition(_tr, false, _ti, _o);
                }
              } catch (e) { console.warn('set_transition:', e); }
              break;
            }
            case 'set_animation':
            case 'animate':
            case 'add_animation': {
              await aiAnimationAction(cmd);
              break;
            }
            case 'set_background_url': {
              if (typeof parseVideoUrl === 'function' && cmd.url && parseVideoUrl(String(cmd.url)) && !/\.gif(\?|#|$)/i.test(String(cmd.url))) {
                await aiVideoAction(Object.assign({}, cmd, { as_background: true }));
                break;
              }
              const dest = (cmd.target_slide || cmd.slide || 1) - 1;
              if (dest < 0 || dest >= slides.length) break;
              const parsed = JSON.parse(slides[dest].json || '{}');
              const fallbackColor = cmd.color || parsed.background || parsed.backgroundColor || '#ffffff';
              const isGifSrc = (s) => typeof s === 'string' &&
                (/^data:image\/gif/i.test(s) || /\.gif(\?|#|$)/i.test(s));
              let pendingBg = null;
              if (cmd.image_number != null) {
                const _num = String(cmd.image_number);
                pendingBg = (pendingImagesStore || []).find((i) => String(i.globalNum) === _num || String(i.number) === _num)
                  || (uploadedImagesStore || []).find((i) => String(i.globalNum) === _num || String(i.number) === _num)
                  || (bottomAiImages || []).find((i) => String(i.globalNum) === _num || String(i.number) === _num)
                  || null;

                if (!pendingBg) {
                  const placed = findObjectByImageNumber(cmd.image_number, dest);
                  if (placed && placed.obj) {
                    const src = placed.obj.src || placed.obj.gifUrl || placed.obj._src || null;
                    if (src) pendingBg = { base64: src, width: placed.obj.width, height: placed.obj.height };
                  }
                }
              }
              if (pendingBg && pendingBg.base64) {
                if (isGifSrc(pendingBg.base64)) {
                  delete parsed.backgroundImage;
                  parsed.backgroundGif = {
                    src: pendingBg.base64,
                    width: pendingBg.width || 960,
                    height: pendingBg.height || 540,
                  };
                  parsed.background = fallbackColor;
                  slides[dest].json = JSON.stringify(parsed);

                  slides[dest].bgType = 'gif';
                  slides[dest].bgVal = null;
                  consumePendingImageByNumber(cmd.image_number);
                  await refreshSlideThumb(dest);
                  if (dest === activeIndex) { try { GifBackground.applyFromSlide(slides[dest].json); } catch (e) {} }
                  showToast('Jonli GIF fon o\'rnatildi!');
                  break;
                }
                parsed.backgroundImage = {
                  type: 'image', src: pendingBg.base64, left: 0, top: 0,
                  scaleX: 960 / (pendingBg.width || 960),
                  scaleY: 540 / (pendingBg.height || 540),
                };
                delete parsed.backgroundGif;
                delete parsed.backgroundVideo;
                parsed.background = fallbackColor;
                slides[dest].json = JSON.stringify(parsed);
                slides[dest].bgType = 'image';
                slides[dest].bgVal = null;
                consumePendingImageByNumber(cmd.image_number);
                await refreshSlideThumb(dest);
                if (dest === activeIndex) {
                  try {
                    applyBackgroundToCanvas(canvas, parsed, () => {
                      try { canvas.requestRenderAll(); } catch (e) {}
                    });
                    GifBackground.clear();
                  } catch (e) {}
                }
                break;
              }
              if (!cmd.url) break;
              if (isGifSrc(cmd.url)) {
                let gifUrl = cmd.url;
                try {
                  const resolved = await resolveGifDirectUrl(gifUrl);
                  if (resolved) gifUrl = resolved;
                } catch (e) {  }
                delete parsed.backgroundImage;
                parsed.backgroundGif = { src: gifUrl, width: 960, height: 540 };
                parsed.background = fallbackColor;
                slides[dest].json = JSON.stringify(parsed);
                slides[dest].bgType = 'gif';
                slides[dest].bgVal = null;
                await refreshSlideThumb(dest);
                if (dest === activeIndex) { try { GifBackground.applyFromSlide(slides[dest].json); } catch (e) {} }
                showToast('Jonli GIF fon o\'rnatildi!');
                break;
              }
              let safeBg = null;
              try {
                safeBg = await resolveRemoteToDataUrl(cmd.url);
              } catch (e) {
                console.warn('set_background_url: proxy data_url xato:', e);
                safeBg = null;
              }

              if (!safeBg || (typeof safeBg === 'string' && /^https?:\/\//i.test(safeBg) && !safeBg.startsWith('data:'))) {
                try {
                  const proxied = '/api/proxy-image?raw=1&url=' + encodeURIComponent(cmd.url);
                  safeBg = proxied;
                } catch (e2) {  }
              }

              if (!safeBg) safeBg = cmd.url;
              const usable = safeBg && typeof safeBg === 'string' &&
                (safeBg.startsWith('data:image') || /^https?:\/\//i.test(safeBg) || safeBg.startsWith('/api/proxy-image'));
              if (usable) {
                if (isGifSrc(safeBg) || isGifSrc(cmd.url)) {
                  const gifSrc = isGifSrc(safeBg) ? safeBg
                    : ('/api/proxy-image?raw=1&url=' + encodeURIComponent(cmd.url));
                  delete parsed.backgroundImage;
                  parsed.backgroundGif = { src: gifSrc, width: 960, height: 540 };
                  parsed.background = fallbackColor || '#ffffff';
                  slides[dest].json = JSON.stringify(parsed);
                  slides[dest].bgType = 'gif';
                  slides[dest].bgVal = null;
                  await refreshSlideThumb(dest);
                  if (dest === activeIndex) { try { GifBackground.applyFromSlide(slides[dest].json); } catch (e) {} }
                  showToast('Jonli GIF fon o\'rnatildi!');
                  break;
                }
                let dims = null;
                if (safeBg.startsWith('data:image')) {
                  dims = await withTimeout(new Promise((resolve) => {
                    try {
                      fabric.Image.fromURL(safeBg, (img) => {
                        if (!img || !img.width) return resolve(null);
                        resolve({ w: img.width || 960, h: img.height || 540 });
                      }, { crossOrigin: 'anonymous' });
                    } catch (e) { resolve(null); }
                  }), 6000, null);
                }

                parsed.backgroundImage = {
                  type: 'image',
                  src: safeBg,
                  _src: cmd.url,
                  left: 0, top: 0,
                  scaleX: 960 / ((dims && dims.w) || 960),
                  scaleY: 540 / ((dims && dims.h) || 540),
                };
                delete parsed.backgroundGif;
                delete parsed.backgroundVideo;

                const solid = (fallbackColor && !/^#0{0,2}[0-4]/i.test(String(fallbackColor)))
                  ? fallbackColor : '#ffffff';
                parsed.background = solid;
                slides[dest].bgType = 'image';
                slides[dest].bgVal = null;
              } else {

                parsed.backgroundImage = {
                  type: 'image',
                  src: '/api/proxy-image?raw=1&url=' + encodeURIComponent(cmd.url),
                  _src: cmd.url,
                  left: 0, top: 0, scaleX: 1, scaleY: 1,
                };
                delete parsed.backgroundGif;
                delete parsed.backgroundVideo;
                parsed.background = '#ffffff';
                slides[dest].bgType = 'image';
                slides[dest].bgVal = null;
                showToast('Fon rasmi yuklanmoqda (proxy)...', 'info');
              }
              slides[dest].json = JSON.stringify(parsed);
              await refreshSlideThumb(dest);
              if (dest === activeIndex) {

                try {
                  if (parsed.backgroundGif) {
                    GifBackground.applyFromSlide(slides[dest].json);
                  } else {
                    GifBackground.clear();
                    applyBackgroundToCanvas(canvas, parsed, () => {
                      try { canvas.requestRenderAll(); } catch (e) {}
                    });
                  }
                  canvas.requestRenderAll();
                } catch (e) { console.warn('set_background_url apply:', e); }
              }
              break;
            }
            case 'duplicate_slide': {
              const idx = (cmd.slide || (activeIndex + 1)) - 1;
              if (idx < 0 || idx >= slides.length) break;
              const src = slides[idx];
              const cloneParsed = JSON.parse(src.json || '{}');
              (cloneParsed.objects || []).forEach((o) => { o._oid = nextObjectId(); });
              slides.splice(idx + 1, 0, {
                json: JSON.stringify(cloneParsed),
                thumb: src.thumb || '',
                imageNumbers: (src.imageNumbers || []).slice(),
              });
              activeIndex = idx + 1;
              await refreshSlideThumb(idx + 1);
              showToast(`${idx + 1}-slayd nusxalandi`);
              break;
            }
            case 'delete_slide': {
              const idx = (cmd.slide || 1) - 1;
              if (idx < 0 || idx >= slides.length || slides.length <= 1) break;
              slides.splice(idx, 1);
              if (activeIndex >= slides.length) activeIndex = slides.length - 1;
              try { renderSidebar(); } catch (e) {}
              try { updateSlideCounterUI(); } catch (e) {}
              break;
            }
            case 'reorder_slide':
            case 'move_slide': {

              const from = ((cmd.from != null ? cmd.from : cmd.slide) || 1) - 1;
              const to = ((cmd.to != null ? cmd.to : cmd.after) || 1) - 1;
              if (from < 0 || from >= slides.length || to < 0 || to >= slides.length || from === to) break;
              const [item] = slides.splice(from, 1);
              slides.splice(to, 0, item);
              activeIndex = to;
              try { renderSidebar(); } catch (e) {}
              try { updateSlideCounterUI(); } catch (e) {}
              showToast(`Slayd ${from + 1} → ${to + 1} ga ko'chirildi`);
              break;
            }
            case 'swap_slides': {
              const a = ((cmd.a != null ? cmd.a : cmd.slide1) || 1) - 1;
              const b = ((cmd.b != null ? cmd.b : cmd.slide2) || 2) - 1;
              if (a < 0 || a >= slides.length || b < 0 || b >= slides.length || a === b) break;
              const tmp = slides[a];
              slides[a] = slides[b];
              slides[b] = tmp;
              try { renderSidebar(); } catch (e) {}
              try { updateSlideCounterUI(); } catch (e) {}
              showToast(`Slayd ${a + 1} ↔ ${b + 1} almashtirildi`);
              break;
            }
            case 'change_slide':
            case 'goto_slide':
            case 'switch_slide': {
              const target = ((cmd.slide != null ? cmd.slide : cmd.index) || 1) - 1;
              if (target >= 0 && target < slides.length) {
                try { saveCurrentSlideState(); } catch (e) {}
                activeIndex = target;
              }
              break;
            }
            case 'insert_slide': {

              const _aNum = parseInt(cmd.after, 10);
              const _sNum = parseInt(cmd.slide, 10);
              let afterRaw = !isNaN(_aNum) ? _aNum : (!isNaN(_sNum) ? _sNum : slides.length);
              if (afterRaw < 0) afterRaw = 0;

              while (slides.length < afterRaw) {
                slides.push({
                  json: JSON.stringify({ objects: [], background: '#ffffff' }),
                  thumb: '',
                  imageNumbers: [],
                });
              }
              const insertAt = Math.max(0, Math.min(afterRaw, slides.length));
              await ssPaceBeforeSlide(insertAt);
              const elements = Array.isArray(cmd.elements) ? cmd.elements : [];

              let _insBg = cmd.background;
              if (!_insBg) {
                try {
                  const _prev = slides[Math.max(0, Math.min(insertAt, slides.length) - 1)];
                  const _pj = _prev && _prev.json ? JSON.parse(_prev.json) : null;
                  if (_pj && typeof _pj.background === 'string' && _pj.background) _insBg = _pj.background;
                } catch (e) {}
              }
              const newCanvas = await createFabricCanvasFromElements(elements, _insBg || '#ffffff');
              const _insSlide = {
                json: JSON.stringify(newCanvas.toJSON(SERIALIZE_PROPS)),
                thumb: safeToDataURL(newCanvas, { format: 'png', multiplier: 0.3 }),
                imageNumbers: extractImageNumbers(elements),
              };
              markSlideAsNew(_insSlide);
              slides.splice(insertAt, 0, _insSlide);
              newCanvas.dispose();
              if (typeof cmd.activate === 'number') {
                activeIndex = Math.max(0, Math.min(cmd.activate - 1, slides.length - 1));
              } else {
                activeIndex = insertAt;
              }
              try { renderSidebar(); } catch (e) {}
              try { updateSlideCounterUI(); } catch (e) {}
              try { await loadSlideCanvasAsync(activeIndex); } catch (e) {}
              ssMarkSlideDone(_insSlide);
              break;
            }
            case 'replace_slide': {
              let idx = ((cmd.slide != null ? cmd.slide : (activeIndex + 1)) || 1) - 1;
              if (idx < 0) idx = 0;

              while (slides.length <= idx) {
                slides.push({
                  json: JSON.stringify({ objects: [], background: '#ffffff' }),
                  thumb: '',
                  imageNumbers: [],
                });
              }
              await ssPaceBeforeSlide(idx);
              const elems = Array.isArray(cmd.elements) ? cmd.elements : [];
              const newCanvas = await createFabricCanvasFromElements(elems, cmd.background || '#ffffff');

              let jsonStr = JSON.stringify(newCanvas.toJSON(SERIALIZE_PROPS));
              try {
                const parsedR = JSON.parse(jsonStr);
                if (cmd.background && typeof cmd.background === 'string' && /^https?:\/\//i.test(cmd.background)) {

                  parsedR.background = '#ffffff';
                } else if (cmd.background && typeof cmd.background === 'string' && cmd.background.startsWith('#')) {
                  parsedR.background = cmd.background;
                }
                jsonStr = JSON.stringify(parsedR);
              } catch (e) {}
              try {
                if (!cmd.background && slides[idx] && slides[idx].json) {
                  const oldP = JSON.parse(slides[idx].json);
                  const newP = JSON.parse(jsonStr);
                  // v29: AI "background" bermasa — slaydning avvalgi fon rangi (masalan to'q ko'k) saqlanadi
                  try {
                    if (typeof window.isSolidBgColor === 'function' && window.isSolidBgColor(oldP.background) &&
                        !oldP.backgroundGif && !oldP.backgroundImage && !oldP.backgroundVideo) {
                      newP.background = oldP.background;
                      newP.backgroundColor = oldP.background;
                    }
                  } catch (e) {}
                  if (!newP.backgroundGif && !newP.backgroundImage) {
                    if (oldP.backgroundGif) newP.backgroundGif = oldP.backgroundGif;
                    else if (oldP.backgroundImage) newP.backgroundImage = oldP.backgroundImage;
                    if (oldP.background && (oldP.backgroundGif || oldP.backgroundImage)) newP.background = oldP.background;
                    jsonStr = JSON.stringify(newP);
                  }
                }
              } catch (e) {}
              const _keepBgType = slides[idx] ? slides[idx].bgType : undefined;
              const _keepBgVal = slides[idx] ? slides[idx].bgVal : undefined;
              slides[idx] = {
                json: jsonStr,
                thumb: safeToDataURL(newCanvas, { format: 'png', multiplier: 0.3 }),
                imageNumbers: extractImageNumbers(elems),
              };
              if (_keepBgType) { slides[idx].bgType = _keepBgType; slides[idx].bgVal = _keepBgVal; }
              // v29: yangi slayd o'z fon rangini olib kelgan bo'lsa — eski (masalan reset_deck qo'ygan oq) bgVal uni
              // keyingi saqlashda bosib ketmasin. Fon rasmi/GIF bo'lsa bgType ham shunga mos.
              try {
                const _np2 = JSON.parse(jsonStr);
                if (_np2.backgroundGif || _np2.backgroundImage) {
                  slides[idx].bgType = _np2.backgroundGif ? 'gif' : 'image';
                  slides[idx].bgVal = null;
                } else if (typeof window.isSolidBgColor === 'function' && window.isSolidBgColor(_np2.background)) {
                  slides[idx].bgType = 'color';
                  slides[idx].bgVal = _np2.background;
                }
              } catch (e) {}
              markSlideAsNew(slides[idx]);
              newCanvas.dispose();
              activeIndex = idx;
              try { renderSidebar(); } catch (e) {}
              try { updateSlideCounterUI(); } catch (e) {}
              try { await loadSlideCanvasAsync(idx); } catch (e) { console.warn('replace_slide load:', e); }
              try {
                const _pj = JSON.parse(slides[idx].json || '{}');
                if (_pj.backgroundGif) GifBackground.applyFromSlide(slides[idx].json);
              } catch (e) {}

              try { ensureSlideMediaLoaded(idx); } catch (e) {}
              ssMarkSlideDone(slides[idx]);
              break;
            }
            case 'reset_deck':
            case 'delete_extra_slides': {
              if (_resetDeckAppliedThisStream && executedActionSignatures.has('RESET_DECK')) {
                break;
              }
              _resetDeckAppliedThisStream = true;

              let keepRaw = parseInt(cmd.keep, 10);
              if (isNaN(keepRaw) || keepRaw < 0) keepRaw = 1;
              const keep = Math.max(1, Math.min(keepRaw || 1, Math.max(slides.length, 1)));

              if (slides.length > keep) slides.splice(keep);

              if (slides.length === 0) {
                slides.push({
                  json: JSON.stringify({ objects: [], background: '#ffffff' }),
                  thumb: '',
                  imageNumbers: [],
                });
              }

              for (let k = 0; k < slides.length; k++) {
                slides[k].json = JSON.stringify({ objects: [], background: '#ffffff', backgroundImage: null });
                slides[k].imageNumbers = [];
                slides[k].thumb = '';
                slides[k].bgType = 'color';
                slides[k].bgVal = '#ffffff';
                await refreshSlideThumb(k);
              }
              activeIndex = 0;
              try { GifOverlay.clear(); } catch (e) {}
              try { GifBackground.clear(); } catch (e) {}
              try {
                const card = document.getElementById('canvasCard');
                if (card) card.classList.remove('has-gif-bg');
              } catch (e) {}
              canvas.clear();
              canvas.setBackgroundImage(null, () => {
                canvas.setBackgroundColor('#ffffff', canvas.renderAll.bind(canvas));
              });
              try { renderSidebar(); } catch (e) {}
              try { updateSlideCounterUI(); } catch (e) {}
              break;
            }
            case 'create_element':
            case 'add_text': {
              if (cmd.slide_index !== undefined && cmd.slide_index !== null) {
                const targetIndex = parseInt(cmd.slide_index, 10) - 1;
                if (targetIndex >= 0 && targetIndex < slides.length && targetIndex !== activeIndex) {
                  await switchSlide(targetIndex);
                }
              }
              const el = cmd.element || (cmd.type ? cmd : null);
              if (el && slides[activeIndex]) {
                const parsed = JSON.parse(slides[activeIndex].json || '{}');
                parsed.objects = parsed.objects || [];
                const fabEl = await parseElementToFabric(el);
                if (fabEl) {
                  ensureObjectId(fabEl);
                  parsed.objects.push(fabEl.toJSON(SERIALIZE_PROPS));
                  slides[activeIndex].json = JSON.stringify(parsed);
                  await refreshSlideThumb(activeIndex);
                }
              }
              break;
            }
            case 'clear_slide': {
              const idx = ((cmd.slide != null ? cmd.slide : (activeIndex + 1)) || 1) - 1;
              if (idx >= 0 && idx < slides.length) {
                slides[idx].json = JSON.stringify({ objects: [], background: '#ffffff', backgroundImage: null });
                slides[idx].imageNumbers = [];
                slides[idx].thumb = '';
                slides[idx].bgType = 'color';
                slides[idx].bgVal = '#ffffff';
                await refreshSlideThumb(idx);
                if (idx === activeIndex) {
                  try { GifOverlay.clear(); } catch (e) {}
                  try { GifBackground.clear(); } catch (e) {}
                  canvas.clear();
                  canvas.setBackgroundImage(null, () => {
                    canvas.setBackgroundColor('#ffffff', canvas.renderAll.bind(canvas));
                  });
                  try {
                    const card = document.getElementById('canvasCard');
                    if (card) card.classList.remove('has-gif-bg');
                  } catch (e) {}
                }
              }
              break;
            }
            case 'success':
              showToast(cmd.message || '✅ Bajarildi');
              break;
            case 'error':
              showToast('⚠️ ' + (cmd.message || 'Xatolik'), 'error');
              break;
            default:
              await executeAiSlideActions(cmd);
          }
          if (cmd.action !== 'success' && cmd.action !== 'error') {
            lastActionReport.push(`✅ ${cmd.action}${cmd.slide ? ` (slayd ${cmd.slide})` : ''}${cmd.image_number ? ` (#${cmd.image_number})` : ''}`);
          }
        } catch (e) {
          console.error(`Command ${cmd.action} xatolik:`, e);
          lastActionReport.push(`❌ ${cmd.action}: xatolik — ${String((e && e.message) || e)}`);
        } finally {
          try { if (_liveSk) _liveSk.remove(); } catch (e) {}
        }
      }
      isAiApplyingCommands = false;

      const _needsFullReload = (lastActionReport || []).slice(_batchReportStart).some((line) => {
        if (!line || line.startsWith('❌')) return false;
        return /replace_slide|clear_slide|insert_slide|create_slides|reset_deck|delete_extra|delete_slide/i.test(line);
      });
      const _incrementalOnly = (lastActionReport || []).slice(_batchReportStart).some((line) => {
        if (!line || line.startsWith('❌')) return false;
        return /add_gif|place_image|add_element|add_text|add_video|add_button|add_link|style_media|set_animation|create_element|update_element|move_element|delete_element|copy_object|set_background/i.test(line);
      });
      if (isAiStreaming) {
        try {
          if (slides.length > 0) {
            const safeIdx = Math.min(Math.max(activeIndex, 0), slides.length - 1);
            activeIndex = safeIdx;
            try { await refreshSlideThumb(safeIdx); } catch (e) {  }

            if (_needsFullReload || _lastRenderedSlideIndex !== safeIdx) {
              try {
                if (typeof scheduleSidebarRender === 'function') scheduleSidebarRender(80);
                else renderSidebar();
              } catch (e) { try { renderSidebar(); } catch (e2) {} }
            }
            updateSlideCounterUI();
            const needReload = (_lastRenderedSlideIndex !== safeIdx) || _needsFullReload;
            if (needReload) {
              try {
                await new Promise((r) => requestAnimationFrame(() => r()));
                await loadSlideCanvasAsync(safeIdx);
                _lastRenderedSlideIndex = safeIdx;
              } catch (e) { console.warn('stream reload:', e); }
            } else if (_incrementalOnly) {

              requestAnimationFrame(() => {
                try { canvas.requestRenderAll(); } catch (e) {}
                try { GifOverlay.scheduleSync(); } catch (e) {}
                try { GifOverlay.sync && GifOverlay.sync(); } catch (e) {}
                try { updateAllImageBadges(); } catch (e) {}
              });
            } else {
              requestAnimationFrame(() => {
                try { canvas.requestRenderAll(); } catch (e) {}
                try { GifOverlay.scheduleSync(); } catch (e) {}
              });
            }
            try { updateAllImageBadges(); } catch (e) {}
          }
        } catch (e) {  }
      } else {

        if (_needsFullReload || !_incrementalOnly) {
          await syncUiAfterAiChange();
        } else {
          try { await refreshSlideThumb(activeIndex); } catch (e) {}
          requestAnimationFrame(() => {
            try { canvas.requestRenderAll(); } catch (e) {}
            try { GifOverlay.scheduleSync(); } catch (e) {}
            try { GifOverlay.sync && GifOverlay.sync(); } catch (e) {}
            try { updateAllImageBadges(); } catch (e) {}
          });
          try {
            if (typeof scheduleSidebarRender === 'function') scheduleSidebarRender(100);
          } catch (e) {}
        }
        try { recordGlobalState(); } catch (e) {}
      }
    }
    async function syncUiAfterAiChange() {
      if (slides.length > 0) {
        const safeIdx = Math.min(Math.max(activeIndex, 0), slides.length - 1);
        activeIndex = safeIdx;
        await loadSlideCanvasAsync(safeIdx);
        _lastRenderedSlideIndex = safeIdx;
        updateSlideCounterUI();
        updateAllImageBadges();
      } else {
        canvas.clear();
        canvas.renderAll();
        _lastRenderedSlideIndex = -1;
      }

      try {
        for (let i = 0; i < slides.length; i++) {
          await refreshSlideThumb(i);
          await new Promise((r) => setTimeout(r, 0));
        }
      } catch (e) {  }
      if (_sidebarRenderTimer) { clearTimeout(_sidebarRenderTimer); _sidebarRenderTimer = null; }
      renderSidebar();
      try {
        const overlay = document.getElementById('presentationOverlay');
        if (overlay && overlay.style.display === 'flex') {
          presentationIndex = Math.min(presentationIndex, slides.length - 1);
          await renderPresentationSlide();
        }
      } catch (e) {  }
    }
    window.syncUiAfterAiChange = syncUiAfterAiChange;
    async function processAiAction(action) {
      if (!action || !action.action) return;

      if (/^(create_slides|add_slide|add_slides|new_slide|new_slides)$/i.test(String(action.action))) {
        await executeAiCommands({ actions: [action] });
        return;
      }
      switch (action.action) {
        case 'insert_slide': {
          let afterRaw = (typeof action.after === 'number') ? action.after
            : (typeof action.slide === 'number') ? action.slide
            : slides.length;
          if (afterRaw < 0) afterRaw = 0;
          while (slides.length < afterRaw) {
            slides.push({ json: JSON.stringify({ objects: [], background: '#ffffff' }), thumb: '', imageNumbers: [] });
          }
          const insertAt = Math.max(0, Math.min(afterRaw, slides.length));
          const elements = Array.isArray(action.elements) ? action.elements : [];
          const newCanvas = await createFabricCanvasFromElements(elements, action.background || '#ffffff');
          slides.splice(insertAt, 0, {
            json: JSON.stringify(newCanvas.toJSON(SERIALIZE_PROPS)),
            thumb: safeToDataURL(newCanvas, { format: 'png', multiplier: 0.3 }),
            imageNumbers: extractImageNumbers(elements),
          });
          newCanvas.dispose();
          activeIndex = (typeof action.activate === 'number')
            ? Math.max(0, Math.min(action.activate - 1, slides.length - 1))
            : insertAt;
          break;
        }
        case 'create_element':
        case 'add_text': {
          if (action.slide_index !== undefined && action.slide_index !== null) {
            const targetIndex = parseInt(action.slide_index, 10) - 1;
            if (targetIndex >= 0 && targetIndex < slides.length && targetIndex !== activeIndex) {
              await switchSlide(targetIndex);
            }
          }
          const el = action.element || (action.type ? action : null);
          if (el && slides[activeIndex]) {
            const parsed = JSON.parse(slides[activeIndex].json || '{}');
            parsed.objects = parsed.objects || [];
            const fabEl = await parseElementToFabric(el);
            if (fabEl) {
              ensureObjectId(fabEl);
              parsed.objects.push(fabEl.toJSON(SERIALIZE_PROPS));
              slides[activeIndex].json = JSON.stringify(parsed);
              await refreshSlideThumb(activeIndex);
            }
          }
          break;
        }
        case 'clear_slide': {
          const idx = ((action.slide != null ? action.slide : (activeIndex + 1)) || 1) - 1;
          if (idx >= 0 && idx < slides.length) {
            slides[idx].json = JSON.stringify({ objects: [], background: '#ffffff', backgroundImage: null });
            slides[idx].imageNumbers = [];
            slides[idx].thumb = '';
            await refreshSlideThumb(idx);
            if (idx === activeIndex) {
              try { GifOverlay.clear(); } catch (e) {}
              try { GifBackground.clear(); } catch (e) {}
              canvas.clear();
              canvas.setBackgroundImage(null, () => {
                canvas.setBackgroundColor('#ffffff', canvas.renderAll.bind(canvas));
              });
            }
          }
          break;
        }
        default:
          await executeAiCommands({ actions: [action] });
          return;
      }
      await syncUiAfterAiChange();
    }
    window.processAiAction = processAiAction;
    async function executeAiSlideActions(actions) {
      if (!actions) return;
      const actionList = Array.isArray(actions) ? actions : [actions];
      for (const act of actionList) {
        if (!act || !act.action) continue;
        if (act.action === 'error') {
          const botEl = document.getElementById(currentBotMsgId);
          if (botEl) {
            botEl.classList.add('error');
            const span = botEl.querySelector('.msg-text');
            if (span) span.innerText = "⚠️ " + (act.message || "Xatolik");
          }
          continue;
        }
        if (act.action === 'success') { showToast(act.message || "✅ Bajarildi"); continue; }
        let slideIdx = activeIndex;
        if (act.slide === 'current') slideIdx = activeIndex;
        else if (typeof act.slide === 'number') slideIdx = act.slide - 1;
        if (slideIdx < 0) slideIdx = 0;
        if (slideIdx >= slides.length) slideIdx = slides.length - 1;
        try {
          if (act.action === 'change_slide' || act.action === 'goto_slide' || act.action === 'switch_slide') {
            const target = ((act.slide != null ? act.slide : act.index) || 1) - 1;
            if (target >= 0 && target < slides.length) {
              try { saveCurrentSlideState(); } catch (e) {}
              activeIndex = target;
            }
          } else if (act.action === 'set_background') {
            if (slides[slideIdx]) {
              const parsed = JSON.parse(slides[slideIdx].json);
              parsed.background = act.background || '#ffffff';
              slides[slideIdx].json = JSON.stringify(parsed);
            }
          } else if (act.action === 'add_element') {
            if (slides[slideIdx] && act.element.type !== 'image') {
              const parsed = JSON.parse(slides[slideIdx].json);
              const fabEl = await parseElementToFabric(act.element);
              if (fabEl) {
                const oid = ensureObjectId(fabEl);
                parsed.objects.push(fabEl.toJSON(SERIALIZE_PROPS));
                slides[slideIdx].json = JSON.stringify(parsed);
              }
            }
          } else if (act.action === 'update_element') {
            if (slides[slideIdx]) {
              const parsed = JSON.parse(slides[slideIdx].json);
              const targetEl = parsed.objects.find(o => o._oid === act.id);
              if (targetEl && act.props) Object.assign(targetEl, act.props);
              slides[slideIdx].json = JSON.stringify(parsed);
            }
          } else if (act.action === 'delete_element') {
            if (slides[slideIdx]) {
              const parsed = JSON.parse(slides[slideIdx].json);
              parsed.objects = parsed.objects.filter(o => o._oid !== act.id);
              slides[slideIdx].json = JSON.stringify(parsed);
            }
          } else if (act.action === 'delete_slide') {
            const idx = (typeof act.slide === 'number') ? act.slide - 1 : slideIdx;
            if (idx >= 0 && idx < slides.length && slides.length > 1) {
              slides.splice(idx, 1);
              if (activeIndex >= slides.length) activeIndex = slides.length - 1;
            }
          } else if (act.action === 'move_element') {
            if (slides[slideIdx]) {
              const parsed = JSON.parse(slides[slideIdx].json);
              const targetEl = parsed.objects.find(o => o._oid === act.id);
              if (targetEl) {
                if (typeof act.left === 'number') targetEl.left = act.left;
                if (typeof act.top === 'number') targetEl.top = act.top;
              }
              slides[slideIdx].json = JSON.stringify(parsed);
            }
          }
        } catch (e) { console.error("Action xatolik:", act.action, e); }
      }
      await syncUiAfterAiChange();
    }
    function extractImageNumbers(elements) {
      if (!Array.isArray(elements)) return [];
      return elements.filter(e => isImageLike(e) && e.imageNumber != null).map(e => e.imageNumber);
    }
    async function createFabricCanvasFromElements(elements = [], background = '#ffffff') {
      const tempEl = document.createElement('canvas');
      tempEl.width = 960; tempEl.height = 540;
      const tempCanvas = new fabric.Canvas(tempEl, { backgroundColor: background });

      let localMax = 0;
      try {
        if (typeof recalculateGlobalImageCounter === 'function') {
          localMax = recalculateGlobalImageCounter() || 0;
        } else {
          localMax = (typeof globalImageCounter === 'number' ? globalImageCounter : 0);
        }
      } catch (e) { localMax = 0; }
      const used = new Set();
      const list = Array.isArray(elements) ? elements : [];

      for (const el of list) {
        if (!el || !isImageLike(el)) continue;
        if (typeof el.imageNumber === 'number' && el.imageNumber > 0) {
          if (!used.has(el.imageNumber)) {
            used.add(el.imageNumber);
            if (el.imageNumber > localMax) localMax = el.imageNumber;
          }
        }
      }

      // v33: matn o'lchamlari to'g'ri chiqishi uchun ishlatilgan shriftlarni AVVAL yuklaymiz.
      // Aks holda matn zaxira shriftda o'lchanadi, keyin haqiqiy shrift kengroq bo'lib kartochkadan chiqib ketadi
      // (qo'lda yozilgan matn shrift yuklangach o'lchanadi — shuning uchun u to'g'ri chiqardi).
      try {
        if (document.fonts && document.fonts.load) {
          const fams = new Set();
          list.forEach(function (e) { if (e && (e.type === 'text' || e.type === 'textbox')) fams.add(e.fontFamily || 'Roboto'); });
          await Promise.race([
            Promise.all(Array.from(fams).flatMap(function (f) {
              return [document.fonts.load('400 16px "' + f + '"'), document.fonts.load('700 16px "' + f + '"')];
            })),
            new Promise(function (r) { setTimeout(r, 2500); })
          ]);
        }
      } catch (e) {}

      const seenInBatch = new Set();
      for (const el of list) {
        if (!el || !isImageLike(el)) continue;
        const n = el.imageNumber;
        if (typeof n === 'number' && n > 0 && !seenInBatch.has(n)) {
          seenInBatch.add(n);
          continue;
        }
        localMax += 1;
        el.imageNumber = localMax;
        seenInBatch.add(localMax);
        used.add(localMax);
      }
      try { globalImageCounter = Math.max(globalImageCounter || 0, localMax); } catch (e) {}
      for (const el of list) {
        const fabEl = await parseElementToFabric(el);
        if (fabEl) {
          if (isImageLike(el) && el.imageNumber != null) {
            try {
              fabEl.imageNumber = el.imageNumber;
              fabEl.set({ imageNumber: el.imageNumber });
            } catch (e) {}
          }
          tempCanvas.add(fabEl);
        }
      }
      try {
        if (window.CardFit) {
          tempCanvas.getObjects().forEach(function (o) { if (o.initDimensions && (o.type === 'textbox' || o.type === 'i-text')) { try { o.initDimensions(); o.setCoords(); } catch (e) {} } });
          window.CardFit.fit(tempCanvas);
          window.CardFit.fit(tempCanvas);   // 2-o'tish: birinchi o'tishda surilgan elementlar yana tekshiriladi
        }
      } catch (e) { console.warn('CardFit:', e); }
      tempCanvas.renderAll();
      return tempCanvas;
    }
    async function parseElementToFabric(el) {
      if (!el || !el.type) return null;
      if (el.type === 'text' || el.type === 'textbox') {
        const tb = new fabric.Textbox(el.text || '', {
          left: el.left || 50, top: el.top || 50, width: el.width || 400,
          fontSize: el.fontSize || 24, fontWeight: el.fontWeight || 'normal',
          fill: el.fill || '#1f1f1f', fontFamily: el.fontFamily || 'Roboto',
          textAlign: el.textAlign || 'left',
          fontStyle: el.fontStyle || 'normal',
          lineHeight: (typeof el.lineHeight === 'number' && el.lineHeight > 0.8 && el.lineHeight < 3) ? el.lineHeight : 1.25,
          opacity: (typeof el.opacity === 'number') ? el.opacity : 1,
          id: el.id || 'el_' + Date.now() + Math.random().toString(36).substr(2, 4)
        });
        configureTextbox(tb);
        try { if (typeof el.height === 'number' && el.height > 12) { tb._aiBoxH = el.height; } } catch (e) {}   // v36: CardFit.fit dan keyin quti balandligi qat'iylanadi
        try {
          let lk = String(el.link || el.linkUrl || el.url || el.href || '').trim();
          if (lk) {
            if (!/^(https?:|mailto:|tel:)/i.test(lk)) lk = 'https://' + lk.replace(/^\/+/, '');
            tb.linkUrl = lk;
            tb.set({ underline: el.underline !== false });
            if (!el.fill) tb.set({ fill: '#2563eb' });
          }
        } catch (e) {}
        ensureObjectId(tb);
        return tb;
      }
      if (el.type === 'rect') {
        // v29: rx berilmasa to'liq fonli (960x540 ga yaqin) rect burchaksiz, kartalar esa 16 bo'lsin
        function _defaultRectRx(e) { return ((e.width || 0) >= 900 && (e.height || 0) >= 500) ? 0 : 16; }
        const r = new fabric.Rect({
          left: el.left || 50, top: el.top || 50,
          width: el.width || 100, height: el.height || 100,
          fill: el.fill || '#e2e8f0', rx: (el.rx != null ? el.rx : _defaultRectRx(el)), ry: (el.ry != null ? el.ry : (el.rx != null ? el.rx : _defaultRectRx(el))),
          stroke: el.stroke || null, strokeWidth: el.stroke ? (el.strokeWidth || 1) : 0,
          opacity: (typeof el.opacity === 'number') ? el.opacity : 1,
          id: el.id || 'el_' + Date.now()
        });
        try {
          if (el.shadow) {
            r.set('shadow', new fabric.Shadow(typeof el.shadow === 'string'
              ? { color: 'rgba(0,0,0,0.15)', blur: 14, offsetX: 0, offsetY: 4 } : el.shadow));
          }
        } catch (e) {}
        ensureObjectId(r);
        return r;
      }
      if (el.type === 'circle') {
        const c = new fabric.Circle({
          left: el.left || 50, top: el.top || 50,
          radius: el.radius || ((el.width || el.height) ? Math.min(el.width || el.height, el.height || el.width) / 2 : 50), fill: el.fill || '#e2e8f0',
          stroke: el.stroke || null, strokeWidth: el.stroke ? (el.strokeWidth || 1) : 0,
          opacity: (typeof el.opacity === 'number') ? el.opacity : 1,
          id: el.id || 'el_' + Date.now()
        });
        ensureObjectId(c);
        return c;
      }

      if (['line', 'arrow', 'check', 'cross', 'triangle', 'ellipse', 'star', 'polygon', 'hexagon', 'diamond', 'chevron', 'pill', 'shape'].indexOf(el.type) >= 0) {
        const kind = (el.type === 'shape' ? (el.shape || el.kind || 'rect') : el.type);
        const L = (typeof el.left === 'number') ? el.left : 50;
        const T = (typeof el.top === 'number') ? el.top : 50;
        const W = el.width || 100, H = el.height || 100;
        const color = el.fill || el.stroke || '#4F46E5';
        const sw = el.strokeWidth || 4;
        const common = { opacity: (typeof el.opacity === 'number') ? el.opacity : 1, id: el.id || ('el_' + Date.now() + Math.random().toString(36).substr(2, 4)) };
        let o = null;
        if (kind === 'line') {
          o = new fabric.Line([0, 0, W, el.height || 0], Object.assign({ left: L, top: T, stroke: el.stroke || color, strokeWidth: sw, strokeLineCap: 'round', fill: null }, common));
        } else if (kind === 'arrow') {

          const h = Math.max(H, 16), shaft = Math.max(4, Math.round(h * 0.3)), head = Math.min(W * 0.4, h);
          const d = 'M 0 ' + (h / 2 - shaft / 2) + ' L ' + (W - head) + ' ' + (h / 2 - shaft / 2) + ' L ' + (W - head) + ' 0 L ' + W + ' ' + (h / 2) +
            ' L ' + (W - head) + ' ' + h + ' L ' + (W - head) + ' ' + (h / 2 + shaft / 2) + ' L 0 ' + (h / 2 + shaft / 2) + ' Z';
          o = new fabric.Path(d, Object.assign({ left: L, top: T, fill: color }, common));
        } else if (kind === 'check') {
          const sz = Math.min(W, H) || 40;
          o = new fabric.Path('M ' + sz * 0.1 + ' ' + sz * 0.55 + ' L ' + sz * 0.4 + ' ' + sz * 0.85 + ' L ' + sz * 0.92 + ' ' + sz * 0.18,
            Object.assign({ left: L, top: T, fill: null, stroke: color, strokeWidth: Math.max(3, sz * 0.14), strokeLineCap: 'round', strokeLineJoin: 'round' }, common));
        } else if (kind === 'cross') {
          const sz = Math.min(W, H) || 40;
          o = new fabric.Path('M ' + sz * 0.15 + ' ' + sz * 0.15 + ' L ' + sz * 0.85 + ' ' + sz * 0.85 + ' M ' + sz * 0.85 + ' ' + sz * 0.15 + ' L ' + sz * 0.15 + ' ' + sz * 0.85,
            Object.assign({ left: L, top: T, fill: null, stroke: color, strokeWidth: Math.max(3, sz * 0.12), strokeLineCap: 'round' }, common));
        } else if (kind === 'triangle') {
          o = new fabric.Triangle(Object.assign({ left: L, top: T, width: W, height: H, fill: color, stroke: el.stroke || null, strokeWidth: el.stroke ? sw : 0 }, common));
        } else if (kind === 'ellipse') {
          o = new fabric.Ellipse(Object.assign({ left: L, top: T, rx: W / 2, ry: H / 2, fill: color, stroke: el.stroke || null, strokeWidth: el.stroke ? sw : 0 }, common));
        } else if (kind === 'star') {
          const pts = [], cx = W / 2, cy = H / 2;
          for (let i = 0; i < 10; i++) {
            const r = (i % 2 === 0) ? 1 : 0.42, a = -Math.PI / 2 + i * Math.PI / 5;
            pts.push({ x: cx + Math.cos(a) * r * cx, y: cy + Math.sin(a) * r * cy });
          }
          o = new fabric.Polygon(pts, Object.assign({ left: L, top: T, fill: color }, common));
        } else if (kind === 'hexagon' || kind === 'polygon') {
          const n = (kind === 'hexagon') ? 6 : Math.max(3, Math.min(12, el.sides || 5)), pts = [], cx = W / 2, cy = H / 2;
          for (let i = 0; i < n; i++) {
            const a = -Math.PI / 2 + i * 2 * Math.PI / n;
            pts.push({ x: cx + Math.cos(a) * cx, y: cy + Math.sin(a) * cy });
          }
          o = new fabric.Polygon(pts, Object.assign({ left: L, top: T, fill: color, stroke: el.stroke || null, strokeWidth: el.stroke ? sw : 0 }, common));
        } else if (kind === 'diamond') {
          o = new fabric.Polygon([{ x: W / 2, y: 0 }, { x: W, y: H / 2 }, { x: W / 2, y: H }, { x: 0, y: H / 2 }], Object.assign({ left: L, top: T, fill: color }, common));
        } else if (kind === 'chevron') {
          const k = Math.min(W * 0.35, H * 0.5);
          o = new fabric.Polygon([{ x: 0, y: 0 }, { x: W - k, y: 0 }, { x: W, y: H / 2 }, { x: W - k, y: H }, { x: 0, y: H }, { x: k, y: H / 2 }], Object.assign({ left: L, top: T, fill: color }, common));
        } else if (kind === 'pill') {
          o = new fabric.Rect(Object.assign({ left: L, top: T, width: W, height: H, rx: H / 2, ry: H / 2, fill: color, stroke: el.stroke || null, strokeWidth: el.stroke ? sw : 0 }, common));
        } else if (kind === 'rect' || kind === 'circle') {
          return parseElementToFabric(Object.assign({}, el, { type: kind }));
        }
        if (o) {
          try { if (el.angle) o.set('angle', el.angle); } catch (e) {}
          try { if (el.shadow) o.set('shadow', new fabric.Shadow(typeof el.shadow === 'string' ? { color: 'rgba(0,0,0,0.15)', blur: 14, offsetX: 0, offsetY: 4 } : el.shadow)); } catch (e) {}
          ensureObjectId(o);
          return o;
        }
        return null;
      }
      if (el.type === 'gifImage' || el.isGif) {

        let gifUrl = el.gifUrl || el.src;
        if (!gifUrl) return null;
        const nw = el.width || 300;
        const nh = el.height || 200;
        const im = document.createElement('img');
        im.decoding = 'async';
        const isRealGif = typeof gifUrl === 'string' && (
          /^https?:\/\//i.test(gifUrl) || gifUrl.startsWith('data:') || gifUrl.startsWith('blob:') || gifUrl.startsWith('/api/proxy-image')
        );
        let displaySrc = '';
        if (isRealGif) {
          if (/^https?:\/\//i.test(gifUrl) && !gifUrl.startsWith(window.location.origin) && !gifUrl.startsWith('/api/proxy-image')) {
            displaySrc = '/api/proxy-image?raw=1&url=' + encodeURIComponent(gifUrl);
          } else {
            displaySrc = gifUrl;
          }
        } else {

          displaySrc = (typeof GIF_PLACEHOLDER_URL !== 'undefined' ? GIF_PLACEHOLDER_URL : '');
        }
        if (displaySrc) im.src = displaySrc;
        im.width = nw;
        im.height = nh;
        const fImg = new AnimatedGifImage(im, {
          left: el.left != null ? el.left : 50, top: el.top != null ? el.top : 50,
          width: nw, height: nh,
          id: el.id || 'gif_' + Date.now(),
          imageNumber: el.imageNumber != null ? el.imageNumber : null,
          imageHash: el.imageHash || null,
          gifUrl: isRealGif ? gifUrl : displaySrc,
          src: isRealGif ? gifUrl : displaySrc,
          isGif: true,
          isFallback: !!el.isFallback,
          scaleX: (el.scaleX != null ? el.scaleX : 1),
          scaleY: (el.scaleY != null ? el.scaleY : 1),
          objectCaching: false,
          angle: el.angle || 0,
        });
        fImg._gifElement = im;
        fImg._gifUrl = isRealGif ? gifUrl : displaySrc;
        fImg.isFallback = !!el.isFallback;
        fImg._topicHint = isRealGif ? '' : String(gifUrl || '').replace(/[-_+/]/g, ' ').trim().slice(0, 60);
        if (el._oid != null) { fImg._oid = el._oid; fImg.set('_oid', el._oid); }
        else ensureObjectId(fImg);

        if (!isRealGif && typeof ensureWorkingGif === 'function') {
          const topic = fImg._topicHint || 'animation';
          ensureWorkingGif('', topic).then(function (got) {
            if (!got || !got.src) return;
            try {
              fImg.gifUrl = got.src;
              fImg.src = got.src;
              fImg._gifUrl = got.src;
              fImg.isFallback = !!got.isFallback;
              const prox = /^https?:\/\//i.test(got.src)
                ? ('/api/proxy-image?raw=1&url=' + encodeURIComponent(got.src))
                : got.src;
              im.src = prox;
            } catch (e) {}
            try { GifOverlay.scheduleSync(); } catch (e) {}
          }).catch(function () {});
        }
        try { GifOverlay.scheduleSync(); } catch (e) {}
        return fImg;
      }
      if (el.type === 'videoImage' || el.isVideo) {
        const vidUrl = el.videoUrl || el.src;
        if (!vidUrl) return null;
        const vw = el.width || 480;
        const vh = el.height || 270;
        return withTimeout(new Promise((resolve) => {
          const v = document.createElement('video');
          v.crossOrigin = 'anonymous';
          v.src = vidUrl;
          v.loop = el.videoLoop !== false;
          v.muted = el.videoMuted !== false;
          v.playsInline = true;
          v.autoplay = el.videoAutoplay !== false;
          const done = () => {
            const fImg = new VideoImage(v, {
              left: el.left || 50, top: el.top || 50,
              id: el.id || 'video_' + Date.now(),
              imageNumber: el.imageNumber != null ? el.imageNumber : null,
              imageHash: el.imageHash || null,
              videoUrl: vidUrl,
              videoLoop: v.loop, videoMuted: v.muted, videoAutoplay: v.autoplay,
              scaleX: (el.scaleX != null ? el.scaleX : 1),
              scaleY: (el.scaleY != null ? el.scaleY : 1),
              objectCaching: false,
            });
            ensureObjectId(fImg);
            try { if (v.autoplay) v.play().catch(function () {}); } catch (e) {}
            resolve(fImg);
          };
          v.onloadeddata = done;
          v.onerror = () => resolve(null);
          setTimeout(() => { if (v.readyState >= 2) done(); }, 2000);
        }), 6000, null);
      }
      if (el.type === 'image') {
        if (!el.src) return null;

        const _srcL = String(el.src || el.gifUrl || '').toLowerCase();
        const _looksGif = !!(el.isGif || el.type === 'gifImage'
          || /\.gif(\?|#|$)/i.test(_srcL)
          || /media\.giphy\.com|i\.giphy\.com|[\w.-]*klipy\.com|media\.tenor\.com|c\.tenor\.com/i.test(_srcL)
          || /^data:image\/gif/i.test(_srcL));
        if (_looksGif) {
          el = Object.assign({}, el, { type: 'gifImage', isGif: true, gifUrl: el.gifUrl || el.src });

          let gifUrl = el.gifUrl || el.src;
          const nw = el.width || 300;
          const nh = el.height || 200;
          const im = document.createElement('img');
          im.decoding = 'async';
          const isRealGif = typeof gifUrl === 'string' && (
            /^https?:\/\//i.test(gifUrl) || gifUrl.startsWith('data:') || gifUrl.startsWith('blob:') || gifUrl.startsWith('/api/proxy-image')
          );
          let displaySrc = '';
          if (isRealGif) {
            if (/^https?:\/\//i.test(gifUrl) && !gifUrl.startsWith(window.location.origin) && !gifUrl.startsWith('/api/proxy-image')) {
              displaySrc = '/api/proxy-image?raw=1&url=' + encodeURIComponent(gifUrl);
            } else displaySrc = gifUrl;
          } else {
            displaySrc = (typeof GIF_PLACEHOLDER_URL !== 'undefined' ? GIF_PLACEHOLDER_URL : '');
          }
          if (displaySrc) im.src = displaySrc;
          im.width = nw; im.height = nh;
          const fImg = new AnimatedGifImage(im, {
            left: el.left != null ? el.left : 50, top: el.top != null ? el.top : 50,
            width: nw, height: nh,
            id: el.id || 'gif_' + Date.now(),
            imageNumber: el.imageNumber != null ? el.imageNumber : null,
            imageHash: el.imageHash || null,
            gifUrl: isRealGif ? gifUrl : displaySrc,
            src: isRealGif ? gifUrl : displaySrc,
            isGif: true,
            isFallback: !!el.isFallback,
            scaleX: (el.scaleX != null ? el.scaleX : 1),
            scaleY: (el.scaleY != null ? el.scaleY : 1),
            objectCaching: false,
            angle: el.angle || 0,
          });
          fImg._gifElement = im;
          fImg._gifUrl = isRealGif ? gifUrl : displaySrc;
          fImg.isFallback = !!el.isFallback;
          if (el._oid != null) { fImg._oid = el._oid; fImg.set('_oid', el._oid); }
          else ensureObjectId(fImg);
          if (!isRealGif && typeof ensureWorkingGif === 'function') {
            ensureWorkingGif('', String(gifUrl || 'animation').slice(0, 60)).then(function (got) {
              if (!got || !got.src) return;
              try {
                fImg.gifUrl = got.src; fImg.src = got.src; fImg._gifUrl = got.src;
                fImg.isFallback = !!got.isFallback;
                im.src = /^https?:\/\//i.test(got.src)
                  ? ('/api/proxy-image?raw=1&url=' + encodeURIComponent(got.src)) : got.src;
              } catch (e) {}
              try { GifOverlay.scheduleSync(); } catch (e) {}
            }).catch(function () {});
          }
          try { GifOverlay.scheduleSync(); } catch (e) {}
          return fImg;
        }
        const isDataUrl = typeof el.src === 'string' && el.src.startsWith('data:image');
        const isHttpUrl = typeof el.src === 'string' && /^https?:\/\//i.test(el.src);
        if (!isDataUrl && !isHttpUrl) return null;
        let resolvedSrc = el.src;
        if (isHttpUrl) {
          try { resolvedSrc = await resolveRemoteToDataUrl(el.src); } catch (e) { resolvedSrc = el.src; }
        }

        const hasScale = (el.scaleX != null && el.scaleY != null &&
          typeof el.scaleX === 'number' && typeof el.scaleY === 'number');
        return withTimeout(new Promise((resolve) => {
          const onLoaded = (loadedImg) => {
            if (!loadedImg || !loadedImg.width) { resolve(null); return; }
            const nw = loadedImg.width || 1;
            const nh = loadedImg.height || 1;
            let sx, sy;
            if (hasScale) {
              sx = el.scaleX;
              sy = el.scaleY;
            } else {

              const dispW = el.width || 200;
              const dispH = el.height || 150;
              sx = dispW / nw;
              sy = dispH / nh;
            }
            loadedImg.set({
              left: el.left != null ? el.left : 50,
              top: el.top != null ? el.top : 50,
              id: el.id || 'img_' + Date.now(),
              imageNumber: el.imageNumber != null ? el.imageNumber : null,
              imageHash: el.imageHash || null,
              scaleX: sx,
              scaleY: sy,
              angle: el.angle || 0,
              opacity: el.opacity != null ? el.opacity : 1,
              objectCaching: false
            });
            try { loadedImg.setCoords(); } catch (e) {}
            loadedImg.dirty = true;
            if (el._oid != null) { loadedImg._oid = el._oid; loadedImg.set('_oid', el._oid); }
            ensureObjectId(loadedImg);
            resolve(loadedImg);
          };
          try {
            fabric.Image.fromURL(resolvedSrc || el.src, onLoaded, { crossOrigin: 'anonymous' });
          } catch (e) {
            console.warn("parseElementToFabric rasm xatoligi:", e);
            resolve(null);
          }
        }), 6000, null);
      }
      return null;
    }
