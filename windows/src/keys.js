// uiohook-napi 키코드 기준의 "크리스마스" 감지 패턴. (물리 키 위치 기준이라 한글 IME 상태와 무관)
// 글자 내용은 저장하지 않고, 패턴을 어디까지 눌렀는지의 진행 상태만 WordTrigger 가 가진다.
const { UiohookKey: K } = require('uiohook-napi');

const patterns = [
  [K.Z, K.M, K.F, K.L, K.T, K.M, K.A, K.K, K.T, K.M], // 한글 2벌식 "크리스마스"
  [K.C, K.H, K.R, K.I, K.S, K.T, K.M, K.A, K.S],       // "christmas"
];
const ignore = new Set([K.Shift, K.ShiftRight, K.Ctrl, K.CtrlRight, K.Alt, K.AltRight, K.Meta, K.MetaRight, K.CapsLock, K.Tab, K.Escape]);

module.exports = { patterns, backspace: K.Backspace, ignore };
