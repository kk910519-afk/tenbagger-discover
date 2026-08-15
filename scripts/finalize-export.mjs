// 정적 내보내기 마무리. `next build` 직후에 돌며 GitHub Pages가 요구하는 것을 채우고,
// 무엇이 얼마나 나왔는지 보고한다.
//
// `.nojekyll`이 없으면 GitHub Pages는 밑줄로 시작하는 디렉터리를 Jekyll 소스로 보고
// 통째로 버린다 — Next의 자산이 전부 `_next/`에 들어 있으므로 사이트가 스타일도
// 스크립트도 없이 올라간다. 에러가 아니라 조용한 누락이라 배포 후에야 알아차리게 된다.
import { writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.env.EXPORT_DIR ?? 'out'

if (!existsSync(join(OUT, 'index.html'))) {
  console.error(`${OUT}/index.html이 없습니다. 먼저 next build를 실행하세요.`)
  process.exit(1)
}

writeFileSync(join(OUT, '.nojekyll'), '')

/** 디렉터리를 재귀 순회해 파일 수·총 바이트·HTML 페이지 수·가장 큰 파일을 센다. */
function walk(dir) {
  let files = 0
  let bytes = 0
  let pages = 0
  let largest = { path: '', bytes: 0 }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = walk(p)
      files += sub.files
      bytes += sub.bytes
      pages += sub.pages
      if (sub.largest.bytes > largest.bytes) largest = sub.largest
      continue
    }
    const size = statSync(p).size
    files += 1
    bytes += size
    if (entry.name.endsWith('.html')) pages += 1
    if (size > largest.bytes) largest = { path: p, bytes: size }
  }
  return { files, bytes, pages, largest }
}

const { files, bytes, pages, largest } = walk(OUT)
const mib = (n) => `${(n / 1024 / 1024).toFixed(1)} MiB`

console.log(`정적 내보내기 완료 — ${OUT}/`)
console.log(`  HTML 페이지 ${pages.toLocaleString()}장 · 전체 파일 ${files.toLocaleString()}개 · ${mib(bytes)}`)
console.log(`  가장 큰 파일 ${largest.path} (${mib(largest.bytes)})`)
console.log(`  .nojekyll 생성 (없으면 GitHub Pages가 _next/를 통째로 버린다)`)

// GitHub Pages의 한도: 사이트 전체 1GB, 파일 하나 100MB.
const GIB = 1024 ** 3
const MIB100 = 100 * 1024 * 1024
if (bytes > GIB) console.warn(`  경고: 전체 용량이 GitHub Pages 한도(1GB)를 넘었습니다.`)
if (largest.bytes > MIB100) console.warn(`  경고: ${largest.path}가 파일당 한도(100MB)를 넘었습니다.`)
