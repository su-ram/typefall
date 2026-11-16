# ❄️ Typefall

타자를 치면 **화면 전체에 눈, 별가루, 크리스마스 폭죽이 내리는** 작은 앱입니다.
*Snow, stardust and Christmas fireworks that fall across your screen while you type.*

- **눈 / 별가루 / 네잎클로버 / 낙엽 / 벚꽃 / 비눗방울 / 고양이 발자국 / 지폐 / 체리 / 스포츠 공(농구·럭비·야구·테니스) / 패스트푸드(햄버거·피자·감자튀김·콜라) / 종이비행기** — 위에서 아래로 떨어집니다. 타자가 빠를수록 더 많이 내리고, 멈추면 새로 생기지 않습니다. 별가루는 윤슬처럼 가끔 반짝입니다. (클로버부터 종이비행기까지는 고유 색이라 효과 색상과 무관. 비눗방울은 떠다니다 터집니다)
- **효과 색상** — 기본 + 파스텔 6가지(핑크, 민트, 라벤더, 피치, 노랑, 스카이) + **레인보우**(파스텔 6색을 입자마다 섞어서)
- **파티클 양** — 조금 / 보통(기본) / 많이
- **특별 효과 키** *(기본: 없음)* — 메뉴에서 "키 지정"을 누른 뒤 원하는 키를 누르면, 그 키를 칠 때마다 특별 효과가 터집니다. 해제도 메뉴에서.
- **특별 효과** *(기본 켜짐, 메뉴에서 끌 수 있음)* — "크리스마스" 또는 "christmas"를 입력하면 빨강·초록 폭죽과 이모지가 쏟아집니다.

## 설치

### macOS (Homebrew)
```bash
brew install --cask su-ram/typefall/typefall
open -a Typefall
```
처음 실행하면 **시스템 설정 → 개인정보 보호 및 보안 → 입력 모니터링**에서 Typefall을 켜 주세요.
요구 사항: macOS 13 이상 (Apple Silicon / Intel).

### Chrome 확장
`chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램을 로드" → `chrome/` 폴더 선택.
(웹 스토어 등록 예정)

### Windows
`windows/` 폴더의 Electron 앱입니다 (같은 효과 엔진 `shared/typefall-core.js` 사용, 어느 앱에서 쳐도 화면 전체에 효과가 나옵니다).
설치 파일은 GitHub Actions가 빌드합니다 → [Releases](https://github.com/su-ram/typefall/releases) *(준비 중)*.

```bash
cd windows
npm install
npm test          # 키 매핑·단어 감지 테스트
npm start         # 실행 (트레이 아이콘에서 설정)
npm run dist      # Windows 설치 파일 (Windows에서)
```

## 개인정보

- 키 **내용**은 읽거나 저장하지 않으며, 네트워크로 아무것도 전송하지 않습니다. 앱은 입력 **횟수**만 셉니다.
- 특별 효과(기본 켜짐)는 해당 단어의 **키 순서를 어디까지 눌렀는지(진행 상태)** 만 메모리에서 확인합니다. 입력한 글자를 저장하지 않으며, 끄면 키 내용을 아예 보지 않습니다.
- Chrome 확장은 비밀번호 입력창에서는 아무것도 하지 않고, iframe의 키 코드를 상위 페이지로 전달하지 않습니다.
- 맥·Windows 데스크톱 앱은 어느 앱에서 입력하든 감지하므로 **비밀번호 입력창에서 친 키도 횟수로는 계산됩니다**(내용은 읽지 않음). 특별 효과는 기본 켜짐이며, 메뉴에서 끄면 키 내용을 아예 보지 않습니다.
- 맥 앱은 읽기 전용 이벤트 탭(`CGEventTap`, listen-only)을 사용합니다. 코드는 모두 이 저장소에 있습니다.

## 소스에서 빌드 (macOS)

```bash
cd macos
./build.sh          # build/Typefall.app (유니버설)
./package.sh 0.1.0  # dist/Typefall-0.1.0.zip + sha256
```

> 릴리스 빌드는 ad-hoc 서명이며 Apple 공증을 받지 않았습니다. 공증 빌드는 추후 제공 예정입니다.

## 구조

| 폴더 | 내용 |
|---|---|
| `macos/` | 메뉴바 앱 (Swift, AppKit + Core Animation) |
| `chrome/` | Chrome 확장 (MV3) |
| `windows/` | Windows(Electron) 데스크톱 앱 — 트레이, 전역 키 감지(uiohook), 화면별 투명 오버레이 |
| `shared/typefall-core.js` | 효과 엔진 (캔버스 2D, 의존성 없음) — Chrome 확장과 향후 Windows 앱이 공유 |
| `tools/` | 아이콘 생성기, 엔진 테스트 (`node tools/test-core.js`) |

## 라이선스

[MIT](LICENSE)
