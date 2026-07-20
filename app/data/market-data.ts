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
  low: number;
  high: number;
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
  fixedRate: 3.14,
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
function buildForecast(points: PriceTrendPoint[]): PriceForecastPoint[] {
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
  const growth2026 = 0.75 * marketSignal + 0.25 * wardScore;
  const growth2027 = 0.75 * 0.01 + 0.25 * 0.7 * wardScore;
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
      ...range2026,
      status: "nowcast",
    },
    {
      period: "2027",
      midpoint: roundOne(midpoint2027),
      ...range2027,
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
    forecast: buildForecast(points),
  };
});

const suginamiNowcast = priceTrendSeries.find((series) => series.id === "suginami")?.forecast[0];
const suginamiNowcastText = suginamiNowcast
  ? `${suginamiNowcast.midpoint.toFixed(1)}万円/㎡（80%レンジ ${suginamiNowcast.low.toFixed(1)}〜${suginamiNowcast.high.toFixed(1)}万円/㎡）`
  : "算出待ち";

export const marketSnapshot = {
  asOf: "2026-07-20T23:30:00+09:00",
  asOfLabel: "2026年7月20日 23:30 JST",
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
      {
        label: "フラット35 7月",
        value: `${forecastSignals.fixedRate.toFixed(2)}%`,
        direction: "neutral",
      },
    ],
    model: {
      name: "階層縮小モデル v0.1",
      trainedThrough: "2025年（暫定）",
      nowcastAsOf: "2026年6月指標",
      confidence: "低〜中",
      updateRule:
        "区ごとの直近伸びを上限付きで評価し、東京23区の最新月次シグナルへ75%縮小。取引数、過去変動、件数減・在庫増に応じて80%レンジを拡大します。",
      validation:
        "本番更新では公表日基準のローリング検証を行い、単純な据え置き予測を上回らない場合は保守モデルへ自動で戻す設計です。",
    },
    methodology:
      "国土交通省の不動産取引価格情報から、東京23区の中古マンション等・間取り3LDKを抽出。各取引の総額を面積で割り、区・年ごとの中央値を算出しています。23区は13101〜13123の全取引をまとめた中央値です。",
    caveat:
      "2025年は第4四半期の回答が今後追加される可能性があるため暫定値です。建築年・駅距離・所在・階・室内状態などの構成差は未調整で、個別住戸の査定や公的な価格指数ではありません。2026年はナウキャスト、2027年は統計予測で、将来価格を保証しません。",
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
      `パークシティ杉並 セントラルタワーの3LDK参考価格は8,280万〜9,640万円。杉並区3LDKの2026年ナウキャストは${suginamiNowcastText}ですが、区全体の参考推計です。東京23区では成約単価が上がる一方、件数は減っており、同一棟の新しい成約と販売期間を確認する局面です。`,
    positives: [
      "東京23区の4〜6月成約㎡単価は前年比 +5.1%",
      "23区のファミリー型募集賃料は6月に前月比 +0.8%",
      `杉並区3LDKの2026年ナウキャスト中心は${suginamiNowcast?.midpoint.toFixed(1) ?? "算出待ち"}万円/㎡`,
    ],
    risks: [
      "東京23区の4〜6月成約件数は前年比 −13.2%",
      "城西地区では在庫と新規売出がともに前年比約 +19%",
      "予測信頼度は低〜中。2025年は暫定で、築年・駅距離などの構成差は未調整",
    ],
    nextActions: [
      "同一棟・近い面積の新規成約が出たら価格レンジを更新",
      "売出価格ではなく、想定成約価格と販売期間をセットで比較",
      "次回の月次統計と7月30〜31日の日銀会合後にナウキャストを再計算",
    ],
    confidence: "C（公開情報3件を中心に推定）",
    generatedAt: "2026-07-20T23:30:00+09:00",
    nextReview: "2026-07-27",
  },
  updateSchedule: [
    {
      cadence: "営業日",
      time: "11:17 JST",
      label: "金利・情報更新チェック",
      detail: "公的データ源の更新有無を確認。新しい価格データがなければ評価額は動かしません。",
      status: "自動チェック",
    },
    {
      cadence: "毎週 月曜",
      time: "07:17 JST",
      label: "東京23区の今週・AIコメント更新",
      detail: "新しい公表資料を読み、価格・流動性・次の注目日とナウキャスト入力を更新します。",
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
      detail: "国交省の取引個票を再集計し、時系列・予測誤差・建物の参考レンジを見直します。",
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
