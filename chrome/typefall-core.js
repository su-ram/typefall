/*
 * Typefall core — 타자 칠 때 화면에 내리는 효과 엔진 (캔버스 2D, 의존성 없음)
 *   눈 / 별가루 / 크리스마스(빨강·초록 크로세트 폭죽 + 이모지)
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

  /** 효과 색상(눈 + 별가루 공통). null = 기본(별: 금/연노랑/핑크/하늘, 눈: 옅은 하늘색) */
  const TINTS = { default: null, pink: '#FFB3D1', mint: '#B5EAD7', lavender: '#C7B8FF', peach: '#FFD1B3', sky: '#B3DEFF' };
  /** 파티클 양 단계. 기준(기본) = midhigh(중상) = 1.0, 높을수록 많아진다. */
  const DENSITY = { low: 0.25, midlow: 0.5, mid: 0.75, midhigh: 1.0, high: 1.6 };

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
  const EMOJIS = ['🎄', '🎅', '🎁', '⛄', '🔔', '⭐', '🦌', '🍪', '❄️', '🧦'];
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
    const spr = { dot: dotOf(tint || '#BFE0FF'), stars: [], specks: [], emojis: [], xmasDots: XMAS_COLORS.map(dotOf) };

    const colors = tint ? [tint] : ['#FFD34D', '#FFE9A0', '#FFB3D1', '#B3F0FF'];
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
    return spr;
  }

  // ── 눈 / 별가루: 위에서 아래로만 떨어진다 ──────────────────────────────
  class Falling {
    constructor(stars) { this.stars = stars; this.flakes = []; this.dust = []; this.acc = 0; this.t = 0; }
    get count() { return this.flakes.length + this.dust.length; }
    step(dt, rate, W, H, den, images, trail) {
      this.t += dt; this.acc += dt * rate;
      const maxF = Math.round((this.stars ? 50 : 70) * den), maxD = Math.round(160 * den);
      while (this.acc >= 1) {
        this.acc -= 1;
        if (this.flakes.length >= maxF) continue;
        this.flakes.push({
          img: pick(images), size: this.stars ? rnd(9, 17) : rnd(6, 14),
          x: rnd(0, W), y: -10, vy: this.stars ? rnd(45, 85) : rnd(55, 100),
          phase: rnd(0, TAU), drift: rnd(6, 20), spin: rnd(-1.5, 1.5), alpha: rnd(0.55, 0.95),
        });
      }
      const t = this.t;
      this.flakes = this.flakes.filter((f) => {
        f.y += f.vy * dt; f.x += Math.sin(t * 0.8 + f.phase) * f.drift * dt;
        if (this.stars && trail.length && this.dust.length < maxD && Math.random() < dt * 5) { // 꼬리 가루
          const life = rnd(0.7, 1.3);
          this.dust.push({ img: pick(trail), size: rnd(3, 7), x: f.x + rnd(-4, 4), y: f.y + rnd(-6, 2), vy: rnd(6, 22), life, max: life, a: rnd(0.5, 0.9) });
        }
        return f.y < H + 20;
      });
      this.dust = this.dust.filter((p) => { p.life -= dt; p.y += p.vy * dt; return p.life > 0; });
    }
    draw(ctx) {
      const t = this.t;
      for (const f of this.flakes) {
        ctx.save(); ctx.translate(f.x, f.y);
        if (this.stars) { ctx.rotate(t * f.spin + f.phase); ctx.globalAlpha = 0.55 + 0.4 * Math.sin(t * 4 + f.phase); }
        else ctx.globalAlpha = f.alpha;
        ctx.drawImage(f.img, -f.size / 2, -f.size / 2, f.size, f.size);
        ctx.restore();
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
    constructor() { this.parts = []; this.emojiLeft = 0; this.burstsLeft = 0; this.emojiAcc = 0; this.burstAcc = 0; this.t = 0; this.maxParts = 900; }
    get active() { return this.parts.length > 0 || this.emojiLeft > 0 || this.burstsLeft > 0; }
    trigger() { this.emojiLeft += 12; this.burstsLeft += 9; }

    burst(W, H, spr) {
      const cx = rnd(0.12, 0.88) * W, cy = rnd(0.12, 0.6) * H, n = 12;
      for (let i = 0; i < n; i++) { // 큰 별: 빨강/초록 섞임 + 꼬리 + 수명이 끝나면 십자 분열
        const ang = (TAU * i) / n + rnd(-0.1, 0.1), sp = rnd(100, 140), ci = (Math.random() * 2) | 0, life = rnd(0.7, 0.85);
        this.parts.push({ kind: 'dot', img: spr.xmasDots[ci], ci, size: rnd(6, 8), x: cx, y: cy,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 60, drag: 1.5, life, max: life, trail: true, trailAcc: 0, split: true });
      }
    }
    update(dt, W, H, spr) {
      this.t += dt;
      if (this.emojiLeft > 0) {
        this.emojiAcc += dt * 6;
        while (this.emojiAcc >= 1 && this.emojiLeft > 0) {
          this.emojiAcc -= 1; this.emojiLeft -= 1;
          this.parts.push({ kind: 'emoji', img: pick(spr.emojis), size: 40, x: rnd(0, W), y: -30, vy: rnd(90, 160), phase: rnd(0, TAU), spin: rnd(-1.2, 1.2) });
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
      this.opts = { mode: 'snow', tint: 'default', density: 'midhigh', xmas: false };
      this.tracker = new TypingTracker(); this.word = new WordTrigger();
      this.snow = new Falling(false); this.starsF = new Falling(true); this.xmas = new Christmas();
      this.spr = buildSprites(this.createCanvas, this.dpr, TINTS[this.opts.tint]);
    }
    /** {mode:'off'|'snow'|'stars', tint, density, xmas} 일부만 넘겨도 됨 */
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
    /** 키 하나(event.code). 크리스마스가 켜져 있을 때만 본다. 감지되면 true */
    key(code) {
      if (!this.opts.xmas) return false;
      if (this.word.feed(code)) { this.xmas.trigger(); return true; }
      return false;
    }
    triggerChristmas() { this.xmas.trigger(); }
    /** 그릴 게 남아 있거나 타자 중이면 true (오버레이가 루프를 멈출지 판단) */
    get active() {
      return this.tracker.smoothed > 0 || this.snow.count > 0 || this.starsF.count > 0 || this.xmas.active;
    }
    update(dt, now) {
      dt = Math.min(dt, 0.1);
      this.tracker.update(now === undefined ? performance.now() : now);
      const lv = this.tracker.level, idle = this.tracker.idle;
      const den = DENSITY[this.opts.density] || 1, m = this.opts.mode;
      this.snow.step(dt, m === 'snow' && !idle ? lerp(1, 5, lv) * den : 0, this.W, this.H, den, [this.spr.dot], []);
      this.starsF.step(dt, m === 'stars' && !idle ? lerp(1, 4, lv) * den : 0, this.W, this.H, den, this.spr.stars, this.spr.specks);
      this.xmas.update(dt, this.W, this.H, this.spr);
    }
    draw(ctx) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      this.snow.draw(ctx); this.starsF.draw(ctx); this.xmas.draw(ctx);
    }
  }

  const api = { Typefall, TypingTracker, WordTrigger, Falling, Christmas, buildSprites, TINTS, DENSITY, XMAS_PATTERNS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Typefall = api;
})(typeof self !== 'undefined' ? self : this);
