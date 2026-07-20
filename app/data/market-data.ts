export type RegionalBenchmark = {
  name: string;
  average3ldk: number;
  yoy: number;
  sqmPrice: number;
  sqmYoy: number;
  kind: "target" | "comparison";
};

export type BuildingComparable = {
  period: string;
  floorBand: string;
  area: number;
  layout: string;
  price: number;
  sqmPrice: number;
  quality: "B" | "C";
  note: string;
};

export type PriceTrendPoint = {
  period: string;
  value: number;
  sampleCount: number;
  status: "actual" | "provisional";
};

export type PriceForecastPoint = {
  period: string;
  midpoint: number;
  baselineMidpoint: number;
  low: number;
  high: number;
  baseGrowthPercent: number;
  redevelopmentContributionBps: number;
  status: "nowcast" | "forecast";
};

export type PriceTrendSeries = {
  id: string;
  name: string;
  kind: "target" | "aggregate" | "comparison";
  color: string;
  dash: string;
  points: PriceTrendPoint[];
  forecast: PriceForecastPoint[];
};

const forecastSignals = {
  priceYoy: 1.5,
  volumeYoy: -12.8,
  inventoryYoy: 19.0,
};

const noRedevelopmentAdjustment = { 2026: 0, 2027: 0 };
const suginamiRedevelopmentAdjustment = {
  // Known projects are assumed to be reflected in current comparables and the
  // June market signal. Only the small, incremental change in certainty is
  // added to the 2027 growth rate; the annual safeguard is +/-25bp.
  2026: 0,
  2027: 5,
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * A deliberately conservative v0 projection. It shrinks noisy ward-level
 * momentum toward the latest Tokyo 23-ward signal and widens the interval
 * when the latest sample is small or historical returns are volatile.
 */
function buildForecast(
  points: PriceTrendPoint[],
  redevelopmentBps = noRedevelopmentAdjustment,
): PriceForecastPoint[] {
  const values = points.map((point) => point.value);
  const latest = values.at(-1) ?? 0;
  const previous = values.at(-2) ?? latest;
  const threeYearsAgo = values.at(-4) ?? values[0] ?? latest;
  const latestSample = points.at(-1)?.sampleCount ?? 0;
  const latestGrowth = previous > 0 ? latest / previous - 1 : 0;
  const recentCagr = threeYearsAgo > 0 ? (latest / threeYearsAgo) ** (1 / 3) - 1 : 0;
  const wardScore = clampNumber(0.6 * latestGrowth + 0.4 * recentCagr, -0.05, 0.1);

  // June price momentum is the fast signal. Falling volume and rising stock
  // are disclosed alongside it, but are handled through shrinkage and the
  // uncertainty band instead of an opaque point-estimate adjustment.
  const marketSignal = forecastSignals.priceYoy / 100;
  const baseGrowth2026 = 0.75 * marketSignal + 0.25 * wardScore;
  const baseGrowth2027 = 0.75 * 0.01 + 0.25 * 0.7 * wardScore;
  const growth2026 = baseGrowth2026 + redevelopmentBps[2026] / 10_000;
  const growth2027 = baseGrowth2027 + redevelopmentBps[2027] / 10_000;
  const baselineMidpoint2026 = latest * (1 + baseGrowth2026);
  const baselineMidpoint2027 = baselineMidpoint2026 * (1 + baseGrowth2027);
  const midpoint2026 = latest * (1 + growth2026);
  const midpoint2027 = midpoint2026 * (1 + growth2027);

  const logReturns = values.slice(1).map((value, index) => Math.log(value / values[index]));
  const volatility = standardDeviation(logReturns);
  const liquidityStress = Math.max(0, -forecastSignals.volumeYoy / 100) * 0.04
    + Math.max(0, forecastSignals.inventoryYoy / 100) * 0.03;
  const annualSigma = clampNumber(
    0.55 * volatility + 0.025 + liquidityStress + 0.15 / Math.sqrt(Math.max(latestSample, 1)),
    0.065,
    0.16,
  );
  const range = (midpoint: number, horizon: number) => {
    const distance = 1.28 * annualSigma * Math.sqrt(horizon);
    return {
      low: roundOne(midpoint * Math.exp(-distance)),
      high: roundOne(midpoint * Math.exp(distance)),
    };
  };
  const range2026 = range(midpoint2026, 1);
  const range2027 = range(midpoint2027, 2);

  return [
    {
      period: "2026",
      midpoint: roundOne(midpoint2026),
      baselineMidpoint: roundOne(baselineMidpoint2026),
      ...range2026,
      baseGrowthPercent: roundOne(baseGrowth2026 * 100),
      redevelopmentContributionBps: redevelopmentBps[2026],
      status: "nowcast",
    },
    {
      period: "2027",
      midpoint: roundOne(midpoint2027),
      baselineMidpoint: roundOne(baselineMidpoint2027),
      ...range2027,
      baseGrowthPercent: roundOne(baseGrowth2027 * 100),
      redevelopmentContributionBps: redevelopmentBps[2027],
      status: "forecast",
    },
  ];
}

const priceTrendRows = [
  {
    id: "tokyo23",
    name: "東京23区",
    kind: "aggregate" as const,
    color: "#17312d",
    dash: "8 5",
    values: [65.5, 69.2, 73.8, 80.0, 83.3, 90.0, 95.4],
    samples: [3085, 3290, 3251, 2821, 2898, 3070, 2247],
  },
  {
    id: "suginami",
    name: "杉並区",
    kind: "target" as const,
    color: "#1e685c",
    dash: "",
    values: [80.0, 83.3, 90.0, 93.3, 91.4, 101.5, 105.8],
    samples: [119, 130, 131, 96, 115, 106, 94],
  },
  {
    id: "nakano",
    name: "中野区",
    kind: "comparison" as const,
    color: "#52769a",
    dash: "4 4",
    values: [80.0, 81.7, 92.3, 91.7, 100.0, 108.4, 120.0],
    samples: [59, 66, 57, 59, 61, 70, 58],
  },
  {
    id: "setagaya",
    name: "世田谷区",
    kind: "comparison" as const,
    color: "#9a7356",
    dash: "12 5",
    values: [81.7, 84.5, 92.3, 98.2, 102.1, 114.3, 118.1],
    samples: [263, 328, 260, 221, 222, 234, 174],
  },
  {
    id: "nerima",
    name: "練馬区",
    kind: "comparison" as const,
    color: "#756a87",
    dash: "2 5",
    values: [58.3, 58.7, 64.6, 69.2, 72.3, 78.5, 80.0],
    samples: [228, 225, 202, 162, 197, 187, 133],
  },
  {
    id: "shinjuku",
    name: "新宿区",
    kind: "comparison" as const,
    color: "#b05d43",
    dash: "10 4 2 4",
    values: [100.0, 100.0, 108.0, 109.1, 120.0, 129.4, 189.5],
    samples: [77, 79, 80, 57, 88, 103, 67],
  },
  {
    id: "shibuya",
    name: "渋谷区",
    kind: "comparison" as const,
    color: "#c28a2e",
    dash: "3 3",
    values: [117.7, 117.6, 122.2, 146.7, 200.0, 171.4, 242.9],
    samples: [40, 57, 57, 39, 44, 48, 41],
  },
];

const priceTrendSeries: PriceTrendSeries[] = priceTrendRows.map((row) => {
  const points = row.values.map((value, index) => ({
    period: String(2019 + index),
    value,
    sampleCount: row.samples[index],
    status: index === row.values.length - 1 ? "provisional" as const : "actual" as const,
  }));

  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    color: row.color,
    dash: row.dash,
    points,
    forecast: buildForecast(
      points,
      row.id === "suginami" ? suginamiRedevelopmentAdjustment : noRedevelopmentAdjustment,
    ),
  };
});

const suginamiNowcast = priceTrendSeries.find((series) => series.id === "suginami")?.forecast[0];
const suginamiForecast = priceTrendSeries.find((series) => series.id === "suginami")?.forecast ?? [];
const suginamiOutlook = suginamiForecast.find((forecast) => forecast.period === "2027");
const suginamiNowcastText = suginamiNowcast
  ? `${suginamiNowcast.midpoint.toFixed(1)}万円/㎡（80%レンジ ${suginamiNowcast.low.toFixed(1)}〜${suginamiNowcast.high.toFixed(1)}万円/㎡）`
  : "算出待ち";

export const marketSnapshot = {
  asOf: "2026-07-21T12:00:00+09:00",
  asOfLabel: "2026年7月21日 12:00 JST",
  latestMarketPeriod: "2026年6月",
  property: {
    name: "パークシティ杉並 セントラルタワー",
    areaLabel: "杉並区・方南町エリア",
    built: "2000年（築約26年）",
    station: "方南町駅 徒歩圏（分譲時資料）",
    floors: 28,
    towerUnits: 204,
    totalDevelopmentUnits: 243,
    structure: "RC・免震構造",
    developerNote: "竹中工務店 設計・施工",
  },
  estimate: {
    low: 8280,
    midpoint: 8840,
    high: 9640,
    referenceArea: 75.1,
    referenceFloor: 14,
    baseSqmPrice: 117.7,
    confidence: "C",
    sampleCount: 3,
    note: "公開された同一棟の参考成約をもとにした3LDKの暫定レンジ。個別住戸の査定額ではありません。",
  },
  buildingComparables: [
    {
      period: "2025/12",
      floorBand: "中層",
      area: 72.82,
      layout: "3LDK",
      price: 8280,
      sqmPrice: 113.7,
      quality: "B",
      note: "独自収集の参考成約表示",
    },
    {
      period: "2026/02",
      floorBand: "高層",
      area: 75.1,
      layout: "2SLDK",
      price: 8990,
      sqmPrice: 119.7,
      quality: "B",
      note: "間取り近似の参考成約表示",
    },
    {
      period: "2026/02",
      floorBand: "高層",
      area: 78.98,
      layout: "3LDK",
      price: 9640,
      sqmPrice: 122.1,
      quality: "B",
      note: "独自収集の参考成約表示",
    },
  ] satisfies BuildingComparable[],
  weeklyTokyo23: {
    weekLabel: "2026年7月14日〜20日",
    status: "価格は高値圏、成約の勢いは鈍化",
    lead:
      "今週は、7月17日公表の東日本REINS四半期データで『価格上昇と件数減少』がより鮮明になりました。東京23区の公的な週次成約統計はないため、最新の月次・四半期公表を週次で読み直しています。",
    indicators: [
      {
        label: "23区 成約件数",
        value: "4,803件",
        change: "前年同期 −13.2%",
        direction: "down",
        kind: "CLOSE",
        period: "2026年4〜6月",
      },
      {
        label: "23区 成約㎡単価",
        value: "136.22万円",
        change: "前年同期 +5.1%",
        direction: "up",
        kind: "CLOSE",
        period: "2026年4〜6月",
      },
      {
        label: "23区 6月成約㎡単価",
        value: "131.15万円",
        change: "前月 −0.1%",
        direction: "down",
        kind: "CLOSE",
        period: "2026年6月",
      },
      {
        label: "23区 募集賃料",
        value: "5,118円/㎡",
        change: "前月 +0.8%",
        direction: "up",
        kind: "RENT",
        period: "2026年6月・7/16公表",
      },
      {
        label: "城西 在庫件数",
        value: "4,707件",
        change: "前年比 +19.0%",
        direction: "down",
        kind: "INVENTORY",
        period: "2026年6月",
      },
      {
        label: "フラット35 最頻金利",
        value: "3.14%",
        change: "前月 −0.07pt",
        direction: "up",
        kind: "RATE",
        period: "2026年7月",
      },
    ],
    movements: [
      {
        label: "価格",
        title: "成約単価は上昇を維持",
        detail: "23区の4〜6月成約㎡単価は前年比+5.1%。高値圏そのものは崩れていません。",
        tone: "positive",
      },
      {
        label: "流動性",
        title: "取引件数は二桁減",
        detail: "同じ期間の成約件数は前年比−13.2%。価格だけでなく、売れるまでの時間を見る局面です。",
        tone: "risk",
      },
      {
        label: "賃料",
        title: "保有価値の下支え材料",
        detail: "23区のファミリー型募集賃料は前月比+0.8%、前年比+6.6%。ただし募集賃料であり成約賃料ではありません。",
        tone: "caution",
      },
      {
        label: "金利",
        title: "固定金利は小幅低下",
        detail: "7月のフラット35最頻金利は3.14%。前月より下がりましたが、借入負担はなお高い水準です。",
        tone: "neutral",
      },
    ],
    watchNext: [
      "東京カンテイの6月分・70㎡価格",
      "日銀の7月30〜31日 金融政策決定会合",
      "東日本REINSの7月月例データ",
    ],
    interpretation:
      "売り手優位の価格水準は続く一方、何でも早く売れる相場ではありません。同一棟・近い面積の成約根拠を優先し、売出価格と成約価格を分けて判断するのが今週の要点です。",
  },
  priceTrend: {
    title: "3LDK取引㎡単価の推移と予測",
    metric: "中古マンション3LDK・取引㎡単価の年次中央値",
    unit: "万円 / ㎡",
    basePeriod: "2019",
    latestActualPeriod: "2025",
    actualPeriods: ["2019", "2020", "2021", "2022", "2023", "2024", "2025"],
    forecastPeriods: ["2026", "2027"],
    series: priceTrendSeries,
    currentSignals: [
      {
        label: "23区 6月成約㎡単価",
        value: `前年比 +${forecastSignals.priceYoy.toFixed(1)}%`,
        direction: "up",
      },
      {
        label: "23区 6月成約件数",
        value: `前年比 −${Math.abs(forecastSignals.volumeYoy).toFixed(1)}%`,
        direction: "down",
      },
      {
        label: "城西 6月在庫",
        value: `前年比 +${forecastSignals.inventoryYoy.toFixed(1)}%`,
        direction: "down",
      },
    ],
    model: {
      name: "階層縮小＋再開発差分モデル v0.2",
      trainedThrough: "2025年（暫定）",
      nowcastAsOf: "2026年6月指標",
      confidence: "低〜中",
      updateRule:
        "区ごとの直近伸びを上限付きで評価し、東京23区の最新月次シグナルへ75%縮小。再開発は既知計画の総額ではなく、新しい着工・供用確定・延期など『確度の前年差分』だけを最大±0.25ポイント/年で加えます。",
      validation:
        "本番更新では公表日基準のローリング検証を行い、単純な据え置き予測を上回らない場合は保守モデルへ自動で戻す設計です。",
    },
    methodology:
      "国土交通省の不動産取引価格情報から、東京23区の中古マンション等・間取り3LDKを抽出。各取引の総額を面積で割り、区・年ごとの中央値を算出しています。23区は13101〜13123の全取引をまとめた中央値です。",
    caveat:
      "2025年は第4四半期の回答が今後追加される可能性があるため暫定値です。建築年・駅距離・所在・階・室内状態などの構成差は未調整で、個別住戸の査定や公的な価格指数ではありません。再開発の実現・延期・住宅供給増も不確実で、2026年ナウキャストと2027年予測は将来価格を保証しません。",
  },
  redevelopment: {
    asOfLabel: "2026年7月21日確認",
    title: "周辺再開発・まちづくりウォッチ",
    lead:
      "方南町生活圏の防災・歩行環境と、笹塚・中野・新宿の駅周辺更新を公式資料で追跡しています。対象棟への影響は距離、交通上のつながり、事業段階、供用時期、住宅供給を分けて評価します。",
    currentEstimateAdjustmentBps: 0,
    currentEstimateNote:
      "現在の3LDK参考価格は直近の公開事例を基準にしており、既に公表済みの計画期待を別途上乗せしません。二重計上を避けるため、現状価格への追加補正は0.00ポイントです。",
    forecastBreakdown: suginamiForecast.map((forecast) => ({
      period: forecast.period,
      label: forecast.status === "nowcast" ? "ナウキャスト" : "予測",
      baselineMidpoint: forecast.baselineMidpoint,
      adjustedMidpoint: forecast.midpoint,
      baseGrowthPercent: forecast.baseGrowthPercent,
      contributionBps: forecast.redevelopmentContributionBps,
    })),
    projects: [
      {
        id: "honan-one",
        name: "方南一丁目 防災まちづくり",
        area: "方南町生活圏",
        stage: "ルール検討中",
        stageTone: "watch",
        timing: "2027年度以降に手続き／助成は2030年度末まで",
        relation: "生活圏内・直接",
        effect: "道路・空地・不燃化",
        summary:
          "2024年に計画を策定し、2026年5月までに3回のルール検討会を実施。大規模複合開発ではなく、小街区の防災性と住環境を長期的に底上げする取り組みです。",
        priceChannel: "防災リスクの緩和は追い風。ただし規制・届出はまだ導入前で、短期効果は限定的。",
        contribution2027Bps: 1,
        confidence: "事業 高／価格波及 低〜中",
        sourceLabel: "杉並区",
        sourceUrl: "https://www.city.suginami.tokyo.jp/s095/1670.html",
      },
      {
        id: "honan-barrier-free",
        name: "方南町駅周辺 バリアフリー特定事業",
        area: "方南町駅周辺",
        stage: "実施中",
        stageTone: "progress",
        timing: "2023〜2030年度",
        relation: "最寄駅周辺・直接",
        effect: "駅・道路・バス動線",
        summary:
          "駅と生活関連施設を結ぶ経路の段差、案内、歩行環境などを継続改善。確認できる範囲で、方南町駅前の大規模複合再開発ではありません。",
        priceChannel: "高齢者・子育て世帯を含む歩きやすさを小幅に評価。",
        contribution2027Bps: 1,
        confidence: "実施 高／価格波及 低",
        sourceLabel: "杉並区",
        sourceUrl: "https://www.city.suginami.tokyo.jp/s092/6223.html",
      },
      {
        id: "nakano-station",
        name: "中野駅 西改札・南北通路・駅前広場",
        area: "中野駅周辺",
        stage: "供用日確定",
        stageTone: "progress",
        timing: "西改札・南北通路 2026年12月6日／広場 2028〜2029年度",
        relation: "隣接区・間接",
        effect: "回遊性・バリアフリー・商業",
        summary:
          "西改札、橋上駅舎、南北通路と一部デッキが2026年12月に供用予定。駅前広場はその後も段階整備されます。",
        priceChannel: "中野駅利用物件への効果が中心。杉並には地域比較を通じて小さく波及。",
        contribution2027Bps: 2,
        confidence: "供用 高／杉並波及 低〜中",
        sourceLabel: "中野区・JR東日本",
        sourceUrl: "https://www.city.tokyo-nakano.lg.jp/kusei/public/houdou/2026/20260707press.html",
      },
      {
        id: "sasazuka-south",
        name: "笹塚駅南口東地区",
        area: "笹塚駅周辺",
        stage: "建設中",
        stageTone: "progress",
        timing: "2028年ごろを目標",
        relation: "近隣生活圏・間接",
        effect: "住宅・商業・広場",
        summary:
          "住宅約650戸を中心に商業・業務・交流機能、広場や歩行者空間を整備。生活利便の向上と新築供給の増加が同時に進みます。",
        priceChannel: "アメニティ向上は追い風、新規供給は競合要因。ネットでは小幅プラスに限定。",
        contribution2027Bps: 1,
        confidence: "事業 高／価格方向 低〜中",
        sourceLabel: "三井不動産・渋谷区",
        sourceUrl: "https://www.city.shibuya.tokyo.jp/kankyo/sasazuka/kento-sasazuka/sasadukaeki-minami_machidukuri.html",
      },
      {
        id: "shinjuku-west",
        name: "新宿駅西口地区開発",
        area: "新宿駅周辺",
        stage: "工事中",
        stageTone: "progress",
        timing: "2029年度竣工予定",
        relation: "丸ノ内線側・遠隔",
        effect: "雇用・商業・歩行者動線",
        summary:
          "地上48階の複合開発と歩行者ネットワークを整備。2029年度予定は維持されていますが、方南町への波及は間接的です。",
        priceChannel: "沿線需要の説明材料にはするが、2027年までの価格補正には加えない。",
        contribution2027Bps: 0,
        confidence: "事業 高／杉並波及 低",
        sourceLabel: "東京都",
        sourceUrl: "https://www.shinjuku-kojiinfo.metro.tokyo.lg.jp/author/author21232/inprogress_01.html",
      },
      {
        id: "nakano-north",
        name: "中野駅新北口・サンプラザ跡",
        area: "中野駅周辺",
        stage: "計画見直し中",
        stageTone: "review",
        timing: "2034年度は想定・変更可能",
        relation: "隣接区・間接",
        effect: "計画内容・時期とも未確定",
        summary:
          "旧基本協定は解除され、2026年度は事業計画の再検討段階。2034年度竣工は現時点の想定プロセスで、確定時期ではありません。",
        priceChannel: "確度が足りないため近い将来の上昇要因として数値計上しない。",
        contribution2027Bps: 0,
        confidence: "再計画 中／時期 低〜中",
        sourceLabel: "中野区",
        sourceUrl: "https://www.city.tokyo-nakano.lg.jp/machizukuri/machizukuri/nakanoekisyuhen/kaiken_message.html",
      },
    ],
    model: {
      name: "再開発差分モデル v0.1",
      annualCapBps: 25,
      rule:
        "事業種別 × 杉並への影響範囲 × 交通関連性 × 段階確度 × 供用接近度から期待寄与を評価し、住宅供給による競合を控除します。同じ計画の期待水準を毎年足さず、前回確認から確度が変わった分だけを成長率へ反映します。",
      currentTreatment:
        "2026年は0.00ポイント。既知計画の大半は現在価格や6月市場シグナルに含まれうるためです。2027年は供用接近と計画進捗のネット差分として+0.05ポイントだけ加えます。",
      guardrail:
        "1案件と全案件に上限を設け、延期・中止・大量供給はマイナス更新も可能にします。ローリング検証で単純予測を上回らない場合は数値寄与を停止します。",
      disclaimer:
        "再開発効果は実現時期、市場の織り込み度、工事負担、住宅供給に左右されます。価格上昇を保証せず、査定・投資助言ではありません。",
    },
  },
  regionalBenchmarks: [
    { name: "杉並区", average3ldk: 8399, yoy: 9.72, sqmPrice: 97.7, sqmYoy: 2.55, kind: "target" },
    { name: "東京都", average3ldk: 8035, yoy: 12.52, sqmPrice: 110.4, sqmYoy: 8.52, kind: "comparison" },
    { name: "東京23区", average3ldk: 9440, yoy: 15.33, sqmPrice: 121.1, sqmYoy: 9.61, kind: "comparison" },
    { name: "中野区", average3ldk: 8589, yoy: 5.68, sqmPrice: 107.9, sqmYoy: 9.34, kind: "comparison" },
    { name: "世田谷区", average3ldk: 9531, yoy: 12.72, sqmPrice: 108.0, sqmYoy: 6.61, kind: "comparison" },
    { name: "練馬区", average3ldk: 5837, yoy: 4.69, sqmPrice: 78.4, sqmYoy: -2.0, kind: "comparison" },
  ] satisfies RegionalBenchmark[],
  marketPulse: {
    area: "東京都 城西地区（新宿・渋谷・杉並・中野）",
    closed: {
      count: 269,
      countYoy: -17.2,
      price: 8470,
      priceYoy: 1.3,
      sqmPrice: 164.37,
      sqmPriceYoy: 6.4,
    },
    newListings: {
      count: 1752,
      countYoy: 19.4,
      sqmPrice: 192.59,
      sqmPriceYoy: 11.3,
    },
    inventory: {
      count: 4707,
      countYoy: 19.0,
      sqmPrice: 199.93,
      sqmPriceYoy: 19.0,
    },
    askCloseGap: 17.2,
  },
  aiAnalysis: {
    state: "observe" as const,
    title: "高値圏だが、成約の鈍化を見極める週",
    summary:
      `パークシティ杉並 セントラルタワーの3LDK参考価格は8,280万〜9,640万円。杉並区3LDKの2026年ナウキャストは${suginamiNowcastText}ですが、区全体の参考推計です。再開発は現在価格へ重ねて足さず、2027年の確度差分だけ+0.05ポイント反映しました。価格は高値圏でも成約件数は減っており、同一棟の新しい成約と事業の節目を確認する局面です。`,
    positives: [
      "東京23区の4〜6月成約㎡単価は前年比 +5.1%",
      "23区のファミリー型募集賃料は6月に前月比 +0.8%",
      `杉並区3LDKの2026年ナウキャスト中心は${suginamiNowcast?.midpoint.toFixed(1) ?? "算出待ち"}万円/㎡`,
      `再開発差分を含む杉並区3LDKの2027年中心は${suginamiOutlook?.midpoint.toFixed(1) ?? "算出待ち"}万円/㎡`,
    ],
    risks: [
      "東京23区の4〜6月成約件数は前年比 −13.2%",
      "城西地区では在庫と新規売出がともに前年比約 +19%",
      "笹塚の新規住宅供給は生活利便向上と競合増の両面があり、中野新北口は再計画中",
      "予測信頼度は低〜中。2025年は暫定で、築年・駅距離などの構成差は未調整",
    ],
    nextActions: [
      "同一棟・近い面積の新規成約が出たら価格レンジを更新",
      "売出価格ではなく、想定成約価格と販売期間をセットで比較",
      "次回の月次統計、日銀会合、再開発の着工・供用・延期など公式な段階変化で再計算",
    ],
    confidence: "C（公開情報3件を中心に推定）",
    generatedAt: "2026-07-21T12:00:00+09:00",
    nextReview: "2026-07-27",
  },
  updateSchedule: [
    {
      cadence: "営業日",
      time: "11:17 JST",
      label: "金利・再開発の段階変化チェック",
      detail: "公的データ源の更新、着工・供用・延期・計画解除を確認。単なる予定の再掲では評価額を動かしません。",
      status: "自動チェック",
    },
    {
      cadence: "毎週 月曜",
      time: "07:17 JST",
      label: "東京23区の今週・まちづくり・AIコメント更新",
      detail: "新しい公表資料を読み、価格・流動性・再開発の確度差分・次の注目日を更新します。",
      status: "自動更新",
    },
    {
      cadence: "毎月",
      time: "公表後",
      label: "REINS・70㎡価格更新",
      detail: "城西地区の成約・新規売出・在庫と、23区の70㎡売出価格を反映します。",
      status: "公表待ち",
    },
    {
      cadence: "四半期",
      time: "1・4・7・10月",
      label: "23区・杉並区の取引データ更新",
      detail: "国交省の取引個票を再集計し、時系列・予測誤差・再開発あり/なしの精度・建物の参考レンジを見直します。",
      status: "公表待ち",
    },
  ],
  sources: [
    {
      label: "Market Watch 2026年4〜6月期",
      publisher: "東日本不動産流通機構",
      url: "https://www.reins.or.jp/pdf/trend/sf/sf_202604-06.pdf.pdf",
      tier: "A",
      usage: "東京23区の成約件数・価格・㎡単価",
    },
    {
      label: "Market Watch 2026年6月",
      publisher: "東日本不動産流通機構",
      url: "https://www.reins.or.jp/pdf/trend/mw/MW_202606data.pdf",
      tier: "A",
      usage: "城西地区の成約・新規登録・在庫",
    },
    {
      label: "中古マンション価格 70㎡換算",
      publisher: "東京カンテイ",
      url: "https://www.kantei.ne.jp/report/category/70m2/",
      tier: "B",
      usage: "東京23区の売出価格トレンド",
    },
    {
      label: "分譲マンション賃料 2026年6月",
      publisher: "東京カンテイ",
      url: "https://www.kantei.ne.jp/wp-content/uploads/T202606.pdf",
      tier: "B",
      usage: "東京23区のファミリー型募集賃料",
    },
    {
      label: "不動産取引価格情報 CSV",
      publisher: "国土交通省",
      url: "https://www.reinfolib.mlit.go.jp/realEstatePrices/",
      tier: "A",
      usage: "2019〜2025年の3LDK取引㎡単価・件数を独自集計",
    },
    {
      label: "方南一丁目地区のまちづくり",
      publisher: "杉並区",
      url: "https://www.city.suginami.tokyo.jp/s095/1670.html",
      tier: "A",
      usage: "防災まちづくり計画・ルール検討の段階確認",
    },
    {
      label: "杉並区バリアフリー基本構想",
      publisher: "杉並区",
      url: "https://www.city.suginami.tokyo.jp/s092/6223.html",
      tier: "A",
      usage: "方南町駅周辺の特定事業と進捗確認",
    },
    {
      label: "中野駅西側南北通路・橋上駅舎の供用",
      publisher: "中野区・JR東日本",
      url: "https://www.city.tokyo-nakano.lg.jp/kusei/public/houdou/2026/20260707press.html",
      tier: "A",
      usage: "供用日、駅前広場・デッキの段階整備",
    },
    {
      label: "笹塚駅南口地区まちづくり",
      publisher: "渋谷区",
      url: "https://www.city.shibuya.tokyo.jp/kankyo/sasazuka/kento-sasazuka/sasadukaeki-minami_machidukuri.html",
      tier: "A",
      usage: "都市計画・複合機能・歩行者空間",
    },
    {
      label: "新宿駅西口地区開発計画",
      publisher: "東京都",
      url: "https://www.shinjuku-kojiinfo.metro.tokyo.lg.jp/author/author21232/inprogress_01.html",
      tier: "A",
      usage: "工事段階と2029年度竣工予定",
    },
    {
      label: "中野駅新北口駅前エリア見直し",
      publisher: "中野区",
      url: "https://www.city.tokyo-nakano.lg.jp/machizukuri/machizukuri/nakanoekisyuhen/kaiken_message.html",
      tier: "A",
      usage: "旧計画解除後の再計画段階・想定工程",
    },
    {
      label: "パークシティ杉並 分譲時資料",
      publisher: "三井不動産",
      url: "https://www.mitsuifudosan.co.jp/corporate/news/1999/0430_02/",
      tier: "A",
      usage: "物件基本情報",
    },
    {
      label: "パークシティ杉並 参考相場・売買履歴",
      publisher: "IESHIL",
      url: "https://www.ieshil.com/buildings/663386/",
      tier: "B",
      usage: "同一棟の参考成約",
    },
    {
      label: "金融政策決定会合の予定",
      publisher: "日本銀行",
      url: "https://www.boj.or.jp/mopo/mpmsche_minu/index.htm",
      tier: "A",
      usage: "住宅ローン環境の次回確認日",
    },
    {
      label: "フラット35 金利情報",
      publisher: "住宅金融支援機構",
      url: "https://www.flat35.com/loan/index.html",
      tier: "A",
      usage: "全期間固定金利の月次確認",
    },
  ],
};

export type MarketSnapshot = typeof marketSnapshot;
