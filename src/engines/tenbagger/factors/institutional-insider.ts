import { notImplemented, type FactorFn } from '../factor-utils.js'

/**
 * 기관 보유·내부자 거래 신호. 13F와 Form 4 파싱이 필요해 Phase 4로 미룬다.
 * NOT_IMPLEMENTED는 모든 기업에 동일 적용되므로 completeness 분모에서 제외되고
 * 상대 순위를 왜곡하지 않는다.
 */
export const institutionalInsiderFactor: FactorFn = ({ cfg }) =>
  notImplemented('institutional_insider', cfg.scoring.factors.institutional_insider.weight)
