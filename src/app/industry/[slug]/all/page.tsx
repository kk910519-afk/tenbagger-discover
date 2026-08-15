import { getRawDb } from '@/db/client'
import { getAllIndustrySlugs } from '@/app/_queries/static-params'
import { IndustryReport } from '@/app/_components/IndustryReport'

/**
 * `/industry/[slug]/all/` — 후보를 10개로 자르지 않은 산업 페이지.
 *
 * 서버 렌더링일 때 이 상태는 `?all=1` 쿼리스트링이었다. 정적 내보내기에는 요청이 없어
 * 쿼리스트링을 읽을 수 없으므로 상태를 경로로 승격시켰다. 화면과 동작은 그대로이고,
 * 달라진 것은 그 상태가 이제 자기 URL을 가진다는 점뿐이다(공유·북마크가 가능해진다).
 */
export const dynamicParams = false

export function generateStaticParams(): { slug: string }[] {
  const raw = getRawDb()
  try {
    return getAllIndustrySlugs(raw).map((slug) => ({ slug }))
  } finally {
    raw.close()
  }
}

export default async function IndustryAllPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <IndustryReport slug={slug} showAll />
}
