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
    const maple = (c) => mk(40, (x) => {
      x.translate(20, 20); x.fillStyle = c; x.strokeStyle = c; x.lineJoin = 'round'; x.lineWidth = 2.2;
      x.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 8 : 16, a = -Math.PI / 2 + i * Math.PI / 5; x[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r + 1); }
      x.closePath(); x.fill(); x.stroke();
      x.strokeStyle = 'rgba(80,30,0,0.45)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(0, 19); x.lineTo(0, -10); x.stroke();
    });
    const oval = (c) => mk(40, (x) => {
      x.translate(20, 20); x.fillStyle = c; x.beginPath(); x.moveTo(0, -17);
      x.bezierCurveTo(13, -8, 13, 8, 0, 15); x.bezierCurveTo(-13, 8, -13, -8, 0, -17); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(80,30,0,0.45)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(0, 19); x.lineTo(0, -10); x.stroke();
    });
    spr.leaves = [maple('#E8501A'), maple('#F08A24'), maple('#D9342B'), maple('#F2B233'), oval('#C8741F'), oval('#E8A42A'), oval('#A8501A')];
    spr.petals = [['#FF9DBB', '#FFE3EC'], ['#FFB3CB', '#FFF0F5'], ['#FFC2D6', '#FFFFFF']].map(([a, b]) => mk(24, (x) => {
      x.translate(12, 12);
      x.fillStyle = a; x.beginPath(); x.moveTo(0, 10);
      x.bezierCurveTo(-9, 4, -8, -9, -2, -11); x.lineTo(0, -8); x.lineTo(2, -11); x.bezierCurveTo(8, -9, 9, 4, 0, 10); x.closePath(); x.fill();
      glow(x, 0, -6, hexRgb(b), 9, 0.9);   // 끝쪽을 연하게
    }));
    spr.bubbles = [mk(32, (x) => {
      x.translate(16, 16); glow(x, 0, 0, [190, 230, 255], 14, 0.22);
      x.lineWidth = 1.6; x.strokeStyle = 'rgba(170,220,255,0.85)'; x.beginPath(); x.arc(0, 0, 13, 0, TAU); x.stroke();
      x.strokeStyle = 'rgba(255,170,220,0.9)'; x.beginPath(); x.arc(0, 0, 13, 0.2, 1.4); x.stroke();
      x.strokeStyle = 'rgba(200,255,170,0.9)'; x.beginPath(); x.arc(0, 0, 13, Math.PI + 0.2, Math.PI + 1.4); x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.9)'; x.beginPath(); x.ellipse(-5, -6, 3.2, 1.8, -0.7, 0, TAU); x.fill();
    })];
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
    // ttl = 수명(초), fade = 나타나고 사라지는 시간, pop = 사라질 때 살짝 커지며 터짐
    bubble:    { max: 30,  size: [14, 30], vy: [25, 55], drift: [20, 40], spin: [0, 0], ttl: [2.5, 7], fade: 0.25, pop: true, alpha: [0.6, 0.95] },
    paws:      { max: 40,  size: [14, 24], vy: [40, 80], drift: [8, 20],  spin: [-0.3, 0.3], rot: true, alpha: [0.6, 0.9] },
  };
  const NATURE_KINDS = ['clover', 'leaves', 'sakura', 'bubble', 'paws'];
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
          rot0: c.rot ? rnd(0, TAU) : 0, tw: rnd(2, 5.5), age: 0, ttl: c.ttl ? rnd(c.ttl[0], c.ttl[1]) : 0,
        });
      }
      const t = this.t;
      this.flakes = this.flakes.filter((f) => {
        f.y += f.vy * dt; f.x += Math.sin(t * 0.8 + f.phase) * f.drift * dt;
        f.age += dt; if (f.ttl && f.age > f.ttl) return false;
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
          if (f.ttl) { // 나타나고 사라지기(+ 방울은 터지듯 커짐)
            const inK = clamp(f.age / c.fade, 0, 1), outK = clamp((f.ttl - f.age) / c.fade, 0, 1);
            a *= inK * outK; if (c.pop) sc = 1 + 0.5 * (1 - outK);
          }
          ctx.globalAlpha = a; if (sc !== 1) ctx.scale(sc, sc);
          if (c.rot) ctx.rotate(f.rot0 + t * f.spin * 0.5);
          if (c.flip) ctx.scale(Math.max(0.2, Math.abs(Math.cos(t * 1.6 + f.phase))), 1);   // 뒤집히며 팔랑
        }
        ctx.drawImage(f.img, -f.size / 2, -f.size / 2, f.size, f.size);
        ctx.restore();
        if (this.stars && glint) { // 윤슬: 가끔 짧게 번쩍이는 흰 십자
          const g = Math.pow(Math.max(0, Math.sin(t * f.tw + f.phase * 3)), 14);
          if (g > 0.03) {
            const s = f.size * (1.3 + 1.7 * g);
            ctx.globalAlpha = g; ctx.drawImage(glint, f.x - s / 2, f.y - s / 2, s, s);
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
      const imgs = { clover: this.spr.clovers, leaves: this.spr.leaves, sakura: this.spr.petals, bubble: this.spr.bubbles, paws: this.spr.paws };
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

  const api = { Typefall, TypingTracker, WordTrigger, Falling, Christmas, buildSprites, EMOJIS, NATURE_KINDS, TINTS, DENSITY, DENSITY_LEGACY, normDensity, XMAS_PATTERNS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Typefall = api;
})(typeof self !== 'undefined' ? self : this);
