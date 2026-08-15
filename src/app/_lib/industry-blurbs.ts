/**
 * 산업 페이지 헤더 우측에 붙는 한 줄 설명. "이 산업이 뭘 하는 곳인지"만 답한다 —
 * 투자 판단이나 전망은 넣지 않는다. 키는 taxonomy/industries.yaml의 slug와 1:1이고,
 * 값이 없는 slug는 설명 없이 헤더만 렌더링된다(빈 문자열로 채우지 않는다).
 */
const INDUSTRY_BLURB: Record<string, string> = {
  // Theme 1 — AI / Software / Semiconductor
  semiconductors: '연산과 저장을 담당하는 칩을 설계·제조한다. 거의 모든 전자기기의 출발점.',
  'semiconductor-equipment': '칩을 만드는 장비와 소재를 공급한다. 공장이 돌아가려면 반드시 거친다.',
  'software-infrastructure': '다른 소프트웨어가 돌아갈 토대를 판다. 개발·배포·운영 도구.',
  'software-application': '사용자가 직접 쓰는 업무용 소프트웨어. 대개 구독으로 판다.',
  'cloud-computing': '서버·스토리지·연산을 빌려준다. 쓴 만큼 과금한다.',
  cybersecurity: '침입과 유출을 막는 보안 제품·서비스. 지출이 잘 끊기지 않는다.',
  'data-infrastructure': '데이터를 저장·이동·분석하는 기반 기술. 데이터베이스와 파이프라인.',
  'ai-infrastructure': 'AI 모델을 학습시키고 서비스하는 데 필요한 칩·플랫폼·도구.',
  networking: '데이터가 오가는 통로를 만든다. 스위치·라우터·광통신 장비와 연결 소프트웨어.',
  'data-center-infrastructure': '데이터센터를 짓고 돌리는 전력·냉각·설비.',

  // Theme 2 — Healthcare / Biotechnology
  biotechnology: '생명공학으로 새 치료제를 개발한다. 임상 결과에 가치가 크게 흔들린다.',
  pharmaceuticals: '의약품을 개발·생산·판매한다. 특허 만료 주기가 실적을 좌우한다.',
  'medical-devices': '진단·치료·수술에 쓰이는 의료기기를 만든다.',
  diagnostics: '질병을 찾아내는 검사와 장비. 검체 분석과 진단 키트.',
  genomics: '유전체를 읽고 편집하는 기술. 시퀀싱 장비와 유전자 치료.',
  'precision-medicine': '환자 개인의 유전·생체 정보에 맞춘 치료를 설계한다.',
  'drug-discovery': '신약 후보 물질을 찾는 단계에 특화. AI·자동화 활용이 늘고 있다.',
  'healthcare-technology': '병원·보험·환자를 잇는 의료 소프트웨어와 데이터 서비스.',

  // Theme 3 — Industrial / Automation / Defense
  robotics: '사람 대신 작업하는 로봇과 그 부품·제어 기술.',
  'industrial-automation': '공장과 설비를 자동으로 돌리는 제어·계측 시스템.',
  aerospace: '항공기와 엔진·부품을 만든다. 주문에서 인도까지 주기가 길다.',
  'defense-technology': '군용 장비·시스템·소프트웨어. 정부 예산이 최대 고객이다.',
  drones: '무인 항공기와 운용 소프트웨어. 군용과 상업용으로 나뉜다.',
  'advanced-manufacturing': '3D 프린팅처럼 기존 공정을 대체하는 정밀 제조 기술.',
  'logistics-automation': '창고와 물류 현장을 자동화하는 설비·소프트웨어.',

  // Theme 4 — Digital Consumer / Fintech
  'e-commerce': '온라인으로 물건을 판다. 직접 판매와 플랫폼 중개가 섞여 있다.',
  fintech: '기술로 금융 서비스를 다시 만든다. 대출·송금·자산관리.',
  'digital-payments': '결제를 처리하고 수수료를 받는다. 거래액이 늘면 매출이 는다.',
  'digital-advertising': '온라인 광고를 팔거나 중개한다. 경기에 민감하다.',
  gaming: '게임을 만들고 서비스한다. 히트작 주기에 실적이 출렁인다.',
  'online-marketplace': '사는 쪽과 파는 쪽을 잇고 수수료를 받는 플랫폼.',
  'travel-technology': '여행 예약과 운영을 다루는 플랫폼·소프트웨어.',
  'digital-media': '콘텐츠를 온라인으로 유통한다. 구독과 광고가 주 수입원.',

  // Theme 5 — Energy / Next Energy
  nuclear: '원자로를 짓고 운영한다. 소형모듈원자로(SMR)를 포함한다.',
  uranium: '원자력 연료가 되는 우라늄을 캐고 가공한다.',
  'energy-storage': '전기를 저장했다 쓰는 배터리와 저장 시스템.',
  solar: '태양광 패널·인버터를 만들거나 발전소를 운영한다.',
  'grid-infrastructure': '전기를 보내는 송배전망 설비와 운영 기술.',
  'power-semiconductor': '전력을 변환·제어하는 반도체. 전기차와 산업 설비의 핵심 부품.',
  'renewable-energy': '풍력·수력 등 재생에너지로 전기를 만든다.',
  'next-generation-energy': '수소·연료전지처럼 아직 상용화 초기인 에너지 기술.',

  // Theme 6 — Emerging Technology
  'quantum-computing': '양자역학으로 연산하는 컴퓨터와 부품. 상용화는 아직 초기다.',
  space: '로켓 발사와 우주 인프라를 다룬다.',
  satellite: '위성을 만들고 위성으로 통신·관측 서비스를 판다.',
  'autonomous-driving': '스스로 주행하는 차의 센서·칩·소프트웨어.',
  'advanced-computing': '기존 CPU를 넘어서는 새로운 연산 구조와 칩.',
  'ai-robotics': 'AI로 스스로 판단하는 로봇. 휴머노이드와 자율 작업 기계.',
  'advanced-materials': '새 소재를 개발한다. 배터리·반도체·항공에 쓰인다.',
  'synthetic-biology': '생물을 설계해 물질을 만든다. 바이오 기반 제조.',
}

export function industryBlurb(slug: string): string | null {
  return INDUSTRY_BLURB[slug] ?? null
}
