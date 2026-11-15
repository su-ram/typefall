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
const DEFAULTS = { mode: 'snow', tint: 'default', density: 'midhigh', xmas: false }; // 크리스마스 효과는 기본 꺼짐
let settings = { ...DEFAULTS };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (['off', 'snow', 'stars'].includes(s.mode)) settings.mode = s.mode;
    if (s.tint in core.TINTS) settings.tint = s.tint;
    if (s.density in core.DENSITY) settings.density = s.density;
    if (typeof s.xmas === 'boolean') settings.xmas = s.xmas;
  } catch (_) { /* 처음 실행이거나 손상 → 기본값 */ }
}
function saveSettings() {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings)); } catch (_) {}
}

// ── 문구(한국어/영어) ──────────────────────────────────────────────────
const KO = (app.getLocale() || 'en').toLowerCase().startsWith('ko');
const T = KO ? {
  effect: '화면 효과', modes: { off: '끄기', snow: '눈', stars: '별가루' },
  tint: '효과 색상', tints: { default: '기본', pink: '핑크', mint: '민트', lavender: '라벤더', peach: '피치', sky: '스카이' },
  density: '파티클 양', densities: { low: '하', midlow: '중하', mid: '중', midhigh: '중상', high: '상' },
  xmas: '크리스마스 효과 ("크리스마스" 입력 시)', xmasPreview: '크리스마스 효과 미리보기',
  login: '로그인 시 자동 실행', quit: '종료',
} : {
  effect: 'Effect', modes: { off: 'Off', snow: 'Snow', stars: 'Stardust' },
  tint: 'Color', tints: { default: 'Default', pink: 'Pink', mint: 'Mint', lavender: 'Lavender', peach: 'Peach', sky: 'Sky' },
  density: 'Particle amount', densities: { low: 'Low', midlow: 'Medium-low', mid: 'Medium', midhigh: 'Medium-high', high: 'High' },
  xmas: 'Christmas effect (when you type "christmas")', xmasPreview: 'Preview Christmas effect',
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
  let uIOhook, keys;
  try { ({ uIOhook } = require('uiohook-napi')); keys = require('./keys.js'); }
  catch (e) { console.error('Typefall: 키 감지를 시작할 수 없습니다:', e.message); return; }
  word = new core.WordTrigger(keys.patterns, keys.backspace);

  // 키를 꾹 누른 반복 입력은 한 번으로 센다. keyup 을 놓쳐 "눌린 채"로 남는 경우를 막으려고 0.8초 무입력이면 해제.
  const down = new Map();
  uIOhook.on('keydown', (e) => {
    const now = Date.now(), prev = down.get(e.keycode);
    down.set(e.keycode, now);
    if (prev !== undefined && now - prev < 800) return;
    if (keys.ignore.has(e.keycode) || e.ctrlKey || e.metaKey) return;
    broadcast({ type: 'hit' });                                       // 입력 "신호"만 전달 (키 코드는 보내지 않음)
    if (settings.xmas && word.feed(e.keycode)) broadcast({ type: 'xmas' });
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
  send({ type: 'options', options: { mode: kind === 'xmas' ? 'off' : kind, tint, density: argVal('--density') || 'midhigh', xmas: kind === 'xmas' } });
  const timer = setInterval(() => send({ type: 'hit' }), 100);        // 초당 10타
  if (kind === 'xmas') setTimeout(() => send({ type: 'xmas' }), 300);
  const snap = async (name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(outDir, name), img.toPNG()); console.log('saved', name); };
  const [t1, t2] = kind === 'xmas' ? [1500, 2600] : [5000, 9000];
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
