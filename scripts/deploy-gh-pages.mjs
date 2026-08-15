// `npm run deploy` — 정적 사이트를 만들어 gh-pages 브랜치에 올린다.
//
// 순서가 곧 안전장치다: **먼저 원격을 확인하고, 그 다음에 빌드한다.** 원격이 없는데
// 5분짜리 빌드를 끝내 놓고 마지막에 실패하는 것은 시간 낭비이고, 더 나쁘게는 "뭔가는
// 됐겠지" 하는 착각을 남긴다. 원격이 없으면 아무것도 만들지 않고 그 사실만 말하고 끝낸다.
//
// 커밋은 working tree를 건드리지 않고 만든다 — 브랜치를 체크아웃하지도, 스태시하지도
// 않는다. 임시 인덱스(GIT_INDEX_FILE)와 out/을 work tree로 지정해 트리를 쓰고,
// 부모 없는 커밋(commit-tree에 -p 없음)을 만들어 gh-pages로 강제 푸시한다.
// gh-pages는 전부 생성물이므로 히스토리를 쌓을 이유가 없고, 매주 1,200장 넘는 파일이
// 누적되면 저장소만 부푼다.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REMOTE = process.env.GH_PAGES_REMOTE ?? 'origin'
const BRANCH = process.env.GH_PAGES_BRANCH ?? 'gh-pages'
const OUT = resolve(process.env.EXPORT_DIR ?? 'out')

/** 실패하면 stderr를 그대로 올리고 종료 코드를 전파한다. */
function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...opts }).trim()
}

function fail(message) {
  console.error(`\n배포 중단 — ${message}\n`)
  process.exit(1)
}

// ── 1. 원격 확인 (빌드 전에) ────────────────────────────────────────────────
let remoteUrl
try {
  remoteUrl = git(['remote', 'get-url', REMOTE], { stdio: ['ignore', 'pipe', 'ignore'] })
} catch {
  fail(
    `'${REMOTE}' 원격이 없습니다. 아무것도 빌드하지 않았고 아무것도 푸시하지 않았습니다.\n` +
      `  원격을 추가한 뒤 다시 실행하세요:\n` +
      `    git remote add ${REMOTE} https://github.com/<user>/<repo>.git\n` +
      `  다른 이름의 원격을 쓰려면 GH_PAGES_REMOTE=<이름>으로 지정합니다.`,
  )
}
console.log(`원격 ${REMOTE} → ${remoteUrl}`)

// ── 2. base path 결정 ──────────────────────────────────────────────────────
// 프로젝트 사이트(https://<user>.github.io/<repo>/)는 하위 경로에서 서비스되므로
// base path가 /<repo>여야 한다. 사용자/조직 사이트(<user>.github.io 저장소)만 루트다.
// 원격 URL에서 유추하되 무엇을 골랐는지 반드시 출력한다 — 조용한 추론은 사고를 부른다.
function inferBasePath(url) {
  const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(url)
  if (!m) return ''
  const [, owner, repo] = m
  if (repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) return ''
  return `/${repo}`
}

const basePath =
  process.env.NEXT_PUBLIC_BASE_PATH !== undefined
    ? process.env.NEXT_PUBLIC_BASE_PATH
    : inferBasePath(remoteUrl)

if (process.env.NEXT_PUBLIC_BASE_PATH === undefined) {
  console.log(`base path를 원격 URL에서 유추했습니다: '${basePath}' (NEXT_PUBLIC_BASE_PATH로 덮어쓸 수 있습니다)`)
} else {
  console.log(`base path: '${basePath}' (NEXT_PUBLIC_BASE_PATH)`)
}

// ── 3. 빌드 ────────────────────────────────────────────────────────────────
// 스냅샷 기준일을 여기서 한 번 찍어 넘긴다. 정적 생성은 여러 워커에서 병렬로 돌아
// 빌드 도중 자정을 넘기면 페이지마다 기준일이 하루씩 어긋날 수 있다.
const snapshot = new Date().toISOString().slice(0, 10)
console.log(`스냅샷 기준일: ${snapshot}\n`)

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
execFileSync(npm, ['run', 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_SNAPSHOT_DATE: snapshot,
  },
})

if (!existsSync(join(OUT, 'index.html'))) fail(`${OUT}/index.html이 없습니다.`)
if (!existsSync(join(OUT, '.nojekyll'))) fail(`${OUT}/.nojekyll이 없습니다.`)

// ── 4. working tree를 건드리지 않고 커밋을 만든다 ──────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'tenbagger-pages-'))
const indexFile = join(tmp, 'index')
try {
  const env = { ...process.env, GIT_INDEX_FILE: indexFile, GIT_WORK_TREE: OUT }
  // -f: 저장소의 ignore 규칙과 무관하게 out/의 내용을 그대로 담는다.
  git(['add', '-A', '-f', '.'], { env, cwd: OUT })
  const tree = git(['write-tree'], { env })
  const message = `chore(pages): ${snapshot} 스냅샷 배포 (base path '${basePath}')`
  const commit = git(['commit-tree', tree, '-m', message])

  console.log(`\n${BRANCH}로 푸시합니다 — 이 브랜치는 전부 생성물이라 매번 교체됩니다.`)
  execFileSync('git', ['push', '--force', REMOTE, `${commit}:refs/heads/${BRANCH}`], {
    stdio: 'inherit',
  })
  console.log(`\n배포 완료. GitHub 저장소 Settings → Pages에서 소스를 '${BRANCH}' 브랜치 / root로 지정하세요.`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
