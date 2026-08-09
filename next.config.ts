import type { NextConfig } from 'next'

const config: NextConfig = {
  // better-sqlite3는 네이티브 모듈이므로 번들에 포함하지 않는다
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
