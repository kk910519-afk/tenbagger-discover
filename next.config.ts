import type { NextConfig } from 'next'
import { basePath } from './src/app/_lib/paths'

/**
 * 이 앱은 **정적 사이트**로 배포된다. 데이터는 주 1회 파이프라인이 만드는 스냅샷이고
 * 실행 사이에 아무것도 변하지 않으므로 요청마다 계산할 것이 없다. 그리고 383MB짜리
 * SQLite 파일은 git에서 제외돼 있고 어떤 서버리스 용량 제한도 한참 넘어 배포 자체가
 * 불가능하다 — 빌드 시점에 미리 그려 두는 것이 이 사이트를 공개할 수 있는 유일한 방법이다.
 *
 * `output: 'export'`가 포기하는 것(요청 시점에 하는 모든 일): 서버 렌더링, ISR/재검증,
 * Route Handler, 미들웨어, `searchParams`, `cookies()`/`headers()`, 이미지 최적화,
 * `dynamicParams`를 통한 온디맨드 생성. 앱은 이 중 어느 것에도 기대지 않는다 —
 * `searchParams`를 쓰던 산업 페이지의 `?all=1`만 `/industry/[slug]/all/` 경로로 옮겼고,
 * 클라이언트 컴포넌트는 순수 CSS 툴팁 하나뿐이며, next/image는 쓰지 않는다.
 *
 * `basePath`: GitHub Pages 프로젝트 사이트는 `https://<user>.github.io/<repo>/`처럼
 * 하위 경로에서 서비스된다. 저장소 이름이 아직 정해지지 않았으므로 빌드 시점
 * 환경변수 `NEXT_PUBLIC_BASE_PATH`로 받고, 기본값은 빈 문자열이다(로컬에서 루트에
 * 띄워 보는 경우). 마크업의 `<a href>`는 같은 값을 `src/app/_lib/paths.ts`에서 읽으므로
 * 설정과 링크가 갈라질 수 없다.
 *
 * `trailingSlash`: `out/stock/AAPL/index.html` 꼴로 내보낸다. 확장자 없는 URL을
 * `.html`로 풀어 주는 것은 GitHub Pages의 동작이지 정적 파일의 성질이 아니라서,
 * 디렉터리+index.html이면 로컬의 어떤 정적 서버에서도 같은 URL이 그대로 열린다.
 */
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: basePath(),
  // better-sqlite3는 네이티브 모듈이므로 번들에 포함하지 않는다. 정적 내보내기라도
  // 페이지를 그리는 일은 빌드 시점 Node에서 실제로 일어나므로 이 설정은 그대로 필요하다.
  serverExternalPackages: ['better-sqlite3'],
  webpack(webpackConfig) {
    // src/ 전역의 상대 import는 tsx(Node ESM 로더)를 위해 확장자를 .js로 적는다
    // (실제 파일은 .ts). webpack은 이 별칭 없이는 .js 확장자를 문자 그대로 찾다가
    // 실패하므로, .ts/.tsx로도 풀어보도록 별칭을 추가한다.
    webpackConfig.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    }
    return webpackConfig
  },
}

export default config
