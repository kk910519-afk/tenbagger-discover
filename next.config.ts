import type { NextConfig } from 'next'

const config: NextConfig = {
  // better-sqlite3는 네이티브 모듈이므로 번들에 포함하지 않는다
  serverExternalPackages: ['better-sqlite3'],
}

export default config
