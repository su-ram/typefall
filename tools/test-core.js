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
    peak = Math.max(peak, tf.snow.count + tf.starsF.count + Object.values(tf.nature).reduce((n, f) => n + f.count, 0)); peakX = Math.max(peakX, tf.xmas.parts.length);
  }
  const bad = [...tf.snow.flakes, ...tf.starsF.flakes, ...tf.xmas.parts].some((p) => !isFinite(p.x) || !isFinite(p.y));
  for (let i = 0; i < 60 * 40; i++) { t += 1000 / 60; tf.update(1 / 60, t); tf.draw(ctx); } // 40초 방치
  return { tf, peak, peakX, bad };
};
{ const r = sim('snow'); check('눈 최대 개수(≤70)', r.peak, (v) => v > 0 && v <= 70); check('눈 NaN 없음', r.bad, false); check('방치 후 active=false', r.tf.active, false); }
{ const r = sim('stars'); check('별가루 최대(별50+가루160 이하)', r.peak, (v) => v > 0 && v <= 210); check('별 NaN 없음', r.bad, false); check('방치 후 active=false', r.tf.active, false); }
{ const r = sim('stars', { density: 'l' }); check('많이 단계 최대(≤235)', r.peak, (v) => v <= 235); }
{ const r = sim('stars', { density: 's' }); check('조금 단계가 훨씬 적음(≤88)', r.peak, (v) => v <= 88); }
check('파티클 양은 3단계(s/m/l)', Object.keys(T.DENSITY).join(), 's,m,l');
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
check('예전 id 변환(midhigh→m, high→l, low→s, xs→s, xl→l)', ['midhigh', 'high', 'low', 'xs', 'xl'].map(T.normDensity).join(), 'm,l,s,s,l');
check('알 수 없는 값은 기본(m)', T.normDensity('???'), 'm');
check('보통 배율 = 0.35(#8: 이전 0.7의 절반)', T.DENSITY.m, 0.35);
check('조금/많이도 절반(0.21/0.56)', [T.DENSITY.s, T.DENSITY.l].join(), '0.21,0.56');
{ // 이모지 규칙: 트리 3~4개(가장 많음, 화면 전체 최대 4) + 나머지는 하나씩(산타도 반복 없음), ❄️ 항상 포함
  const tf = new T.Typefall({ W: 1200, H: 800, dpr: 1, createCanvas }); const R = tf.spr.emojiRepeatable, N = tf.spr.emojis.length, SNOW = tf.spr.emojiSnowflake;
  check('목록: 사슴·양말 없음, 무스 있음', !T.EMOJIS.includes('🦌') && !T.EMOJIS.includes('🧦') && T.EMOJIS.includes('🫎'), true);
  check('이모지 이미지 개수 = 10', N, 10);
  check('❄️ 인덱스 존재', SNOW >= R, true);
  let ok = { total: true, trees: true, most: true, uniq: true, snow: true }, treeCounts = new Set();
  for (let k = 0; k < 300; k++) {
    tf.xmas.queue = []; tf.xmas.parts = []; tf.triggerChristmas();
    const q = tf.xmas.queue, cnt = {}; q.forEach((i) => { cnt[i] = (cnt[i] || 0) + 1; });
    const trees = cnt[0] || 0; treeCounts.add(trees);
    if (q.length !== 12) ok.total = false;
    if (trees < 3 || trees > 4) ok.trees = false;
    if (Object.entries(cnt).some(([i, c]) => Number(i) !== 0 && c >= trees)) ok.most = false;       // 트리가 가장 많아야 함
    if (Object.entries(cnt).some(([i, c]) => Number(i) >= R && c > 1)) ok.uniq = false;             // 그룹 밖은 중복 금지
    if (!cnt[SNOW]) ok.snow = false;
  }
  check('항상 12개 (300회)', ok.total, true);
  check('트리는 3~4개', ok.trees, true);
  check('트리가 가장 많음', ok.most, true);
  check('트리 3개·4개 둘 다 나옴(무작위)', treeCounts.has(3) && treeCounts.has(4), true);
  check('트리 밖 이모지(산타 포함)는 중복 없음', ok.uniq, true);
  check('❄️ 눈송이가 매번 포함', ok.snow, true);
  // 겹쳐서 연속 트리거: 트리는 대기열+화면 합쳐 최대 4개, 그룹 밖 이모지는 중복 없음
  let overlapOk = true, uniqOk = true;
  for (let k = 0; k < 200; k++) {
    tf.xmas.queue = []; tf.xmas.parts = []; tf.triggerChristmas(); tf.triggerChristmas(); tf.triggerChristmas();
    const q = tf.xmas.queue; if (q.filter((i) => i === 0).length > 4) overlapOk = false;
    const o = q.filter((i) => i >= R); if (new Set(o).size !== o.length) uniqOk = false;
  }
  check('연속 트리거에도 트리 최대 4개', overlapOk, true);
  check('연속 트리거에도 그룹 밖 중복 없음', uniqOk, true);
}
// 새 모드 / 윤슬 / 지정 키
for (const m of T.NATURE_KINDS) {
  const r = sim(m); check(`${m} 개수(0<n≤140)`, r.peak, (v) => v > 0 && v <= 140); check(`${m} NaN 없음`, r.bad, false); check(`${m} 방치 후 active=false`, r.tf.active, false);
}
{ const tf = new T.Typefall({ W: 800, H: 600, dpr: 1, createCanvas }); tf.setOptions({ xmas: false });
  check('기본: 지정 키 없음 → 반응 없음', tf.key('KeyJ'), false);
  tf.setOptions({ specialKey: 'KeyJ' });
  check('지정 키 → 효과', tf.key('KeyJ'), true); check('효과 발생', tf.xmas.active, true); check('다른 키는 무시', tf.key('KeyK'), false); }
// 효과 메타데이터(내부용): 모든 효과가 정의돼 있고 enabled 만 목록에 나온다
{ const ids = T.EFFECTS.map((e) => e.id), known = ['snow', 'stars', ...T.NATURE_KINDS];
  check('메타데이터에 모든 효과가 있음', known.every((k) => ids.includes(k)) && ids.every((k) => known.includes(k)), true);
  check('enabledEffects 는 enabled 만', T.enabledEffects().every((e) => e.enabled) && T.enabledEffects().length === T.EFFECTS.filter((e) => e.enabled).length, true);
  check('모든 효과에 ko/en 이름', T.EFFECTS.every((e) => e.ko && e.en), true); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
