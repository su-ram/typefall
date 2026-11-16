// 화면 효과 목록은 코어의 효과 메타데이터(enabled)에서 만든다
(() => {
  const sel = document.getElementById('mode');
  const TF = self.Typefall;
  for (const [id, ko] of [['off', '끄기'], [TF.RANDOM_MODE.id, TF.RANDOM_MODE.ko], ...TF.enabledEffects().map((e) => [e.id, e.ko])]) sel.add(new Option(ko, id));
})();
const DEFAULTS = { mode: 'snow', tint: 'default', density: 'm', xmas: true, specialKey: '', specialKeyLabel: '' };
const LEGACY_DENSITY = self.Typefall.DENSITY_LEGACY; // 이전 버전에서 저장된 값(5단계 xs/xl 포함) → 3단계
chrome.storage.sync.get(DEFAULTS, (v) => {
  showKey(v.specialKey, v.specialKeyLabel);
  for (const k of ['mode', 'tint', 'density', 'xmas']) {
    const el = document.getElementById(k);
    if (el.type === 'checkbox') el.checked = v[k]; else el.value = (k === 'density' && LEGACY_DENSITY[v[k]]) || v[k];
    el.addEventListener('change', () => chrome.storage.sync.set({ [k]: el.type === 'checkbox' ? el.checked : el.value }));
  }
});
document.getElementById('preview').addEventListener('click', async () => {
  await chrome.storage.sync.set({ xmas: true });          // 미리보기는 크리스마스를 켠 상태에서 동작
  document.getElementById('xmas').checked = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'preview-xmas' }).catch(() => {});
});

// 특별 효과 키 지정: "지정"을 누른 뒤 처음 누르는 키(event.code)를 저장한다
const keyLabel = document.getElementById('keyLabel'), keySet = document.getElementById('keySet');
function showKey(code, label) { keyLabel.textContent = code ? (label || code) : '없음'; }
let capturing = false;
keySet.addEventListener('click', () => { capturing = true; keyLabel.textContent = '키를 누르세요…'; });
document.getElementById('keyClear').addEventListener('click', () => {
  capturing = false; chrome.storage.sync.set({ specialKey: '', specialKeyLabel: '' }); showKey('');
});
addEventListener('keydown', (e) => {
  if (!capturing) return;
  e.preventDefault(); capturing = false;
  if (e.code === 'Escape') { chrome.storage.sync.get(DEFAULTS, (v) => showKey(v.specialKey, v.specialKeyLabel)); return; }
  const label = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  chrome.storage.sync.set({ specialKey: e.code, specialKeyLabel: label }); showKey(e.code, label);
});

