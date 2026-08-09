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
npm run dev
```

키가 없으면 `.env`에 `PRICE_PROVIDER=fixture`로 두고 실행할 수 있다.
이 경우 시가총액이 없어 일부 팩터가 채점되지 않는다.

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
