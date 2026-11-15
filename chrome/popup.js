const DEFAULTS = { mode: 'snow', tint: 'default', density: 'midhigh', xmas: true };
chrome.storage.sync.get(DEFAULTS, (v) => {
  for (const k of Object.keys(DEFAULTS)) {
    const el = document.getElementById(k);
    if (el.type === 'checkbox') el.checked = v[k]; else el.value = v[k];
    el.addEventListener('change', () => chrome.storage.sync.set({ [k]: el.type === 'checkbox' ? el.checked : el.value }));
  }
});
document.getElementById('preview').addEventListener('click', async () => {
  await chrome.storage.sync.set({ xmas: true });          // 미리보기는 크리스마스를 켠 상태에서 동작
  document.getElementById('xmas').checked = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'preview-xmas' }).catch(() => {});
});
