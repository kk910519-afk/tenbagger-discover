/**
 * 이 사이트의 기준 시각.
 *
 * 서버 렌더링일 때 "지금"은 페이지를 여는 순간이었다. 정적 사이트에는 그런 순간이 없다 —
 * 모든 페이지는 빌드 시점에 얼어붙고, 그 시점이 사이트 전체가 가진 유일한 시계다.
 * 화면이 날짜를 말할 때는 반드시 이 함수를 거쳐, 1,000장이 넘는 페이지가 한 날짜를
 * 말하도록 한다.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 스냅샷 기준일(YYYY-MM-DD, UTC).
 *
 * 환경변수로 고정할 수 있게 둔 이유는 편의가 아니라 정합성이다: 정적 생성은 여러 워커
 * 프로세스에서 병렬로 돌고, 페이지가 많으면 빌드 도중 자정을 넘길 수 있다. 그러면 같은
 * 빌드 안에서 페이지마다 기준일이 하루 어긋난다. deploy 스크립트는 빌드를 시작하기 전에
 * 날짜를 한 번 찍어 `NEXT_PUBLIC_SNAPSHOT_DATE`로 넘긴다.
 *
 * 형식이 어긋난 값은 조용히 무시하고 빌드 시각으로 되돌아간다 — 사이트 전체의 기준일이
 * 오타 하나로 깨지는 편보다 낫다.
 */
export function snapshotDate(): string {
  const pinned = process.env.NEXT_PUBLIC_SNAPSHOT_DATE
  if (pinned !== undefined && DATE_RE.test(pinned)) return pinned
  return new Date().toISOString().slice(0, 10)
}

/** `2026-08-15` → `2026년 8월 15일`. 날짜 문자열을 UTC로 읽어 표시도 UTC로 한다. */
export function formatKoreanDate(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`))
}
