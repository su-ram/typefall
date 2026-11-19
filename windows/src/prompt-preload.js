const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tfPrompt', { submit: (v) => ipcRenderer.send('tf-prompt', v) });
