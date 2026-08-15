/**
 * 사이트 안의 모든 내부 링크를 만드는 자리.
 *
 * GitHub Pages 프로젝트 사이트는 `https://<user>.github.io/<repo>/`처럼 **하위 경로**에서
 * 서비스된다. next.config의 `basePath`는 `_next` 자산과 next/link에만 적용되고, 이 앱이
 * 쓰는 평범한 `<a href="/stock/AAPL">`에는 붙지 않는다 — HTML 소스만 보면 멀쩡한데
 * 브라우저에서 클릭하면 사이트 루트로 튀어 404가 나는, 소스 검토로는 잡히지 않는 오류다.
 * 그래서 링크를 이 헬퍼 하나로 모으고 next.config도 같은 함수를 읽게 해서, 마크업과 설정이
 * 서로 다른 접두사를 쓰는 상태 자체가 성립할 수 없게 한다.
 *
 * 저장소 이름은 아직 정해지지 않았으므로 값은 빌드 시점 환경변수 `NEXT_PUBLIC_BASE_PATH`로
 * 받는다. 기본값은 빈 문자열 — 로컬에서 출력 디렉터리를 루트에 띄워 볼 때가 그 경우다.
 *
 * 경로 끝의 슬래시는 next.config의 `trailingSlash: true`와 짝이다. 정적 내보내기가
 * `out/stock/AAPL/index.html`을 만들므로 링크도 디렉터리 형태여야 리다이렉트 없이
 * 아무 정적 서버에서나 그대로 열린다.
 */

/**
 * 정규화된 base path. 없으면 `''`, 있으면 `/repo` 꼴(앞 슬래시 있음, 뒤 슬래시 없음).
 *
 * `process.env.NEXT_PUBLIC_BASE_PATH`를 리터럴 표현식으로 적어야 한다 — Next는 클라이언트
 * 번들에서 이 표현식 자체를 문자열로 치환하므로, 변수에 담아 두면 치환 대상이 되지 않는다.
 * 모듈 최상단 상수로 캐시하지 않는 것도 의도적이다: 테스트가 환경변수를 바꿔 가며
 * 확인할 수 있어야 한다.
 */
export function basePath(): string {
  const configured = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').trim().replace(/\/+$/, '')
  if (configured === '') return ''
  return configured.startsWith('/') ? configured : `/${configured}`
}

/** 홈. `hash`는 `'#top-candidates'`처럼 `#`를 포함해 넘긴다. */
export function homePath(hash = ''): string {
  return `${basePath()}/${hash}`
}

/** 산업 상세(미리보기 10개). */
export function industryPath(slug: string): string {
  return `${basePath()}/industry/${encodeURIComponent(slug)}/`
}

/**
 * 산업 상세 — 후보 전체.
 *
 * 서버 렌더링일 때는 `?all=1` 쿼리스트링이었다. 정적 내보내기에는 요청 시점이 없어
 * 쿼리스트링을 읽을 수 없으므로, 같은 상태를 경로로 승격시켜 별도 페이지로 만든다.
 * 사용자가 보는 동작("전체 보기"를 누르면 잘리지 않은 표가 나온다)은 그대로다.
 */
export function industryAllPath(slug: string): string {
  return `${industryPath(slug)}all/`
}

/** 종목 상세. */
export function stockPath(ticker: string): string {
  return `${basePath()}/stock/${encodeURIComponent(ticker)}/`
}
