# Tenbagger Discovery Dashboard

미국 상장 성장주 중 향후 3~7년 내 Multibagger 후보를 조기에 발견하기 위한 리서치 대시보드.

시가총액 순 나열이 아니라 `Growth Theme → Industry → Leader/Challenger/Emerging →
Tenbagger Score` 경로로 탐색한다.

## 실행

```bash
npm install
cp .env.example .env     # Finnhub 무료 키를 넣는다 (https://finnhub.io)
npm run db:migrate
npm run pipeline:all     # 최초 실행은 추정치로 1시간 내외(미측정), 약 1GB 다운로드
npm run dev              # 개발 서버. 배포본 확인은 build + preview로 한다(아래)
```

## 주간 흐름 — 수집 · 빌드 · 배포

데이터는 주 1회 파이프라인이 만드는 **스냅샷**이고 실행 사이에는 아무것도 변하지 않는다.
그래서 이 사이트는 요청마다 계산하지 않고 빌드 시점에 전부 그려 두는 **정적 사이트**다
(383MB짜리 SQLite는 git에서 제외돼 있어 애초에 배포할 수도 없다).

```bash
npm run pipeline:all                  # 1. 수집·정규화·채점 (DB 갱신)
npm run build                         # 2. out/ 에 정적 사이트 생성
npm run preview                       # 3. 로컬에서 확인 → http://localhost:4173/
npm run deploy                        # 4. gh-pages 브랜치로 배포
```

`npm run build`는 분류된 **모든** 기업의 페이지를 만든다(데이터 완전성 기준 미달 기업
포함). 산업 표가 그들에게도 링크를 걸기 때문이다 — 404가 나는 링크는 "데이터가
부족하다"고 말해 주는 페이지보다 나쁘다.

### base path — GitHub Pages 하위 경로

프로젝트 사이트는 `https://<user>.github.io/<repo>/`처럼 하위 경로에서 서비스되므로
모든 링크와 자산에 `/<repo>` 접두사가 필요하다. 빌드 시점 환경변수로 지정한다.

```bash
NEXT_PUBLIC_BASE_PATH=/my-repo npm run build
NEXT_PUBLIC_BASE_PATH=/my-repo npm run preview   # 같은 접두사로 확인해야 의미가 있다
```

기본값은 빈 문자열이라 로컬에서는 `npm run build && npm run preview`만으로 루트에서
열린다. `npm run deploy`는 원격 URL에서 저장소 이름을 읽어 접두사를 자동으로 정하고
무엇을 골랐는지 출력한다(`NEXT_PUBLIC_BASE_PATH`로 덮어쓸 수 있다).

> 접두사를 틀려도 HTML 소스는 멀쩡해 보인다. 반드시 `npm run preview`로 띄워
> **브라우저에서** 링크를 눌러 보고 CSS가 입혀졌는지 확인할 것.

### 배포

`npm run deploy`는 (1) 원격을 먼저 확인하고 → (2) 빌드하고 → (3) `out/`의 내용을
`gh-pages` 브랜치로 푸시한다. 원격이 없으면 **아무것도 만들지 않고 중단한다**.

- 원격 이름은 기본 `origin`, `GH_PAGES_REMOTE`로 바꿀 수 있다.
- 작업 트리를 건드리지 않는다 — 브랜치를 체크아웃하지도, 스태시하지도 않는다.
- `gh-pages`는 전부 생성물이라 매번 부모 없는 커밋으로 교체된다(히스토리를 쌓지 않는다).
- 최초 1회: GitHub 저장소 **Settings → Pages**에서 소스를 `gh-pages` 브랜치 / `root`로 지정.

### 자동 배포 — GitHub Actions 주 1회

`.github/workflows/weekly-deploy.yml`이 위 네 단계를 매주 **토요일 22:00 UTC(일요일 07:00
KST)** 에 GitHub Actions에서 그대로 돌린다 — 금요일 미국 장 마감 시세와 그 주에 제출된
공시가 반영된 뒤다. Actions 탭 → *Weekly deploy* → *Run workflow*로 언제든 수동 실행할 수 있다.

최초 1회 설정:

1. **Settings → Secrets and variables → Actions → New repository secret**
   이름 `FINNHUB_API_KEY`, 값은 Finnhub 무료 키. 없으면 워크플로가 수집 전에 바로 실패한다.
2. 첫 실행이 끝난 뒤 **Settings → Pages**에서 소스를 `gh-pages` 브랜치 / `root`로 지정.

동작 메모:

- SQLite DB만 `actions/cache`로 실행 간에 이어받는다. DB가 있으면 파이프라인은 stale한
  회사만 SEC API로 다시 조회하므로 두 번째 실행부터 훨씬 짧다.
- `data/cache`(HTTP 캐시)는 이어받지 **않는다**. 그 캐시는 만료가 없어 상장 목록·티커 맵이
  첫 주 상태로 굳고 새 상장사가 유니버스에 들어오지 못한다. 매주 다시 받는 비용은 10분 안팎이다.
- 푸시는 `GITHUB_TOKEN`으로 하며 `contents: write` 권한만 준다. 배포 로직은 로컬과 같은
  `scripts/deploy-gh-pages.mjs`라 base path도 원격 URL에서 자동으로 `/<repo>`가 된다.
- 같은 워크플로가 겹쳐 돌지 않도록 `concurrency`로 직렬화한다. 진행 중인 실행은 취소하지 않는다.

### 스냅샷 기준일

정적 페이지는 빌드 시점에 얼어붙는다. 그래서 모든 페이지 상단에 기준일이 한 줄로 붙는다.

> 이 페이지는 2026-08-15 기준으로 만들어진 정적 스냅샷입니다 — 실시간 시세가 아니며,
> 다음 빌드까지 갱신되지 않습니다.

`STALE` 배지는 **방문자의 시계가 아니라 이 기준일**에 대고 판정한다. 방문자의 시계로
재면 임계(`config.yaml` → `staleness`)를 넘기는 날 모든 페이지가 한꺼번에 STALE이 되어
배지가 아무것도 구별해 주지 못한다. 기준일에 대고 재면 배지는 "이 스냅샷을 뜰 때
수집이 밀려 있었는가"라는 원래 질문에 답하고, 그 답은 시간이 지나도 변하지 않는다.
"이 페이지가 얼마나 오래됐는가"는 배지가 아니라 기준일이 답한다.

## 실행 메모

파이프라인(`tsx`로 직접 실행)은 `.env`를 시작 시점에 직접 읽는다 — 웹 앱(`next dev`)과
달리 Next.js의 자동 로딩을 타지 않기 때문이다. `.env`가 아예 없어도 실행은 되며(선택
사항), 이미 export된 실제 환경변수가 있으면 `.env`보다 우선한다.

**Finnhub 키 없이 할 수 있는 것.** 키는 시세(`prices`) 단계에서만 필요하다.
`npm run pipeline:universe`, `pipeline:fundamentals`, `pipeline:scores`는 키가 없어도
정상적으로 끝까지 실행된다. 키가 없다면 이 세 단계를 따로 돌리거나, `.env`에
`PRICE_PROVIDER=fixture`를 두고 `npm run pipeline:all`을 실행한다 — 이 경우 실제
시가총액이 없어 일부 팩터가 채점되지 않는다. 키가 없는 채로 `pipeline:all`을 그대로
실행하면 universe/fundamentals까지는 끝나고 `prices` 단계에서 멈춘다(그 뒤의 `scores`는
실행되지 않는다).

## 데이터 소스

| 데이터 | 출처 | 비용 |
|---|---|---|
| 재무제표 | SEC EDGAR XBRL (분기 벌크 + companyfacts) | 무료 |
| 상장 메타데이터 | nasdaqtrader 심볼 디렉터리 | 무료 |
| 업종·거래소 | SEC submissions API | 무료 |
| 주가 | Finnhub `/quote` | 무료 티어 |

## 구조

- `config.yaml` — 유니버스 필터, 스코어 가중치·곡선, Red Flag 임계값. **코드에 매직넘버 없음**
- `taxonomy/` — Theme·Industry·SIC 매핑·기업 오버라이드
- `src/engines/` — 순수 함수 스코어링. DB와 Provider를 import하지 않는다 (테스트로 강제)
- `src/providers/` — 외부 데이터. 인터페이스 뒤에 격리
- `src/pipeline/` — 수집·정규화·스코어 잡

설계 문서: [docs/superpowers/specs/](docs/superpowers/specs/)

## 알려진 제약 (Phase 1)

- 유동성 필터 미작동 — Finnhub 무료 티어의 `/quote` 엔드포인트는 실제 키로 확인한 결과
  `{c, d, dp, h, l, o, pc, t}`만 반환하며 거래량 필드가 없다. 이 티어로는 유동성 필터를
  구현할 수 없다 (의심이 아니라 확인된 사실).
- 기관/내부자 팩터(5점) 미구현 — 13F·Form 4 파싱 필요, Phase 4
- Going Concern·고객 집중도 Red Flag 미구현 — 10-K 본문 파싱 필요, Phase 4
- TAM은 수동 큐레이션. 미입력 산업은 구성기업 매출성장률 중앙값으로 대체
- Industry 분류는 오버라이드가 없으면 SIC 기본 버킷 (화면에 표시됨)
- 최초 파이프라인 실행(`npm run pipeline:all`)은 브리프의 단계별 소요시간과 다운로드
  용량을 근거로 한 추정치로 약 1시간이 걸리고 약 1GB를 내려받는다 — 실측치가 아니다.
  이 사실을 모르고 실행하면 오래 걸리는 이유를 알 수 없으니 미리 인지할 것.
