const T = require('../shared/typefall-core.js');
let fails = 0;
const check = (n, got, want) => { const ok = typeof want === 'function' ? want(got) : got === want; if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', n, '→', got); };

// 가짜 캔버스(그리기 호출만 흡수)
const ctx = new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
const createCanvas = (w, h) => ({ width: w, height: h, getContext: () => ctx });

// 1. 단어 감지
const codes = (s) => s.split(' ');
const run = (seq, bs = false) => { const w = new T.WordTrigger(); let n = 0; for (const c of codes(seq)) if (w.feed(c)) n++; return n; };
check('한글 크리스마스', run('KeyZ KeyM KeyF KeyL KeyT KeyM KeyA KeyK KeyT KeyM'), 1);
check('영어 christmas', run('KeyC KeyH KeyR KeyI KeyS KeyT KeyM KeyA KeyS'), 1);
check('일부만', run('KeyZ KeyM KeyF'), 0);
check('틀린 키', run('KeyZ KeyM KeyX KeyL KeyT KeyM KeyA KeyK KeyT KeyM'), 0);
check('두 번', run('KeyC KeyH KeyR KeyI KeyS KeyT KeyM KeyA KeyS Space KeyC KeyH KeyR KeyI KeyS KeyT KeyM KeyA KeyS'), 2);
{ const w = new T.WordTrigger(); const f = (c) => w.feed(c);
  'KeyC KeyH KeyR KeyI KeyS KeyT KeyM KeyA'.split(' ').forEach(f); f('Backspace'); f('KeyA');
  check('백스페이스 후 재입력', f('KeyS'), true); }

// 2. 시뮬레이션
const sim = (mode, extra = {}) => {
  const tf = new T.Typefall({ W: 1200, H: 800, dpr: 2, createCanvas });
  tf.setOptions({ mode, ...extra });
  let t = 0, peak = 0, peakX = 0;
  for (let i = 0; i < 60 * 8; i++) { // 8초: 초당 10타
    t += 1000 / 60; if (i % 6 === 0) tf.hit(t);
    tf.update(1 / 60, t); tf.draw(ctx);
    peak = Math.max(peak, tf.snow.count + tf.starsF.count); peakX = Math.max(peakX, tf.xmas.parts.length);
  }
  const bad = [...tf.snow.flakes, ...tf.starsF.flakes, ...tf.xmas.parts].some((p) => !isFinite(p.x) || !isFinite(p.y));
  for (let i = 0; i < 60 * 40; i++) { t += 1000 / 60; tf.update(1 / 60, t); tf.draw(ctx); } // 40초 방치
  return { tf, peak, peakX, bad };
};
{ const r = sim('snow'); check('눈 최대 개수(≤70)', r.peak, (v) => v > 0 && v <= 70); check('눈 NaN 없음', r.bad, false); check('방치 후 active=false', r.tf.active, false); }
{ const r = sim('stars'); check('별가루 최대(별50+가루160 이하)', r.peak, (v) => v > 0 && v <= 210); check('별 NaN 없음', r.bad, false); check('방치 후 active=false', r.tf.active, false); }
{ const r = sim('stars', { density: 'high' }); check('상 단계 최대(≤336)', r.peak, (v) => v <= 336); }
{ const r = sim('stars', { density: 'low' }); check('하 단계가 더 적음', r.peak, (v) => v <= 53); }
{ const tf = new T.Typefall({ W: 1200, H: 800, dpr: 1, createCanvas }); tf.setOptions({ mode: 'off', xmas: true });
  let t = 0, peak = 0;
  for (const c of 'KeyZ KeyM KeyF KeyL KeyT KeyM KeyA KeyK KeyT KeyM'.split(' ')) { tf.hit(t += 100); tf.key(c); }
  check('감지 → 크리스마스 시작', tf.xmas.active, true);
  for (let i = 0; i < 60 * 12; i++) { t += 1000 / 60; tf.update(1 / 60, t); tf.draw(ctx); peak = Math.max(peak, tf.xmas.parts.length); }
  check('크리스마스 입자 상한(≤900)', peak, (v) => v > 50 && v <= 900);
  check('크리스마스 종료 후 입자 0', tf.xmas.parts.length, 0);
  check('종료 후 active=false', (() => { for (let i = 0; i < 600; i++) { t += 16; tf.update(0.016, t); } return tf.active; })(), false); }
{ const tf = new T.Typefall({ W: 800, H: 600, dpr: 1, createCanvas }); // xmas 꺼짐이면 감지 안 함
  let hit = false; for (const c of 'KeyC KeyH KeyR KeyI KeyS KeyT KeyM KeyA KeyS'.split(' ')) hit = tf.key(c) || hit;
  check('xmas 꺼짐 → 감지 안 함', hit, false); }
{ const tf = new T.Typefall({ W: 800, H: 600, dpr: 1, createCanvas }); tf.setOptions({ tint: 'mint' }); check('색상 변경 후 스프라이트 재생성', tf.spr.stars.length, 8); }
check('노랑 색상 존재', T.TINTS.yellow, '#FFE08A');
{ const tf = new T.Typefall({ W: 800, H: 600, dpr: 1, createCanvas }); tf.setOptions({ tint: 'yellow' }); check('노랑 스프라이트 생성', tf.spr.stars.length, 8); }
check('레인보우 = 파스텔 6색 배열', Array.isArray(T.TINTS.rainbow) && T.TINTS.rainbow.length, 6);
{ const tf = new T.Typefall({ W: 800, H: 600, dpr: 1, createCanvas }); tf.setOptions({ tint: 'rainbow', mode: 'stars' });
  check('레인보우 별 스프라이트(6색×8모양)', tf.spr.stars.length, 48); check('레인보우 눈 스프라이트(6색)', tf.spr.dots.length, 6);
  let t = 0; for (let i = 0; i < 600; i++) { t += 16; if (i % 6 === 0) tf.hit(t); tf.update(0.016, t); tf.draw(ctx); }
  check('레인보우 시뮬레이션 정상', tf.starsF.count > 0, true); }
{ const tf = new T.Typefall({ W: 800, H: 600, dpr: 1, createCanvas }); tf.setOptions({ tint: 'mint' });
  check('단색은 눈 스프라이트 1개', tf.spr.dots.length, 1); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
