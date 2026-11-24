// In-browser static simulation engine for GAMSDAQ (GitHub Pages Static Demo)
(function () {
  const origFetch = window.fetch.bind(window);

  let state = null;

  function roundToTick(price, tick) {
    return Math.round(price / tick) * tick;
  }

  function calcEffectivePrice(listedPrice, shippingFee, actualWeightKg, targetWeightKg) {
    return roundToTick(((listedPrice + shippingFee) / actualWeightKg) * targetWeightKg, 10);
  }

  function evaluateCandidates(ticker, rawCandidates) {
    const excluded = ['파지', '못난이', '주스', '가공', '흠과', '중소과', '혼합', '하품', '보통', '중과', '소과', '가정용'];
    const evaluated = rawCandidates.map((c) => {
      const reasons = [];
      const codes = [];
      const hasExcluded = excluded.some((term) => c.productTitle.includes(term) || c.gradeText.includes(term));
      if (hasExcluded) {
        codes.push('GATE-01_QUALITY_MISMATCH');
        reasons.push(`필수 등급(${ticker.grade}) 토큰 미충족 또는 하위/혼합 등급`);
      }
      if (!c.guaranteedBrix || c.guaranteedBrix < ticker.minBrix) {
        codes.push('GATE-02_BRIX_UNVERIFIED');
        reasons.push(`${ticker.minBrix}브릭스 이상 보장되지 않음`);
      }
      if (c.listedWeightKg < 0.6 * ticker.weightKg) {
        codes.push('GATE-03_BAIT_WEIGHT_OPTION');
        reasons.push(`${c.listedWeightKg}kg 소포장 옵션: 목표 ${ticker.weightKg}kg의 60% 미만`);
      }
      const effective = calcEffectivePrice(c.listedPrice, c.shippingFee, c.listedWeightKg, ticker.weightKg);
      if (effective < ticker.wholesalePrice + 2000) {
        codes.push('GATE-04_DUMP_OUTLIER');
        reasons.push(`실질 환산가 ${effective.toLocaleString('ko-KR')}원은 도매가 + 2,000원 미만인 덤핑 이상치`);
      }
      const shipWarn = c.shippingFee > 0 && c.shippingFee / c.listedPrice > 0.35;
      let reason = codes.length > 0
        ? `제외: ${reasons.join('; ')}`
        : `통과: 배송비 ${c.shippingFee.toLocaleString('ko-KR')}원 합산, ${ticker.weightKg}kg 실질 환산가 ${effective.toLocaleString('ko-KR')}원`;
      if (shipWarn) reason += '; [FLAG_SHIPPING_BAIT] 배송비 주의 (상품가의 35% 초과)';
      return {
        ...c,
        effective3KgOr5KgPrice: effective,
        isPassed: codes.length === 0,
        gateCode: codes[0] || 'GATE_PASS',
        verdictReason: reason
      };
    });

    const passed = evaluated.filter((c) => c.isPassed).sort((a, b) => a.effective3KgOr5KgPrice - b.effective3KgOr5KgPrice);
    if (passed.length > 0) {
      const best = passed[0];
      const idx = evaluated.findIndex((c) => c.id === best.id);
      evaluated[idx] = {
        ...best,
        gateCode: 'GATE_PASS_LOWEST_ADOPTED',
        verdictReason: `채택(실질 최저가): ${best.verdictReason}`
      };
    }
    return {
      evaluated,
      verifiedLowest: passed[0] ? passed[0].effective3KgOr5KgPrice : ticker.verifiedRetailLowestPrice,
      rejectedCount: evaluated.length - passed.length,
      passedCount: passed.length,
      adoptedMall: passed[0] ? passed[0].mallName : ''
    };
  }

  function computeOptimalPrice(ticker, asks, bids) {
    const totalAsk = asks.reduce((s, a) => s + a.quantity, 0);
    const totalBid = bids.reduce((s, b) => s + b.quantity, 0);
    const obi = totalAsk + totalBid > 0 ? (totalBid - totalAsk) / (totalBid + totalAsk) : 0;
    const mid = 0.48 * ticker.wholesalePrice + 0.52 * ticker.verifiedRetailLowestPrice;
    const raw = mid + 0.08 * obi * (ticker.verifiedRetailLowestPrice - ticker.wholesalePrice);
    const lower = Math.ceil((ticker.wholesalePrice + 500) / 100) * 100;
    const upper = Math.floor((ticker.verifiedRetailLowestPrice - 500) / 100) * 100;
    return Math.max(lower, Math.min(upper, roundToTick(raw, 100)));
  }

  function createSeedState() {
    const now = Date.now();
    const minAgo = (m) => new Date(now - m * 60000).toISOString();

    const tickers = {
      'JJ-GYUL-12B-3KG': {
        code: 'JJ-GYUL-12B-3KG',
        name: '12브릭스 노지 감귤 3kg',
        origin: '제주 서귀포 노지',
        minBrix: 12,
        weightKg: 3.0,
        grade: '로얄과 (특등급)',
        openPrice: 12000,
        currentPrice: 12400,
        highPrice: 12800,
        lowPrice: 11800,
        wholesalePrice: 9200,
        verifiedRetailLowestPrice: 15800,
        aiOptimalPrice: 12600,
        executionStrength: 118.4
      },
      'CD-BANSI-13B-5KG': {
        code: 'CD-BANSI-13B-5KG',
        name: '청도 명품 반시 대과 5kg',
        origin: '경북 청도군 화양읍',
        minBrix: 13,
        weightKg: 5.0,
        grade: '대과 (특품)',
        openPrice: 19500,
        currentPrice: 18900,
        highPrice: 19600,
        lowPrice: 18500,
        wholesalePrice: 14000,
        verifiedRetailLowestPrice: 24800,
        aiOptimalPrice: 19500,
        executionStrength: 86.2
      }
    };

    const asks = {
      'JJ-GYUL-12B-3KG': [
        { price: 12800, quantity: 84 },
        { price: 12700, quantity: 58 },
        { price: 12600, quantity: 96 },
        { price: 12500, quantity: 64 },
        { price: 12400, quantity: 38 }
      ],
      'CD-BANSI-13B-5KG': [
        { price: 19300, quantity: 62 },
        { price: 19200, quantity: 88 },
        { price: 19100, quantity: 75 },
        { price: 19000, quantity: 110 },
        { price: 18900, quantity: 54 }
      ]
    };

    const bids = {
      'JJ-GYUL-12B-3KG': [
        { price: 12300, quantity: 92 },
        { price: 12200, quantity: 115 },
        { price: 12100, quantity: 54 },
        { price: 12000, quantity: 76 },
        { price: 11900, quantity: 41 },
        { price: 11800, quantity: 29 }
      ],
      'CD-BANSI-13B-5KG': [
        { price: 18800, quantity: 48 },
        { price: 18700, quantity: 66 },
        { price: 18600, quantity: 82 },
        { price: 18500, quantity: 39 },
        { price: 18400, quantity: 30 },
        { price: 18300, quantity: 25 }
      ]
    };

    const trades = {
      'JJ-GYUL-12B-3KG': [
        { id: 'TRD-101', tickerCode: 'JJ-GYUL-12B-3KG', price: 12400, quantity: 12, side: 'BUY', executedAt: minAgo(1) },
        { id: 'TRD-102', tickerCode: 'JJ-GYUL-12B-3KG', price: 12400, quantity: 5, side: 'BUY', executedAt: minAgo(2) },
        { id: 'TRD-103', tickerCode: 'JJ-GYUL-12B-3KG', price: 12300, quantity: 8, side: 'SELL', executedAt: minAgo(4) },
        { id: 'TRD-104', tickerCode: 'JJ-GYUL-12B-3KG', price: 12400, quantity: 30, side: 'BUY', executedAt: minAgo(6) },
        { id: 'TRD-105', tickerCode: 'JJ-GYUL-12B-3KG', price: 12400, quantity: 4, side: 'BUY', executedAt: minAgo(8) },
        { id: 'TRD-106', tickerCode: 'JJ-GYUL-12B-3KG', price: 12300, quantity: 15, side: 'SELL', executedAt: minAgo(11) }
      ],
      'CD-BANSI-13B-5KG': [
        { id: 'TRD-201', tickerCode: 'CD-BANSI-13B-5KG', price: 18900, quantity: 6, side: 'SELL', executedAt: minAgo(1) },
        { id: 'TRD-202', tickerCode: 'CD-BANSI-13B-5KG', price: 18900, quantity: 10, side: 'SELL', executedAt: minAgo(3) },
        { id: 'TRD-203', tickerCode: 'CD-BANSI-13B-5KG', price: 19000, quantity: 4, side: 'BUY', executedAt: minAgo(5) },
        { id: 'TRD-204', tickerCode: 'CD-BANSI-13B-5KG', price: 18900, quantity: 18, side: 'SELL', executedAt: minAgo(9) },
        { id: 'TRD-205', tickerCode: 'CD-BANSI-13B-5KG', price: 18900, quantity: 7, side: 'SELL', executedAt: minAgo(12) }
      ]
    };

    const rawCandidates = {
      'JJ-GYUL-12B-3KG': [
        {
          id: 'EC-G1', mallName: '오픈마켓 A몰 (네이버쇼핑)', productTitle: '[특가] 제주 노지 감귤 달콤 과즙팡팡',
          listedPrice: 9900, shippingFee: 4500, listedWeightKg: 1.0, guaranteedBrix: 12, gradeText: '로얄과 특등급',
          sourceUrl: 'https://search.shopping.naver.com/search/all?query=%EC%A0%9C%EC%A3%BC+%EB%85%B8%EC%A7%80+%EA%B0%90%EA%B7%A4+1kg'
        },
        {
          id: 'EC-G2', mallName: '오픈마켓 B몰 (11번가)', productTitle: '제주 산지직송 노지 감귤 3kg 가정용 혼합과',
          listedPrice: 11500, shippingFee: 3000, listedWeightKg: 3.0, guaranteedBrix: 9, gradeText: '가정용 파지/혼합',
          sourceUrl: 'https://www.11st.co.kr/search/Search.tmall?kwd=%EC%A0%9C%EC%A3%BC+%EB%85%B8%EC%A7%80+%EA%B0%90%EA%B7%A4+3kg'
        },
        {
          id: 'EC-G3', mallName: '소셜커머스 C몰 (G마켓)', productTitle: '서귀포 고당도 12브릭스 노지감귤 3kg 로얄과',
          listedPrice: 11900, shippingFee: 5000, listedWeightKg: 3.0, guaranteedBrix: 12, gradeText: '로얄과 특등급',
          sourceUrl: 'https://www.gmarket.co.kr/n/search?keyword=12%EB%B8%8C%EB%A6%AD%EC%8A%A4+%EB%85%B8%EC%A7%80%EA%B0%90%EA%B7%A4+3kg'
        },
        {
          id: 'EC-G4', mallName: '산지직송 D몰 (쿠팡 로켓프레시)', productTitle: '[비파괴당도선별] 12브릭스 보장 제주 노지감귤 3kg 로얄과 무료배송',
          listedPrice: 15800, shippingFee: 0, listedWeightKg: 3.0, guaranteedBrix: 12, gradeText: '로얄과 특등급',
          sourceUrl: 'https://www.coupang.com/np/search?q=12%EB%B8%8C%EB%A6%AD%EC%8A%A4+%EB%85%B8%EC%A7%80%EA%B0%90%EA%B7%A4+3kg'
        },
        {
          id: 'EC-G5', mallName: '백화점몰 E몰 (SSG닷컴)', productTitle: '제주 명품 12브릭스 노지 감귤 선물세트 3kg',
          listedPrice: 17500, shippingFee: 0, listedWeightKg: 3.0, guaranteedBrix: 12, gradeText: '로얄과 특등급',
          sourceUrl: 'https://www.ssg.com/search.ssg?query=12%EB%B8%8C%EB%A6%AD%EC%8A%A4+%EB%85%B8%EC%A7%80%EA%B0%90%EA%B7%A4+3kg'
        }
      ],
      'CD-BANSI-13B-5KG': [
        {
          id: 'EC-B1', mallName: '오픈마켓 A몰 (네이버쇼핑)', productTitle: '씨없는 청도 반시 감 홍시용 초특가',
          listedPrice: 12900, shippingFee: 4000, listedWeightKg: 2.5, guaranteedBrix: 13, gradeText: '중소과',
          sourceUrl: 'https://search.shopping.naver.com/search/all?query=%EC%B2%AD%EB%8F%84+%EB%B0%98%EC%8B%9C+2.5kg'
        },
        {
          id: 'EC-B2', mallName: '오픈마켓 B몰 (11번가)', productTitle: '청도 반시 5kg 가정용 주스/홍시용 파지 포함',
          listedPrice: 15900, shippingFee: 3500, listedWeightKg: 5.0, guaranteedBrix: 10, gradeText: '가정용 파지',
          sourceUrl: 'https://www.11st.co.kr/search/Search.tmall?kwd=%EC%B2%AD%EB%8F%84+%EB%B0%98%EC%8B%9C+5kg'
        },
        {
          id: 'EC-B3', mallName: '산지직송 C몰 (청도몰/쿠팡)', productTitle: '[청도군인증] 13브릭스 청도 명품 반시 대과 5kg 무료배송',
          listedPrice: 24800, shippingFee: 0, listedWeightKg: 5.0, guaranteedBrix: 13, gradeText: '대과 특품',
          sourceUrl: 'https://www.coupang.com/np/search?q=13%EB%B8%8C%EB%A6%AD%EC%8A%A4+%EC%B2%AD%EB%8F%84+%EB%B0%98%EC%8B%9C+%EB%8C%80%EA%B3%BC+5kg'
        },
        {
          id: 'EC-B4', mallName: '오픈마켓 D몰 (G마켓)', productTitle: '청도 화양 명품 반시 대과 5kg 특등급 선물용',
          listedPrice: 23000, shippingFee: 3500, listedWeightKg: 5.0, guaranteedBrix: 13, gradeText: '대과 특품',
          sourceUrl: 'https://www.gmarket.co.kr/n/search?keyword=%EC%B2%AD%EB%8F%84+%EB%B0%98%EC%8B%9C+%EB%8C%80%EA%B3%BC+5kg'
        },
        {
          id: 'EC-B5', mallName: '백화점몰 E몰 (SSG닷컴)', productTitle: '경북 청도 명품 반시 대과 5kg 산지직송 특품',
          listedPrice: 27200, shippingFee: 0, listedWeightKg: 5.0, guaranteedBrix: 13, gradeText: '대과 특품',
          sourceUrl: 'https://www.ssg.com/search.ssg?query=%EC%B2%AD%EB%8F%84+%EB%B0%98%EC%8B%9C+%EB%8C%80%EA%B3%BC+5kg'
        }
      ]
    };

    const verifiedCandidates = {};
    for (const code of Object.keys(tickers)) {
      const res = evaluateCandidates(tickers[code], rawCandidates[code]);
      verifiedCandidates[code] = res.evaluated;
      tickers[code].verifiedRetailLowestPrice = res.verifiedLowest;
      tickers[code].aiOptimalPrice = computeOptimalPrice(tickers[code], asks[code], bids[code]);
    }

    return {
      tickers,
      asks,
      bids,
      trades,
      verifiedCandidates,
      virtualBalance: 500000,
      sellerPendingSettlement: 189000,
      totalConsumerSaved: 124800,
      totalFarmerExtraEarned: 142600,
      contractSeq: 2,
      tradeSeq: 300,
      cartContracts: [
        {
          contractId: 'CTR-2026-001',
          tickerCode: 'JJ-GYUL-12B-3KG',
          itemName: '12브릭스 노지 감귤 3kg',
          executedPrice: 12400,
          quantity: 2,
          totalPaidAmount: 24800,
          savedVsRetailAmount: 6800,
          farmerExtraGainAmount: 6400,
          status: 'CONTRACT_EXECUTED',
          recipientName: null,
          recipientPhone: null,
          shippingAddress: null,
          executedAt: minAgo(10),
          shippedAt: null
        }
      ]
    };
  }

  state = createSeedState();

  function buildOrderBook(code) {
    const ticker = state.tickers[code] || state.tickers['JJ-GYUL-12B-3KG'];
    const asks = [...state.asks[ticker.code]]
      .filter((a) => a.quantity > 0)
      .sort((a, b) => b.price - a.price)
      .map((a) => ({
        price: a.price,
        quantity: a.quantity,
        changeRatePercent: Number((((a.price - ticker.openPrice) / ticker.openPrice) * 100).toFixed(2))
      }));
    const bids = [...state.bids[ticker.code]]
      .filter((b) => b.quantity > 0)
      .sort((a, b) => b.price - a.price)
      .map((b) => ({
        price: b.price,
        quantity: b.quantity,
        changeRatePercent: Number((((b.price - ticker.openPrice) / ticker.openPrice) * 100).toFixed(2))
      }));
    return {
      ticker,
      asks,
      bids,
      totalAskQuantity: asks.reduce((s, a) => s + a.quantity, 0),
      totalBidQuantity: bids.reduce((s, b) => s + b.quantity, 0),
      recentTrades: state.trades[ticker.code].slice(0, 8),
      verifiedCandidates: state.verifiedCandidates[ticker.code]
    };
  }

  function buildWallet() {
    return {
      virtualBalance: state.virtualBalance,
      sellerPendingSettlement: state.sellerPendingSettlement,
      totalConsumerSaved: state.totalConsumerSaved,
      totalFarmerExtraEarned: state.totalFarmerExtraEarned,
      cartContracts: state.cartContracts
    };
  }

  function parseNaturalInput(text, fallbackCode) {
    const raw = (text || '').trim();
    const lower = raw.toLowerCase();
    if (lower.includes('ignore previous') || lower.includes('system prompt') || lower.includes('<script')) {
      return { safe: false, warning: '프롬프트 인젝션 및 비정상 제어 명령 패턴이 감지되어 차단되었습니다.' };
    }
    const isBansi = raw.includes('반시') || raw.includes('청도') || raw.includes('5kg') || (!raw.includes('귤') && fallbackCode === 'CD-BANSI-13B-5KG');
    const code = isBansi ? 'CD-BANSI-13B-5KG' : 'JJ-GYUL-12B-3KG';
    const ticker = state.tickers[code];
    const qtyMatch = raw.match(/(\d+)\s*(?:박스|상자|개)/);
    const qty = qtyMatch ? Math.max(1, Math.min(1000, parseInt(qtyMatch[1], 10))) : 20;
    const optPrice = computeOptimalPrice(ticker, state.asks[code], state.bids[code]);
    return {
      safe: true,
      code,
      ticker,
      qty,
      optPrice
    };
  }

  function jsonResponse(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init && init.method ? init.method : 'GET').toUpperCase();

    if (url.includes('/api/health')) {
      return jsonResponse({
        status: 'Healthy',
        copilotSessionMode: 'STATIC_DEMO_SIMULATION_READY',
        toolExecutionMode: 'DETERMINISTIC_AIFUNCTION_ENGINE'
      });
    }

    if (url.endsWith('/api/tickers') && method === 'GET') {
      return jsonResponse(Object.values(state.tickers));
    }

    const obMatch = url.match(/\/api\/tickers\/([^/]+)\/orderbook/);
    if (obMatch && method === 'GET') {
      const code = decodeURIComponent(obMatch[1]);
      return jsonResponse(buildOrderBook(code));
    }

    if (url.endsWith('/api/wallet-and-cart') && method === 'GET') {
      return jsonResponse(buildWallet());
    }

    if (url.endsWith('/api/demo/reset') && method === 'POST') {
      state = createSeedState();
      return jsonResponse({
        success: true,
        message: '데모 호가창, 가상 예수금(500,000원), 체결 장바구니가 초기 시드 상태로 복원되었습니다.',
        walletAndCart: buildWallet(),
        tickers: Object.values(state.tickers)
      });
    }

    if (url.endsWith('/api/farmers/natural-quote') && method === 'POST') {
      const body = init && init.body ? JSON.parse(init.body) : {};
      const parsed = parseNaturalInput(body.naturalText, 'JJ-GYUL-12B-3KG');
      if (!parsed.safe) {
        return jsonResponse({
          isSafeInput: false,
          safetyWarning: parsed.warning,
          matchedTickerCode: 'JJ-GYUL-12B-3KG',
          matchedItemName: '12브릭스 노지 감귤 3kg',
          extractedQuantity: 0,
          wholesalePrice: 0,
          verifiedRetailPrice: 0,
          recommendedAskPrice: 0,
          expectedExtraGainPerBox: 0,
          expectedTotalExtraGain: 0,
          reasoningSummary: parsed.warning
        });
      }
      const { ticker, qty, optPrice } = parsed;
      const gainPerBox = optPrice - ticker.wholesalePrice;
      return jsonResponse({
        isSafeInput: true,
        matchedTickerCode: ticker.code,
        matchedItemName: ticker.name,
        extractedQuantity: qty,
        wholesalePrice: ticker.wholesalePrice,
        verifiedRetailPrice: ticker.verifiedRetailLowestPrice,
        recommendedAskPrice: optPrice,
        expectedExtraGainPerBox: gainPerBox,
        expectedTotalExtraGain: gainPerBox * qty,
        reasoningSummary: `[${ticker.code}] ${ticker.name} ${qty}박스 정규화 완료 → 도매가(${ticker.wholesalePrice.toLocaleString('ko-KR')}원)와 인터넷 실질최저가(${ticker.verifiedRetailLowestPrice.toLocaleString('ko-KR')}원) 사이 상생 최적 호가 ${optPrice.toLocaleString('ko-KR')}원 산출`,
        executionMode: 'DETERMINISTIC_AIFUNCTION',
        copilotSessionMode: 'STATIC_DEMO_SIMULATION_READY'
      });
    }

    if (url.endsWith('/api/agents/verify-stream') && method === 'POST') {
      const body = init && init.body ? JSON.parse(init.body) : {};
      const parsed = parseNaturalInput(body.query, body.tickerCode || 'JJ-GYUL-12B-3KG');
      const ticker = parsed.safe ? parsed.ticker : state.tickers['JJ-GYUL-12B-3KG'];
      const optPrice = parsed.safe ? parsed.optPrice : ticker.aiOptimalPrice;
      const cands = state.verifiedCandidates[ticker.code];
      const rejectedCount = cands.filter((c) => !c.isPassed).length;

      const steps = parsed.safe
        ? [
            {
              stepId: 'STEP-1',
              agentName: 'SpecNormalizerAgent',
              status: 'COMPLETED',
              toolName: 'parse_produce_spec + lookup_standard_ticker',
              summary: `규격 정규화 완료: [${ticker.code}] ${ticker.name} (${parsed.qty}박스)`,
              executionLatencyMs: 42,
              executionMode: 'DETERMINISTIC_AIFUNCTION'
            },
            {
              stepId: 'STEP-2',
              agentName: 'PriceDiscoveryAgent',
              status: 'COMPLETED',
              toolName: 'search_ecommerce_listings + fetch_wholesale_benchmark',
              summary: `원본 소매 후보 ${cands.length}건, 산지 도매 기준가 ${ticker.wholesalePrice.toLocaleString('ko-KR')}원 확보`,
              executionLatencyMs: 65,
              executionMode: 'DETERMINISTIC_AIFUNCTION'
            },
            {
              stepId: 'STEP-3',
              agentName: 'BaitFilterVerifierAgent',
              status: 'COMPLETED',
              toolName: 'calculate_effective_price + evaluate_bait_rules + verify_four_gate_lowest_price',
              summary: `4-Gate 검증: 미끼 상품 ${rejectedCount}건 제외, 실질 최저가 ${ticker.verifiedRetailLowestPrice.toLocaleString('ko-KR')}원 채택`,
              executionLatencyMs: 58,
              executionMode: 'DETERMINISTIC_AIFUNCTION'
            },
            {
              stepId: 'STEP-4',
              agentName: 'OptimalQuoteAdvisorAgent',
              status: 'COMPLETED',
              toolName: 'get_order_book_snapshot + compute_win_win_optimal_quote',
              summary: `상생 최적 추천호가 ${optPrice.toLocaleString('ko-KR')}원 산출 (농가 +${(optPrice - ticker.wholesalePrice).toLocaleString('ko-KR')}원 / 소비자 -${(ticker.verifiedRetailLowestPrice - optPrice).toLocaleString('ko-KR')}원)`,
              executionLatencyMs: 37,
              executionMode: 'DETERMINISTIC_AIFUNCTION'
            },
            {
              stepId: 'STEP-5',
              agentName: 'AuditorGuardrailAgent',
              status: 'AUDIT_PASSED',
              toolName: 'audit_quote_invariants',
              summary: `AUDIT_PASSED: 도매가(${ticker.wholesalePrice.toLocaleString('ko-KR')}원) < 추천호가(${optPrice.toLocaleString('ko-KR')}원) < 인터넷최저가(${ticker.verifiedRetailLowestPrice.toLocaleString('ko-KR')}원) 불변식 및 100원 호가 단위 검증 완료`,
              executionLatencyMs: 29,
              executionMode: 'DETERMINISTIC_AIFUNCTION'
            }
          ]
        : [
            {
              stepId: 'STEP-0',
              agentName: 'PromptShieldGuardrail',
              status: 'BLOCKED',
              toolName: 'ValidateAndSanitize',
              summary: parsed.warning,
              executionLatencyMs: 12,
              executionMode: 'DETERMINISTIC_AIFUNCTION'
            }
          ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          for (const step of steps) {
            await new Promise((r) => setTimeout(r, 180));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(step)}\n\n`));
          }
          controller.close();
        }
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' }
      });
    }

    if (url.endsWith('/api/orders') && method === 'POST') {
      const req = init && init.body ? JSON.parse(init.body) : {};
      const ticker = state.tickers[req.tickerCode] || state.tickers['JJ-GYUL-12B-3KG'];
      const isBuy = String(req.side).toUpperCase() === 'BUY';
      const isMarket = String(req.orderType).toUpperCase() === 'MARKET';
      const qty = Math.max(1, Number(req.quantity) || 1);
      const targetPrice = Number(req.price) || ticker.currentPrice;

      if (!isMarket) {
        if (targetPrice <= ticker.wholesalePrice || targetPrice >= ticker.verifiedRetailLowestPrice) {
          return jsonResponse({
            success: false,
            message: `[상생 가격 밴드 위반] 주문 호가(${targetPrice.toLocaleString('ko-KR')}원)는 도매 하한(${ticker.wholesalePrice.toLocaleString('ko-KR')}원) 초과, 인터넷 최저가 상한(${ticker.verifiedRetailLowestPrice.toLocaleString('ko-KR')}원) 미만이어야 합니다.`,
            updatedOrderBook: buildOrderBook(ticker.code)
          }, 400);
        }
        if (targetPrice % 100 !== 0) {
          return jsonResponse({
            success: false,
            message: '호가 단위는 100원 단위여야 합니다.',
            updatedOrderBook: buildOrderBook(ticker.code)
          }, 400);
        }
      }

      const opposite = isBuy ? state.asks[ticker.code] : state.bids[ticker.code];
      const ownBook = isBuy ? state.bids[ticker.code] : state.asks[ticker.code];
      opposite.sort((a, b) => (isBuy ? a.price - b.price : b.price - a.price));

      let remaining = qty;
      let totalPaid = 0;
      for (const level of opposite) {
        if (remaining <= 0 || level.quantity <= 0) continue;
        const canMatch = isMarket || (isBuy ? level.price <= targetPrice : level.price >= targetPrice);
        if (!canMatch) continue;
        const fill = Math.min(remaining, level.quantity);
        level.quantity -= fill;
        remaining -= fill;
        totalPaid += fill * level.price;
        ticker.currentPrice = level.price;
        ticker.highPrice = Math.max(ticker.highPrice, level.price);
        ticker.lowPrice = Math.min(ticker.lowPrice, level.price);
        state.trades[ticker.code].unshift({
          id: `FILL-${++state.tradeSeq}`,
          tickerCode: ticker.code,
          price: level.price,
          quantity: fill,
          side: isBuy ? 'BUY' : 'SELL',
          executedAt: new Date().toISOString()
        });
      }

      const matched = qty - remaining;
      const restingQty = isMarket ? 0 : remaining;
      if (restingQty > 0) {
        const existing = ownBook.find((l) => l.price === targetPrice);
        if (existing) existing.quantity += restingQty;
        else ownBook.push({ price: targetPrice, quantity: restingQty });
      }

      let createdContract = null;
      if (matched > 0) {
        state.sellerPendingSettlement += totalPaid;
        state.totalFarmerExtraEarned += totalPaid - ticker.wholesalePrice * matched;
        if (isBuy) {
          state.virtualBalance = Math.max(0, state.virtualBalance - totalPaid);
          state.totalConsumerSaved += ticker.verifiedRetailLowestPrice * matched - totalPaid;
          createdContract = {
            contractId: `CTR-2026-00${state.contractSeq++}`,
            tickerCode: ticker.code,
            itemName: ticker.name,
            executedPrice: roundToTick(totalPaid / matched, 100),
            quantity: matched,
            totalPaidAmount: totalPaid,
            savedVsRetailAmount: ticker.verifiedRetailLowestPrice * matched - totalPaid,
            farmerExtraGainAmount: totalPaid - ticker.wholesalePrice * matched,
            status: 'CONTRACT_EXECUTED',
            recipientName: null,
            recipientPhone: null,
            shippingAddress: null,
            executedAt: new Date().toISOString(),
            shippedAt: null
          };
          state.cartContracts.unshift(createdContract);
        }
      }

      ticker.aiOptimalPrice = computeOptimalPrice(ticker, state.asks[ticker.code], state.bids[ticker.code]);
      const msg = `[${isBuy ? '매수' : '매도'}] ${matched}박스 체결, ${restingQty}박스 지정가 대기, 체결 총액 ${totalPaid.toLocaleString('ko-KR')}원`;
      return jsonResponse({
        success: true,
        message: msg,
        matchedQuantity: matched,
        restingQuantity: restingQty,
        averageExecutionPrice: matched > 0 ? roundToTick(totalPaid / matched, 100) : 0,
        totalExecutedAmount: totalPaid,
        virtualBalance: state.virtualBalance,
        createdContract,
        updatedOrderBook: buildOrderBook(ticker.code)
      });
    }

    const shipMatch = url.match(/\/api\/cart\/([^/]+)\/ship/);
    if (shipMatch && method === 'POST') {
      const contractId = decodeURIComponent(shipMatch[1]);
      const req = init && init.body ? JSON.parse(init.body) : {};
      const c = state.cartContracts.find((item) => item.contractId === contractId);
      if (!c) {
        return jsonResponse({ success: false, message: '체결 계약을 찾을 수 없습니다.' }, 404);
      }
      const name = String(req.recipientName || '김청도').trim();
      const maskedName = name.length <= 2 ? `${name[0]}*` : `${name[0]}${'*'.repeat(name.length - 2)}${name[name.length - 1]}`;
      const addrTokens = String(req.shippingAddress || '경상북도 청도군').trim().split(/\s+/);
      const maskedAddr = `${addrTokens.slice(0, 2).join(' ')} **** (세션 격리·비식별 처리됨)`;
      c.status = 'SHIPPING_STARTED';
      c.recipientName = maskedName;
      c.recipientPhone = '010-****-0419';
      c.shippingAddress = maskedAddr;
      c.shippedAt = new Date().toISOString();
      return jsonResponse({
        success: true,
        message: `[배송 시작 완료] ${c.itemName} (${c.quantity}박스) 산지 출고가 시작되었습니다. 수령지: ${c.shippingAddress}`,
        contract: c,
        walletAndCart: buildWallet()
      });
    }

    return origFetch(input, init);
  };
})();
