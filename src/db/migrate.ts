import { getRawDb, runMigrations } from './client.js'

const raw = getRawDb()
runMigrations(raw)
console.log(`마이그레이션 완료: ${raw.name}`)
raw.close()
