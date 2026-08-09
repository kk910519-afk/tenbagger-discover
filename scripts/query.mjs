// DB 임시 조회용. 읽기 전용으로 열어 파이프라인 실행 중에도 안전하다.
//   npm run query "SELECT ticker, name FROM companies LIMIT 5"
//   npm run query -- --file my-query.sql
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const fileIdx = args.indexOf('--file')
const sql = fileIdx >= 0 ? readFileSync(args[fileIdx + 1], 'utf8') : args.join(' ')

if (!sql.trim()) {
  console.error('사용법: npm run query "SELECT ..."  또는  npm run query -- --file q.sql')
  process.exit(1)
}

const db = new Database(process.env.DATABASE_PATH ?? './data/tenbagger.db', { readonly: true })
try {
  const rows = db.prepare(sql).all()
  if (rows.length === 0) console.log('(결과 없음)')
  else console.table(rows)
  console.log(`${rows.length}행`)
} finally {
  db.close()
}
