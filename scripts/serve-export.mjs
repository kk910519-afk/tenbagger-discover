// `npm run preview` — 내보낸 정적 파일을 평범한 HTTP로 띄운다.
//
// 있어야 하는 이유: base path를 잘못 설정해도 HTML 소스는 멀쩡해 보인다. `_next/`
// 자산 경로와 `<a href>`가 실제로 맞물리는지는 하위 경로에 올려 브라우저로 열어 봐야만
// 드러난다. 개발 서버(next dev)는 정적 내보내기와 다른 경로 규칙으로 동작하므로
// 검증 수단이 되지 못한다 — 여기서는 out/ 아래의 파일만 그대로 돌려준다.
//
//   NEXT_PUBLIC_BASE_PATH=/tenbagger npm run preview   → http://localhost:4173/tenbagger/
//
// 의존성을 새로 들이지 않으려고 node:http로 직접 쓴다(수십 줄이면 충분하다).
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join, extname, normalize, resolve } from 'node:path'

const OUT = resolve(process.env.EXPORT_DIR ?? 'out')
const PORT = Number(process.env.PORT ?? 4173)
const RAW_BASE = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').trim().replace(/\/+$/, '')
const BASE = RAW_BASE === '' ? '' : RAW_BASE.startsWith('/') ? RAW_BASE : `/${RAW_BASE}`

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

function send(res, status, file) {
  res.writeHead(status, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let pathname = decodeURIComponent(url.pathname)

  // base path 밖의 요청은 404다 — GitHub Pages에서도 그렇다. 이 서버가 관대하면
  // 접두사 오류가 여기서만 조용히 통과하고 배포 후에 드러난다.
  if (BASE !== '') {
    if (pathname === BASE) {
      res.writeHead(301, { location: `${BASE}/` })
      res.end()
      return
    }
    if (!pathname.startsWith(`${BASE}/`)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`base path '${BASE}' 밖의 경로입니다: ${pathname}`)
      return
    }
    pathname = pathname.slice(BASE.length)
  }

  // 경로 탈출 방지
  const target = join(OUT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''))
  if (!target.startsWith(OUT)) {
    res.writeHead(403).end()
    return
  }

  if (existsSync(target) && statSync(target).isDirectory()) {
    const index = join(target, 'index.html')
    if (existsSync(index)) return send(res, 200, index)
  }
  if (existsSync(target) && statSync(target).isFile()) return send(res, 200, target)

  const notFound = join(OUT, '404.html')
  if (existsSync(notFound)) return send(res, 404, notFound)
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('Not found')
}).listen(PORT, () => {
  console.log(`정적 미리보기: http://localhost:${PORT}${BASE}/  (${OUT})`)
})
