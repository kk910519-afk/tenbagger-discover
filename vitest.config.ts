import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // tsconfig.json은 Next.js 빌드 파이프라인 때문에 jsx: "preserve"를 쓴다.
  // vitest가 쓰는 vite(oxc 트랜스폼)는 그 설정을 그대로 물려받으면 .tsx의
  // JSX를 변환하지 않고 그대로 남겨 두므로("invalid JS syntax" 에러),
  // 테스트 트랜스폼에서만 자동 런타임으로 명시적으로 override한다.
  oxc: { jsx: 'automatic' },
  test: { environment: 'node', include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
