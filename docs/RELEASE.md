# 출시 가이드

코드 쪽 준비(앱 포장, 아이콘, 스플래시, 스크린샷, 개인정보 처리방침, 자동 빌드)는 끝나 있어요. 남은 건 **본인 명의 계정과 결제가 필요한 일**이에요.

## 한눈에 보기

| 단계 | 비용 | 기간 | 누가 |
|---|---|---|---|
| 0. 웹 링크 + 안드로이드 테스트 설치 | 무료 | 오늘 | 설정 버튼 하나 |
| 1. 이름 확정, 앱 ID 확정 | 무료 | 하루 | 본인 |
| 2. Google Play | 25달러 (한 번) | **최소 3주** (14일 비공개 테스트 의무) | 본인 |
| 3. App Store | 99달러 / 년 | 1~2주 (심사 보통 1~3일) | 본인 + Mac |

추천 순서: **0 → 1 → 2와 3을 동시에.** Google Play는 14일 테스트 기간이 있어서 먼저 시작해두는 게 좋아요.

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

코드를 푸시할 때마다 GitHub가 설치 파일(APK)을 자동으로 만들어요.

1. **Actions** 탭 → `Android` → 가장 최근 실행 → 아래 **Artifacts**에서 `hold-debug-apk` 다운로드 (zip 안에 `app-debug.apk`)
2. 폰으로 옮겨서 열기 → "출처를 알 수 없는 앱 설치" 허용

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
1. [Play Console](https://play.google.com/console) 가입, 등록비 25달러 (한 번)
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
- 그래픽 이미지 1024×500: `store/android/feature-graphic.png`
- 휴대전화 스크린샷: `store/android/1-home.png` ~ `4-habits.png`

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
| 스크린샷 6.9" (1320×2868) | `store/ios/1-home.png` ~ `4-habits.png` |
| 개인정보 처리방침 URL | `https://di258294-lang.github.io/-1-/privacy.html` |
| 지원 URL | `https://di258294-lang.github.io/-1-/support.html` |
| 앱 개인정보 보호 | **데이터를 수집하지 않음** |
| 연령 등급 | 모든 항목 "없음". 시뮬레이션 도박: 없음 (주식 타이밍 게임, 베팅/확률 보상 없음) → 4+ 예상 |
| 가격 | 무료 |
| 출시 국가 | 처음엔 **대한민국만** 추천 (EU 출시는 판매자 신원 표시 의무가 추가로 생겨요) |

### 심사 메모 (App Review Information → Notes)
> HOLD is a single-player timing game. Press and hold the pad to hold a fictional stock, release to sell. All companies, prices and news are generated and fictional; no real money, no purchases, no ads, no accounts, no data collection. The game runs fully offline and uses native haptics. A daily chart (same for every player) plus an unlimited practice mode are available from the home screen.

---

## 게임 등급 (한국)

애플과 구글은 정부가 지정한 **자체등급분류사업자**예요. 스토어 설문으로 받은 등급이 그대로 인정돼서 게임물관리위원회에 따로 신청할 필요 없어요. 단, 같은 게임을 스토어가 아닌 다른 플랫폼(예: 자체 웹사이트에서 정식 서비스)에 유통하면 그때 게임물 정보를 따로 전달해야 해요.

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
주식,모의투자,주식게임,차트,타이밍,투자습관,존버,단타,매매,재테크,경제공부,데일리게임,한손게임
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

## 업데이트 올리는 법

1. 코드 수정 → `npm run cap:sync`
2. 버전 올리기
   - Android: `android/app/build.gradle`의 `versionCode` (+1)와 `versionName`
   - iOS: Xcode → App 타깃 → General → Version / Build (+1)

## 지금 설정된 것

- 세로 화면 고정 (iOS, Android)
- iOS는 iPhone 전용 (iPad 스크린샷과 iPad 심사 불필요). iPad를 지원하려면 Xcode → General → Supported Destinations에 iPad 추가 후 13인치 스크린샷 준비
- iOS 암호화 수출 규정: 해당 없음으로 미리 설정 (업로드마다 묻지 않음)
3. 위의 서명 빌드 과정을 반복해서 업로드

## 에셋 다시 만들기

아이콘이나 스플래시를 바꾸면:
```bash
npm run assets   # assets/*.png 렌더링 + iOS/Android 모든 크기 생성
```
스크린샷 다시 찍기:
```bash
npm run build && npx vite preview --port 4173 &
node scripts/store-shots.mjs ios
node scripts/store-shots.mjs android
```
