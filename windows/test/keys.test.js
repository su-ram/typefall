// 키 매핑 + 단어 감지 테스트: node test/keys.test.js   (npm test)
const core = require('../src/typefall-core.js');
const keys = require('../src/keys.js');
const { UiohookKey: K } = require('uiohook-napi');
let fails = 0;
const check = (n, got, want) => { const ok = got === want; if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', n, '→', got); };

// 1) 패턴에 정의되지 않은 키(undefined)가 없어야 한다 — 있으면 감지가 조용히 실패함
check('패턴 키코드 모두 정의됨', keys.patterns.flat().every((c) => Number.isInteger(c)), true);
check('무시 키 모두 정의됨', [...keys.ignore].every((c) => Number.isInteger(c)), true);
check('Backspace 정의됨', Number.isInteger(keys.backspace), true);

// 2) 실제 uiohook 키코드로 감지
const run = (seq) => { const w = new core.WordTrigger(keys.patterns, keys.backspace); let n = 0; for (const c of seq) if (w.feed(c)) n++; return n; };
check('한글 크리스마스(zmfltmaktm)', run([K.Z, K.M, K.F, K.L, K.T, K.M, K.A, K.K, K.T, K.M]), 1);
check('영어 christmas', run([K.C, K.H, K.R, K.I, K.S, K.T, K.M, K.A, K.S]), 1);
check('일부만 입력', run([K.C, K.H, K.R]), 0);
check('틀린 키', run([K.C, K.H, K.R, K.I, K.X, K.T, K.M, K.A, K.S]), 0);
check('두 번 연속', run([K.C, K.H, K.R, K.I, K.S, K.T, K.M, K.A, K.S, K.Space, K.C, K.H, K.R, K.I, K.S, K.T, K.M, K.A, K.S]), 2);
{ const w = new core.WordTrigger(keys.patterns, keys.backspace); const f = (c) => w.feed(c);
  [K.C, K.H, K.R, K.I, K.S, K.T, K.M, K.A].forEach(f); f(K.Backspace); f(K.A);
  check('백스페이스 후 재입력', f(K.S), true); }
// 3) 기본 WordTrigger(문자열 코드)도 여전히 동작
{ const w = new core.WordTrigger(); let n = 0; for (const c of ['KeyC', 'KeyH', 'KeyR', 'KeyI', 'KeyS', 'KeyT', 'KeyM', 'KeyA', 'KeyS']) if (w.feed(c)) n++;
  check('기본(event.code) 패턴 호환', n, 1); }

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
