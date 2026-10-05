# 출시 가이드

코드 쪽 준비(앱 포장, 아이콘, 스플래시, 스크린샷, 개인정보 처리방침, 자동 빌드)는 끝나 있어요. 남은 건 **본인 명의 계정과 결제가 필요한 일**이에요.

## 한눈에 보기

| 단계 | 비용 | 기간 | 누가 |
|---|---|---|---|
| 0. 웹 링크 + 안드로이드 테스트 설치 | 무료 | 오늘 | 설정 버튼 하나 |
| 1. 이름 확정, 앱 ID 확정 | 무료 | 하루 | 본인 |
| 2. Google Play | 25달러 (한 번) | **최소 3주** (14일 비공개 테스트 의무) | 본인 |
| 3. App Store | 99달러 / 년 | 1~2주 (심사 보통 1~3일) | 본인 + Mac |
| 4. 앱인토스 (토스 미니앱) | 무료 | 스토어 출시 뒤 (등급 증빙 필요) | 만 19세 이상 본인 |

추천 순서: **0 → 1 → 2와 3을 동시에 → 4.** Google Play는 14일 테스트 기간이 있어서 먼저 시작해두는 게 좋아요. 앱인토스는 게임 등급 증빙으로 스토어에 출시된 페이지가 필요해서 마지막이에요.

---

## 0. 지금 바로: 친구들에게 돌려보기

### 웹 링크 (무료, GitHub Pages)

1. GitHub 저장소 → **Settings → Pages**
2. **Source**를 `GitHub Actions`로 바꾸기
3. **Actions** 탭 → `Web` → `Run workflow`

몇 분 뒤 `https://di258294-lang.github.io/-1-/` 에서 게임이 열려요. 같은 곳에 스토어 제출에 필요한 페이지도 올라가요.

- 개인정보 처리방침: `https://di258294-lang.github.io/-1-/privacy.html`
- 고객 지원: `https://di258294-lang.github.io/-1-/support.html`

### 안드로이드 폰에 설치 (무료)

코드를 푸시할 때마다 GitHub가 테스트를 돌리고 설치 파일(APK)을 자동으로 만들어요. 항상 같은 링크에 최신 파일이 올라가요.

1. 폰에서 `https://github.com/di258294-lang/-1-/releases/download/android-test/hold.apk` 열기
   (또는 **Actions** 탭 → `Android` → 최근 실행 → **Artifacts**의 `hold-apk`)
2. "출처를 알 수 없는 앱 설치" 허용 → 설치. 빌드마다 버전 번호(versionCode)가 올라가서 이전 테스트 버전 위에 그대로 덮어 설치돼요.

이건 테스트용이에요. 스토어에는 서명된 파일(AAB)을 따로 올려요 (아래 2단계).

---

## 1. 이름과 앱 ID 확정 (스토어 등록 전에 꼭)

**앱 이름.** "HOLD"는 임시 이름이에요.
- [KIPRIS](https://www.kipris.or.kr)에서 상표 검색 (9류 앱, 41류 게임)
- 앱스토어, 플레이스토어에서 같은 이름 검색
- 스토어 표시 이름은 검색어를 붙여도 돼요. 예: `HOLD: 40초 매매 습관 게임`

**앱 ID.** 지금은 `com.holdgame.app`이에요. **스토어에 한 번 올리면 영원히 못 바꿔요.** 바꾸려면 세 군데를 같이 고쳐요.
- `capacitor.config.ts` → `appId`
- `android/app/build.gradle` → `namespace`, `applicationId`
- Xcode → App 타깃 → Signing & Capabilities → Bundle Identifier

---

## 2. Google Play

### 계정
1. [Play Console](https://play.google.com/console) 가입, 등록비 25달러 (한 번). **계정 소유자는 만 18세 이상이어야 해요.** 미성년자라면 보호자 명의로 만들어야 해요.
2. 개인 계정 신원 확인 (신분증)

### 서명된 파일 만들기 (Android Studio 필요, Windows/Mac 다 됨)
1. `npm install && npm run cap:sync`
2. `npx cap open android` → Android Studio가 열려요
3. **Build → Generate Signed App Bundle / APK → Android App Bundle**
4. 키 저장소(keystore) 새로 만들기. **이 파일과 비밀번호는 잃어버리면 업데이트를 못 올려요.** 저장소에 올리지 말고 따로 백업하세요.
5. `release` 선택 → `app-release.aab` 생성

### 비공개 테스트 (개인 계정 필수 조건)
2023년 11월 이후 만든 개인 계정은 **12명 이상이 14일 연속 참여한 비공개 테스트**를 거쳐야 프로덕션 출시를 신청할 수 있어요. 시계는 12번째 테스터가 참여한 날부터 시작해요.
1. **테스트 → 비공개 테스트** 트랙 만들기 → AAB 업로드
2. 테스터 이메일 목록 등록 (지인 12명 이상, 여유 있게 15명 추천)
3. 참여 링크 공유 → 각자 폰에서 설치
4. 14일 뒤 **대시보드 → 프로덕션 액세스 신청**

### 스토어 등록정보
아래 [등록 문구](#스토어-등록-문구)를 그대로 쓰면 돼요.
- 앱 아이콘 512×512: `store/android/icon-512.png`
- 그래픽 이미지 1024×500: `store/play/feature-graphic.png`
- 휴대전화 스크린샷 1080×1920: `store/play/1-hold.png` ~ `6-challenge.png` (캡션·가상 표기 포함)
- 만드는 법은 [출시 이미지 체크리스트](#출시-이미지-체크리스트)

### 정책 설문 답변
| 항목 | 답 |
|---|---|
| 개인정보처리방침 URL | `https://di258294-lang.github.io/-1-/privacy.html` |
| 광고 포함 | 아니요 |
| 앱 액세스 권한 | 모든 기능을 제한 없이 이용 가능 |
| 데이터 보안 | 데이터를 수집하거나 공유하지 않음 |
| 대상 연령 | 13세 이상 (아동 대상 정책을 피하려면 13 미만은 체크하지 않기) |
| 콘텐츠 등급 (IARC) | 카테고리 "게임". 폭력, 선정성, 언어, 약물 모두 없음. 실제 돈으로 하는 도박 없음. 사용자 간 소통 없음 |
| 금융 기능 | 금융 서비스 제공 안 함 (가상 금액 게임) |
| 정부 앱 / 뉴스 앱 | 아니요 |

---

## 3. App Store

### 계정
1. [Apple Developer Program](https://developer.apple.com/programs/) 가입, 99달러/년 (개인으로 가입하면 D-U-N-S 번호 불필요)

### 빌드 (Mac + Xcode 필요)
Mac이 없다면 클라우드 Mac 빌드 서비스(Codemagic 등)를 쓸 수 있어요. 필요해지면 설정을 추가할게요.

1. `npm install && npm run cap:sync`
2. `npx cap open ios` → Xcode가 열려요
3. App 타깃 → **Signing & Capabilities** → Team에 본인 계정 선택
4. 상단 기기를 `Any iOS Device`로 → **Product → Archive**
5. **Distribute App → App Store Connect → Upload**

### TestFlight로 먼저 테스트
App Store Connect → TestFlight → 내부 테스터 추가. 심사 없이 바로 지인 폰에 설치돼요.

### 스토어 등록
| 항목 | 값 |
|---|---|
| 카테고리 | 게임 → 시뮬레이션 (보조: 퍼즐) |
| 스크린샷 6.9" (1320×2868) | `store/appstore/1-hold.png` ~ `6-challenge.png` (`npm run store-shots`) |
| 개인정보 처리방침 URL | `https://di258294-lang.github.io/-1-/privacy.html` |
| 지원 URL | `https://di258294-lang.github.io/-1-/support.html` |
| 앱 개인정보 보호 | **데이터를 수집하지 않음** |
| 연령 등급 | 모든 항목 "없음". 시뮬레이션 도박: 없음 (주식 타이밍 게임, 베팅/확률 보상 없음) → 4+ 예상 |
| 가격 | 무료 |
| 출시 국가 | 처음엔 **대한민국만** 추천 (EU 출시는 판매자 신원 표시 의무가 추가로 생겨요) |

### 심사 메모 (App Review Information → Notes)
> HOLD is a single-player timing game. Press and hold the pad to hold a fictional stock, release to sell. All companies, prices and news are generated and fictional; no real money, no purchases, no ads, no accounts, no data collection. The game runs fully offline and uses native haptics. A daily chart (same for every player) plus an unlimited practice mode are available from the home screen.

---

## 4. 앱인토스 (토스 미니앱)

같은 게임을 토스 앱 안의 미니앱으로도 낼 수 있어요. 코드는 준비돼 있어요 (`src/platform/toss.ts`, `apps-in-toss.config.ts`). 웹·앱 빌드에는 토스 SDK가 들어가지 않아요.

### 먼저 확인할 것 (막히기 쉬운 순서)
1. **만 19세 이상 본인이 워크스페이스를 만들어야 해요.** 만 19세 미만은 워크스페이스를 만들 수 없고 초대만 받을 수 있어요. 콘솔 QR 테스트도 만 19세 이상, 워크스페이스 멤버, 토스 로그인 상태여야 열려요.
2. **정책 리스크: 주식·코인·레버리지 소재.** 앱인토스는 가상자산, 증권 등 금융 상품, 투자 자문·종목 추천 서비스를 출시 불가로 정해두고 있어요. HOLD는 가상 회사·가상 금액의 타이밍 게임이고 투자 권유가 아니지만, 소재 때문에 반려될 수 있어요. **제출 전에 채널톡으로 "가상 주식 차트 타이밍 게임(실제 금융 상품·시세·종목 추천 없음)"이 가능한지 먼저 문의**하고 답을 받아두세요. 필요하면 토스 빌드에서만 코인 상품을 빼는 것도 방법이에요.
3. **게임 등급 증빙이 필수예요.** 둘 중 하나:
   - 스토어(구글 플레이·앱스토어)에 **실제로 출시된** 게임 페이지 URL + 게임물관리위원회 '자체등급분류 게임물 조회'에서 찾은 등록자명·등급분류번호·일자·이용등급·내용정보, 스토어판/토스판 플레이 화면 각 2장, 대표자 서명 이미지. **스토어 등록자명(구글: 개발자명, 애플: 제공자명)이 토스 워크스페이스의 사업자/본인 이름과 같아야** 해요. 다르면 반려돼요.
   - 또는 게임물관리위원회(GRAC)에서 직접 받은 등급분류 증명서 PDF.
4. **라이트 모드만.** 토스는 다크 모드를 지원하지 않아서 토스 빌드는 항상 밝은 테마로 떠요 (`toss.ts`가 `data-theme="light"` 고정).

### 이름 (확정)
- 앱 이름 **`홀드`**, 영어 이름 **`HOLD Timing`**, 부제 `누르는 동안만 버티는 40초 타이밍 게임`.
- "HOLD" 단독은 안 돼요. 영어 이름은 15자 이하이고 흔한 단어 하나만으로는 반려돼요 (LAUNCH.md "바뀐 사실").
- **`.env.toss`의 `VITE_AIT_APP_NAME`은 콘솔에 등록한 `holdtime`이에요 (2026-10-05 등록, 바꿀 수 없음).** 공유 링크(`intoss://<appName>`)와 `.ait` 파일 이름에 쓰여요. 비어 있거나 TODO면 빌드가 멈춰요.

### 콘솔에 올릴 이미지
| 항목 | 규격 | 파일 |
|---|---|---|
| 로고 | 600×600 PNG, 각진 정사각형 (둥근 모서리 금지) | `store/toss/logo-600.png` (`assets/icon-only.png`를 줄인 것) |
| 썸네일 (가로형 대표 이미지) | 1932×828 PNG | `store/toss/thumbnail.png` |
| 스크린샷 (세로형) | 636×1048 PNG, **최소 3장** | `store/toss/screenshot-1.png` ~ `3.png` |
| OG 이미지 | 1200×600 PNG | `store/toss/og.png` |

앱 이름과 아이콘은 콘솔에서 관리해요 (SDK 3.x부터 설정 파일에는 없어요). 모든 이미지는 `npm run store-shots`로 만들어요.

### 설정 (SDK 3.x)
- `@apps-in-toss/web-framework` 3.x, 설정 파일은 `apps-in-toss.config.ts` (`granite.config.ts`는 2.x 방식이라 쓰지 않아요). `ait init`, `ait migrate`는 package.json 스크립트를 덮어쓰니 실행하지 마세요.
- `.env.toss`의 `VITE_AIT_APP_NAME`을 콘솔에 등록한 appName으로 바꿔요. 공유 링크(`intoss://<appName>`)와 `.ait` 파일 이름에 쓰여요.
- 게임이라 네비게이션 바는 투명(`transparentBackground: true`)이고, 오른쪽 위 더보기/닫기 버튼 자리를 비워뒀어요 (`styles.css` 끝의 `.toss` 규칙). QR 테스트에서 겹치지 않는지 꼭 확인하세요.
- 바운스, 당겨서 새로고침, iOS 스와이프 뒤로가기는 꺼져 있어요. 안드로이드 뒤로가기는 게임이 직접 처리해요 (화면 뒤로 → 홈에서는 종료 확인).

### 빌드와 배포
```bash
npm run dev:toss      # 브라우저에서 토스 SDK 목업 + AIT Devtools 패널로 테스트
npm run build:toss    # 타입체크 + dist-toss/ 빌드 + <appName>.ait 생성
npx ait token add     # 처음 한 번: 콘솔에서 발급한 배포 키 등록
npm run deploy:toss   # .ait 업로드 → 콘솔에서 QR로 토스 앱 테스트 → 검수 요청
```
SDK 3.x로 한 번 출시하면 2.x로 되돌릴 수 없어요. QR 테스트를 충분히 한 뒤 출시하세요.

### 게임 리더보드 (콘솔 설정 필요)
토스 빌드는 오늘의 차트를 끝낼 때마다 점수 하나를 토스 게임센터 리더보드에 보내고, 결과 화면과 내 기록에 **순위 보기**를 보여줘요 (`src/ui/leaderboard.ts`, `Game.setLeaderboardScore` / `Game.openLeaderboard`, 설치된 SDK 3.7.0에 있어요). 웹·앱 빌드에는 없어요.

- **점수 = 그냥 들고 있기보다 앞선 만큼(bp, 정수).** `round((내 수익률 − 그냥 들고 있기) × 10,000)`. 시장보다 3.21%p 앞서면 `321`, 0.5%p 뒤지면 `-50` (`src/core/reach.ts` `leaderboardScore`).
- 콘솔 → 미니앱 → **미니앱 정보 → 리더보드 (게임 앱)** 에서 정책을 정해요.
  1. 정렬: **높은 점수가 위** (내림차순).
  2. 점수 단위: `점` (1점 = 0.01%p). 소수점 없이 정수로 보내요.
  3. 집계 기간을 고를 수 있으면 **매일 초기화**(오늘의 차트와 같은 날 기준)를 골라 주세요. 선택지가 없으면 그대로 두세요.
  4. 같은 사람이 여러 번 보내면 무엇을 남길지 고를 수 있으면 **최고 점수**. 오늘의 차트는 하루 한 번이라 하루에 한 번만 보내요.
- 리더보드는 **게임 카테고리 미니앱에서만**, **미니앱 정보 승인 뒤에만** 돼요. 승인 전에는 `LEADERBOARD_NOT_FOUND`가 나고 게임은 조용히 넘어가요 (승인은 영업일 1~2일, 채널톡으로 당길 수 있어요).
- 리더보드는 미니앱당 하나예요. 연습·다시 보기·친구 도전 판은 보내지 않아요.
- **순위에 보상을 걸지 않아요.** 토스 포인트·프로모션·게임 안의 무엇도 순위와 엮지 마세요 (토스 정책, `docs/LAUNCH.md`).
- QR 테스트에서 확인할 것 (기기에서만 돼요): ① 오늘의 차트를 끝내면 점수가 들어가는지, ② **음수 점수가 들어가는지** (문서에 음수 허용 여부가 없어요. `UNPARSABLE_SCORE`로 거절되면 알려 주세요), ③ 순위 보기를 누르면 리더보드가 열리고 닫으면 게임으로 돌아오는지, ④ 게임 프로필이 없는 첫 사용자: 점수가 `PROFILE_NOT_FOUND`로 거절되면 순위 보기를 연 뒤 한 번 더 보내요. 샌드박스 점수는 실제 리더보드에 안 남아요.

### 리뷰 요청
토스 빌드도 앱처럼 조건이 맞을 때 한 번 `Review.request`를 불러요 (아래 "알림과 리뷰 요청" 참고). 화면이 뜰지는 토스가 정하고, 결과는 게임에 알려주지 않아요. 별도 콘솔 설정은 없고, 리뷰는 콘솔 **평점 및 리뷰**에서 봐요.

### 토스 푸시알림은 쓰지 않아요
"오늘의 차트가 열렸어요" 알림을 토스에서는 보내지 않아요. 토스 푸시알림은 콘솔 템플릿 검수를 받은 **기능성 메시지만** 되고, 가이드가 "서비스 이용 유도·리텐션 목적"을 금지해요. 같은 가이드가 정기 발송 예로 "출석 알림"을 들긴 하지만, 매일 열리는 차트를 알리는 건 리텐션 목적으로 볼 여지가 커서 반려 위험이 있어요. 또 사용자가 시간을 고르거나 게임 안에서 끌 수 없어요. 나중에 하려면 채널톡으로 먼저 문의하고, 콘솔 → 푸시알림 → 토스에게 발송 요청(정기 발송) + 알림 동의문 + `Notification.requestAgreement`로 붙이면 돼요.

---

## 게임 등급 (한국)

애플과 구글은 정부가 지정한 **자체등급분류사업자**예요. 스토어 설문으로 받은 등급이 그대로 인정돼서 게임물관리위원회에 따로 신청할 필요 없어요. 단, 같은 게임을 스토어가 아닌 다른 플랫폼(예: 앱인토스, 자체 웹사이트에서 정식 서비스)에 유통하면 그때 게임물 정보를 따로 전달해야 해요. 앱인토스는 위 4단계처럼 스토어 등급 정보를 콘솔에 입력하는 방식이에요.

---

## 스토어 등록 문구

**앱 이름** (30자 이내)
```
HOLD: 40초 매매 습관 게임
```

**부제 / 간단한 설명**
- App Store 부제 (30자): `누르는 동안만 사는 주식 타이밍 게임`
- Google Play 간단한 설명 (80자): `손가락을 대면 사고, 떼면 팔아요. 40초 만에 내 매매 습관이 드러나는 주식 타이밍 게임.`

**키워드** (App Store, 100자, 쉼표로 구분, 띄어쓰기 없이)
```
주식,모의투자,주식게임,채권,금,코인,레버리지,차트,타이밍,투자습관,존버,단타,재테크,경제공부
```

**설명**
```
누르고 있는 동안만 주식을 들고 있어요.
손가락을 대면 사고, 떼면 팔아요. 조작은 그게 전부예요.

■ 매일 하나의 차트
한국 시간 0시마다 새 차트가 열려요. 모두가 같은 차트로, 하루 한 번만.
결과는 한 달 동안 시즌 계좌에 그대로 쌓여요. 어제 잃은 건 오늘도 아파요.

■ 40초 만에 드러나는 매매 습관
판이 끝나면 내가 실제로 어떻게 움직였는지 숫자로 알려줘요.
"손실 난 매매는 평균 5.6초, 수익 난 매매는 1.2초 들고 있었어요."
5판을 하면 내 성향이 나와요.
존버형, 새가슴 익절형, 단타 중독형, 추격 매수형, 지라시 추종형, 냉정한 기계형.

■ 주식, 채권, 금, 코인, 레버리지 2배
요일마다 오늘의 차트 상품이 바뀌어요.
채권은 금리 뉴스에 반대로, 금은 위기 때 오르고, 코인은 크게 출렁여요.
레버리지 2배는 정말 2배일까요? 직접 해보면 알게 돼요.

■ 공시는 믿고, 지라시는 의심하고
뉴스가 뜨고 1.5초 뒤에 가격이 움직여요.
공시는 항상 맞지만 지라시는 반이 틀려요.

■ 수수료도 진짜처럼
사고팔 때마다 수수료가 빠져요. 마구 누르면 손해예요.

■ 연습 모드는 무제한
오늘의 차트 전에 감을 잡아보세요.

등장하는 회사, 뉴스, 가격은 모두 가상이에요.
실제 돈은 오가지 않고, 투자 권유가 아니에요.
회원가입, 광고, 개인정보 수집 없이 바로 할 수 있어요.
```

---

## 알림과 리뷰 요청 (앱)

### 매일 알림 (선택)
설정 → **매일 알림**을 켜면 고른 시간(오전 8시 / 낮 12시 / 저녁 8시)에 하루 한 번 "오늘의 차트가 열렸어요 · 40초면 돼요"가 떠요. 기본은 꺼짐이고, 켤 때만 권한을 물어요. 이미 오늘의 차트를 한 날은 건너뛰어요. 웹과 토스에는 이 설정이 없어요.

- `@capacitor/local-notifications` 8.x. 서버나 네트워크 없이 기기 안에서만 울려요 (2주치를 미리 걸어두고, 앱을 열거나 오늘의 차트를 끝낼 때마다 다시 걸어요. 2주 동안 앱을 안 열면 조용히 멈춰요).
- **Android**: 13 이상은 알림 권한을 켤 때 물어요. 정확한 알람 권한(`SCHEDULE_EXACT_ALARM`)은 `AndroidManifest.xml`에서 뺐어요. 그래서 알림이 몇 분 늦게 올 수는 있지만 "알람 및 리마인더" 권한과 Play 신고가 필요 없어요. 상태 표시줄 아이콘은 `res/drawable/ic_stat_hold.xml`.
- **iOS**: Info.plist 추가 없음. 처음 켤 때 시스템 권한 창이 떠요.
- 문구는 기능만: 연속 기록, "놓쳐요" 같은 압박 문구는 넣지 않아요 (`src/core/reach.ts` 테스트가 막아요).

### 리뷰 요청
세 번째 이상 끝낸 오늘의 차트가 **그냥 들고 있기보다 앞서고 손해도 안 났을 때만**, 90일에 한 번까지 스토어 자체 리뷰 창을 불러요 (Play In-App Review, iOS `SKStoreReviewController`; `@capacitor-community/in-app-review` 8.x). 진 판 뒤에는 절대 안 부르고, "평가해 주세요" 버튼이나 보상은 없어요.
- 창이 뜰지는 OS가 정해요. Play는 **Play 스토어에서 설치한 빌드**에서만 떠요 (CI APK·사이드로드는 안 떠요. 내부 앱 공유로 테스트). iOS는 개발 빌드에선 늘 뜨고 TestFlight에선 안 떠요.

### 네이티브 프로젝트
- 플러그인을 추가하거나 바꾼 뒤엔 `npm run cap:sync` (→ `android/`, `ios/App/CapApp-SPM/Package.swift` 갱신, 커밋돼 있어요).
- Android Studio: Gradle Sync 한 번 (Play Review 라이브러리 `com.google.android.play:review`를 받아요).
- Xcode: 열 때 Swift 패키지(CapacitorLocalNotifications, CapacitorCommunityInAppReview)를 받아요. 별도 Capability 추가는 필요 없어요.
- 개인정보: 둘 다 데이터를 수집하지 않아요. App Store "데이터를 수집하지 않음", Play 데이터 보안 답변은 그대로예요.

---

## 업데이트 올리는 법

1. 코드 수정 → `npm run cap:sync`
2. 버전 올리기
   - Android: `android/app/build.gradle`의 기본 `versionCode` (+1)와 `versionName`. 명령줄에서 `./gradlew bundleRelease -PversionCode=12 -PversionName=1.2`처럼 넘겨도 돼요 (CI 테스트 APK는 실행 번호를 자동으로 넘겨요). 스토어에 올린 적 있는 번호보다 커야 해요.
   - iOS: Xcode → App 타깃 → General → Version / Build (+1)

## 지금 설정된 것

- 세로 화면 고정 (iOS, Android)
- iOS는 iPhone 전용 (iPad 스크린샷과 iPad 심사 불필요). iPad를 지원하려면 Xcode → General → Supported Destinations에 iPad 추가 후 13인치 스크린샷 준비
- iOS 암호화 수출 규정: 해당 없음으로 미리 설정 (업로드마다 묻지 않음)
3. 위의 서명 빌드 과정을 반복해서 업로드

## 폰트

Pretendard는 게임에 실제로 쓰인 글자만 남긴 파일 하나(`src/assets/pretendard-subset.woff2`, 약 120KB)로 들어가요. **한글 문구를 새로 쓰면** 다시 만들어 커밋하세요. 안 하면 CI(`npm run font:check`)가 빠진 글자를 알려주며 실패해요.
```bash
pip install fonttools brotli
npm run font
```

## 에셋 다시 만들기

아이콘이나 스플래시를 바꾸면:
```bash
npm run assets   # assets/*.png 렌더링 + iOS/Android 모든 크기 생성
```
스크린샷과 스토어 그래픽은 아래 [출시 이미지 체크리스트](#출시-이미지-체크리스트)를 보세요.

## 출시 이미지 체크리스트

모든 이미지는 Playwright(Chromium)로 그려요. 문구 디자인은 `scripts/lib/brand.mjs` 한 곳에 있어요 (DESIGN.md 원칙: 회백색 캔버스, 잉크 글자, 빨강은 보유 구간만, 그라데이션·그림자·이모지 없음).

| 쓰는 곳 | 크기 | 파일 | 명령 | 커밋 |
|---|---|---|---|---|
| 링크 미리보기 (카톡, X, 스레드) | 1200×630 | `public/og.png` | `npm run og` | ✅ |
| Google Play 스크린샷 6장 | 1080×1920 | `store/play/1-hold.png` ~ `6-challenge.png` | `npm run store-shots` | ❌ |
| Google Play 그래픽 이미지 | 1024×500 | `store/play/feature-graphic.png` | `npm run store-shots` | ❌ |
| Google Play 아이콘 | 512×512 | `store/android/icon-512.png` | `npm run assets` | ✅ |
| App Store 6.9" 스크린샷 6장 | 1320×2868 | `store/appstore/1-hold.png` ~ `6-challenge.png` | `npm run store-shots` | ❌ |
| 앱인토스 세로 스크린샷 3장 | 636×1048 | `store/toss/screenshot-1.png` ~ `3.png` | `npm run store-shots` | ❌ |
| 앱인토스 썸네일 | 1932×828 | `store/toss/thumbnail.png` | `npm run store-shots` | ❌ |
| 앱인토스 OG | 1200×600 | `store/toss/og.png` | `npm run store-shots` | ❌ |
| 결과 이미지 카드 샘플 | 1080×1080, 1080×1920 | `store/card/*.png` | `npm run card-preview` | ❌ |

- `npm run store-shots`는 `npm run build` 뒤 `node scripts/store-shots.mjs`예요. 대상만 고르려면 `node scripts/store-shots.mjs play toss appstore` 중 일부를, 캡처 없이 다시 합성만 하려면 `--compose-only`를 붙여요. `vite preview`는 스크립트가 직접 띄워요 (`URL=`로 이미 뜬 서버를 쓸 수도 있어요).
- 찍는 방법: 가짜 시계(`page.clock`)로 2026-11-02~08 일주일의 오늘의 차트를 실제로 플레이해서 연속 기록·시즌 계좌·습관 유형을 진짜로 만든 뒤, 출시일 2026-11-09(#40, 주식, 공식 발표와 소문이 나오는 차트)에 홈 → 소문 뉴스 → 보유 중 → 결과 → 도전장 시트 → 습관 화면을 찍어요. `Math.random`도 고정이라 매번 같은 그림이 나와요. 장면별 캡션은 LAUNCH.md 스토리보드 그대로이고, 모든 장 하단에 `모든 회사·가격·뉴스는 가상이에요`가 들어가요.
- 화면을 바꿨으면 다시 찍고 **6장을 눈으로 확인**하세요 (잘린 글자, 시트 겹침).
- `store/play`, `store/toss`, `store/appstore`, `store/raw`, `store/card`는 `store/.gitignore`로 커밋하지 않아요. `store/android`, `store/ios`의 예전 캡션 없는 스크린샷은 더 이상 갱신하지 않아요.
- `og:image`는 빌드 때 `.env`의 `VITE_SHARE_URL` + `og.png`로 채워져요. 주소를 바꾸면 끝에 `/`를 붙이고, 카톡 미리보기 캐시는 https://developers.kakao.com/tool/clear/og 에서 지워요.
