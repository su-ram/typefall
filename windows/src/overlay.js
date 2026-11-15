// 오버레이 렌더러: 화면 전체 투명 캔버스에 효과 엔진을 그린다. 그릴 게 없으면 루프를 멈춰 부하 0.
(() => {
  const TF = window.Typefall;
  const q = new URLSearchParams(location.search);
  const keepAlive = !!q.get('bg');                                  // 자가 테스트: 배경색을 깔고 계속 그림
  if (q.get('bg')) document.body.style.background = '#' + q.get('bg').replace(/[^0-9a-f]/gi, '').slice(0, 6);

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const tf = new TF.Typefall({ W: innerWidth, H: innerHeight, dpr: Math.min(devicePixelRatio || 1, 2) });

  function fit() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    tf.resize(innerWidth, innerHeight, dpr);
  }
  fit(); addEventListener('resize', fit);

  let running = false, last = 0;
  function start() { if (running) return; running = true; last = performance.now(); requestAnimationFrame(frame); }
  function frame(now) {
    const dt = (now - last) / 1000; last = now;
    tf.update(dt, now); tf.draw(ctx);
    if (tf.active || keepAlive) requestAnimationFrame(frame);
    else { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }

  window.tfBridge.on((m) => {
    if (m.type === 'options') tf.setOptions(m.options);
    else if (m.type === 'hit') { if (tf.opts.mode !== 'off') { tf.hit(); start(); } }
    else if (m.type === 'xmas') { tf.triggerChristmas(); start(); }
  });
  if (keepAlive) start();
})();
