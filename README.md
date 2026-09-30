# HOLD

누르고 있는 동안만 주식을 들고 있어요. 매일 하나의 차트, 40초 타이밍 게임.

## 게임

- 화면 아래 패드를 **누르고 있으면 매수, 떼면 매도**. 조작은 이게 전부예요.
- 한 판은 40초. 시작 전 12초 흐름을 보여주고, 끝나면 종목 이름이 공개돼요.
- 사고팔 때마다 수수료 0.1%. 마구 누르면 손해라서 "언제 참을지"가 실력이에요.
- 라운드마다 뉴스가 2~3개 떠요. 1.5초 뒤 가격이 반응해요. **공시**는 항상 맞고 **지라시**는 60%만 맞아요.
- **오늘의 차트**: 한국 시간 0시마다 바뀌고, 전 세계 모두 같은 차트. 하루 한 번. 중간에 새로고침해도 다시 못 해요.
- **연습 모드**: 무제한, 매번 새 차트.
- 결과는 "그냥 들고 있었으면"과 "1초 단위로 완벽했다면"과 비교하고, 10칸짜리 타임라인으로 공유해요.

```
HOLD #1  +12.4%
그냥 들고 있었으면 -3.1%
🟥🟥⬜⬜🟥🟦⬜⬜🟥🟥
```

## 실행

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 코어 로직 테스트
npm run build      # 타입체크 + 프로덕션 빌드 (dist/)

# HTML 파일 하나로 묶기 (폰트까지 포함, 약 150KB)
pip install fonttools brotli
npm run build && python3 scripts/build-single.py dist/hold.html
```

## 구조

```
src/core/   순수 로직, DOM 없음. 테스트 대상.
  rng.ts      시드 고정 난수 (같은 날 = 같은 차트)
  market.ts   가격 생성: 추세/횡보 레짐 + 모멘텀 + 뉴스 쇼크
  round.ts    보유/수수료/수익률 계산, 등급
  daily.ts    KST 기준 날짜, 회차 번호
  storage.ts  localStorage 기록, 연속 참여, 중도 이탈 처리
  share.ts    공유 텍스트
src/ui/     화면 (프레임워크 없이 DOM + canvas)
  home.ts / play.ts / result.ts / chart.ts / intro.ts / sheet.ts
```

기획 배경과 디자인 원칙은 [docs/PLAN.md](docs/PLAN.md), [docs/DESIGN.md](docs/DESIGN.md)에 있어요.
