import AppKit
import QuartzCore
import ServiceManagement

// MARK: - Tracker (shared/typefall-core.js 와 같은 로직)
final class Tracker {
    var stamps: [TimeInterval] = []
    var smoothed = 0.0
    var last: TimeInterval = 0
    var maxWpm = 100.0
    let window = 3.0

    func hit(_ now: TimeInterval) { stamps.append(now) }

    func update(_ now: TimeInterval) -> Double {
        while let f = stamps.first, f < now - window { stamps.removeFirst() }
        var raw = 0.0
        if let f = stamps.first {
            let span = min(max(now - f, 1), window)
            raw = Double(stamps.count) / span * 12
        }
        let dt = last == 0 ? 0.016 : now - last
        last = now
        let tau = raw > smoothed ? 0.25 : 0.7
        smoothed += (raw - smoothed) * (1 - exp(-dt / tau))
        if raw == 0 && smoothed < 0.3 { smoothed = 0 }
        return smoothed
    }
    var level: Double { min(1, max(0, smoothed / maxWpm)) }
    var idle: Bool { smoothed < 1 }
}

func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }

func hex(_ v: UInt32) -> CGColor {
    CGColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
}

/// 눈/별가루: 위에서 생성되어 아래로만 떨어진다 (레이어 좌표는 y가 위로 증가 → 아래로 = y 감소)
enum FallKind: String, CaseIterable { case snow, stars, clover, leaves, sakura, bubble, paws }

final class SnowField {
    final class Flake { let layer = CALayer(); let glint = CALayer(); var x = 0.0, y = 0.0, vy = 0.0, phase = 0.0, drift = 0.0, spin = 0.0, rot0 = 0.0, tw = 0.0, d = 0.0, age = 0.0, ttl = 0.0, alpha = 1.0 }
    final class Dust { let layer = CALayer(); var y = 0.0, vy = 0.0, life = 0.0, maxLife = 1.0, alpha = 1.0 }
    let root = CALayer()
    let size: CGSize
    let kind: FallKind       // stars: 반짝이는 별가루(회전 + 깜빡임 + 윤슬 + 꼬리 가루), snow: 눈송이, clover/leaves/sakura: 자연물
    var stars: Bool { kind == .stars }
    /// 종류별 설정 — shared/typefall-core.js 의 FALL 과 같은 값.
    /// ttl = 수명(초), fade = 나타나고 사라지는 시간, pop = 사라질 때 커지며 터짐
    struct Cfg {
        var max: Int, size: ClosedRange<Double>, vy: ClosedRange<Double>, drift: ClosedRange<Double>, spin: ClosedRange<Double>
        var alpha: ClosedRange<Double> = 0.55...0.95
        var rot = false, flip = false, ttl: ClosedRange<Double>? = nil, fade = 0.0, pop = false
    }
    var cfg: Cfg {
        switch kind {
        case .snow: return Cfg(max: 70, size: 6...14, vy: 55...100, drift: 6...20, spin: -1.5...1.5)
        case .stars: return Cfg(max: 50, size: 9...17, vy: 45...85, drift: 6...20, spin: -1.5...1.5)
        case .clover: return Cfg(max: 40, size: 11...18, vy: 40...80, drift: 15...30, spin: -1...1, rot: true)
        case .leaves: return Cfg(max: 40, size: 16...28, vy: 50...95, drift: 30...60, spin: -2...2, rot: true, flip: true)
        case .sakura: return Cfg(max: 70, size: 9...16, vy: 30...60, drift: 25...50, spin: -1.5...1.5, rot: true, flip: true)
        case .bubble: return Cfg(max: 30, size: 14...30, vy: 25...55, drift: 20...40, spin: 0...0, alpha: 0.6...0.95, ttl: 2.5...7, fade: 0.25, pop: true)
        case .paws: return Cfg(max: 40, size: 14...24, vy: 40...80, drift: 8...20, spin: -0.3...0.3, alpha: 0.6...0.9, rot: true)
        }
    }
    var natural: Bool { kind != .snow && kind != .stars }
    var flakes: [Flake] = []
    var dust: [Dust] = []
    var acc = 0.0, t = 0.0
    var density = 1.0        // 파티클 양 배율 (적게/보통/많게)
    var maxFlakes: Int { Int(Double(cfg.max) * density) } // 개수 상한
    var maxDust: Int { Int(160 * density) }

    init(size: CGSize, kind: FallKind) { self.size = size; self.kind = kind; root.frame = CGRect(origin: .zero, size: size) }

    func step(dt dtIn: Double, rate: Double, images: [CGImage], trail: [CGImage] = [], glint: CGImage? = nil) {
        let dt = min(dtIn, 0.1); t += dt; acc += dt * rate
        CATransaction.begin(); CATransaction.setDisableActions(true)
        while acc >= 1 {
            acc -= 1
            if flakes.count >= maxFlakes { continue }
            let c = cfg; let f = Flake(); let d = Double.random(in: c.size); f.d = d
            f.layer.contents = images.randomElement()!
            f.layer.bounds = CGRect(x: 0, y: 0, width: d, height: d)
            f.alpha = Double.random(in: c.alpha); f.layer.opacity = Float(f.alpha)
            f.x = Double.random(in: 0...Double(size.width))
            f.y = Double(size.height) + 10 // 화면 맨 위
            if let r = c.ttl { f.ttl = Double.random(in: r) }
            f.vy = Double.random(in: c.vy)
            f.phase = Double.random(in: 0...6.28); f.drift = Double.random(in: c.drift)
            f.spin = Double.random(in: c.spin); f.tw = Double.random(in: 2...5.5)
            if c.rot { f.rot0 = Double.random(in: 0...6.28) }
            if stars, let g = glint { f.glint.contents = g; f.glint.opacity = 0; f.layer.addSublayer(f.glint) }
            root.addSublayer(f.layer); flakes.append(f)
        }
        flakes.removeAll { f in
            f.y -= f.vy * dt
            f.x += sin(t * 0.8 + f.phase) * f.drift * dt
            let c = cfg
            f.age += dt
            if f.ttl > 0 && f.age > f.ttl { f.layer.removeFromSuperlayer(); return true }
            f.layer.position = CGPoint(x: f.x, y: f.y)
            if natural { // 회전 (+ 뒤집히며 팔랑), 수명이 있으면 나타나고 사라지기 (방울은 터지듯 커짐)
                var a = f.alpha, sc = 1.0
                if f.ttl > 0 {
                    let inK = min(1, max(0, f.age / c.fade)), outK = min(1, max(0, (f.ttl - f.age) / c.fade))
                    a *= inK * outK; if c.pop { sc = 1 + 0.5 * (1 - outK) }
                }
                f.layer.opacity = Float(a)
                var tr = c.rot ? CATransform3DMakeRotation(CGFloat(f.rot0 + t * f.spin * 0.5), 0, 0, 1) : CATransform3DIdentity
                if c.flip { tr = CATransform3DScale(tr, CGFloat(max(0.2, abs(cos(t * 1.6 + f.phase)))), 1, 1) }
                f.layer.transform = sc == 1 ? tr : CATransform3DScale(tr, CGFloat(sc), CGFloat(sc), 1)
            }
            if stars { // 반짝임 + 회전
                f.layer.opacity = Float(0.55 + 0.4 * sin(t * 4 + f.phase))
                f.layer.transform = CATransform3DMakeRotation(CGFloat(t * f.spin + f.phase), 0, 0, 1)
                // 윤슬: 가끔 짧게 번쩍이는 흰 십자
                let g = pow(max(0, sin(t * f.tw + f.phase * 3)), 14), s = f.d * (1.3 + 1.7 * g)
                f.glint.bounds = CGRect(x: 0, y: 0, width: s, height: s)
                f.glint.position = CGPoint(x: f.d / 2, y: f.d / 2)
                f.glint.opacity = Float(g)
                // 꼬리: 별 뒤로 작은 가루를 흘린다
                if !trail.isEmpty && dust.count < maxDust && Double.random(in: 0...1) < dt * 5 {
                    let p = Dust(); let d = Double.random(in: 3...7)
                    p.layer.contents = trail.randomElement()!
                    p.layer.bounds = CGRect(x: 0, y: 0, width: d, height: d)
                    p.layer.position = CGPoint(x: f.x + Double.random(in: -4...4), y: f.y + Double.random(in: -2...6))
                    p.y = Double(p.layer.position.y); p.vy = Double.random(in: 6...22)
                    p.maxLife = Double.random(in: 0.7...1.3); p.life = p.maxLife; p.alpha = Double.random(in: 0.5...0.9)
                    root.addSublayer(p.layer); dust.append(p)
                }
            }
            if f.y < -20 { f.layer.removeFromSuperlayer(); return true }
            return false
        }
        dust.removeAll { p in
            p.life -= dt
            if p.life <= 0 { p.layer.removeFromSuperlayer(); return true }
            p.y -= p.vy * dt
            p.layer.position = CGPoint(x: p.layer.position.x, y: p.y)
            p.layer.opacity = Float(p.alpha * p.life / p.maxLife)
            return false
        }
        CATransaction.commit()
    }
}

/// 화면 효과 색상 (눈 + 별가루 공통). nil = 기본(별: 금색, 눈: 하늘색), 여러 개 = 입자마다 무작위로 섞음(레인보우)
let fxTints: [(String, [UInt32]?)] = [
    ("기본", nil), ("핑크", [0xFFB3D1]), ("민트", [0xB5EAD7]), ("라벤더", [0xC7B8FF]), ("피치", [0xFFD1B3]), ("노랑", [0xFFE08A]), ("스카이", [0xB3DEFF]),
    ("레인보우", [0xFFB3D1, 0xFFD1B3, 0xFFE08A, 0xB5EAD7, 0xB3DEFF, 0xC7B8FF]),   // 핑크·피치·노랑·민트·스카이·라벤더
]

/// 단어 감지: 글자 내용을 저장하지 않고, 목표 키 순서를 어디까지 눌렀는지 "진행 상태"만 가진다.
/// 물리 키 위치(ANSI keycode)로 비교하므로 한글 조합(IME) 상태와 무관하게 동작한다.
final class WordTrigger {
    // 한글 2벌식 "크리스마스" = z m f l t m a k t m,  영어 "christmas"
    let patterns: [[Int64]] = [[6, 46, 3, 37, 17, 46, 0, 40, 17, 46], [8, 4, 15, 34, 1, 17, 46, 0, 1]]
    var progress: [Int]
    init() { progress = Array(repeating: 0, count: patterns.count) }
    func reset() { progress = Array(repeating: 0, count: patterns.count) }

    func feed(_ code: Int64) -> Bool {
        if code == 51 { // delete: 한 글자 되돌림
            for i in progress.indices where progress[i] > 0 { progress[i] -= 1 }
            return false
        }
        var hit = false
        for i in patterns.indices {
            let p = patterns[i]
            if code == p[progress[i]] {
                progress[i] += 1
                if progress[i] == p.count { progress[i] = 0; hit = true }
            } else {
                progress[i] = code == p[0] ? 1 : 0
            }
        }
        return hit
    }
}

/// 크리스마스 효과: 빨강·초록 크로세트 폭죽(큰 별이 공중에서 반대 색 십자 4갈래로 갈라짐) + 이모지 소나기
final class ChristmasFX {
    final class P {
        let layer = CALayer()
        var x = 0.0, y = 0.0, vx = 0.0, vy = 0.0, g = 0.0
        var life = 0.0, maxLife = 1.0, phase = 0.0, spin = 0.0
        var emoji = false, emojiIdx = 0
        var trail = false, trailAcc = 0.0   // 날아가며 꼬리 점을 남김
        var sparkle = 0.0, flicker = false  // 반짝이는 가루를 흘림 / 깜빡임
        var drag = 1.2, size = 5.0
        var img: CGImage?
        var split = false, colorIdx = 0     // 수명이 끝나면 십자로 갈라짐
    }
    let maxParts = 900                      // 꼬리·가루 포함 전체 입자 상한
    let root = CALayer()
    let size: CGSize
    let emojis: [CGImage], dots: [CGImage]
    var parts: [P] = []
    var emojiQueue: [Int] = []          // 앞으로 떨어뜨릴 이모지(인덱스)
    var burstsLeft = 0
    let repeatable: Int                 // 앞의 N개(트리)만 여러 번 나올 수 있음
    let snowflake: Int                  // ❄️ 의 인덱스(매번 포함)
    var emojiAcc = 0.0, burstAcc = 0.0, t = 0.0

    init(size: CGSize, emojis: [CGImage], repeatable: Int, snowflake: Int, dots: [CGImage]) {
        self.size = size; self.emojis = emojis; self.repeatable = repeatable; self.snowflake = snowflake; self.dots = dots
        root.frame = CGRect(origin: .zero, size: size)
    }

    /// 이모지 12개를 예약한다: 트리 3~4개(화면 전체 최대 4개, 가장 많음) + 나머지는 하나씩(❄️ 는 항상 포함).
    /// 반복 가능 그룹(트리) 밖의 이모지는 화면·대기열에 이미 있으면 다시 뽑지 않는다.
    func trigger() {
        burstsLeft += 9
        let total = 12, maxTrees = 4
        var busy = Set(emojiQueue)
        var treeNow = emojiQueue.filter { $0 == 0 }.count
        for p in parts where p.emoji { busy.insert(p.emojiIdx); if p.emojiIdx == 0 { treeNow += 1 } }
        let trees = min(Int.random(in: 3...4), max(0, maxTrees - treeNow))
        let slots = total - trees
        var others = Array(repeatable..<emojis.count).filter { !busy.contains($0) }.shuffled()
        if let i = others.firstIndex(of: snowflake), i > 0 { others.remove(at: i); others.insert(snowflake, at: 0) }   // ❄️ 먼저
        let picked = Array(others.prefix(slots))
        emojiQueue += (Array(repeating: 0, count: trees) + picked).shuffled()
    }

    func spawnEmoji(_ idx: Int) {
        let p = P(); let d = 40.0              // 이모지는 모두 같은 크기
        p.emoji = true
        p.emojiIdx = idx
        p.layer.contents = emojis[idx]
        p.layer.bounds = CGRect(x: 0, y: 0, width: d, height: d)
        p.x = Double.random(in: 0...Double(size.width)); p.y = Double(size.height) + 30
        p.vy = Double.random(in: 90...160)      // 아래로 떨어지는 속도(px/s)
        p.phase = Double.random(in: 0...6.28); p.spin = Double.random(in: -1.2...1.2)
        root.addSublayer(p.layer); parts.append(p)
    }

    /// 크로세트: 큰 별(빨강/초록)이 꼬리를 끌며 퍼지다가 수명이 끝나면 반대 색 별 4개로 십자 분열한다.
    func burst() {
        let cx = Double.random(in: 0.12...0.88) * Double(size.width)
        let cy = Double.random(in: 0.4...0.88) * Double(size.height)
        let n = 12
        for i in 0..<n {
            let p = P(); let d = Double.random(in: 6...8)
            let ang = Double.pi * 2 * Double(i) / Double(n) + Double.random(in: -0.1...0.1), sp = Double.random(in: 100...140)
            p.colorIdx = Int.random(in: 0..<dots.count)   // 별마다 빨강 또는 초록 → 섞임
            p.img = dots[p.colorIdx]; p.layer.contents = p.img
            p.layer.bounds = CGRect(x: 0, y: 0, width: d, height: d)
            p.size = d
            p.x = cx; p.y = cy; p.vx = cos(ang) * sp; p.vy = sin(ang) * sp; p.g = 60; p.drag = 1.5
            p.maxLife = Double.random(in: 0.7...0.85); p.life = p.maxLife
            p.trail = true; p.split = true
            p.layer.position = CGPoint(x: p.x, y: p.y)
            root.addSublayer(p.layer); parts.append(p)
        }
    }

    /// 분열: 부모의 진행 방향을 30% 물려받고 십자(90°) 4방향으로 퍼지는 반대 색 별
    func splitChildren(of p: P) -> [P] {
        let a0 = Double.random(in: 0...(Double.pi * 2)), other = (p.colorIdx + 1) % dots.count
        return (0..<4).map { k in
            let b = a0 + Double(k) * Double.pi / 2
            let q = makeSecondary(from: p, size: Double.random(in: 4...6), life: 0.9,
                                  vx: p.vx * 0.3 + cos(b) * 110, vy: p.vy * 0.3 + sin(b) * 110, g: 60, flicker: false)
            q.colorIdx = other; q.img = dots[other]; q.layer.contents = q.img
            q.drag = 1.6; q.trail = true
            return q
        }
    }

    func makeSecondary(from p: P, size d: Double, life: Double, vx: Double, vy: Double, g: Double, flicker: Bool) -> P {
        let q = P()
        q.img = p.img; q.layer.contents = p.img
        q.layer.bounds = CGRect(x: 0, y: 0, width: d, height: d)
        q.size = d; q.x = p.x; q.y = p.y; q.vx = vx; q.vy = vy; q.g = g; q.drag = 1.0
        q.maxLife = life; q.life = life; q.flicker = flicker
        q.layer.position = CGPoint(x: q.x, y: q.y)
        return q
    }

    func update(dt dtIn: Double) {
        let dt = min(dtIn, 0.1); t += dt
        if parts.isEmpty && emojiQueue.isEmpty && burstsLeft == 0 { return }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        if !emojiQueue.isEmpty {
            emojiAcc += dt * 6
            while emojiAcc >= 1 && !emojiQueue.isEmpty { emojiAcc -= 1; spawnEmoji(emojiQueue.removeFirst()) }
        }
        if burstsLeft > 0 {
            burstAcc += dt * 3.5
            while burstAcc >= 1 && burstsLeft > 0 { burstAcc -= 1; burstsLeft -= 1; burst() }
        }
        var alive: [P] = [], born: [P] = []
        for p in parts {
            if p.emoji {
                p.y -= p.vy * dt
                p.x += sin(t * 1.5 + p.phase) * 25 * dt
                p.layer.position = CGPoint(x: p.x, y: p.y)
                p.layer.transform = CATransform3DMakeRotation(CGFloat(t * p.spin + p.phase), 0, 0, 1)
                if p.y < -60 { p.layer.removeFromSuperlayer(); continue }
                alive.append(p); continue
            }
            p.life -= dt
            if p.life <= 0 {
                if p.split && parts.count + born.count < maxParts { born.append(contentsOf: splitChildren(of: p)) }
                p.layer.removeFromSuperlayer(); continue
            }
            let d = exp(-p.drag * dt)
            p.vx *= d; p.vy = p.vy * d - p.g * dt
            p.x += p.vx * dt; p.y += p.vy * dt
            p.layer.position = CGPoint(x: p.x, y: p.y)
            let total = parts.count + born.count
            if p.trail {                       // 꼬리: 지나온 자리에 작은 점을 남겨 서서히 사라지게
                p.trailAcc += dt
                if p.trailAcc >= 0.06 && total < maxParts {
                    p.trailAcc = 0
                    born.append(makeSecondary(from: p, size: p.size * 0.7, life: 0.35, vx: 0, vy: 0, g: 0, flicker: false))
                }
            }
            if p.sparkle > 0 && total < maxParts && Double.random(in: 0...1) < p.sparkle * dt * 60 {   // 반짝이 가루
                born.append(makeSecondary(from: p, size: Double.random(in: 2...3.5), life: Double.random(in: 0.5...0.9),
                                          vx: Double.random(in: -12...12), vy: Double.random(in: -8...14), g: 70, flicker: true))
            }
            p.layer.opacity = Float(p.life / p.maxLife * (p.flicker ? Double.random(in: 0.5...1) : 1))
            alive.append(p)
        }
        for q in born { root.addSublayer(q.layer) }
        parts = alive + born
        CATransaction.commit()
    }
}

/// 파티클 양 단계 (눈/별가루 생성 속도와 최대 개수에 곱해짐). 기준(기본) = "보통" = 1.0, 높을수록 많아진다.
let fxDensities: [(String, Double)] = [("아주 조금", 0.3), ("조금", 0.6), ("보통", 1.0), ("많이", 1.6), ("아주 많이", 2.4)]
/// 이전 버전(0.1.2 이하)에서 저장된 이름 → 같은 양의 새 이름
let fxDensityLegacy: [String: String] = ["하": "아주 조금", "중하": "조금", "중": "조금", "중상": "보통", "상": "많이"]

final class ScreenFX {
    var windows: [NSWindow] = []
    var snowFields: [SnowField] = []
    var starFields: [SnowField] = []
    var previewUntil = 0.0
    var density = 1.0
    var xmasOn = false
    var xmasFX: [ChristmasFX] = []
    let xmasEmojis: [CGImage]
    let xmasEmojiRepeatable = 1
    let xmasSnowflake: Int
    let xmasDots: [CGImage]
    var snowOn = false, starsOn = false
    var natKind: FallKind? = nil          // clover / leaves / sakura 중 하나 (켜져 있을 때)
    var natFields: [SnowField] = []
    let natImages: [FallKind: [CGImage]], glintImage: CGImage
    var dots: [CGImage]
    var starImages: [CGImage]
    var speckImages: [CGImage]
    var tint: [UInt32]? = nil { didSet { dots = (tint ?? [0xBFE0FF]).map { ScreenFX.makeDot($0) }; (starImages, speckImages) = ScreenFX.makeStars(tint) } }

    init() {
        dots = [ScreenFX.makeDot(0xBFE0FF)]
        (starImages, speckImages) = ScreenFX.makeStars(nil)
        (natImages, glintImage) = ScreenFX.makeNature()
        // 앞의 1개(트리)만 반복 가능, 나머지는 한 번에 하나씩 — xmasEmojiRepeatable 과 맞춰야 함
        // 🫎(무스)는 Unicode 15 이모지라 macOS 13.2 이하에서는 글자가 깨져 보일 수 있다
        let names = ["🎄", "🎅", "🤶", "🎁", "⛄", "🔔", "⭐", "🫎", "🍪", "❄️"]
        xmasEmojis = names.map { ScreenFX.makeEmoji($0) }
        xmasSnowflake = names.firstIndex(of: "❄️")!
        xmasDots = [0xFF3B4E, 0x2EC866].map { ScreenFX.makeDot($0) }
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in self?.rebuild() }
    }

    /// 별가루 이미지: 작은 가루 점 / 빛 구슬 / 5각 별 / 가는 4갈래 반짝이.
    /// stars = 떨어지는 본체(가루 점을 가장 많이 섞음), specks = 꼬리용 작은 가루
    static func makeStars(_ tint: [UInt32]?) -> (stars: [CGImage], specks: [CGImage]) {
        let colors: [UInt32] = tint ?? [0xFFD34D, 0xFFE9A0, 0xFFB3D1, 0xB3F0FF]
        func glow(_ c: CGContext, _ rgb: UInt32, _ r: CGFloat, _ a: CGFloat) {
            let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [hex(rgb).copy(alpha: a)!, hex(rgb).copy(alpha: 0)!] as CFArray, locations: [0, 1])!
            c.drawRadialGradient(g, startCenter: CGPoint(x: 12, y: 12), startRadius: 0, endCenter: CGPoint(x: 12, y: 12), endRadius: r, options: [])
        }
        func poly(_ c: CGContext, _ pts: [(CGFloat, CGFloat)], _ rgb: UInt32) {
            c.setFillColor(hex(rgb)); c.beginPath()
            c.move(to: CGPoint(x: pts[0].0, y: pts[0].1))
            for q in pts.dropFirst() { c.addLine(to: CGPoint(x: q.0, y: q.1)) }
            c.closePath(); c.fillPath()
        }
        var stars: [CGImage] = [], specks: [CGImage] = []
        for rgb in colors {
            let speck = makeImage(24) { c in glow(c, rgb, 4.5, 1) }
            let orb = makeImage(24) { c in glow(c, rgb, 12, 0.85); glow(c, 0xFFFFFF, 3.5, 0.95) }
            let star5 = makeImage(24) { c in
                glow(c, rgb, 12, 0.35)
                var pts: [(CGFloat, CGFloat)] = []
                for i in 0..<10 {
                    let r: CGFloat = i % 2 == 0 ? 9.5 : 4, a = CGFloat.pi / 2 + CGFloat(i) * .pi / 5
                    pts.append((12 + cos(a) * r, 12 + sin(a) * r))
                }
                poly(c, pts, rgb)
            }
            let spark = makeImage(24) { c in
                glow(c, rgb, 8, 0.3)
                poly(c, [(12, 24), (13, 13), (24, 12), (13, 11), (12, 0), (11, 11), (0, 12), (11, 13)], rgb)
            }
            stars += [speck, speck, speck, orb, orb, star5, star5, spark]
            specks.append(speck)
        }
        return (stars, specks)
    }

    /// 자연물 이미지(색상 옵션과 무관, 고유 색): 네잎클로버 / 낙엽(단풍잎·둥근 잎) / 벚꽃잎, 그리고 윤슬용 흰 십자 반짝임
    static func makeNature() -> (images: [FallKind: [CGImage]], glint: CGImage) {
        func glow(_ c: CGContext, _ rgb: UInt32, _ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat, _ a: CGFloat) {
            let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [hex(rgb).copy(alpha: a)!, hex(rgb).copy(alpha: 0)!] as CFArray, locations: [0, 1])!
            c.drawRadialGradient(g, startCenter: CGPoint(x: cx, y: cy), startRadius: 0, endCenter: CGPoint(x: cx, y: cy), endRadius: r, options: [])
        }
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }
        func heart(_ c: CGContext, _ rgb: UInt32) {
            c.setFillColor(hex(rgb)); c.beginPath(); c.move(to: pt(0, -2))
            c.addCurve(to: pt(-9, -14), control1: pt(-4, -5), control2: pt(-10, -7)); c.addCurve(to: pt(0, -14), control1: pt(-8, -19), control2: pt(-2, -19))
            c.addCurve(to: pt(9, -14), control1: pt(2, -19), control2: pt(8, -19)); c.addCurve(to: pt(0, -2), control1: pt(10, -7), control2: pt(4, -5))
            c.closePath(); c.fillPath()
            c.setStrokeColor(CGColor(gray: 1, alpha: 0.35)); c.setLineWidth(1); c.move(to: pt(0, -3)); c.addLine(to: pt(0, -13)); c.strokePath()
        }
        func vein(_ c: CGContext) { c.setStrokeColor(CGColor(srgbRed: 0.31, green: 0.12, blue: 0, alpha: 0.45)); c.setLineWidth(1.2); c.beginPath(); c.move(to: pt(0, 19)); c.addLine(to: pt(0, -10)); c.strokePath() }
        let clovers = [0x34C759, 0x2EA84F, 0x4CD174, 0x8BDB5A, 0x1F8A4C].map { rgb in makeImage(40) { c in
            c.translateBy(x: 20, y: 20)
            for k in 0..<4 { c.saveGState(); c.rotate(by: CGFloat(k) * .pi / 2); heart(c, UInt32(rgb)); c.restoreGState() }
            glow(c, 0xFFFFFF, 0, 0, 4, 0.25)
        } }
        func maple(_ rgb: UInt32) -> CGImage { makeImage(40) { c in
            c.translateBy(x: 20, y: 20); c.setFillColor(hex(rgb)); c.setStrokeColor(hex(rgb)); c.setLineJoin(.round); c.setLineWidth(2.2)
            c.beginPath()
            for i in 0..<10 {
                let r: CGFloat = i % 2 == 0 ? 8 : 16, a = -CGFloat.pi / 2 + CGFloat(i) * .pi / 5
                let p = pt(cos(a) * r, sin(a) * r + 1); if i == 0 { c.move(to: p) } else { c.addLine(to: p) }
            }
            c.closePath(); c.drawPath(using: .fillStroke); vein(c)
        } }
        func oval(_ rgb: UInt32) -> CGImage { makeImage(40) { c in
            c.translateBy(x: 20, y: 20); c.setFillColor(hex(rgb)); c.beginPath(); c.move(to: pt(0, -17))
            c.addCurve(to: pt(0, 15), control1: pt(13, -8), control2: pt(13, 8)); c.addCurve(to: pt(0, -17), control1: pt(-13, 8), control2: pt(-13, -8))
            c.closePath(); c.fillPath(); vein(c)
        } }
        let leaves = [maple(0xE8501A), maple(0xF08A24), maple(0xD9342B), maple(0xF2B233), oval(0xC8741F), oval(0xE8A42A), oval(0xA8501A)]
        let petals = [(0xFF9DBB, 0xFFE3EC), (0xFFB3CB, 0xFFF0F5), (0xFFC2D6, 0xFFFFFF)].map { (a, b) in makeImage(24) { c in
            c.translateBy(x: 12, y: 12); c.setFillColor(hex(UInt32(a))); c.beginPath(); c.move(to: pt(0, 10))
            c.addCurve(to: pt(-2, -11), control1: pt(-9, 4), control2: pt(-8, -9)); c.addLine(to: pt(0, -8)); c.addLine(to: pt(2, -11))
            c.addCurve(to: pt(0, 10), control1: pt(8, -9), control2: pt(9, 4)); c.closePath(); c.fillPath()
            glow(c, UInt32(b), 0, -6, 9, 0.9)
        } }
        let glint = makeImage(32) { c in
            glow(c, 0xFFFFFF, 16, 16, 8, 0.5); c.setFillColor(hex(0xFFFFFF)); c.beginPath()
            let pts = [pt(16, 32), pt(17.2, 17.2), pt(32, 16), pt(17.2, 14.8), pt(16, 0), pt(14.8, 14.8), pt(0, 16), pt(14.8, 17.2)]
            c.move(to: pts[0]); for q in pts.dropFirst() { c.addLine(to: q) }; c.closePath(); c.fillPath()
        }
        let bubbles = [makeImage(32) { c in
            c.translateBy(x: 16, y: 16); glow(c, 0xBEE6FF, 0, 0, 14, 0.22); c.setLineWidth(1.6)
            c.setStrokeColor(CGColor(srgbRed: 0.67, green: 0.86, blue: 1, alpha: 0.85)); c.strokeEllipse(in: CGRect(x: -13, y: -13, width: 26, height: 26))
            c.setStrokeColor(CGColor(srgbRed: 1, green: 0.67, blue: 0.86, alpha: 0.9)); c.beginPath(); c.addArc(center: .zero, radius: 13, startAngle: 0.2, endAngle: 1.4, clockwise: false); c.strokePath()
            c.setStrokeColor(CGColor(srgbRed: 0.78, green: 1, blue: 0.67, alpha: 0.9)); c.beginPath(); c.addArc(center: .zero, radius: 13, startAngle: .pi + 0.2, endAngle: .pi + 1.4, clockwise: false); c.strokePath()
            c.setFillColor(CGColor(gray: 1, alpha: 0.9)); c.fillEllipse(in: CGRect(x: -8.2, y: 4.2, width: 6.4, height: 3.6))
        }]
        let paws = [0x8D6E63, 0xF4A6B8, 0x9AA5B1, 0xFFB74D].map { rgb in makeImage(32) { c in
            c.translateBy(x: 16, y: 16); c.setFillColor(hex(UInt32(rgb)))
            c.fillEllipse(in: CGRect(x: -7.5, y: -10, width: 15, height: 12))
            for (x, y) in [(-8.0, 4.0), (-3.0, 9.0), (3.0, 9.0), (8.0, 4.0)] { c.fillEllipse(in: CGRect(x: x - 3, y: y - 3.8, width: 6, height: 7.6)) }
        } }
        return ([.clover: clovers, .leaves: leaves, .sakura: petals, .bubble: bubbles, .paws: paws], glint)
    }

    static func makeEmoji(_ e: String) -> CGImage {
        makeImage(48) { c in
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(cgContext: c, flipped: false)
            let str = NSAttributedString(string: e, attributes: [.font: NSFont.systemFont(ofSize: 38)])
            let sz = str.size()
            str.draw(at: NSPoint(x: (48 - sz.width) / 2, y: (48 - sz.height) / 2))
            NSGraphicsContext.restoreGraphicsState()
        }
    }

    static func makeDot(_ rgb: UInt32) -> CGImage {
        makeImage(16) { c in
            let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [hex(rgb), hex(rgb).copy(alpha: 0)!] as CFArray, locations: [0, 1])!
            c.drawRadialGradient(g, startCenter: CGPoint(x: 8, y: 8), startRadius: 0, endCenter: CGPoint(x: 8, y: 8), endRadius: 8, options: [])
        }
    }

    static func makeImage(_ size: Int, _ draw: (CGContext) -> Void) -> CGImage {
        let ctx = CGContext(data: nil, width: size * 2, height: size * 2, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.scaleBy(x: 2, y: 2); draw(ctx)
        return ctx.makeImage()!
    }

    static var headless = false   // --menu-test: 화면 창을 만들지 않는다
    func rebuild() {
        windows.forEach { $0.orderOut(nil) }
        windows = []; snowFields = []; starFields = []; natFields = []; xmasFX = []
        guard snowOn || starsOn || natKind != nil || xmasOn, !ScreenFX.headless else { return }
        for sc in NSScreen.screens {
            let w = NSWindow(contentRect: sc.frame, styleMask: .borderless, backing: .buffered, defer: false)
            w.isOpaque = false; w.backgroundColor = .clear; w.hasShadow = false
            w.ignoresMouseEvents = true // 클릭은 그대로 아래 앱으로 통과
            w.level = .screenSaver
            w.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
            w.isReleasedWhenClosed = false
            let v = NSView(frame: NSRect(origin: .zero, size: sc.frame.size)); v.wantsLayer = true
            w.contentView = v
            if snowOn {
                let f = SnowField(size: sc.frame.size, kind: .snow)
                v.layer!.addSublayer(f.root); snowFields.append(f)
            }
            if starsOn {
                let f = SnowField(size: sc.frame.size, kind: .stars)
                v.layer!.addSublayer(f.root); starFields.append(f)
            }
            if let k = natKind {
                let f = SnowField(size: sc.frame.size, kind: k)
                v.layer!.addSublayer(f.root); natFields.append(f)
            }
            if xmasOn {
                let x = ChristmasFX(size: sc.frame.size, emojis: xmasEmojis, repeatable: xmasEmojiRepeatable, snowflake: xmasSnowflake, dots: xmasDots)
                v.layer!.addSublayer(x.root); xmasFX.append(x)
            }
            w.setFrame(sc.frame, display: false); w.orderFrontRegardless()
            windows.append(w)
        }
    }

    func triggerChristmas() { for x in xmasFX { x.trigger() } }

    /// 타자 속도에 비례해 눈 양 조절
    func update(level: Double, idle: Bool, dt: Double) {
        for f in snowFields { f.density = density; f.step(dt: dt, rate: idle ? 0 : lerp(1, 5, level) * density, images: dots) } // 초당 1~5개 생성
        for x in xmasFX { x.update(dt: dt) }
        for f in starFields { f.density = density; f.step(dt: dt, rate: idle ? 0 : lerp(1, 4, level) * density, images: starImages, trail: speckImages, glint: glintImage) }
        for f in natFields {
            f.density = density
            f.step(dt: dt, rate: idle ? 0 : lerp(1, 4, level) * density, images: natImages[f.kind] ?? [])
        }
    }
}

var appRef: App?
func tapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let t = appRef?.tap { CGEvent.tapEnable(tap: t, enable: true) }
    } else if type == .keyDown {
        appRef?.onKey(event)
    }
    return Unmanaged.passUnretained(event)
}

// MARK: - App
final class App: NSObject, NSApplicationDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let tracker = Tracker()
    let fx = ScreenFX()
    let word = WordTrigger()
    // --menu-test: 사용자 설정을 건드리지 않도록 별도 저장소를 쓴다
    let defaults: UserDefaults = CommandLine.arguments.contains("--menu-test") ? UserDefaults(suiteName: "dev.typefall.menutest")! : UserDefaults.standard
    var permItem = NSMenuItem(title: "", action: #selector(openPrivacy), keyEquivalent: "")   // 메뉴를 다시 만들 때마다 새 항목으로 교체
    var xmasOn: Bool { defaults.object(forKey: "xmas") as? Bool ?? true }
    /// 사용자가 지정한 특별 효과 키(물리 키코드). 기본 = 없음
    var specialKey: Int64? { (defaults.object(forKey: "fxSpecialKey") as? Int).map { Int64($0) } }
    var capturingKey = false   // "키 지정"을 누른 뒤 다음 키 하나를 저장
    var tap: CFMachPort?
    var keyCount = 0
    var wasTrusted = false
    var askedOnce = false
    var lastTick = ProcessInfo.processInfo.systemUptime

    /// 개발용: 메뉴를 만들고 항목을 프로그램으로 "클릭"해서, 저장값과 체크 표시가 일치하는지 검사한다.
    func runMenuTest() -> Int32 {
        var fails = 0
        func checked(_ menuTitle: String) -> [String] {
            guard let sub = item.menu?.items.first(where: { $0.title == menuTitle })?.submenu else { return ["<메뉴 없음>"] }
            return sub.items.filter { $0.state == .on }.map { $0.title }
        }
        func click(_ menuTitle: String, _ name: String) {
            guard let sub = item.menu?.items.first(where: { $0.title == menuTitle })?.submenu,
                  let idx = sub.items.firstIndex(where: { $0.title == name }) else { print("항목 없음: \(menuTitle)/\(name)"); fails += 1; return }
            let it = sub.items[idx]   // 실제 클릭과 같은 경로: 항목의 target/action 을 직접 호출
            _ = NSApp.sendAction(it.action!, to: it.target, from: it)
        }
        defaults.removePersistentDomain(forName: "dev.typefall.menutest")
        buildMenu()
        print("초기 파티클 양 체크:", checked("파티클 양"), "(기대: [보통])")
        if checked("파티클 양") != ["보통"] { fails += 1 }
        for name in fxDensities.map({ $0.0 }) + ["보통", "많이", "보통"] {
            click("파티클 양", name)
            let got = checked("파티클 양"), saved = defaults.string(forKey: "fxDensity") ?? "nil"
            let ok = got == [name] && saved == name
            if !ok { fails += 1 }
            print(ok ? "PASS" : "FAIL", "선택=\(name)  저장=\(saved)  체크=\(got)")
        }
        for (title, name) in [("끄기", "끄기"), ("눈", "눈"), ("별가루", "별가루"), ("눈", "눈")] {
            click("화면 효과", title)
            let got = checked("화면 효과"), ok = got == [name]
            if !ok { fails += 1 }
            print(ok ? "PASS" : "FAIL", "화면 효과 선택=\(name)  체크=\(got)")
        }
        let xmasTitle = "크리스마스 효과 (\"크리스마스\" 입력 시)"
        func xmasState() -> NSControl.StateValue? { item.menu?.items.first(where: { $0.title == xmasTitle })?.state }
        for _ in 0..<3 {
            let before = xmasState()
            if let it = item.menu?.items.first(where: { $0.title == xmasTitle }) { _ = NSApp.sendAction(it.action!, to: it.target, from: it) }
            let after = xmasState(), ok = before != nil && after != nil && before != after
            if !ok { fails += 1 }
            print(ok ? "PASS" : "FAIL", "크리스마스 토글  \(before == .on ? "켜짐" : "꺼짐") → \(after == .on ? "켜짐" : "꺼짐")")
        }
        for name in fxTints.map({ $0.0 }) {
            click("효과 색상", name)
            let got = checked("효과 색상"), ok = got == [name]
            if !ok { fails += 1 }
            print(ok ? "PASS" : "FAIL", "색상 선택=\(name)  체크=\(got)")
        }
        defaults.removePersistentDomain(forName: "dev.typefall.menutest")
        print(fails == 0 ? "ALL PASSED" : "\(fails) FAILED")
        return fails == 0 ? 0 : 1
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        if CommandLine.arguments.contains("--menu-test") { setvbuf(stdout, nil, _IONBF, 0); ScreenFX.headless = true; exit(runMenuTest()) }
        applyFx()
        // 처음 실행하면 로그인 시 자동 실행을 켠다(이후 메뉴에서 끄면 존중). 개발용 빌드(/Applications 밖)는 등록하지 않는다.
        if defaults.object(forKey: "loginInit") == nil, Bundle.main.bundlePath.hasPrefix("/Applications") {
            defaults.set(true, forKey: "loginInit")
            try? SMAppService.mainApp.register()
        }
        let previewMode = CommandLine.arguments.first(where: { $0.hasPrefix("--fx-preview") }).map { String($0.dropFirst("--fx-preview".count)).trimmingCharacters(in: CharacterSet(charactersIn: "-")) }
        if let pm = previewMode {   // --fx-preview[-stars|-clover|-leaves|-sakura]: 타자 없이 효과 시연
            fx.snowOn = pm.isEmpty || pm == "snow"; fx.starsOn = pm == "stars"; fx.natKind = FallKind(rawValue: pm).flatMap { $0 == .snow || $0 == .stars ? nil : $0 }
            fx.rebuild()
            fx.previewUntil = ProcessInfo.processInfo.systemUptime + 8
        }
        if CommandLine.arguments.contains("--xmas-preview") {
            fx.xmasOn = true; fx.rebuild()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.fx.triggerChristmas() }
        }
        buildMenu()
        ensureMonitor(prompt: true)
        let t = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(t, forMode: .common)
        let p = Timer(timeInterval: 2, repeats: true) { [weak self] _ in self?.ensureMonitor(prompt: false) }
        RunLoop.main.add(p, forMode: .common)
    }

    // 키 입력 읽기엔 "입력 모니터링"(또는 "손쉬운 사용") 권한이 필요. 나중에 허용해도 재시작 없이 (재)설치한다.
    func ensureMonitor(prompt: Bool) {
        let trusted = CGPreflightListenEventAccess() || AXIsProcessTrusted()
        if !trusted && prompt && !askedOnce {
            askedOnce = true
            _ = CGRequestListenEventAccess()
            _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        }
        permItem.title = trusted ? "✓ 입력 모니터링 권한 있음" : "⚠︎ 권한 필요 — 입력 모니터링 열기…"
        permItem.action = trusted ? nil : #selector(openPrivacy)
        if trusted && !wasTrusted, let t = tap { CGEvent.tapEnable(tap: t, enable: false); tap = nil }
        wasTrusted = trusted
        if trusted && tap == nil {
            // 읽기 전용 이벤트 탭: 키 "내용"은 읽지 않고 입력 횟수만 센다
            appRef = self
            if let t = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                                         eventsOfInterest: CGEventMask(1 << CGEventType.keyDown.rawValue),
                                         callback: tapCallback, userInfo: nil) {
                tap = t
                let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, t, 0)
                CFRunLoopAddSource(CFRunLoopGetMain(), src, .commonModes)
                CGEvent.tapEnable(tap: t, enable: true)
            }
        }
    }

    func onKey(_ e: CGEvent) {
        keyCount += 1
        if e.getIntegerValueField(.keyboardEventAutorepeat) != 0 { return }
        if e.flags.contains(.maskCommand) || e.flags.contains(.maskControl) { return }
        let code = e.getIntegerValueField(.keyboardEventKeycode)
        if capturingKey {   // 키 지정 모드: 이 키를 저장하고 끝 (효과는 내지 않음). 표시용 글자만 함께 저장
            capturingKey = false
            let label = NSEvent(cgEvent: e)?.charactersIgnoringModifiers?.uppercased().trimmingCharacters(in: .whitespaces) ?? ""
            defaults.set(Int(code), forKey: "fxSpecialKey"); defaults.set(label.isEmpty ? "#\(code)" : label, forKey: "fxSpecialKeyLabel")
            DispatchQueue.main.async { [weak self] in self?.applyFx(); self?.buildMenu() }
            return
        }
        tracker.hit(ProcessInfo.processInfo.systemUptime)
        if let sk = specialKey, code == sk { fx.triggerChristmas() }
        // 크리스마스 단어 감지: 켜져 있을 때만, 키 위치의 진행 상태만 본다 (내용은 저장하지 않음)
        if xmasOn, word.feed(e.getIntegerValueField(.keyboardEventKeycode)) { fx.triggerChristmas() }
    }

    func tick() {
        let now = ProcessInfo.processInfo.systemUptime
        _ = tracker.update(now)
        let dt = now - lastTick; lastTick = now
        if fx.previewUntil > now {            // 미리보기: 타자 없이 효과 시연
            fx.update(level: 0.8, idle: false, dt: dt)
        } else {
            if fx.previewUntil > 0 { fx.previewUntil = 0; applyFx() } // 미리보기 종료 → 저장된 설정 복귀
            fx.update(level: tracker.level, idle: tracker.idle, dt: dt)
        }
    }

    /// 화면 효과는 off / snow / stars 중 하나만. (이전 버전의 fxSnow/fxStars 설정이 있으면 한 번 변환)
    var fxMode: String {
        if let m = defaults.string(forKey: "fxMode") { return m }
        return defaults.bool(forKey: "fxStars") ? "stars" : (defaults.bool(forKey: "fxSnow") ? "snow" : "off")
    }
    /// 저장된 파티클 양 이름 (예전 이름이면 새 이름으로 변환)
    var densityName: String {
        let raw = defaults.string(forKey: "fxDensity") ?? "보통"
        return fxDensityLegacy[raw] ?? raw
    }
    func applyFx() {
        let m = fxMode
        let wantSnow = m == "snow", wantStars = m == "stars", wantXmas = xmasOn || specialKey != nil   // 특별 효과 키가 있으면 폭죽 레이어가 필요
        let wantNat: FallKind? = FallKind(rawValue: m).flatMap { $0 == .snow || $0 == .stars ? nil : $0 }
        let structureChanged = fx.snowOn != wantSnow || fx.starsOn != wantStars || fx.xmasOn != wantXmas || fx.natKind != wantNat
        fx.snowOn = wantSnow; fx.starsOn = wantStars; fx.xmasOn = wantXmas; fx.natKind = wantNat
        if !xmasOn { word.reset() }
        let name = defaults.string(forKey: "fxTint") ?? "기본"
        fx.tint = fxTints.first(where: { $0.0 == name })?.1
        let den = densityName
        fx.density = fxDensities.first(where: { $0.0 == den })?.1 ?? 1.0
        if structureChanged { fx.rebuild() }   // 색상·파티클 양은 즉시 반영만 하고 입자는 유지
        updateIcon()
    }
    func updateIcon() {
        let sym = ["snow": "snowflake", "stars": "sparkles", "clover": "leaf", "leaves": "leaf.fill", "sakura": "camera.macro", "bubble": "circle.dotted", "paws": "pawprint"][fxMode] ?? "moon.zzz"
        // 메뉴바 높이(약 24pt) 안에서 낼 수 있는 가장 큰 크기로 그린다
        let cfg = NSImage.SymbolConfiguration(pointSize: 22, weight: .regular)
        let img = NSImage(systemSymbolName: sym, accessibilityDescription: "Typefall")?.withSymbolConfiguration(cfg)
        img?.isTemplate = true
        item.button?.image = img
    }

    func buildMenu() {
        let m = NSMenu()
        let ver = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
        let verItem = NSMenuItem(title: "Typefall \(ver)", action: nil, keyEquivalent: "")
        verItem.isEnabled = false
        m.addItem(verItem)
        m.addItem(.separator())
        let fxMenu = NSMenu()
        let curFx = fxMode
        for (key, title) in [("off", "끄기"), ("snow", "눈"), ("stars", "별가루"), ("clover", "네잎클로버"), ("leaves", "낙엽"), ("sakura", "벚꽃"), ("bubble", "비눗방울"), ("paws", "고양이 발자국")] { // 하나만 선택 가능
            let i = NSMenuItem(title: title, action: #selector(pickFxMode(_:)), keyEquivalent: "")
            i.target = self; i.representedObject = key; i.state = key == curFx ? .on : .off
            fxMenu.addItem(i)
        }
        let fxItem = NSMenuItem(title: "화면 효과", action: nil, keyEquivalent: ""); fxItem.submenu = fxMenu
        m.addItem(fxItem)

        let tintMenu = NSMenu()
        let curTint = defaults.string(forKey: "fxTint") ?? "기본"
        for (name, _) in fxTints {
            let i = NSMenuItem(title: name, action: #selector(pickTint(_:)), keyEquivalent: "")
            i.target = self; i.representedObject = name; i.state = name == curTint ? .on : .off
            tintMenu.addItem(i)
        }
        let tintItem = NSMenuItem(title: "효과 색상", action: nil, keyEquivalent: ""); tintItem.submenu = tintMenu
        m.addItem(tintItem)

        let xm = NSMenuItem(title: "크리스마스 효과 (\"크리스마스\" 입력 시)", action: #selector(toggleXmas(_:)), keyEquivalent: "")
        xm.target = self; xm.state = xmasOn ? .on : .off
        m.addItem(xm)
        let xp = NSMenuItem(title: "크리스마스 효과 미리보기", action: #selector(previewXmas), keyEquivalent: "")
        xp.target = self
        m.addItem(xp)
        let keyMenu = NSMenu()
        let setKey = NSMenuItem(title: capturingKey ? "지정할 키를 누르세요…" : "키 지정… (다음에 누르는 키)", action: #selector(startCaptureKey), keyEquivalent: "")
        setKey.target = self; keyMenu.addItem(setKey)
        let clearKey = NSMenuItem(title: "지정 해제", action: specialKey == nil ? nil : #selector(clearSpecialKey), keyEquivalent: "")
        clearKey.target = self; keyMenu.addItem(clearKey)
        let keyItem = NSMenuItem(title: "특별 효과 키: \(specialKey == nil ? "없음" : (defaults.string(forKey: "fxSpecialKeyLabel") ?? "?"))", action: nil, keyEquivalent: "")
        keyItem.submenu = keyMenu
        m.addItem(keyItem)
        m.addItem(.separator())
        let denMenu = NSMenu()
        let curDen = densityName
        for (name, _) in fxDensities {
            let i = NSMenuItem(title: name, action: #selector(pickDensity(_:)), keyEquivalent: "")
            i.target = self; i.representedObject = name; i.state = name == curDen ? .on : .off
            denMenu.addItem(i)
        }
        let denItem = NSMenuItem(title: "파티클 양", action: nil, keyEquivalent: ""); denItem.submenu = denMenu
        m.addItem(denItem)
        m.addItem(.separator())
        let lg = NSMenuItem(title: "로그인 시 자동 실행", action: #selector(toggleLogin(_:)), keyEquivalent: "")
        lg.target = self; lg.state = loginOn ? .on : .off
        m.addItem(lg)
        // 같은 NSMenuItem 을 새 메뉴에 또 넣으면 예외가 나서 메뉴가 갱신되지 않는다(체크 표시가 옛 값으로 남던 버그) → 항상 새로 만든다.
        let perm = NSMenuItem(title: permItem.title, action: permItem.action, keyEquivalent: "")
        perm.target = self
        permItem = perm
        m.addItem(permItem)
        m.addItem(.separator())
        m.addItem(NSMenuItem(title: "종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        item.menu = m
    }

    @objc func pickFxMode(_ s: NSMenuItem) {
        defaults.set(s.representedObject as? String, forKey: "fxMode")
        applyFx(); buildMenu()
    }
    @objc func pickTint(_ s: NSMenuItem) {
        defaults.set(s.representedObject as? String, forKey: "fxTint")
        applyFx(); buildMenu()
    }
    var loginOn: Bool { SMAppService.mainApp.status == .enabled }
    @objc func toggleLogin(_ s: NSMenuItem) {
        do { if loginOn { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() } }
        catch { NSLog("Typefall: 로그인 항목 변경 실패 \(error.localizedDescription)") }
        buildMenu()
    }
    @objc func toggleXmas(_ s: NSMenuItem) {
        defaults.set(!xmasOn, forKey: "xmas")
        applyFx(); buildMenu()
    }
    @objc func startCaptureKey() { capturingKey = true; buildMenu() }
    @objc func clearSpecialKey() {
        capturingKey = false
        defaults.removeObject(forKey: "fxSpecialKey"); defaults.removeObject(forKey: "fxSpecialKeyLabel")
        applyFx(); buildMenu()
    }
    @objc func previewXmas() {
        if !fx.xmasOn { fx.xmasOn = true; fx.rebuild() }
        fx.triggerChristmas()
    }
    @objc func pickDensity(_ s: NSMenuItem) {
        defaults.set(s.representedObject as? String, forKey: "fxDensity")
        applyFx(); buildMenu()
    }
    @objc func openPrivacy() {
        _ = CGRequestListenEventAccess() // 요청해야 설정 목록에 Typefall이 나타난다
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")!)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // Dock 아이콘 없음
let delegate = App()
app.delegate = delegate
app.run()
