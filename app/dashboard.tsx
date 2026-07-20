"use client";

import { useMemo, useState } from "react";
import type { MarketSnapshot } from "./data/market-data";
import { PriceTrendChart } from "./price-trend-chart";

type Advice = MarketSnapshot["aiAnalysis"];

type DashboardProps = {
  snapshot: MarketSnapshot;
};

type HomeInputs = {
  area: string;
  floor: string;
  orientation: string;
  renovation: string;
};

const numberFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 0,
});

function formatPrice(value: number) {
  return `${numberFormatter.format(Math.round(value))}万円`;
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundToTen(value: number) {
  return Math.round(value / 10) * 10;
}

function formatBasisPoints(basisPoints: number) {
  if (basisPoints === 0) return "0.00pt";
  return `${basisPoints > 0 ? "+" : "−"}${(Math.abs(basisPoints) / 100).toFixed(2)}pt`;
}

export function Dashboard({ snapshot }: DashboardProps) {
  const [inputs, setInputs] = useState<HomeInputs>({
    area: "",
    floor: "",
    orientation: "",
    renovation: "",
  });
  const [advice, setAdvice] = useState<Advice>(snapshot.aiAnalysis);
  const [adviceSource, setAdviceSource] = useState<"scheduled" | "rules">("scheduled");
  const [refreshMessage, setRefreshMessage] = useState("");

  const valuation = useMemo(() => {
    const rawArea = Number(inputs.area);
    const rawFloor = Number(inputs.floor);
    const hasArea = Number.isFinite(rawArea) && rawArea >= 45 && rawArea <= 115;
    const hasFloor = Number.isFinite(rawFloor) && rawFloor >= 1 && rawFloor <= snapshot.property.floors;
    const hasOrientation = Boolean(inputs.orientation);
    const hasRenovation = Boolean(inputs.renovation);
    const inputCount = [hasArea, hasFloor, hasOrientation, hasRenovation].filter(Boolean).length;

    if (inputCount === 0) {
      return {
        low: snapshot.estimate.low,
        midpoint: snapshot.estimate.midpoint,
        high: snapshot.estimate.high,
        confidence: "C",
        confidenceLabel: "標準住戸の参考値",
        inputCount,
      };
    }

    let midpoint = hasArea
      ? rawArea * snapshot.estimate.baseSqmPrice
      : snapshot.estimate.midpoint;

    if (hasFloor) {
      const floorAdjustment = clamp(
        (rawFloor - snapshot.estimate.referenceFloor) * 0.0035,
        -0.05,
        0.05,
      );
      midpoint *= 1 + floorAdjustment;
    }

    const orientationAdjustment: Record<string, number> = {
      south: 0.02,
      southeast: 0.015,
      southwest: 0.012,
      east: 0,
      west: -0.005,
      north: -0.02,
    };
    midpoint *= 1 + (orientationAdjustment[inputs.orientation] ?? 0);

    const renovationAdjustment: Record<string, number> = {
      premium: 0.03,
      standard: 0.015,
      basic: 0.005,
    };
    midpoint *= 1 + (renovationAdjustment[inputs.renovation] ?? 0);

    const uncertainty = inputCount >= 4 ? 0.055 : inputCount >= 2 ? 0.07 : 0.085;
    midpoint = roundToTen(midpoint);

    return {
      low: roundToTen(midpoint * (1 - uncertainty)),
      midpoint,
      high: roundToTen(midpoint * (1 + uncertainty)),
      confidence: inputCount >= 4 ? "B" : "C+",
      confidenceLabel: inputCount >= 4 ? "主要条件を反映" : "一部条件を反映",
      inputCount,
    };
  }, [inputs, snapshot]);

  const redevelopmentProjection = useMemo(() => {
    const nowcast = snapshot.redevelopment.forecastBreakdown.find((item) => item.period === "2026");
    const outlook = snapshot.redevelopment.forecastBreakdown.find((item) => item.period === "2027");
    if (!nowcast || !outlook || nowcast.adjustedMidpoint <= 0 || nowcast.baselineMidpoint <= 0) return null;

    return {
      baseline: roundToTen(valuation.midpoint * (outlook.baselineMidpoint / nowcast.baselineMidpoint)),
      adjusted: roundToTen(valuation.midpoint * (outlook.adjustedMidpoint / nowcast.adjustedMidpoint)),
    };
  }, [snapshot.redevelopment.forecastBreakdown, valuation.midpoint]);

  const updateInput = (key: keyof HomeInputs, value: string) => {
    setInputs((current) => ({ ...current, [key]: value }));
  };

  const resetInputs = () => {
    setInputs({ area: "", floor: "", orientation: "", renovation: "" });
    setAdvice(snapshot.aiAnalysis);
    setAdviceSource("scheduled");
    setRefreshMessage("");
  };

  const refreshAdvice = () => {
    const conditionText = valuation.inputCount > 0
      ? `入力条件を反映した参考レンジは${formatPrice(valuation.low)}〜${formatPrice(valuation.high)}です。`
      : `標準住戸の参考レンジは${formatPrice(valuation.low)}〜${formatPrice(valuation.high)}です。`;

    setAdvice({
      ...snapshot.aiAnalysis,
      summary: `${conditionText} 東京23区では価格上昇と成約件数の減少が同時に起きています。再開発は既知情報の二重計上を避け、2027年の確度差分だけ+0.05ポイント反映しています。まず同一棟の直近成約と販売期間を確認し、売出価格ではなく成約見込みを基準に判断するのが妥当です。`,
      confidence: `${valuation.confidence}（入力条件の簡易補正）`,
      generatedAt: new Date().toISOString(),
    });
    setAdviceSource("rules");
    setRefreshMessage("入力条件を反映して、公開版の分析を更新しました。");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="杉並ホームバリュー トップへ">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>
            <strong>SUGINAMI</strong>
            <small>HOME VALUE WATCH</small>
          </span>
        </a>
        <nav className="topnav" aria-label="ページ内ナビゲーション">
          <a href="#valuation">3LDK相場</a>
          <a href="#trend">価格推移</a>
          <a href="#redevelopment">再開発</a>
          <a href="#weekly">東京23区の今週</a>
          <a href="#market">地域比較</a>
          <a href="#sources">データ</a>
        </nav>
        <div className="freshness-pill" title={`最終更新 ${snapshot.asOfLabel}`}>
          <span aria-hidden="true" />
          今週更新
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">PUBLIC MARKET MONITOR</p>
          <h1>{snapshot.property.name}</h1>
          <p className="hero-address">
            {snapshot.property.areaLabel} <span>・</span> {snapshot.property.station}
          </p>
          <div className="hero-tags" aria-label="物件概要">
            <span>28階建</span>
            <span>免震</span>
            <span>タワー204戸</span>
            <span>3LDK</span>
          </div>
        </div>

        <div className="hero-status">
          <div className="status-label">
            <span className="status-dot" aria-hidden="true" />
            今週の見立て
          </div>
          <strong>高値圏</strong>
          <span>価格は維持、成約の勢いは鈍化</span>
        </div>
      </section>

      <section className="building-profile" aria-labelledby="building-profile-title">
        <div>
          <p className="eyebrow">BUILDING PROFILE</p>
          <h2 id="building-profile-title">建物の主要情報</h2>
          <p>分譲時資料など、公開情報で確認できる建物全体の概要です。</p>
        </div>
        <dl>
          <div><dt>竣工</dt><dd>{snapshot.property.built}</dd></div>
          <div><dt>規模</dt><dd>地上{snapshot.property.floors}階建</dd></div>
          <div><dt>構造</dt><dd>{snapshot.property.structure}</dd></div>
          <div><dt>タワー戸数</dt><dd>{snapshot.property.towerUnits}戸</dd></div>
          <div><dt>設計・施工</dt><dd>{snapshot.property.developerNote}</dd></div>
        </dl>
      </section>

      <section className="valuation-grid" id="valuation" aria-labelledby="valuation-title">
        <article className="value-card primary-value-card">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">3LDK ESTIMATED VALUE</p>
              <h2 id="valuation-title">3LDKの参考価格</h2>
            </div>
            <span className={`confidence-badge confidence-${valuation.confidence.toLowerCase().replace("+", "plus")}`}>
              信頼度 {valuation.confidence}
            </span>
          </div>

          <div className="price-display">
            <strong>{formatPrice(valuation.midpoint)}</strong>
            <span>参考中央値</span>
          </div>
          <div className="range-line">
            <span>{formatPrice(valuation.low)}</span>
            <div aria-hidden="true"><i /></div>
            <span>{formatPrice(valuation.high)}</span>
          </div>
          <p className="range-caption">
            暫定レンジ ・ {valuation.confidenceLabel} ・ 公開参考事例 {snapshot.estimate.sampleCount}件
          </p>

          <div className="public-metric-grid">
            <div>
              <span>基準㎡単価</span>
              <strong>{snapshot.estimate.baseSqmPrice.toFixed(1)}万円</strong>
            </div>
            <div>
              <span>基準面積</span>
              <strong>{snapshot.estimate.referenceArea.toFixed(1)}㎡</strong>
            </div>
            <div>
              <span>対象</span>
              <strong>3LDK中心</strong>
            </div>
          </div>
          <p className="fine-print">
            {snapshot.estimate.note} 眺望・向き・室内状態・成約時期によって実際の価格は変わります。
          </p>
        </article>

        <article className="value-card input-card">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">REFINE THE RANGE</p>
              <h2>住戸条件で見る</h2>
            </div>
            <button className="text-button" type="button" onClick={resetInputs}>リセット</button>
          </div>
          <p className="card-lead">
            個人情報は保存しません。分かる項目だけを入れると、この画面内で参考レンジを補正します。
          </p>
          <div className="area-presets" aria-label="専有面積のクイック選択">
            <span>面積の目安</span>
            {[70, 75, 80].map((area) => (
              <button type="button" key={area} onClick={() => updateInput("area", String(area))}>
                {area}㎡
              </button>
            ))}
          </div>
          <div className="input-grid">
            <label>
              <span>専有面積</span>
              <div className="input-with-unit">
                <input
                  inputMode="decimal"
                  min="45"
                  max="115"
                  placeholder="例 75.10"
                  type="number"
                  value={inputs.area}
                  onChange={(event) => updateInput("area", event.target.value)}
                />
                <em>㎡</em>
              </div>
            </label>
            <label>
              <span>階数</span>
              <div className="input-with-unit">
                <input
                  inputMode="numeric"
                  min="1"
                  max={snapshot.property.floors}
                  placeholder="例 14"
                  type="number"
                  value={inputs.floor}
                  onChange={(event) => updateInput("floor", event.target.value)}
                />
                <em>階</em>
              </div>
            </label>
            <label>
              <span>主な方角</span>
              <select value={inputs.orientation} onChange={(event) => updateInput("orientation", event.target.value)}>
                <option value="">未入力</option>
                <option value="south">南</option>
                <option value="southeast">南東</option>
                <option value="southwest">南西</option>
                <option value="east">東</option>
                <option value="west">西</option>
                <option value="north">北</option>
              </select>
            </label>
            <label>
              <span>室内状態</span>
              <select value={inputs.renovation} onChange={(event) => updateInput("renovation", event.target.value)}>
                <option value="">未入力</option>
                <option value="premium">高品質・全面改修</option>
                <option value="standard">標準・全面改修</option>
                <option value="basic">部分改修</option>
              </select>
            </label>
          </div>
          <div className="privacy-note">
            <span aria-hidden="true">公</span>
            <div>
              <strong>公開サイト向けの表示です</strong>
              <p>住所、購入額、改修費、ローン・税情報など個人に紐づく情報は掲載していません。</p>
            </div>
          </div>
          <p className="fine-print">
            補正率は公開参考事例からの簡易推定です。個別の査定や鑑定評価ではありません。
          </p>
        </article>
      </section>

      <section className="section-block trend-section" id="trend" aria-labelledby="price-trend-title">
        <PriceTrendChart trend={snapshot.priceTrend} />
      </section>

      <section className="section-block redevelopment-section" id="redevelopment" aria-labelledby="redevelopment-title">
        <div className="section-heading redevelopment-heading">
          <div>
            <p className="eyebrow">REDEVELOPMENT &amp; URBAN CHANGE</p>
            <h2 id="redevelopment-title">{snapshot.redevelopment.title}</h2>
          </div>
          <p className="section-note">{snapshot.redevelopment.asOfLabel} ・ 公式一次資料</p>
        </div>

        <div className="redevelopment-lead">
          <p>{snapshot.redevelopment.lead}</p>
          <div aria-label="再開発の価格推計への反映概要">
            <span><small>現在価格</small><strong>{formatBasisPoints(snapshot.redevelopment.currentEstimateAdjustmentBps)}</strong></span>
            {snapshot.redevelopment.forecastBreakdown.map((item) => (
              <span key={item.period}>
                <small>{item.period}年</small>
                <strong>{formatBasisPoints(item.contributionBps)}</strong>
              </span>
            ))}
            <span><small>年次上限</small><strong>±{(snapshot.redevelopment.model.annualCapBps / 100).toFixed(2)}pt</strong></span>
          </div>
        </div>

        <div className="redevelopment-layout">
          <div className="redevelopment-timeline" role="list" aria-label="周辺再開発の進捗">
            {snapshot.redevelopment.projects.map((project) => (
              <article className="redevelopment-project" role="listitem" key={project.id}>
                <div className="redevelopment-marker" aria-hidden="true"><i /></div>
                <div className="redevelopment-project-body">
                  <div className="redevelopment-project-meta">
                    <span className={`redevelopment-stage stage-${project.stageTone}`}>{project.stage}</span>
                    <span>{project.timing}</span>
                  </div>
                  <div className="redevelopment-project-title">
                    <div>
                      <h3>{project.name}</h3>
                      <p>{project.area} ・ {project.relation}</p>
                    </div>
                    <span>{project.effect}</span>
                  </div>
                  <p className="redevelopment-summary">{project.summary}</p>
                  <div className="redevelopment-impact">
                    <p><strong>価格への経路</strong>{project.priceChannel}</p>
                    <div>
                      <span>2027寄与 {formatBasisPoints(project.contribution2027Bps)}</span>
                      <small>{project.confidence}</small>
                      <a href={project.sourceUrl} target="_blank" rel="noreferrer">{project.sourceLabel} ↗</a>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <aside className="redevelopment-model-card" aria-labelledby="redevelopment-model-title">
            <div className="redevelopment-model-header">
              <div><p className="eyebrow">FORECAST DECOMPOSITION</p><h3 id="redevelopment-model-title">価格推計への織り込み</h3></div>
              <span>{snapshot.redevelopment.model.name}</span>
            </div>

            <p className="redevelopment-current-note">{snapshot.redevelopment.currentEstimateNote}</p>

            <div className="redevelopment-forecast-table" role="table" aria-label="再開発反映前後の杉並区予測">
              <div className="redevelopment-forecast-row header" role="row">
                <span role="columnheader">年</span><span role="columnheader">基礎予測</span><span role="columnheader">再開発</span><span role="columnheader">反映後</span>
              </div>
              {snapshot.redevelopment.forecastBreakdown.map((item) => (
                <div className="redevelopment-forecast-row" role="row" key={item.period}>
                  <span role="cell"><strong>{item.period}</strong><small>{item.label}</small></span>
                  <span role="cell">{item.baselineMidpoint.toFixed(1)}<small>万円/㎡</small></span>
                  <span role="cell" className={item.contributionBps > 0 ? "positive" : ""}>{formatBasisPoints(item.contributionBps)}</span>
                  <span role="cell"><strong>{item.adjustedMidpoint.toFixed(1)}</strong><small>万円/㎡</small></span>
                </div>
              ))}
            </div>

            {redevelopmentProjection ? (
              <div className="redevelopment-building-projection">
                <span>対象棟3LDK・2027年参考中心</span>
                <strong>{formatPrice(redevelopmentProjection.adjusted)}</strong>
                <p>基礎 {formatPrice(redevelopmentProjection.baseline)} → 再開発反映後。現在の参考中央値に杉並区予測の伸びを機械的に当てた参考値です。</p>
              </div>
            ) : null}

            <div className="redevelopment-model-copy">
              <p>{snapshot.redevelopment.model.rule}</p>
              <p>{snapshot.redevelopment.model.currentTreatment}</p>
              <p>{snapshot.redevelopment.model.guardrail}</p>
            </div>

            <details className="redevelopment-method-details">
              <summary>採点と更新ルールを見る</summary>
              <ul>
                <li>構想・都市計画・着工・供用確定を別の確度で評価</li>
                <li>交通利便、生活機能、防災性、工事負担を分けて評価</li>
                <li>新築住宅の供給増は競合として控除</li>
                <li>同一案件は事業IDで重複排除し、予定の再掲では加点しない</li>
                <li>延期・中止はマイナス、供用後は実績で検証</li>
              </ul>
            </details>

            <p className="redevelopment-disclaimer">{snapshot.redevelopment.model.disclaimer}</p>
          </aside>
        </div>
      </section>

      <section className="section-block weekly-section" id="weekly" aria-labelledby="weekly-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">TOKYO 23 WARDS · THIS WEEK</p>
            <h2 id="weekly-title">東京23区の今週</h2>
          </div>
          <p className="section-note">{snapshot.weeklyTokyo23.weekLabel}</p>
        </div>

        <div className="weekly-lead">
          <span>今週の要約</span>
          <div>
            <strong>{snapshot.weeklyTokyo23.status}</strong>
            <p>{snapshot.weeklyTokyo23.lead}</p>
          </div>
        </div>

        <div className="weekly-stat-grid">
          {snapshot.weeklyTokyo23.indicators.map((indicator) => (
            <article key={indicator.label}>
              <div className="weekly-stat-meta">
                <span className={`data-kind kind-${indicator.kind.toLowerCase()}`}>{indicator.kind}</span>
                <small>{indicator.period}</small>
              </div>
              <p>{indicator.label}</p>
              <strong>{indicator.value}</strong>
              <em className={indicator.direction === "up" ? "positive" : "risk-text"}>{indicator.change}</em>
            </article>
          ))}
        </div>

        <div className="weekly-detail-grid">
          <div className="movement-list">
            {snapshot.weeklyTokyo23.movements.map((movement) => (
              <article key={movement.label} className={`movement movement-${movement.tone}`}>
                <span>{movement.label}</span>
                <div>
                  <strong>{movement.title}</strong>
                  <p>{movement.detail}</p>
                </div>
              </article>
            ))}
          </div>
          <aside className="watch-card">
            <p className="eyebrow">WHAT TO WATCH NEXT</p>
            <h3>次に動きやすい日</h3>
            <ul>
              {snapshot.weeklyTokyo23.watchNext.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <div>
              <strong>今週の読み方</strong>
              <p>{snapshot.weeklyTokyo23.interpretation}</p>
            </div>
          </aside>
        </div>
        <p className="market-footnote">
          週次の公的な成約統計はないため、直近に公表された月次・四半期データを毎週点検しています。ASK（売出）とCLOSE（成約）は別指標です。
        </p>
      </section>

      <section className="section-block" id="timing" aria-labelledby="timing-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">WEEKLY AI MARKET BRIEF</p>
            <h2 id="timing-title">動き出すタイミングの見方</h2>
          </div>
          <div className="analysis-meta">
            <span>{adviceSource === "rules" ? "入力条件を反映" : "週次AI生成"}</span>
            <span>次回確認 {advice.nextReview.replaceAll("-", ".")}</span>
          </div>
        </div>

        <div className="advice-layout">
          <article className="advice-main">
            <div className="recommendation-ribbon">
              <span>THIS WEEK</span>
              <strong>{advice.title}</strong>
            </div>
            <p className="advice-summary">{advice.summary}</p>
            <div className="evidence-columns">
              <div>
                <h3><span className="evidence-dot good" aria-hidden="true" />追い風</h3>
                <ul>{advice.positives.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
              <div>
                <h3><span className="evidence-dot risk" aria-hidden="true" />注意信号</h3>
                <ul>{advice.risks.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            </div>
            <div className="advice-actions">
              <h3>見るべき順番</h3>
              <ol>
                {advice.nextActions.map((item, index) => (
                  <li key={item}><span>{index + 1}</span><p>{item}</p></li>
                ))}
              </ol>
            </div>
            <div className="refresh-row">
              <button className="primary-button" type="button" onClick={refreshAdvice}>
                入力条件を分析に反映
              </button>
              <p aria-live="polite">{refreshMessage || `信頼度 ${advice.confidence}`}</p>
            </div>
          </article>

          <aside className="timing-panel" aria-label="市場タイミングの目安">
            <div className="timing-score">
              <span>MARKET TEMPERATURE</span>
              <strong>68</strong>
              <small>/ 100</small>
            </div>
            <div className="readiness-bar" aria-label="市場温度 68パーセント"><i style={{ width: "68%" }} /></div>
            <p>価格には追い風、売れやすさには慎重さが必要な状態です。</p>
            <div className="timing-steps">
              <div className="active">
                <span>いま</span>
                <strong>相場確認</strong>
                <p>同一棟の新しい成約と販売期間を確認</p>
              </div>
              <div>
                <span>次の材料</span>
                <strong>判断更新</strong>
                <p>月次統計と日銀会合後に再評価</p>
              </div>
              <div>
                <span>動く条件</span>
                <strong>根拠を揃える</strong>
                <p>近似成約2件以上と複数査定を比較</p>
              </div>
            </div>
            <div className="decision-gate">
              <span>公開版の判断ゲート</span>
              <strong>近い条件の成約が2件以上</strong>
              <p>売出価格ではなく、同一棟・近い面積・直近180日の成約根拠を優先します。</p>
            </div>
          </aside>
        </div>
      </section>

      <section className="section-block market-section" id="market" aria-labelledby="market-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">MARKET POSITION</p>
            <h2 id="market-title">杉並は東京と比べてどうか</h2>
          </div>
          <p className="section-note">2025年 3LDK実取引集計 ・ 単位：万円</p>
        </div>

        <div className="market-layout">
          <article className="benchmark-card">
            <div className="benchmark-header"><span>地域</span><span>平均価格</span><span>前年比</span></div>
            <div className="benchmark-list">
              {snapshot.regionalBenchmarks.map((region) => (
                <div className={region.kind === "target" ? "benchmark-row target" : "benchmark-row"} key={region.name}>
                  <strong>{region.name}</strong>
                  <div className="benchmark-bar-wrap">
                    <i style={{ width: `${(region.average3ldk / 10000) * 100}%` }} />
                    <span>{numberFormatter.format(region.average3ldk)}</span>
                  </div>
                  <em className={region.yoy >= 0 ? "positive" : "negative"}>{formatSignedPercent(region.yoy)}</em>
                </div>
              ))}
            </div>
            <div className="benchmark-takeaway">
              <span>読み取り</span>
              <p>
                杉並区は上昇中ですが、2025年の伸びは23区平均を
                <strong> 5.61ポイント下回りました。</strong>
                対象棟は区平均より上でも、東京全体の上昇をそのまま当てはめない方が安全です。
              </p>
            </div>
          </article>

          <article className="comp-card">
            <div className="card-title-row">
              <div><p className="eyebrow">BUILDING COMPARABLES</p><h3>同一棟の参考成約</h3></div>
              <span>Tier B</span>
            </div>
            <div className="comp-chart" aria-label="同一棟の参考成約価格">
              {snapshot.buildingComparables.map((comp) => (
                <div className="comp-row" key={`${comp.period}-${comp.area}`}>
                  <div><strong>{comp.floorBand}</strong><span>{comp.area.toFixed(2)}㎡・{comp.layout}</span></div>
                  <div className="comp-track"><i style={{ width: `${(comp.price / 10000) * 100}%` }} /><span>{numberFormatter.format(comp.price)}</span></div>
                  <small>{comp.period}</small>
                </div>
              ))}
            </div>
            <p className="fine-print">
              REINS原票ではなく独自収集の参考成約表示です。階数は公開向けに帯表示とし、売出価格と混在させていません。
            </p>
          </article>
        </div>

        <div className="pulse-grid">
          <article className="pulse-card">
            <div className="pulse-top"><span>成約</span><em className="risk-text">件数 {formatSignedPercent(snapshot.marketPulse.closed.countYoy)}</em></div>
            <strong>{numberFormatter.format(snapshot.marketPulse.closed.sqmPrice)}<small>万円 / ㎡</small></strong>
            <div className="pulse-footer"><span>前年比</span><b className="positive">{formatSignedPercent(snapshot.marketPulse.closed.sqmPriceYoy)}</b></div>
          </article>
          <article className="pulse-card">
            <div className="pulse-top"><span>新規売出</span><em>件数 {formatSignedPercent(snapshot.marketPulse.newListings.countYoy)}</em></div>
            <strong>{numberFormatter.format(snapshot.marketPulse.newListings.sqmPrice)}<small>万円 / ㎡</small></strong>
            <div className="pulse-footer"><span>前年比</span><b className="caution-text">{formatSignedPercent(snapshot.marketPulse.newListings.sqmPriceYoy)}</b></div>
          </article>
          <article className="pulse-card">
            <div className="pulse-top"><span>在庫</span><em>件数 {formatSignedPercent(snapshot.marketPulse.inventory.countYoy)}</em></div>
            <strong>{numberFormatter.format(snapshot.marketPulse.inventory.count)}<small>件</small></strong>
            <div className="pulse-footer"><span>前年比</span><b className="caution-text">{formatSignedPercent(snapshot.marketPulse.inventory.countYoy)}</b></div>
          </article>
          <article className="pulse-card gap-card">
            <div className="pulse-top"><span>新規売出 / 成約</span><em>粗い乖離</em></div>
            <strong>{snapshot.marketPulse.askCloseGap.toFixed(1)}<small>%</small></strong>
            <div className="pulse-footer"><span>買い手の選別</span><b className="caution-text">強まる</b></div>
          </article>
        </div>
        <p className="market-footnote">
          {snapshot.marketPulse.area}、{snapshot.latestMarketPeriod}。売出と成約は物件構成が異なるため、17.2%を値引率とは扱いません。
        </p>
      </section>

      <section className="section-block operations-section" aria-labelledby="operations-title">
        <div className="section-heading">
          <div><p className="eyebrow">UPDATE OPERATIONS</p><h2 id="operations-title">更新のしくみ</h2></div>
          <p className="section-note">最終チェック {snapshot.asOfLabel}</p>
        </div>
        <div className="schedule-list">
          {snapshot.updateSchedule.map((item) => (
            <article key={`${item.cadence}-${item.label}`}>
              <div className="schedule-cadence"><strong>{item.cadence}</strong><span>{item.time}</span></div>
              <div><h3>{item.label}</h3><p>{item.detail}</p></div>
              <span className={item.status.includes("自動") ? "schedule-status active" : "schedule-status"}>{item.status}</span>
            </article>
          ))}
        </div>
        <div className="operations-note">
          <strong>日次で価格を無理に動かしません。</strong>
          <p>公的な成約価格は月次・四半期更新です。新しいデータがない日は更新日時と注目材料だけを見直し、架空の値動きを作りません。</p>
        </div>
      </section>

      <section className="section-block sources-section" id="sources" aria-labelledby="sources-title">
        <div className="section-heading">
          <div><p className="eyebrow">DATA PROVENANCE</p><h2 id="sources-title">根拠データ</h2></div>
          <div className="tier-legend"><span>A 公的・一次</span><span>B 参考・二次</span></div>
        </div>
        <div className="source-table" role="table" aria-label="使用データソース">
          {snapshot.sources.map((source) => (
            <a href={source.url} target="_blank" rel="noreferrer" className="source-row" role="row" key={source.url}>
              <span className={`tier tier-${source.tier.toLowerCase()}`}>{source.tier}</span>
              <span><strong>{source.label}</strong><small>{source.publisher}</small></span>
              <span>{source.usage}</span>
              <b aria-hidden="true">↗</b>
            </a>
          ))}
        </div>
        <div className="method-strip">
          <span><b>ASK</b> 売出価格</span>
          <span><b>CLOSE</b> 成約価格</span>
          <span><b>INVENTORY</b> 在庫</span>
          <span><b>ESTIMATE</b> 推定値</span>
        </div>
      </section>

      <section className="disclaimer-card" aria-labelledby="disclaimer-title">
        <div className="disclaimer-mark" aria-hidden="true">!</div>
        <div>
          <p className="eyebrow">IMPORTANT NOTICE</p>
          <h2 id="disclaimer-title">利用上の重要な注意</h2>
          <p>
            掲載価格は公開情報から作成した参考推定で、実際の売却価格・将来価格を保証しません。更新の遅れ、集計対象の違い、誤差を含む可能性があります。
            本サイトは鑑定評価、媒介査定、投資・税務・法務上の助言ではなく、売買・保有その他の判断は利用者ご自身の責任で行ってください。
            本サイトの利用または掲載情報に基づく判断によって生じた損害について、運営者は法令上認められる範囲で責任を負いません。
          </p>
        </div>
      </section>

      <footer className="footer">
        <div><strong>SUGINAMI HOME VALUE WATCH</strong><p>建物の相場と東京23区のいまを、根拠とともに。</p></div>
        <p>本サイトは公開情報を整理した参考資料であり、鑑定評価・税務・法務・投資助言ではありません。個別の判断は宅地建物取引士等へご確認ください。</p>
      </footer>
    </main>
  );
}
