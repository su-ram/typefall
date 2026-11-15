const { contextBridge, ipcRenderer } = require('electron');
// 메인 프로세스 → 오버레이: {type:'options'|'hit'|'xmas', ...}. 키 코드는 전달하지 않는다(타자 "신호"만).
contextBridge.exposeInMainWorld('tfBridge', { on: (cb) => ipcRenderer.on('tf', (_e, msg) => cb(msg)) });
