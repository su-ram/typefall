// Typefall content script — 타자 칠 때 페이지 전체에 효과를 그린다.
// 프라이버시: 키 내용은 읽지 않는다. 물리 키 위치(event.code)로 "크리스마스" 진행 상태만 본다(저장·전송 없음).
// iframe 의 키 코드는 상위 페이지로 보내지 않는다(각 프레임이 자체 감지, 신호만 전달).
(() => {
  const TF = self.Typefall;
  const isTop = window.top === window;
  const IGNORE = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'Tab', 'Escape']);
  const DEFAULTS = { mode: 'snow', tint: 'default', density: 'm', xmas: true, specialKey: '', specialKeyLabel: '', emoji: TF.DEFAULT_EMOJI };
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let settings = { ...DEFAULTS };

  const frameWord = new TF.WordTrigger(); // iframe 용(자체 감지)
  const isPassword = (el) => el && el.tagName === 'INPUT' && el.type === 'password';

  let tf = null, canvas = null, ctx = null, running = false, last = 0;

  function ensure() {
    if (tf) return;
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;';
    (document.documentElement || document.body).appendChild(canvas);
    ctx = canvas.getContext('2d');
    tf = new TF.Typefall({ W: innerWidth, H: innerHeight, dpr: Math.min(devicePixelRatio || 1, 2) });
    tf.setOptions(settings);
    fit();
    addEventListener('resize', fit);
  }
  function fit() {
    if (!tf) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    tf.resize(innerWidth, innerHeight, dpr);
  }
  function start() {
    ensure();
    if (running) return;
    running = true; last = performance.now();
    requestAnimationFrame(frame);
  }
  function frame(now) {
    const dt = (now - last) / 1000; last = now;
    tf.update(dt, now); tf.draw(ctx);
    if (tf.active) requestAnimationFrame(frame);
    else { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); } // 다 사라지면 루프 정지(부하 0)
  }

  // 최상위: 타자/크리스마스 반영
  function onHit() { if (reduceMotion) return; if (settings.mode !== 'off') { ensure(); tf.hit(); start(); } }
  function onXmas() { ensure(); tf.triggerChristmas(); start(); }

  addEventListener('keydown', (e) => {
    if (!e.isTrusted || e.repeat || e.ctrlKey || e.metaKey || IGNORE.has(e.code) || isPassword(e.target)) return;
    if (isTop) {
      onHit();
      if (settings.xmas || settings.specialKey) { ensure(); if (tf.key(e.code)) { if (!reduceMotion) start(); } }
    } else {
      try { window.top.postMessage({ __typefall: 'hit' }, '*'); } catch (_) {}
      if ((settings.xmas && frameWord.feed(e.code)) || (settings.specialKey && e.code === settings.specialKey)) { try { window.top.postMessage({ __typefall: 'xmas' }, '*'); } catch (_) {} }
    }
  }, true);

  if (!isTop) return;
  addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.__typefall === 'hit') onHit();
    else if (e.data.__typefall === 'xmas' && (settings.xmas || settings.specialKey) && !reduceMotion) onXmas();
  });

  try {
    chrome.storage.sync.get(DEFAULTS, (v) => { settings = { ...DEFAULTS, ...v }; if (tf) tf.setOptions(settings); });
    chrome.storage.onChanged.addListener((ch) => {
      for (const k in ch) settings[k] = ch[k].newValue;
      if (tf) tf.setOptions(settings);
      if (!settings.xmas) frameWord.reset();
    });
    chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'preview-xmas') onXmas(); });
  } catch (_) {}
})();
