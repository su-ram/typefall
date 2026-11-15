/*
 * Typefall core — 타자 칠 때 화면에 내리는 효과 엔진 (캔버스 2D, 의존성 없음)
 *   눈 / 별가루(윤슬 반짝임) / 네잎클로버 / 낙엽 / 벚꽃 / 비눗방울 / 고양이 발자국 / 크리스마스(빨강·초록 크로세트 폭죽 + 이모지)
 * 브라우저(Chrome 확장·데모)에서는 전역 `Typefall`, Node에서는 module.exports.
 * 좌표는 CSS px, y는 아래로 증가. 맥 앱(Swift)의 로직과 같은 상수를 쓴다.
 * 프라이버시: 키 "내용"은 쓰지 않는다. WordTrigger는 물리 키 위치(event.code)의
 * 진행 상태만 가지며 아무것도 저장·전송하지 않는다.
 */
(function (root) {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /** 효과 색상(눈 + 별가루 공통). null = 기본(별: 금/연노랑/핑크/하늘, 눈: 옅은 하늘색), 배열 = 입자마다 무작위로 섞어 씀 */
  const TINTS = { default: null, pink: '#FFB3D1', mint: '#B5EAD7', lavender: '#C7B8FF', peach: '#FFD1B3', yellow: '#FFE08A', sky: '#B3DEFF',
    rainbow: ['#FFB3D1', '#FFD1B3', '#FFE08A', '#B5EAD7', '#B3DEFF', '#C7B8FF'] }; // 핑크·피치·노랑·민트·스카이·라벤더
  /** 파티클 양 단계(아주 조금/조금/보통/많이/아주 많이). 기준(기본) = m(보통) = 1.0, 높을수록 많아진다. */
  const DENSITY = { xs: 0.3, s: 0.6, m: 1.0, l: 1.6, xl: 2.4 };
  /** 0.1.2 이하에서 저장된 id → 같은 양의 새 id */
  const DENSITY_LEGACY = { low: 'xs', midlow: 's', mid: 's', midhigh: 'm', high: 'l' };
  const normDensity = (d) => (DENSITY[d] !== undefined ? d : (DENSITY_LEGACY[d] || 'm'));

  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

  /** 최근 3초 키 입력 수 → WPM(5타=1단어) → 지수 평활. level 0~1 이 눈/별 양을 정한다. */
  class TypingTracker {
    constructor(opts = {}) {
      this.windowMs = opts.windowMs || 3000;
      this.maxWpm = opts.maxWpm || 100;
      this.stamps = []; this.smoothed = 0; this._last = 0;
    }
    hit(now) { this.stamps.push(now); }
    update(now) {
      const cutoff = now - this.windowMs;
      while (this.stamps.length && this.stamps[0] < cutoff) this.stamps.shift();
      let raw = 0;
      if (this.stamps.length) {
        const span = clamp((now - this.stamps[0]) / 1000, 1, this.windowMs / 1000);
        raw = (this.stamps.length / span) * 12;
      }
      const dt = this._last ? now - this._last : 16;
      this._last = now;
      const tau = raw > this.smoothed ? 250 : 700;
      this.smoothed += (raw - this.smoothed) * (1 - Math.exp(-dt / tau));
      if (raw === 0 && this.smoothed < 0.3) this.smoothed = 0;
      return this.smoothed;
    }
    get level() { return clamp(this.smoothed / this.maxWpm, 0, 1); }
    get idle() { return this.smoothed < 1; }
  }

  /**
   * 단어 감지: 글자 내용을 저장하지 않고 "목표 키 순서를 어디까지 눌렀는지"만 가진다.
   * event.code(물리 키 위치)로 비교하므로 한글 조합(IME) 상태와 무관하다.
   */
  const XMAS_PATTERNS = [
    ['KeyZ', 'KeyM', 'KeyF', 'KeyL', 'KeyT', 'KeyM', 'KeyA', 'KeyK', 'KeyT', 'KeyM'], // 한글 2벌식 "크리스마스"
    ['KeyC', 'KeyH', 'KeyR', 'KeyI', 'KeyS', 'KeyT', 'KeyM', 'KeyA', 'KeyS'],          // "christmas"
  ];
  class WordTrigger {
    // patterns/backspace 는 키 체계가 다른 환경(예: Windows 전역 훅의 숫자 키코드)에서도 쓸 수 있게 주입 가능
    constructor(patterns = XMAS_PATTERNS, backspace = 'Backspace') { this.patterns = patterns; this.backspace = backspace; this.reset(); }
    reset() { this.progress = this.patterns.map(() => 0); }
    feed(code) {
      if (code === this.backspace) { this.progress = this.progress.map((p) => Math.max(0, p - 1)); return false; }
      let hit = false;
      this.patterns.forEach((p, i) => {
        if (code === p[this.progress[i]]) {
          if (++this.progress[i] === p.length) { this.progress[i] = 0; hit = true; }
        } else this.progress[i] = code === p[0] ? 1 : 0;
      });
      return hit;
    }
  }

  // ── 스프라이트(오프스크린 캔버스에 한 번만 그림) ───────────────────────
  // 앞의 EMOJI_REPEATABLE 개(트리)만 여러 번 나와도 되고, 나머지는 화면에 동시에 하나씩만 나온다.
  // 한 번에 12개: 트리 3~4개(화면 전체 최대 4개, 가장 많음) + 나머지는 하나씩(❄️ 는 항상 포함).
  // 🫎(무스)는 Unicode 15 이모지라 오래된 OS(macOS 13.2 이하, Windows 10 등)에서는 글자가 깨져 보일 수 있다.
  const EMOJIS = ['🎄', '🎅', '🤶', '🎁', '⛄', '🔔', '⭐', '🫎', '🍪', '❄️'];
  const EMOJI_REPEATABLE = 1, MAX_TREES = 4;
  const XMAS_COLORS = ['#FF3B4E', '#2EC866']; // 빨강, 초록

  function buildSprites(createCanvas, dpr, tint) {
    const mk = (size, draw) => {
      const c = createCanvas(Math.round(size * dpr), Math.round(size * dpr));
      const x = c.getContext('2d'); x.scale(dpr, dpr); draw(x); return c;
    };
    const glow = (x, cx, cy, rgb, r, a) => {
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgba(rgb, a)); g.addColorStop(1, rgba(rgb, 0));
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill();
    };
    const poly = (x, pts, rgb) => {
      x.fillStyle = rgba(rgb, 1); x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
      x.closePath(); x.fill();
    };
    const shade = (hex, k) => { const c = hexRgb(hex).map((v) => clamp(Math.round(v * k), 0, 255)); return `rgb(${c[0]},${c[1]},${c[2]})`; };
    const dotOf = (hex) => mk(16, (x) => glow(x, 8, 8, hexRgb(hex), 8, 1));
    const tints = tint ? (Array.isArray(tint) ? tint : [tint]) : null;   // 색 하나 또는 여러 색(레인보우)
    const dots = (tints || ['#BFE0FF']).map(dotOf);
    const spr = { dot: dots[0], dots, stars: [], specks: [], emojis: [], xmasDots: XMAS_COLORS.map(dotOf) };

    const colors = tints || ['#FFD34D', '#FFE9A0', '#FFB3D1', '#B3F0FF'];
    for (const hex of colors) {
      const rgb = hexRgb(hex);
      const speck = mk(24, (x) => glow(x, 12, 12, rgb, 4.5, 1));
      const orb = mk(24, (x) => { glow(x, 12, 12, rgb, 12, 0.85); glow(x, 12, 12, [255, 255, 255], 3.5, 0.95); });
      const star5 = mk(24, (x) => {
        glow(x, 12, 12, rgb, 12, 0.35);
        const pts = [];
        for (let i = 0; i < 10; i++) { const r = i % 2 ? 4 : 9.5, a = -Math.PI / 2 + i * Math.PI / 5; pts.push([12 + Math.cos(a) * r, 12 + Math.sin(a) * r]); }
        poly(x, pts, rgb);
      });
      const spark = mk(24, (x) => {
        glow(x, 12, 12, rgb, 8, 0.3);
        poly(x, [[12, 0], [13, 11], [24, 12], [13, 13], [12, 24], [11, 13], [0, 12], [11, 11]], rgb);
      });
      spr.stars.push(speck, speck, speck, orb, orb, star5, star5, spark); // 가루 점을 가장 많이
      spr.specks.push(speck);
    }
    for (const e of EMOJIS) {
      spr.emojis.push(mk(48, (x) => {
        x.font = '38px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
        x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(e, 24, 26);
      }));
    }
    // 윤슬: 별가루 위에서 순간적으로 번쩍이는 흰 십자 반짝임
    spr.glint = mk(32, (x) => {
      glow(x, 16, 16, [255, 255, 255], 8, 0.5);
      poly(x, [[16, 0], [17.2, 14.8], [32, 16], [17.2, 17.2], [16, 32], [14.8, 17.2], [0, 16], [14.8, 14.8]], [255, 255, 255]);
    });
    // 자연물(색상 옵션과 무관, 고유 색): 네잎클로버 / 낙엽 / 벚꽃잎
    const heart = (x, fill) => {
      x.fillStyle = fill; x.beginPath(); x.moveTo(0, -2);
      x.bezierCurveTo(-4, -5, -10, -7, -9, -14); x.bezierCurveTo(-8, -19, -2, -19, 0, -14);
      x.bezierCurveTo(2, -19, 8, -19, 9, -14); x.bezierCurveTo(10, -7, 4, -5, 0, -2); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, -3); x.lineTo(0, -13); x.stroke();
    };
    spr.clovers = ['#34C759', '#2EA84F', '#4CD174', '#8BDB5A', '#1F8A4C'].map((c) => mk(40, (x) => {
      x.translate(20, 20);
      for (let k = 0; k < 4; k++) { x.save(); x.rotate(k * Math.PI / 2); heart(x, c); x.restore(); }
      glow(x, 0, 0, [255, 255, 255], 4, 0.25);
    }));
    const ginkgo = (c) => mk(40, (x) => {   // 은행잎(참고 이미지): 넓은 부채꼴 + 위쪽 좁고 깊은 갈라짐 + 물결 가장자리 + 촘촘한 부채살 잎맥 + 길게 휜 잎자루
      x.translate(20, 20); x.lineJoin = 'round'; x.lineCap = 'round';
      const leaf = () => {
        x.beginPath(); x.moveTo(0, 9);
        x.bezierCurveTo(-5, 7, -13, 5, -18.5, 2); x.bezierCurveTo(-20.5, -1, -19.5, -4, -17, -6.5); x.bezierCurveTo(-14.5, -9.5, -11.5, -12, -8, -13.5);
        x.bezierCurveTo(-5.5, -15, -3, -15.8, -1.2, -14.5); x.lineTo(0, -4.5); x.lineTo(1.2, -14.5);
        x.bezierCurveTo(3, -15.8, 5.5, -15, 8, -13.5); x.bezierCurveTo(11.5, -12, 14.5, -9.5, 17, -6.5); x.bezierCurveTo(19.5, -4, 20.5, -1, 18.5, 2);
        x.bezierCurveTo(13, 5, 5, 7, 0, 9); x.closePath();
      };
      x.strokeStyle = shade(c, 0.9); x.lineWidth = 1.5; x.beginPath(); x.moveTo(0, 9); x.quadraticCurveTo(1.4, 15, -1.6, 19.5); x.stroke();   // 잎자루
      leaf(); x.fillStyle = c; x.fill();
      x.save(); leaf(); x.clip();
      glow(x, 0, -2, [255, 255, 255], 15, 0.45);                    // 가운데는 연하게
      x.strokeStyle = shade(c, 0.82); x.globalAlpha = 0.3; x.lineWidth = 3.4; leaf(); x.stroke(); x.globalAlpha = 1;   // 가장자리는 살짝 진하게
      x.strokeStyle = shade(c, 0.82); x.lineWidth = 0.5; x.beginPath();   // 부채살 잎맥
      for (let k = -7; k <= 7; k++) { const a = k * 0.215; if (Math.abs(a) < 0.04) continue; x.moveTo(0, 9); x.lineTo(Math.sin(a) * 21, 2 - Math.cos(a) * 17.5); }
      x.stroke(); x.restore();
    });
    spr.leaves = ['#FBD88A', '#F7C95C', '#F2B544', '#EFA23A', '#E8B94A', '#D9B24A'].map(ginkgo);   // 낙엽은 은행잎만(노랑·금색·주황 계열)
    spr.petals = [['#FF9DBB', '#FFE3EC'], ['#FFB3CB', '#FFF0F5'], ['#FFC2D6', '#FFFFFF']].map(([a, b]) => mk(24, (x) => {
      x.translate(12, 12);
      x.fillStyle = a; x.beginPath(); x.moveTo(0, 10);
      x.bezierCurveTo(-9, 4, -8, -9, -2, -11); x.lineTo(0, -8); x.lineTo(2, -11); x.bezierCurveTo(8, -9, 9, 4, 0, 10); x.closePath(); x.fill();
      glow(x, 0, -6, hexRgb(b), 9, 0.9);   // 끝쪽을 연하게
    }));
    // 비눗방울: 방울마다 반사되는 빛(무지개 호 색·각도·하이라이트 위치)이 다르다. [테두리, 호1, 호2, 호 시작각, 하이라이트 각도, 하이라이트 크기]
    const BUBBLE_STYLES = [
      ['170,220,255', '255,170,220', '200,255,170', 0.2, -2.3, 1],
      ['190,190,255', '255,235,150', '160,240,255', 1.6, -0.9, 1.25],
      ['255,200,170', '170,200,255', '255,170,210', 3.0, -3.5, 0.8],
      ['170,245,220', '240,170,255', '170,210,255', 4.4, 2.2, 1.1],
      ['255,240,190', '170,235,235', '220,190,255', 0.9, -1.6, 0.9],
      ['200,225,255', '255,190,190', '190,255,200', 2.4, 0.6, 1.3],
    ];
    spr.bubbles = BUBBLE_STYLES.map(([ring, a1, a2, st, hl, hs]) => mk(32, (x) => {
      x.translate(16, 16); glow(x, 0, 0, ring.split(',').map(Number), 14, 0.22);
      x.lineWidth = 0.8; x.strokeStyle = `rgba(${ring},0.85)`; x.beginPath(); x.arc(0, 0, 13, 0, TAU); x.stroke();
      x.strokeStyle = `rgba(${a1},0.9)`; x.beginPath(); x.arc(0, 0, 13, st, st + 1.2); x.stroke();
      x.strokeStyle = `rgba(${a2},0.9)`; x.beginPath(); x.arc(0, 0, 13, st + Math.PI, st + Math.PI + 1.2); x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.9)'; x.beginPath(); x.ellipse(Math.cos(hl) * 7, Math.sin(hl) * 7, 3.2 * hs, 1.8 * hs, hl + Math.PI / 2, 0, TAU); x.fill();
    }));
    // ── 리본 🎀 / 프레첼 🥨 / 지폐 💵 (이모지 모양을 참고해 직접 그림) ──
    const bow = (c) => mk(40, (x) => {   // 통통한 리본 매듭: 둥근 고리 두 개 + 땡땡이 무늬 + 짧은 꼬리
      x.translate(20, 20); x.lineJoin = 'round';
      const dark = shade(c, 0.68), mid = shade(c, 0.84), light = shade(c, 1.3);
      x.lineWidth = 1.3; x.strokeStyle = dark;
      for (const sgn of [-1, 1]) {   // 꼬리
        x.fillStyle = mid; x.beginPath(); x.moveTo(sgn * 1, 4); x.lineTo(sgn * 9, 15); x.lineTo(sgn * 6, 14.5); x.lineTo(sgn * 5.5, 17.5); x.lineTo(sgn * 0, 8); x.closePath(); x.fill(); x.stroke();
      }
      for (const sgn of [-1, 1]) {   // 고리(바깥 + 안쪽 구멍)
        x.fillStyle = c; x.beginPath(); x.moveTo(sgn * 2, 0); x.bezierCurveTo(sgn * 4, -16, sgn * 19, -17, sgn * 19, -6); x.bezierCurveTo(sgn * 19, 6, sgn * 7, 9, sgn * 2, 2); x.closePath(); x.fill(); x.stroke();
        x.fillStyle = dark; x.beginPath(); x.moveTo(sgn * 4.5, -0.5); x.bezierCurveTo(sgn * 6, -9, sgn * 14, -10, sgn * 14, -5); x.bezierCurveTo(sgn * 14, 0, sgn * 9, 3, sgn * 4.5, 1.5); x.closePath(); x.fill();
        x.save(); x.beginPath(); x.moveTo(sgn * 2, 0); x.bezierCurveTo(sgn * 4, -16, sgn * 19, -17, sgn * 19, -6); x.bezierCurveTo(sgn * 19, 6, sgn * 7, 9, sgn * 2, 2); x.closePath(); x.clip();
        x.fillStyle = 'rgba(255,255,255,0.8)'; for (const [px, py] of [[sgn * 12, -13], [sgn * 17, -8], [sgn * 16, 2], [sgn * 9, 6], [sgn * 8, -15]]) { x.beginPath(); x.arc(px, py, 1.25, 0, TAU); x.fill(); }
        x.restore();
        x.fillStyle = light; x.globalAlpha = 0.5; x.beginPath(); x.ellipse(sgn * 11, -13.5, 4.5, 1.6, sgn * -0.3, 0, TAU); x.fill(); x.globalAlpha = 1;
      }
      x.fillStyle = c; x.beginPath(); x.arc(0, 1, 4.6, 0, TAU); x.fill(); x.stroke();   // 매듭
      x.fillStyle = light; x.globalAlpha = 0.6; x.beginPath(); x.ellipse(-1.3, -0.7, 1.6, 1, -0.4, 0, TAU); x.fill(); x.globalAlpha = 1;
    });
    const streamer = (c) => mk(40, (x) => {   // 돌돌 말린 새틴 리본 띠
      x.translate(20, 20); x.lineCap = 'butt'; x.lineJoin = 'round';
      const path = () => { x.beginPath(); x.moveTo(-14, -15); x.bezierCurveTo(6, -18, 15, -6, 3, -1); x.bezierCurveTo(-10, 4, -7, 15, 14, 15); };
      x.strokeStyle = shade(c, 0.66); x.lineWidth = 8.4; path(); x.stroke();
      x.strokeStyle = c; x.lineWidth = 6.4; path(); x.stroke();
      x.strokeStyle = shade(c, 1.3); x.globalAlpha = 0.6; x.lineWidth = 1.6; x.save(); x.translate(-0.9, -0.9); path(); x.stroke(); x.restore(); x.globalAlpha = 1;
    });
    spr.ribbons = ['#F2557A', '#FF8FB1', '#4F8DF0', '#9B5DE5', '#F2B233'].map(bow).concat(['#F2557A', '#4FC3A1', '#F2B233', '#9B5DE5'].map(streamer));
    spr.pretzels = [['#8A4B16', '#B8672A', '#E0A25A'], ['#7A3F10', '#A85C22', '#D69A50']].map(([dk, md, lt]) => mk(40, (x) => {
      x.translate(20, 20); x.lineCap = 'round'; x.lineJoin = 'round';
      const arc = () => { x.beginPath(); x.moveTo(-11, 11); x.bezierCurveTo(-7, 18, 7, 18, 11, 11); };
      const armR = () => { x.beginPath(); x.moveTo(-10, 12); x.bezierCurveTo(-3, 6, 4, -4, 8, -9); x.bezierCurveTo(11, -14, 17, -12, 16, -4); x.bezierCurveTo(15, 3, 13, 7, 11, 11); };
      const armL = () => { x.beginPath(); x.moveTo(10, 12); x.bezierCurveTo(3, 6, -4, -4, -8, -9); x.bezierCurveTo(-11, -14, -17, -12, -16, -4); x.bezierCurveTo(-15, 3, -13, 7, -11, 11); };
      for (const p of [arc, armR, armL]) {   // 위에 오는 팔은 어두운 테두리가 먼저 깔려 겹침이 보인다
        x.strokeStyle = dk; x.lineWidth = 8.6; p(); x.stroke();
        x.strokeStyle = md; x.lineWidth = 6; p(); x.stroke();
        x.strokeStyle = lt; x.globalAlpha = 0.6; x.lineWidth = 1.6; x.save(); x.translate(-0.8, -1.2); p(); x.stroke(); x.restore(); x.globalAlpha = 1;
      }
      x.fillStyle = '#FFFFFF';   // 굵은 소금
      for (const [px, py, r] of [[-13, -9, 1.3], [-9.5, -11.5, 1.1], [-16, -4, 1.1], [13, -9, 1.3], [9.5, -11.5, 1.1], [16, -4, 1.1], [0, 0.5, 1.2], [-6, 5, 1.2], [6, 5, 1.2], [-3, 14.5, 1.1], [3, 14.5, 1.1], [-12.5, 5, 1.1], [12.5, 5, 1.1]]) {
        x.beginPath(); x.ellipse(px, py, r * 1.2, r, px * 0.1, 0, TAU); x.fill();
      }
    }));
    const note = ([base, edge, mark]) => mk(40, (x) => {
      x.translate(20, 20);
      const rr = (w, h, r) => { x.beginPath(); x.moveTo(-w + r, -h); x.lineTo(w - r, -h); x.quadraticCurveTo(w, -h, w, -h + r); x.lineTo(w, h - r); x.quadraticCurveTo(w, h, w - r, h); x.lineTo(-w + r, h); x.quadraticCurveTo(-w, h, -w, h - r); x.lineTo(-w, -h + r); x.quadraticCurveTo(-w, -h, -w + r, -h); x.closePath(); };
      x.fillStyle = base; rr(18, 9.5, 2); x.fill();
      x.strokeStyle = edge; x.lineWidth = 1.2; rr(15.5, 7, 1.5); x.stroke();
      x.fillStyle = mark; x.beginPath(); x.arc(0, 0, 5, 0, TAU); x.fill();
      x.fillStyle = base; x.beginPath(); x.arc(0, 0, 3.4, 0, TAU); x.fill();
      x.fillStyle = mark; x.fillRect(-1, -2.6, 2, 5.2);
      for (const [px, py] of [[-12, 0], [12, 0]]) { x.beginPath(); x.arc(px, py, 1.6, 0, TAU); x.fill(); }
    });
    spr.bills = [
      note(['#8FD19E', '#3E8E5A', '#3E8E5A']), note(['#F5D98A', '#B9892A', '#B9892A']), note(['#9CC7F0', '#3F6FA8', '#3F6FA8']), note(['#F2B8C6', '#B0536B', '#B0536B']),   // 초록·노랑·파랑·분홍 지폐
    ];
    // ── 과일·채소(각각 따로 선택): 딸기 🍓 / 체리 🍒 / 당근 🥕 / 귤 🍊 / 토마토 🍅 ──
    const leafStar = (x, cx, cy, n, r, c) => {   // 꼭지 잎
      x.fillStyle = c; x.beginPath();
      for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, rr = i % 2 ? r * 0.35 : r; x[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr * 1.2, cy + Math.sin(a) * rr * 0.7); }
      x.closePath(); x.fill();
    };
    const strawberry = mk(40, (x) => {   // 어깨가 넓고 통통한 딸기, 윤기 + 큰 씨 + 늘어진 꼭지잎
      x.translate(20, 21); x.lineJoin = 'round'; x.lineCap = 'round';
      const body = () => { x.beginPath(); x.moveTo(0, 18); x.bezierCurveTo(-7, 16, -16, 6, -15.5, -4); x.bezierCurveTo(-15, -11, -8, -14, 0, -12); x.bezierCurveTo(8, -14, 15, -11, 15.5, -4); x.bezierCurveTo(16, 6, 7, 16, 0, 18); x.closePath(); };
      body(); x.fillStyle = '#E02F45'; x.fill();
      x.save(); body(); x.clip();
      glow(x, 7, 9, [150, 15, 35], 14, 0.55);   // 아래 오른쪽 그늘
      glow(x, -6, -4, [255, 150, 160], 11, 0.6);   // 위 왼쪽 윤기
      x.restore();
      body(); x.strokeStyle = '#A81A2E'; x.lineWidth = 1.2; x.stroke();
      for (const [px, py, a] of [[-8, -4, -0.3], [0, -6, 0], [8, -4, 0.3], [-11, 2, -0.5], [-4, 1, -0.15], [4, 1, 0.15], [11, 2, 0.5], [-7, 8, -0.4], [0, 7, 0], [7, 8, 0.4], [-3, 13, -0.2], [3, 13, 0.2]]) {   // 씨(작은 물방울)
        x.save(); x.translate(px, py); x.rotate(a); x.fillStyle = '#FFE58A'; x.strokeStyle = 'rgba(150,20,35,0.55)'; x.lineWidth = 0.7;
        x.beginPath(); x.ellipse(0, 0, 1.1, 1.8, 0, 0, TAU); x.fill(); x.stroke(); x.restore();
      }
      x.fillStyle = 'rgba(255,255,255,0.5)'; x.beginPath(); x.ellipse(-9.5, -7, 3, 1.5, -0.7, 0, TAU); x.fill();
      x.fillStyle = '#3BAA4E'; x.strokeStyle = '#25803A'; x.lineWidth = 1;   // 꼭지잎: 어깨 위로 늘어짐
      for (const a of [-2.7, -2.0, -1.1, -0.4, 0.3, -1.57]) {
        x.save(); x.translate(0, -12.5); x.rotate(a + Math.PI / 2); x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(2.6, 4, 0, 9); x.quadraticCurveTo(-2.6, 4, 0, 0); x.closePath(); x.fill(); x.stroke(); x.restore();
      }
      x.strokeStyle = '#2E8B3E'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, -12); x.quadraticCurveTo(1, -16, 3.5, -18); x.stroke();   // 꼭지
    });
    const carrot = mk(40, (x) => {
      x.translate(20, 20); x.lineJoin = 'round';
      x.fillStyle = '#4CAF50';   // 잎
      for (const [a, l] of [[-0.5, 9], [0, 11], [0.5, 9]]) { x.save(); x.translate(0, -10); x.rotate(a); x.beginPath(); x.ellipse(0, -l / 2, 2.2, l / 2, 0, 0, TAU); x.fill(); x.restore(); }
      x.beginPath(); x.moveTo(-7.5, -9); x.bezierCurveTo(-8, -12, 8, -12, 7.5, -9); x.bezierCurveTo(7, 3, 3, 13, 0, 19); x.bezierCurveTo(-3, 13, -7, 3, -7.5, -9); x.closePath();
      x.fillStyle = '#F28C28'; x.fill(); x.strokeStyle = '#C9690F'; x.lineWidth = 1.2; x.stroke();
      glow(x, -3, -2, [255, 200, 120], 8, 0.5);
      x.strokeStyle = '#D9701A'; x.lineWidth = 1; x.beginPath(); for (const [a, b, c] of [[-5, -3, 3], [1, 2, -3], [-3, 7, 2], [0, 12, -1]]) { x.moveTo(a - 2.2, b); x.lineTo(a + 2.2 + c * 0.2, b); } x.stroke();
    });
    const roundFruit = (base, edge, hi, ry, stem) => mk(40, (x) => {
      x.translate(20, 21); x.lineJoin = 'round';
      x.beginPath(); x.ellipse(0, 1, 14, ry, 0, 0, TAU); x.fillStyle = base; x.fill(); x.strokeStyle = edge; x.lineWidth = 1.2; x.stroke();
      glow(x, -5, -4, hexRgb(hi), 10, 0.6);
      x.fillStyle = 'rgba(255,255,255,0.55)'; x.beginPath(); x.ellipse(-7, -5, 3.2, 1.8, -0.7, 0, TAU); x.fill();
      stem(x);
    });
    const mandarin = roundFruit('#FF9F1C', '#D97A0B', '#FFD28A', 12.5, (x) => {
      x.fillStyle = 'rgba(190,100,0,0.45)'; for (const [px, py] of [[4, 4], [8, -2], [-2, 8], [-8, 5], [2, -5], [-4, 0], [7, 8]]) { x.beginPath(); x.arc(px, py, 0.6, 0, TAU); x.fill(); }
      x.fillStyle = '#2E8B3E'; x.fillRect(-1, -13, 2, 3.5); leafStar(x, 0, -11, 5, 4.6, '#3BAA4E');
      x.fillStyle = '#4CBF5A'; x.beginPath(); x.ellipse(5, -14, 4.2, 2, -0.5, 0, TAU); x.fill();   // 잎사귀
    });
    const tomato = roundFruit('#E53935', '#B71C1C', '#FF9A8F', 12, (x) => { leafStar(x, 0, -10.5, 5, 7.5, '#2E9B45'); x.fillStyle = '#2E8B3E'; x.fillRect(-1, -17, 2, 5); });
    const cherry = mk(40, (x) => {
      x.translate(20, 20); x.lineJoin = 'round'; x.lineCap = 'round';
      x.strokeStyle = '#4E7F2E'; x.lineWidth = 1.6; x.beginPath(); x.moveTo(-6, 6); x.bezierCurveTo(-7, -4, -2, -11, 4, -14); x.moveTo(8, 8); x.bezierCurveTo(8, -2, 7, -9, 4, -14); x.stroke();   // 줄기
      x.fillStyle = '#4CBF5A'; x.strokeStyle = '#2E8B3E'; x.lineWidth = 1; x.beginPath(); x.moveTo(4, -14); x.bezierCurveTo(8, -19, 16, -18, 17, -14); x.bezierCurveTo(13, -9, 7, -10, 4, -14); x.closePath(); x.fill(); x.stroke();   // 잎
      for (const [cx, cy] of [[-6, 9], [8, 11]]) {
        x.beginPath(); x.arc(cx, cy, 8, 0, TAU); x.fillStyle = '#D81B3A'; x.fill(); x.strokeStyle = '#9E1128'; x.lineWidth = 1.2; x.stroke();
        glow(x, cx - 2.5, cy - 3, [255, 140, 150], 6.5, 0.6);
        x.fillStyle = 'rgba(255,255,255,0.6)'; x.beginPath(); x.ellipse(cx - 3.2, cy - 3.2, 2, 1.2, -0.7, 0, TAU); x.fill();
      }
    });
    spr.strawberries = [strawberry]; spr.cherries = [cherry]; spr.carrots = [carrot]; spr.mandarins = [mandarin]; spr.tomatoes = [tomato];
    // ── 패스트푸드: 햄버거 🍔 / 피자 🍕 / 감자튀김 🍟 / 콜라 🥤 ──
    const burger = mk(40, (x) => {
      x.translate(20, 20); x.lineJoin = 'round';
      const rr = (x0, y0, x1, y1, r) => { x.beginPath(); x.moveTo(x0 + r, y0); x.lineTo(x1 - r, y0); x.quadraticCurveTo(x1, y0, x1, y0 + r); x.lineTo(x1, y1 - r); x.quadraticCurveTo(x1, y1, x1 - r, y1); x.lineTo(x0 + r, y1); x.quadraticCurveTo(x0, y1, x0, y1 - r); x.lineTo(x0, y0 + r); x.quadraticCurveTo(x0, y0, x0 + r, y0); x.closePath(); };
      x.lineWidth = 1.1;
      x.fillStyle = '#D89445'; x.strokeStyle = '#A86A22'; rr(-15, 10, 15, 16.5, 3.5); x.fill(); x.stroke();          // 아랫빵
      x.fillStyle = '#6B3E26'; x.strokeStyle = '#42240F'; rr(-16, 4, 16, 10.5, 3); x.fill(); x.stroke();            // 패티
      x.fillStyle = '#E8473A'; x.strokeStyle = '#B02A20'; rr(-14, 2.5, 14, 5.5, 1.5); x.fill(); x.stroke();         // 토마토
      x.fillStyle = '#FFD23F'; x.strokeStyle = '#D9A416'; x.beginPath(); x.moveTo(-15, 1); x.lineTo(15, 1); x.lineTo(15, 3.5); x.lineTo(10, 3.5); x.lineTo(7, 7.5); x.lineTo(4, 3.5); x.lineTo(-15, 3.5); x.closePath(); x.fill(); x.stroke();   // 치즈
      x.fillStyle = '#6CC24A'; x.strokeStyle = '#3F8E28'; x.beginPath(); x.moveTo(-17, -1.5);                      // 양상추(물결)
      for (let i = 0; i < 6; i++) x.quadraticCurveTo(-17 + i * 6 + 3, i % 2 ? -4.5 : 3.5, -17 + (i + 1) * 6, -1.5);
      x.lineTo(17, 1.5); x.lineTo(-17, 1.5); x.closePath(); x.fill(); x.stroke();
      x.beginPath(); x.moveTo(-16.5, -1); x.bezierCurveTo(-17, -17, 17, -17, 16.5, -1); x.closePath();             // 윗빵
      x.fillStyle = '#E8A44E'; x.fill(); x.strokeStyle = '#A86A22'; x.stroke();
      x.save(); x.clip(); glow(x, -5, -11, [255, 220, 150], 10, 0.55); x.restore();   // 하이라이트는 빵 안쪽에만
      x.fillStyle = '#FFF4D6'; for (const [px, py, a] of [[-7, -9, -0.5], [0, -12, 0.2], [7, -9, 0.6], [-3, -6, 0.3], [4, -5.5, -0.4], [-10, -5, 0.8]]) { x.beginPath(); x.ellipse(px, py, 1.5, 0.8, a, 0, TAU); x.fill(); }   // 참깨
    });
    const pizza = mk(40, (x) => {
      x.translate(20, 20); x.lineJoin = 'round';
      x.beginPath(); x.moveTo(-15, -9); x.lineTo(15, -9); x.lineTo(0, 17); x.closePath();
      x.fillStyle = '#FFC93C'; x.fill(); x.strokeStyle = '#D9961A'; x.lineWidth = 1.4; x.stroke();
      glow(x, -4, -3, [255, 235, 150], 12, 0.5);
      x.fillStyle = '#D9382B'; x.strokeStyle = '#9E2018'; x.lineWidth = 1;   // 페퍼로니
      for (const [px, py, r] of [[-5.5, -3, 4], [5, -1, 3.6], [0, 8, 3]]) { x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill(); x.stroke(); }
      x.fillStyle = 'rgba(120,20,10,0.5)'; for (const [px, py] of [[-6.5, -4], [-4, -2], [4, -2], [6, 0], [-0.5, 7.5], [1, 9]]) { x.beginPath(); x.arc(px, py, 0.7, 0, TAU); x.fill(); }
      x.fillStyle = '#4CAF50'; for (const [px, py, a] of [[-9, -6, 0.5], [9, -5, -0.4], [2, 3, 0.9], [-3, 4, -0.6]]) { x.beginPath(); x.ellipse(px, py, 1.8, 1, a, 0, TAU); x.fill(); }   // 피망 조각
      x.beginPath(); x.moveTo(-17, -9); x.quadraticCurveTo(-17, -15, -11, -15); x.lineTo(11, -15); x.quadraticCurveTo(17, -15, 17, -9); x.quadraticCurveTo(17, -6, 14, -6); x.lineTo(-14, -6); x.quadraticCurveTo(-17, -6, -17, -9); x.closePath();   // 도우 테두리
      x.fillStyle = '#E3A24F'; x.fill(); x.strokeStyle = '#A86A22'; x.lineWidth = 1.2; x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.45)'; x.beginPath(); x.ellipse(-8, -12.5, 5, 1.2, 0, 0, TAU); x.fill();
    });
    const fries = mk(40, (x) => {
      x.translate(20, 20); x.lineJoin = 'round'; x.lineCap = 'round';
      for (const [sx, top, ang] of [[-8, -16, -0.25], [-3, -18, -0.08], [2, -17, 0.1], [7, -15, 0.28], [-5.5, -13, 0.18], [4.5, -18.5, -0.15]]) {   // 감자튀김
        x.save(); x.translate(sx, 2); x.rotate(ang); x.fillStyle = '#FFD54F'; x.strokeStyle = '#E0A81E'; x.lineWidth = 0.9;
        x.beginPath(); x.rect(-1.8, top - 2, 3.6, 2 - top); x.fill(); x.stroke(); x.restore();
      }
      x.beginPath(); x.moveTo(-11, 1); x.lineTo(11, 1); x.lineTo(9, 17); x.quadraticCurveTo(0, 19, -9, 17); x.closePath();   // 빨간 상자
      x.fillStyle = '#E53935'; x.fill(); x.strokeStyle = '#A8201D'; x.lineWidth = 1.2; x.stroke();
      x.strokeStyle = '#FFFFFF'; x.lineWidth = 1.8; x.beginPath(); x.arc(0, 7, 4, 0.3, Math.PI - 0.3); x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.28)'; x.beginPath(); x.ellipse(-6.5, 8, 1.4, 5, 0, 0, TAU); x.fill();
    });
    const cola = mk(40, (x) => {
      x.translate(20, 20); x.lineJoin = 'round'; x.lineCap = 'round';
      x.strokeStyle = '#E53935'; x.lineWidth = 2.4; x.beginPath(); x.moveTo(2, -9); x.lineTo(7, -18.5); x.stroke();   // 빨대
      x.strokeStyle = '#FFFFFF'; x.lineWidth = 2.4; x.setLineDash([2, 2.2]); x.beginPath(); x.moveTo(2, -9); x.lineTo(7, -18.5); x.stroke(); x.setLineDash([]);
      x.beginPath(); x.moveTo(-10.5, -6.5); x.lineTo(10.5, -6.5); x.lineTo(8, 17); x.quadraticCurveTo(0, 18.5, -8, 17); x.closePath();   // 컵
      x.fillStyle = '#D9342B'; x.fill(); x.strokeStyle = '#9E2018'; x.lineWidth = 1.2; x.stroke();
      x.fillStyle = '#FFFFFF'; x.beginPath(); x.moveTo(-9.8, 1); x.lineTo(9.8, 1); x.lineTo(8.9, 9); x.lineTo(-8.9, 9); x.closePath(); x.fill();   // 흰 띠 + 빨간 물결
      x.strokeStyle = '#D9342B'; x.lineWidth = 1.6; x.beginPath(); x.moveTo(-6, 5.5); x.quadraticCurveTo(-3, 2.5, 0, 5.5); x.quadraticCurveTo(3, 8.5, 6, 5.5); x.stroke();
      x.beginPath(); x.moveTo(-11, -8); x.quadraticCurveTo(0, -14.5, 11, -8); x.closePath(); x.fillStyle = '#F0F0F0'; x.fill(); x.strokeStyle = '#A8A8A8'; x.lineWidth = 1; x.stroke();   // 뚜껑
      x.fillStyle = '#E0E0E0'; x.fillRect(-12, -9, 24, 3); x.strokeRect(-12, -9, 24, 3);
      x.fillStyle = 'rgba(255,255,255,0.3)'; x.beginPath(); x.ellipse(-6.5, 11, 1.3, 4, 0, 0, TAU); x.fill();
    });
    spr.fastfood = [burger, pizza, fries, cola];   // 패스트푸드 한 효과로 묶음(햄버거·피자·감자튀김·콜라)
    // ── 스포츠 공: 농구 🏀 / 럭비 🏉 / 야구 ⚾ / 테니스 🎾 / 당구·포켓볼 🎱 ──
    const ball = (base, edge, details) => mk(40, (x) => {
      x.translate(20, 20); x.lineJoin = 'round'; x.lineCap = 'round';
      x.beginPath(); x.arc(0, 0, 16, 0, TAU); x.fillStyle = base; x.fill();
      x.save(); x.clip(); details(x); glow(x, -6, -7, [255, 255, 255], 13, 0.4); x.restore();   // 무늬 + 반사광은 공 안쪽에만
      x.beginPath(); x.arc(0, 0, 16, 0, TAU); x.strokeStyle = edge; x.lineWidth = 1.4; x.stroke();
    });
    const basketball = ball('#F08A24', '#9A4F0E', (x) => {
      x.strokeStyle = '#3A2210'; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(0, -16); x.lineTo(0, 16); x.moveTo(-16, 0); x.lineTo(16, 0); x.stroke();
      x.beginPath(); x.arc(-19, 0, 14, -1.0, 1.0); x.stroke(); x.beginPath(); x.arc(19, 0, 14, Math.PI - 1.0, Math.PI + 1.0); x.stroke();
    });
    const rugby = mk(40, (x) => {
      x.translate(20, 20); x.lineJoin = 'round'; x.lineCap = 'round';
      const body = () => { x.beginPath(); x.moveTo(-18, 0); x.quadraticCurveTo(0, -17, 18, 0); x.quadraticCurveTo(0, 17, -18, 0); x.closePath(); };
      body(); x.fillStyle = '#A0602E'; x.fill();
      x.save(); x.clip();
      x.strokeStyle = '#FFFFFF'; x.lineWidth = 2; for (const sx of [-11, 11]) { x.beginPath(); x.moveTo(sx, -9); x.lineTo(sx, 9); x.stroke(); }   // 흰 띠
      glow(x, -4, -6, [255, 220, 170], 14, 0.4); x.restore();
      x.strokeStyle = '#FFFFFF'; x.lineWidth = 1.4; x.beginPath(); x.moveTo(-6, 0); x.lineTo(6, 0); for (const tx of [-4, -1.3, 1.4, 4]) { x.moveTo(tx, -2.4); x.lineTo(tx, 2.4); } x.stroke();   // 끈
      body(); x.strokeStyle = '#5E3213'; x.lineWidth = 1.4; x.stroke();
    });
    const baseball = ball('#F7F4EA', '#B9B3A0', (x) => {
      x.strokeStyle = '#D32F2F'; x.lineWidth = 1.2;
      for (const sgn of [-1, 1]) {
        const cx = sgn * 17, a0 = sgn < 0 ? -1.05 : Math.PI - 1.05;
        x.beginPath(); x.arc(cx, 0, 11, a0, a0 + 2.1); x.stroke();
        for (let k = 0; k <= 6; k++) { const a = a0 + 0.35 * k, px = cx + Math.cos(a) * 11, py = Math.sin(a) * 11, nx = Math.cos(a), ny = Math.sin(a);   // 바늘땀
          x.beginPath(); x.moveTo(px - nx * 2.2, py - ny * 2.2); x.lineTo(px + nx * 2.2, py + ny * 2.2); x.stroke(); }
      }
    });
    const tennis = ball('#D4E84A', '#8FA21E', (x) => {
      x.strokeStyle = '#FFFFFF'; x.lineWidth = 2.2;
      x.beginPath(); x.arc(-15, -9, 17, 0, TAU); x.stroke(); x.beginPath(); x.arc(15, 9, 17, 0, TAU); x.stroke();
    });
    const pool = (n, c) => ball(c, 'rgba(0,0,0,0.55)', (x) => {
      x.fillStyle = '#FFFFFF'; x.beginPath(); x.arc(0, 0, 7, 0, TAU); x.fill();
      x.fillStyle = '#111111'; x.font = 'bold 9px "Helvetica Neue",Arial,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(n), 0, 0.6);
    });
    spr.sports = [basketball, rugby, baseball, tennis];   // 스포츠 공 한 효과로 묶음(농구·럭비·야구·테니스)
    spr.billiards = [pool(8, '#1B1B1B'), pool(1, '#F6C42B'), pool(2, '#2457C5'), pool(3, '#D1352B'), pool(4, '#6A2C91')];
    // ── 종이비행기 ✈ (코가 +x 방향): 윗날개 밝게 / 아랫날개 중간 / 가운데 접힌 면 어둡게 ──
    const plane = (c) => mk(40, (x) => {
      x.translate(20, 20); x.lineJoin = 'round'; x.lineWidth = 0.9; x.strokeStyle = 'rgba(70,80,100,0.6)';
      const tri = (pts, fill) => { x.fillStyle = fill; x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]); x.closePath(); x.fill(); x.stroke(); };
      tri([[18, 1], [-16, 12], [-6, 2]], shade(c, 0.86));          // 아랫날개
      tri([[18, 1], [-6, 2], [-11, 7]], shade(c, 0.66));           // 가운데 접힌 면(그늘)
      tri([[18, 1], [-16, -12], [-6, 0]], shade(c, 1.0));          // 윗날개
      x.strokeStyle = 'rgba(70,80,100,0.45)'; x.beginPath(); x.moveTo(18, 1); x.lineTo(-6, 1); x.stroke();   // 가운데 접힌 선
      x.fillStyle = 'rgba(255,255,255,0.55)'; x.beginPath(); x.moveTo(14, -0.5); x.lineTo(-8, -8); x.lineTo(-4, -2); x.closePath(); x.fill();
    });
    spr.planes = ['#FFFFFF', '#BFE3FF', '#FFD6E7', '#FFF2B3', '#D8F5D0'].map(plane);
    spr.paws = ['#8D6E63', '#F4A6B8', '#9AA5B1', '#FFB74D'].map((c) => mk(32, (x) => {
      x.translate(16, 16); x.fillStyle = c;
      const el = (cx, cy, rx, ry, rot) => { x.beginPath(); x.ellipse(cx, cy, rx, ry, rot || 0, 0, TAU); x.fill(); };
      el(0, 4, 7.5, 6); el(-8, -4, 3, 3.8, -0.4); el(-3, -9, 3, 3.8, -0.1); el(3, -9, 3, 3.8, 0.1); el(8, -4, 3, 3.8, 0.4);
    }));
    spr.emojiRepeatable = EMOJI_REPEATABLE; spr.emojiSnowflake = EMOJIS.indexOf('❄️');
    return spr;
  }

  // ── 눈 / 별가루 / 클로버 / 낙엽 / 벚꽃: 위에서 아래로만 떨어진다 ──────────
  // max 동시 개수, size/vy/drift/spin 범위. flip = 뒤집히며 팔랑거림, rot = 처음 각도를 무작위로
  const FALL = {
    snow:   { max: 70, size: [6, 14],  vy: [55, 100], drift: [6, 20],  spin: [-1.5, 1.5] },
    stars:  { max: 50, size: [9, 17],  vy: [45, 85],  drift: [6, 20],  spin: [-1.5, 1.5] },
    clover: { max: 40, size: [11, 18], vy: [40, 80],  drift: [15, 30], spin: [-1, 1], rot: true },
    leaves: { max: 40, size: [16, 28], vy: [50, 95],  drift: [30, 60], spin: [-2, 2], rot: true, flip: true },
    sakura: { max: 70, size: [9, 16],  vy: [30, 60],  drift: [25, 50], spin: [-1.5, 1.5], rot: true, flip: true },
    // fade = 나타나는 시간(초), popAt = 화면 높이의 이 비율까지 내려오면 살짝 커지며 터짐
    bubble:    { max: 30,  size: [14, 30], vy: [25, 55], drift: [20, 40], spin: [0, 0], fade: 0.25, popAt: 0.9, alpha: [0.6, 0.95] },
    ribbon:    { max: 40,  size: [16, 26], vy: [40, 80], drift: [20, 40], spin: [-1.5, 1.5], rot: true, flip: true },
    pretzel:   { max: 30,  size: [16, 26], vy: [45, 85], drift: [10, 25], spin: [-1.5, 1.5], rot: true },
    money:     { max: 40,  size: [20, 32], vy: [50, 95], drift: [30, 60], spin: [-1.5, 1.5], rot: true, flip: true },
    strawberry: { max: 35, size: [16, 26], vy: [45, 90], drift: [15, 35], spin: [-1.5, 1.5], rot: true },
    cherry:    { max: 35,  size: [16, 26], vy: [45, 90], drift: [15, 35], spin: [-1.5, 1.5], rot: true },
    carrot:    { max: 35,  size: [16, 26], vy: [45, 90], drift: [15, 35], spin: [-1.5, 1.5], rot: true },
    mandarin:  { max: 35,  size: [16, 26], vy: [45, 90], drift: [15, 35], spin: [-1.5, 1.5], rot: true },
    tomato:    { max: 35,  size: [16, 26], vy: [45, 90], drift: [15, 35], spin: [-1.5, 1.5], rot: true },
    fastfood:  { max: 30,  size: [18, 28], vy: [45, 90], drift: [15, 35], spin: [-1.5, 1.5], rot: true },
    sports:    { max: 30,  size: [16, 26], vy: [45, 90], drift: [10, 25], spin: [-2, 2], rot: true },
    billiard:  { max: 30,  size: [14, 22], vy: [45, 90], drift: [10, 25], spin: [-2, 2], rot: true },
    paperplane: { max: 25, size: [18, 28], vy: [50, 90], drift: [40, 80], spin: [0, 0], glide: true },
    paws:      { max: 40,  size: [14, 24], vy: [40, 80], drift: [8, 20],  spin: [-0.3, 0.3], rot: true, alpha: [0.6, 0.9] },
  };
  const POP_TIME = 0.2;   // 방울이 터지는 시간(초)
  const NATURE_KINDS = ['clover', 'leaves', 'sakura', 'bubble', 'paws', 'ribbon', 'pretzel', 'money', 'strawberry', 'cherry', 'carrot', 'mandarin', 'tomato', 'fastfood', 'sports', 'billiard', 'paperplane'];
  /**
   * 효과 메타데이터 (내부용, 코드로만 관리). 메뉴·팝업의 효과 목록은 여기서 만든다.
   * enabled: false 로 두면 목록에서 빠진다(시안·보류 효과). 저장된 설정이 꺼진 효과를 가리키면 끄기로 취급.
   */
  const EFFECTS = [
    { id: 'snow', ko: '눈', en: 'Snow', enabled: true },
    { id: 'stars', ko: '별가루', en: 'Stardust', enabled: true },
    { id: 'clover', ko: '네잎클로버', en: 'Four-leaf clover', enabled: true },
    { id: 'leaves', ko: '낙엽', en: 'Autumn leaves', enabled: true },
    { id: 'sakura', ko: '벚꽃', en: 'Cherry blossoms', enabled: true },
    { id: 'bubble', ko: '비눗방울', en: 'Bubbles', enabled: true },
    { id: 'paws', ko: '고양이 발자국', en: 'Cat paws', enabled: true },
    { id: 'money', ko: '지폐', en: 'Banknotes', enabled: true },
    { id: 'cherry', ko: '체리', en: 'Cherries', enabled: true },
    { id: 'sports', ko: '스포츠 공', en: 'Sports balls', enabled: true },
    { id: 'fastfood', ko: '패스트푸드', en: 'Fast food', enabled: true },
    { id: 'paperplane', ko: '종이비행기', en: 'Paper planes', enabled: true },
    // 시안 단계(스프라이트만 있고 메뉴에는 노출하지 않음)
    { id: 'ribbon', ko: '리본', en: 'Ribbons', enabled: false },
    { id: 'pretzel', ko: '프레첼', en: 'Pretzels', enabled: false },
    { id: 'strawberry', ko: '딸기', en: 'Strawberries', enabled: false },
    { id: 'carrot', ko: '당근', en: 'Carrots', enabled: false },
    { id: 'mandarin', ko: '귤', en: 'Mandarins', enabled: false },
    { id: 'tomato', ko: '토마토', en: 'Tomatoes', enabled: false },
    { id: 'billiard', ko: '당구공', en: 'Pool balls', enabled: false },
  ];
  const enabledEffects = () => EFFECTS.filter((e) => e.enabled);
  class Falling {
    constructor(kind) {
      this.kind = kind === true ? 'stars' : kind === false || !kind ? 'snow' : kind;
      this.stars = this.kind === 'stars'; this.cfg = FALL[this.kind];
      this.flakes = []; this.dust = []; this.acc = 0; this.t = 0;
    }
    get count() { return this.flakes.length + this.dust.length; }
    step(dt, rate, W, H, den, images, trail) {
      this.t += dt; this.acc += dt * rate;
      const c = this.cfg, maxF = Math.round(c.max * den), maxD = Math.round(160 * den);
      while (this.acc >= 1) {
        this.acc -= 1;
        if (this.flakes.length >= maxF) continue;
        this.flakes.push({
          img: pick(images), size: rnd(c.size[0], c.size[1]),
          x: rnd(0, W), y: -10, vy: rnd(c.vy[0], c.vy[1]),
          phase: rnd(0, TAU), drift: rnd(c.drift[0], c.drift[1]), spin: rnd(c.spin[0], c.spin[1]), alpha: c.alpha ? rnd(c.alpha[0], c.alpha[1]) : rnd(0.55, 0.95),
          rot0: c.rot ? rnd(0, TAU) : 0, tw: rnd(2, 5.5), age: 0,
          popAt: c.popAt ? (Math.random() < 0.6 ? rnd(0.12, c.popAt) : c.popAt) : 0,   // 방울의 60%는 중간에서 터지고 나머지는 화면 90% 까지 내려옴
        });
      }
      const t = this.t;
      this.flakes = this.flakes.filter((f) => {
        if (f.popT !== undefined) { f.popT += dt; return f.popT < POP_TIME; }   // 터지는 중: 제자리에서 커지며 사라짐
        f.y += f.vy * dt; f.x += Math.sin(t * 0.8 + f.phase) * f.drift * dt;
        f.age += dt; if (f.popAt && f.y >= f.popAt * H) f.popT = 0;
        if (this.stars && trail.length && this.dust.length < maxD && Math.random() < dt * 5) { // 꼬리 가루
          const life = rnd(0.7, 1.3);
          this.dust.push({ img: pick(trail), size: rnd(3, 7), x: f.x + rnd(-4, 4), y: f.y + rnd(-6, 2), vy: rnd(6, 22), life, max: life, a: rnd(0.5, 0.9) });
        }
        return f.y < H + 20;
      });
      this.dust = this.dust.filter((p) => { p.life -= dt; p.y += p.vy * dt; return p.life > 0; });
    }
    draw(ctx, glint) {
      const t = this.t, c = this.cfg;
      for (const f of this.flakes) {
        ctx.save(); ctx.translate(f.x, f.y);
        if (this.stars) { ctx.rotate(t * f.spin + f.phase); ctx.globalAlpha = 0.55 + 0.4 * Math.sin(t * 4 + f.phase); }
        else {
          let a = f.alpha, sc = 1;
          if (c.fade) a *= clamp(f.age / c.fade, 0, 1);
          if (f.popT !== undefined) { const k = f.popT / POP_TIME; a *= 1 - k; sc = 1 + 0.6 * k; }
          ctx.globalAlpha = a; if (sc !== 1) ctx.scale(sc, sc);
          if (c.glide) ctx.rotate(Math.atan2(f.vy, Math.cos(t * 0.8 + f.phase) * 0.8 * f.drift));   // 진행 방향으로 코를 향함
          else if (c.rot) ctx.rotate(f.rot0 + t * f.spin * 0.5);
          if (c.flip) ctx.scale(Math.max(0.2, Math.abs(Math.cos(t * 1.6 + f.phase))), 1);   // 뒤집히며 팔랑
        }
        ctx.drawImage(f.img, -f.size / 2, -f.size / 2, f.size, f.size);
        ctx.restore();
        if (this.stars && glint) { // 윤슬: 가끔 짧게 번쩍이는 흰 십자
          const g = Math.pow(Math.max(0, Math.sin(t * f.tw + f.phase * 3)), 24);   // 아주 짧고 은은하게
          if (g > 0.05) {
            const s = f.size * (1 + 0.5 * g);
            ctx.globalAlpha = 0.45 * g; ctx.drawImage(glint, f.x - s / 2, f.y - s / 2, s, s);
          }
        }
      }
      for (const p of this.dust) {
        ctx.globalAlpha = p.a * (p.life / p.max);
        ctx.drawImage(p.img, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;
    }
  }

  // ── 크리스마스: 빨강·초록 크로세트 폭죽 + 이모지 소나기 ────────────────
  class Christmas {
    constructor() { this.parts = []; this.queue = []; this.burstsLeft = 0; this.emojiAcc = 0; this.burstAcc = 0; this.t = 0; this.maxParts = 900; this.spr = null; }
    get active() { return this.parts.length > 0 || this.queue.length > 0 || this.burstsLeft > 0; }
    /** 이모지 12개를 예약한다. 반복 가능 그룹(트리) 밖의 이모지는 화면·대기열에 이미 있으면 다시 뽑지 않는다. */
    trigger(spr) {
      spr = spr || this.spr;
      this.burstsLeft += 9;
      if (!spr) return;
      const n = spr.emojis.length, R = spr.emojiRepeatable, total = 12;
      const busy = new Set(this.queue);
      let treeNow = this.queue.filter((i) => i === 0).length;
      for (const p of this.parts) if (p.kind === 'emoji') { busy.add(p.idx); if (p.idx === 0) treeNow++; }
      const trees = Math.min(3 + ((Math.random() * 2) | 0), Math.max(0, MAX_TREES - treeNow));   // 트리 3~4개, 화면 전체로는 최대 4개
      const slots = total - trees;
      const others = [];
      for (let i = R; i < n; i++) if (!busy.has(i)) others.push(i);
      shuffle(others);
      const sf = others.indexOf(spr.emojiSnowflake);
      if (sf > 0) { others.splice(sf, 1); others.unshift(spr.emojiSnowflake); }                     // ❄️ 는 항상 먼저 뽑음
      const picked = others.slice(0, slots);
      this.queue.push(...shuffle([].concat(Array(trees).fill(0), picked)));
    }

    burst(W, H, spr) {
      const cx = rnd(0.12, 0.88) * W, cy = rnd(0.12, 0.6) * H, n = 12;
      for (let i = 0; i < n; i++) { // 큰 별: 빨강/초록 섞임 + 꼬리 + 수명이 끝나면 십자 분열
        const ang = (TAU * i) / n + rnd(-0.1, 0.1), sp = rnd(100, 140), ci = (Math.random() * 2) | 0, life = rnd(0.7, 0.85);
        this.parts.push({ kind: 'dot', img: spr.xmasDots[ci], ci, size: rnd(6, 8), x: cx, y: cy,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 60, drag: 1.5, life, max: life, trail: true, trailAcc: 0, split: true });
      }
    }
    update(dt, W, H, spr) {
      this.t += dt; this.spr = spr;
      if (this.queue.length > 0) {
        this.emojiAcc += dt * 6;
        while (this.emojiAcc >= 1 && this.queue.length > 0) {
          this.emojiAcc -= 1; const idx = this.queue.shift();
          this.parts.push({ kind: 'emoji', idx, img: spr.emojis[idx], size: 40, x: rnd(0, W), y: -30, vy: rnd(90, 160), phase: rnd(0, TAU), spin: rnd(-1.2, 1.2) });
        }
      }
      if (this.burstsLeft > 0) {
        this.burstAcc += dt * 3.5;
        while (this.burstAcc >= 1 && this.burstsLeft > 0) { this.burstAcc -= 1; this.burstsLeft -= 1; this.burst(W, H, spr); }
      }
      const alive = [], born = [], t = this.t;
      const sec = (p, size, life, vx, vy, g, ci) => ({ kind: 'dot', img: spr.xmasDots[ci], ci, size, x: p.x, y: p.y, vx, vy, g, drag: 1.0, life, max: life, trail: false, trailAcc: 0, split: false });
      for (const p of this.parts) {
        if (p.kind === 'emoji') {
          p.y += p.vy * dt; p.x += Math.sin(t * 1.5 + p.phase) * 25 * dt;
          if (p.y < H + 60) alive.push(p);
          continue;
        }
        p.life -= dt;
        if (p.life <= 0) {
          if (p.split && this.parts.length + born.length < this.maxParts) { // 십자 분열: 반대 색 4개
            const a0 = rnd(0, TAU), other = (p.ci + 1) % 2;
            for (let k = 0; k < 4; k++) {
              const b = a0 + (k * Math.PI) / 2;
              const q = sec(p, rnd(4, 6), 0.9, p.vx * 0.3 + Math.cos(b) * 110, p.vy * 0.3 + Math.sin(b) * 110, 60, other);
              q.drag = 1.6; q.trail = true; born.push(q);
            }
          }
          continue;
        }
        const d = Math.exp(-p.drag * dt);
        p.vx *= d; p.vy = p.vy * d + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.trail) { // 지나온 자리에 작은 점을 남김
          p.trailAcc += dt;
          if (p.trailAcc >= 0.06 && this.parts.length + born.length < this.maxParts) { p.trailAcc = 0; born.push(sec(p, p.size * 0.7, 0.35, 0, 0, 0, p.ci)); }
        }
        alive.push(p);
      }
      this.parts = alive.concat(born);
    }
    draw(ctx) {
      for (const p of this.parts) {
        if (p.kind === 'emoji') {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(this.t * p.spin + p.phase); ctx.globalAlpha = 1;
          ctx.drawImage(p.img, -p.size / 2, -p.size / 2, p.size, p.size); ctx.restore();
        } else {
          ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
          ctx.drawImage(p.img, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // ── 진입점 ────────────────────────────────────────────────────────────
  class Typefall {
    constructor(o = {}) {
      this.createCanvas = o.createCanvas || ((w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
      this.W = o.W || 800; this.H = o.H || 600; this.dpr = o.dpr || 1;
      this.opts = { mode: 'snow', tint: 'default', density: 'm', xmas: false, specialKey: '' }; // specialKey: 이 키를 누르면 크리스마스 효과(빈 값 = 사용 안 함)
      this.tracker = new TypingTracker(); this.word = new WordTrigger();
      this.snow = new Falling('snow'); this.starsF = new Falling('stars'); this.xmas = new Christmas();
      this.nature = {};
      for (const k of NATURE_KINDS) this.nature[k] = new Falling(k);
      this.spr = buildSprites(this.createCanvas, this.dpr, TINTS[this.opts.tint]);
    }
    /** {mode, tint, density, xmas, specialKey} 일부만 넘겨도 됨 */
    setOptions(o) {
      const prevTint = this.opts.tint;
      Object.assign(this.opts, o);
      if (this.opts.tint !== prevTint) this.spr = buildSprites(this.createCanvas, this.dpr, TINTS[this.opts.tint]);
      if (!this.opts.xmas) this.word.reset();
    }
    resize(W, H, dpr) {
      this.W = W; this.H = H;
      if (dpr && dpr !== this.dpr) { this.dpr = dpr; this.spr = buildSprites(this.createCanvas, this.dpr, TINTS[this.opts.tint]); }
    }
    hit(now) { this.tracker.hit(now === undefined ? performance.now() : now); }
    /** 키 하나(event.code). 지정 키는 항상, 크리스마스 단어는 켜져 있을 때만 본다. 감지되면 true */
    key(code) {
      if (this.opts.specialKey && code === this.opts.specialKey) { this.xmas.trigger(this.spr); return true; }
      if (!this.opts.xmas) return false;
      if (this.word.feed(code)) { this.xmas.trigger(this.spr); return true; }
      return false;
    }
    triggerChristmas() { this.xmas.trigger(this.spr); }
    /** 그릴 게 남아 있거나 타자 중이면 true (오버레이가 루프를 멈출지 판단) */
    get active() {
      return this.tracker.smoothed > 0 || this.snow.count > 0 || this.starsF.count > 0 || this.xmas.active ||
        Object.values(this.nature).some((f) => f.count > 0);
    }
    update(dt, now) {
      dt = Math.min(dt, 0.1);
      this.tracker.update(now === undefined ? performance.now() : now);
      const lv = this.tracker.level, idle = this.tracker.idle;
      const den = DENSITY[normDensity(this.opts.density)] || 1, m = this.opts.mode;
      this.snow.step(dt, m === 'snow' && !idle ? lerp(1, 5, lv) * den : 0, this.W, this.H, den, this.spr.dots, []);
      this.starsF.step(dt, m === 'stars' && !idle ? lerp(1, 4, lv) * den : 0, this.W, this.H, den, this.spr.stars, this.spr.specks);
      const imgs = { clover: this.spr.clovers, leaves: this.spr.leaves, sakura: this.spr.petals, bubble: this.spr.bubbles, paws: this.spr.paws, ribbon: this.spr.ribbons, pretzel: this.spr.pretzels, money: this.spr.bills,
        strawberry: this.spr.strawberries, cherry: this.spr.cherries, carrot: this.spr.carrots, mandarin: this.spr.mandarins, tomato: this.spr.tomatoes, fastfood: this.spr.fastfood,
        sports: this.spr.sports, billiard: this.spr.billiards, paperplane: this.spr.planes };
      for (const k in this.nature) this.nature[k].step(dt, m === k && !idle ? lerp(1, 4, lv) * den : 0, this.W, this.H, den, imgs[k], []);
      this.xmas.update(dt, this.W, this.H, this.spr);
    }
    draw(ctx) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      this.snow.draw(ctx); this.starsF.draw(ctx, this.spr.glint);
      for (const k in this.nature) this.nature[k].draw(ctx);
      this.xmas.draw(ctx);
    }
  }

  const api = { Typefall, TypingTracker, WordTrigger, Falling, Christmas, buildSprites, EMOJIS, NATURE_KINDS, EFFECTS, enabledEffects, TINTS, DENSITY, DENSITY_LEGACY, normDensity, XMAS_PATTERNS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Typefall = api;
})(typeof self !== 'undefined' ? self : this);
