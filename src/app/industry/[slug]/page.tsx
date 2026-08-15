import { getRawDb } from '@/db/client'
import { getAllIndustrySlugs } from '@/app/_queries/static-params'
import { IndustryReport } from '@/app/_components/IndustryReport'

/**
 * 빌드 시점에 모든 산업 페이지를 미리 만든다. 목록에 없는 slug는 정적 사이트에 파일이
 * 없다는 뜻이므로 `dynamicParams`를 명시적으로 끈다 — `output: 'export'`에서는 어차피
 * 강제되지만, 이 페이지가 요청 시점에 아무것도 하지 않는다는 사실을 코드에 남겨 둔다.
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

export default async function IndustryPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <IndustryReport slug={slug} showAll={false} />
}
