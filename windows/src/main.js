'use strict';
// Typefall (Windows/Electron) 메인 프로세스
//  - 전역 키 감지(uiohook-napi): 키 "내용"은 쓰지 않고 입력 신호만 오버레이로 전달
//  - 화면마다 투명·클릭 통과 오버레이 창, 트레이 메뉴
//  - --selftest=snow|stars|xmas --out=DIR : 화면에 띄우지 않고(offscreen) 효과를 그려 PNG 로 저장
const { app, BrowserWindow, Tray, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const core = require('./typefall-core.js');

const argv = process.argv.slice(2);
const argVal = (name) => { const a = argv.find((x) => x.startsWith(name + '=')); return a ? a.slice(name.length + 1) : null; };
const SELFTEST = argVal('--selftest');
const OUT_DIR = argVal('--out') || path.join(process.cwd(), 'selftest-out');

// ── 설정 ───────────────────────────────────────────────────────────────
const DEFAULTS = { mode: 'snow', tint: 'default', density: 'm', xmas: true, loginInit: false, specialKey: 0, specialKeyLabel: '' };  // specialKey: uiohook 키코드(0 = 사용 안 함)
let settings = { ...DEFAULTS };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (s.mode === 'off' || s.mode === core.RANDOM_MODE.id || core.enabledEffects().some((e) => e.id === s.mode)) settings.mode = s.mode;   // 꺼진(enabled:false) 효과를 가리키면 기본값
    if (s.tint in core.TINTS) settings.tint = s.tint;
    settings.density = core.normDensity(s.density);   // 예전 값(low/midlow/…)은 같은 양의 새 값으로 변환
    if (typeof s.xmas === 'boolean') settings.xmas = s.xmas;
    if (Number.isInteger(s.specialKey) && s.specialKey > 0) { settings.specialKey = s.specialKey; settings.specialKeyLabel = String(s.specialKeyLabel || '').slice(0, 20); }
    if (typeof s.loginInit === 'boolean') settings.loginInit = s.loginInit;
  } catch (_) { /* 처음 실행이거나 손상 → 기본값 */ }
}
function saveSettings() {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings)); } catch (_) {}
}

// ── 문구(한국어/영어) ──────────────────────────────────────────────────
const KO = (app.getLocale() || 'en').toLowerCase().startsWith('ko');
// 화면 효과 목록: 코어의 효과 메타데이터(enabled)에서 만든다
const modeLabels = (lang, off) => ({ off, [core.RANDOM_MODE.id]: core.RANDOM_MODE[lang], ...Object.fromEntries(core.enabledEffects().map((e) => [e.id, e[lang]])) });
const T = KO ? {
  effect: '화면 효과', modes: modeLabels('ko', '끄기'),
  tint: '효과 색상', tints: { default: '기본', pink: '핑크', mint: '민트', lavender: '라벤더', peach: '피치', yellow: '노랑', sky: '스카이', rainbow: '레인보우' },
  density: '파티클 양', densities: { s: '조금', m: '보통', l: '많이' },
  xmas: '특별 효과', xmasPreview: '특별 효과 미리보기',
  specialKey: (k) => `특별 효과 키: ${k || '없음'}`, setKey: '키 지정… (다음에 누르는 키)', pressKey: '지정할 키를 누르세요…', clearKey: '지정 해제',
  login: '로그인 시 자동 실행', quit: '종료',
} : {
  effect: 'Effect', modes: modeLabels('en', 'Off'),
  tint: 'Color', tints: { default: 'Default', pink: 'Pink', mint: 'Mint', lavender: 'Lavender', peach: 'Peach', yellow: 'Yellow', sky: 'Sky', rainbow: 'Rainbow' },
  density: 'Particle amount', densities: { s: 'A little', m: 'Normal', l: 'A lot' },
  xmas: 'Special effect', xmasPreview: 'Preview special effect',
  specialKey: (k) => `Special effect key: ${k || 'None'}`, setKey: 'Set key… (next key you press)', pressKey: 'Press the key to use…', clearKey: 'Clear key',
  login: 'Launch at login', quit: 'Quit',
};

// ── 오버레이 창 (화면마다 하나) ────────────────────────────────────────
const overlays = new Map();
const PRELOAD = path.join(__dirname, 'preload.js');
const broadcast = (msg) => { for (const w of overlays.values()) if (!w.isDestroyed()) w.webContents.send('tf', msg); };

function createOverlay(display) {
  const b = display.bounds;
  const win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width,
    height: b.height - 1,            // 화면과 정확히 같은 크기면 Windows가 전체 화면 앱으로 취급해 작업표시줄/게임에 영향
    transparent: true, frame: false, resizable: false, movable: false, focusable: false, skipTaskbar: true,
    hasShadow: false, alwaysOnTop: true, fullscreenable: false, show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });   // 클릭은 그대로 아래 앱으로 통과
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.on('did-finish-load', () => win.webContents.send('tf', { type: 'options', options: settings }));
  win.once('ready-to-show', () => win.showInactive());  // 포커스를 뺏지 않고 표시
  win.loadFile(path.join(__dirname, 'overlay.html'));
  overlays.set(display.id, win);
}
function rebuildOverlays() {
  for (const w of overlays.values()) if (!w.isDestroyed()) w.destroy();
  overlays.clear();
  for (const d of screen.getAllDisplays()) createOverlay(d);
}

// ── 트레이 메뉴 ────────────────────────────────────────────────────────
let tray = null;
let capturingKey = false;   // 메뉴에서 "키 지정"을 누른 뒤 다음 키 하나를 특별 효과 키로 저장
function pushSettings() { saveSettings(); broadcast({ type: 'options', options: settings }); buildMenu(); }

function buildMenu() {
  const radio = (obj, key, labels) => Object.keys(labels).map((v) => ({
    label: labels[v], type: 'radio', checked: settings[key] === v, click: () => { settings[key] = v; pushSettings(); },
  }));
  const menu = Menu.buildFromTemplate([
    { label: `Typefall ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: T.effect, submenu: radio(null, 'mode', T.modes) },
    { label: T.tint, submenu: radio(null, 'tint', T.tints) },
    { label: T.density, submenu: radio(null, 'density', T.densities) },
    { type: 'separator' },
    { label: T.xmas, type: 'checkbox', checked: settings.xmas, click: (i) => { settings.xmas = i.checked; word.reset(); pushSettings(); } },
    { label: T.xmasPreview, click: () => broadcast({ type: 'xmas' }) },
    { label: T.specialKey(settings.specialKeyLabel), submenu: [
      { label: capturingKey ? T.pressKey : T.setKey, click: () => { capturingKey = true; buildMenu(); } },
      { label: T.clearKey, enabled: settings.specialKey > 0, click: () => { capturingKey = false; settings.specialKey = 0; settings.specialKeyLabel = ''; pushSettings(); } },
    ] },
    { type: 'separator' },
    { label: T.login, type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { label: T.quit, role: 'quit' },
  ]);
  tray.setContextMenu(menu);
}

// ── 전역 키 감지 ───────────────────────────────────────────────────────
let word = null;
function startHook() {
  let uIOhook, keys, UiohookKey;
  try { ({ uIOhook, UiohookKey } = require('uiohook-napi')); keys = require('./keys.js'); }
  catch (e) { console.error('Typefall: 키 감지를 시작할 수 없습니다:', e.message); return; }
  word = new core.WordTrigger(keys.patterns, keys.backspace);

  // 키를 꾹 누른 반복 입력은 한 번으로 센다. keyup 을 놓쳐 "눌린 채"로 남는 경우를 막으려고 0.8초 무입력이면 해제.
  const down = new Map();
  uIOhook.on('keydown', (e) => {
    const now = Date.now(), prev = down.get(e.keycode);
    down.set(e.keycode, now);
    if (prev !== undefined && now - prev < 800) return;
    if (capturingKey) {                                               // 키 지정 모드: 이 키를 저장하고 끝 (효과는 내지 않음)
      capturingKey = false;
      if (!keys.ignore.has(e.keycode)) {
        settings.specialKey = e.keycode;
        settings.specialKeyLabel = Object.keys(UiohookKey).find((n) => UiohookKey[n] === e.keycode) || `#${e.keycode}`;
        saveSettings();
      }
      buildMenu(); return;
    }
    if (keys.ignore.has(e.keycode) || e.ctrlKey || e.metaKey) return;
    broadcast({ type: 'hit' });                                       // 입력 "신호"만 전달 (키 코드는 보내지 않음)
    const hitWord = settings.xmas && word.feed(e.keycode);
    if (hitWord || (settings.specialKey > 0 && e.keycode === settings.specialKey)) broadcast({ type: 'xmas' });
  });
  uIOhook.on('keyup', (e) => down.delete(e.keycode));
  uIOhook.start();
  app.on('will-quit', () => { try { uIOhook.stop(); } catch (_) {} });
}

// ── 자가 테스트: 화면에 띄우지 않고 효과를 그려 PNG 로 저장 ───────────────
async function selftest(kind, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({
    show: false, width: 1200, height: 700,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, offscreen: true },
  });
  await win.loadFile(path.join(__dirname, 'overlay.html'), { query: { bg: '1b2a41' } });
  const send = (m) => win.webContents.send('tf', m);
  const tint = argVal('--tint') || 'default';
  send({ type: 'options', options: { mode: kind === 'xmas' ? 'off' : kind, tint, density: argVal('--density') || 'm', xmas: kind === 'xmas' } });
  const timer = setInterval(() => send({ type: 'hit' }), 100);        // 초당 10타
  if (kind === 'xmas') setTimeout(() => send({ type: 'xmas' }), 300);
  const snap = async (name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(outDir, name), img.toPNG()); console.log('saved', name); };
  const [t1, t2] = kind === 'xmas' ? [2600, 3800] : [5000, 9000];
  setTimeout(() => snap(`${kind}-a.png`), t1);
  setTimeout(async () => { await snap(`${kind}-b.png`); clearInterval(timer); app.quit(); }, t2);
}

// ── 시작 ───────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock() && !SELFTEST) { app.quit(); }
else {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  app.whenReady().then(() => {
    loadSettings();
    if (SELFTEST) { selftest(SELFTEST, OUT_DIR); return; }
    if (app.isPackaged && !settings.loginInit) {       // 처음 실행하면 로그인 시 자동 실행을 켠다 (이후 메뉴에서 끄면 존중)
      app.setLoginItemSettings({ openAtLogin: true });
      settings.loginInit = true; saveSettings();
    }
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png')).resize({ width: 16, height: 16 }));
    tray.setToolTip('Typefall');
    word = new core.WordTrigger();   // startHook 에서 uiohook 키코드용으로 교체
    buildMenu();
    rebuildOverlays();
    screen.on('display-added', rebuildOverlays);
    screen.on('display-removed', rebuildOverlays);
    screen.on('display-metrics-changed', rebuildOverlays);
    startHook();
  });
  app.on('window-all-closed', (e) => e.preventDefault()); // 트레이 앱: 창이 없어도 종료하지 않음
}
