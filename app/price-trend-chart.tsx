"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { MarketSnapshot, PriceTrendSeries } from "./data/market-data";

type PriceTrend = MarketSnapshot["priceTrend"];
type DisplayMode = "amount" | "index";

type ChartValue = {
  value: number;
  low?: number;
  high?: number;
  baseGrowthPercent?: number;
  redevelopmentContributionBps?: number;
  sampleCount?: number;
  status: "actual" | "provisional" | "nowcast" | "forecast";
};

const chartWidth = 1000;
const chartHeight = 430;
const plot = { left: 76, right: 974, top: 24, bottom: 370 };

function formatAmount(value: number) {
  return `${value.toFixed(1)}万円/㎡`;
}

function formatIndex(value: number) {
  return `${value.toFixed(1)}`;
}

function statusLabel(status: ChartValue["status"]) {
  if (status === "provisional") return "暫定";
  if (status === "nowcast") return "ナウキャスト";
  if (status === "forecast") return "予測";
  return "実績";
}

function valueForPeriod(series: PriceTrendSeries, period: string): ChartValue | null {
  const actual = series.points.find((point) => point.period === period);
  if (actual) {
    return {
      value: actual.value,
      sampleCount: actual.sampleCount,
      status: actual.status,
    };
  }

  const forecast = series.forecast.find((point) => point.period === period);
  if (!forecast) return null;
  return {
    value: forecast.midpoint,
    low: forecast.low,
    high: forecast.high,
    baseGrowthPercent: forecast.baseGrowthPercent,
    redevelopmentContributionBps: forecast.redevelopmentContributionBps,
    status: forecast.status,
  };
}

function baseValue(series: PriceTrendSeries, basePeriod: string) {
  return series.points.find((point) => point.period === basePeriod)?.value ?? 1;
}

function transformValue(value: number, series: PriceTrendSeries, mode: DisplayMode, basePeriod: string) {
  return mode === "index" ? (value / baseValue(series, basePeriod)) * 100 : value;
}

function niceBounds(values: number[], mode: DisplayMode) {
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = Math.max(rawMax - rawMin, mode === "index" ? 20 : 30);
  const paddedMin = rawMin - spread * 0.09;
  const paddedMax = rawMax + spread * 0.11;
  const step = mode === "index"
    ? paddedMax - paddedMin > 100 ? 25 : 10
    : paddedMax - paddedMin > 160 ? 50 : 20;
  const lowerBound = Math.floor(paddedMin / step) * step;
  return {
    min: rawMin > 0 && lowerBound <= 0 ? step : lowerBound,
    max: Math.ceil(paddedMax / step) * step,
  };
}

function pathFromPoints(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
}

export function PriceTrendChart({ trend }: { trend: PriceTrend }) {
  const [mode, setMode] = useState<DisplayMode>("index");
  const [visibleIds, setVisibleIds] = useState(() => trend.series.map((series) => series.id));
  const [activePeriod, setActivePeriod] = useState("2026");
  const periods = useMemo(
    () => [...trend.actualPeriods, ...trend.forecastPeriods],
    [trend.actualPeriods, trend.forecastPeriods],
  );
  const visibleSeries = trend.series.filter((series) => visibleIds.includes(series.id));

  const geometry = useMemo(() => {
    const transformedValues: number[] = [];
    for (const series of visibleSeries) {
      for (const period of periods) {
        const item = valueForPeriod(series, period);
        if (item) transformedValues.push(transformValue(item.value, series, mode, trend.basePeriod));
      }
      if (series.kind === "target" || series.kind === "aggregate") {
        for (const item of series.forecast) {
          transformedValues.push(transformValue(item.low, series, mode, trend.basePeriod));
          transformedValues.push(transformValue(item.high, series, mode, trend.basePeriod));
        }
      }
    }

    const bounds = niceBounds(transformedValues, mode);
    const x = (period: string) => {
      const index = periods.indexOf(period);
      return plot.left + (index / (periods.length - 1)) * (plot.right - plot.left);
    };
    const y = (value: number) => plot.bottom - ((value - bounds.min) / (bounds.max - bounds.min)) * (plot.bottom - plot.top);
    const ticks = Array.from({ length: 6 }, (_, index) => bounds.min + ((bounds.max - bounds.min) / 5) * index);

    return { bounds, x, y, ticks };
  }, [mode, periods, trend.basePeriod, visibleSeries]);

  const toggleSeries = (id: string) => {
    setVisibleIds((current) => {
      if (!current.includes(id)) return [...current, id];
      if (current.length === 1) return current;
      return current.filter((currentId) => currentId !== id);
    });
  };

  const activeYearLabel = activePeriod === "2026"
    ? "2026年 ナウキャスト"
    : activePeriod === "2027"
      ? "2027年 予測"
      : `${activePeriod}年${activePeriod === trend.latestActualPeriod ? " 暫定" : " 実績"}`;

  const chartDescription = `${trend.metric}。${trend.actualPeriods[0]}年から${trend.latestActualPeriod}年は取引実績、2026年はナウキャスト、2027年は予測。表示中の地域は${visibleSeries.map((series) => series.name).join("、")}。`;

  return (
    <article className="trend-card">
      <header className="trend-card-header">
        <div>
          <div className="trend-kicker-row">
            <p className="eyebrow">PRICE HISTORY &amp; OUTLOOK</p>
            <span className="data-kind kind-close">CLOSE</span>
          </div>
          <h2 id="price-trend-title">{trend.title}</h2>
          <p>{trend.metric} ・ 2025年は暫定値</p>
        </div>
        <div className="trend-mode-toggle" aria-label="グラフの表示単位">
          <button type="button" aria-pressed={mode === "amount"} onClick={() => setMode("amount")}>実価格</button>
          <button type="button" aria-pressed={mode === "index"} onClick={() => setMode("index")}>{trend.basePeriod}=100</button>
        </div>
      </header>

      <div className="trend-toolbar">
        <div className="trend-series-controls" aria-label="表示する地域">
          {trend.series.map((series) => {
            const selected = visibleIds.includes(series.id);
            return (
              <button
                key={series.id}
                type="button"
                className={series.kind === "target" ? "trend-series-button target" : "trend-series-button"}
                aria-pressed={selected}
                onClick={() => toggleSeries(series.id)}
                style={{ "--series-color": series.color } as CSSProperties}
              >
                <i aria-hidden="true" />
                {series.name}
              </button>
            );
          })}
        </div>
        <label className="trend-period-select">
          <span>数値を確認</span>
          <select value={activePeriod} onChange={(event) => setActivePeriod(event.target.value)}>
            {periods.map((period) => (
              <option value={period} key={period}>
                {period}年{period === "2026" ? " ナウキャスト" : period === "2027" ? " 予測" : period === "2025" ? " 暫定" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <figure className="trend-figure">
        <div className="trend-plot">
          <svg
            className="trend-svg"
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-labelledby="trend-svg-title trend-svg-desc"
          >
            <title id="trend-svg-title">{trend.title}</title>
            <desc id="trend-svg-desc">{chartDescription}</desc>

            {geometry.ticks.map((tick) => {
              const tickY = geometry.y(tick);
              return (
                <g key={tick}>
                  <line className="trend-grid" x1={plot.left} x2={plot.right} y1={tickY} y2={tickY} />
                  <text className="trend-axis-label" x={plot.left - 12} y={tickY + 4} textAnchor="end">
                    {mode === "index" ? Math.round(tick) : tick.toFixed(0)}
                  </text>
                </g>
              );
            })}

            <rect
              className="trend-forecast-zone"
              x={geometry.x("2025")}
              y={plot.top}
              width={plot.right - geometry.x("2025")}
              height={plot.bottom - plot.top}
            />
            <line className="trend-forecast-boundary" x1={geometry.x("2025")} x2={geometry.x("2025")} y1={plot.top} y2={plot.bottom} />
            <text className="trend-forecast-label" x={geometry.x("2025") + 12} y={plot.top + 17}>NOWCAST / FORECAST</text>

            {visibleSeries.filter((series) => series.kind === "target" || series.kind === "aggregate").map((series) => {
              const lastActual = series.points.at(-1);
              if (!lastActual) return null;
              const highPoints = [
                { period: lastActual.period, value: lastActual.value },
                ...series.forecast.map((item) => ({ period: item.period, value: item.high })),
              ];
              const lowPoints = [
                { period: lastActual.period, value: lastActual.value },
                ...series.forecast.map((item) => ({ period: item.period, value: item.low })),
              ].reverse();
              const polygon = [...highPoints, ...lowPoints].map((item) => {
                const transformed = transformValue(item.value, series, mode, trend.basePeriod);
                return `${geometry.x(item.period)},${geometry.y(transformed)}`;
              }).join(" ");
              return <polygon key={`${series.id}-range`} className="trend-range" points={polygon} style={{ fill: series.color }} />;
            })}

            <line
              className="trend-active-guide"
              x1={geometry.x(activePeriod)}
              x2={geometry.x(activePeriod)}
              y1={plot.top}
              y2={plot.bottom}
            />

            {visibleSeries.map((series) => {
              const actualPoints = series.points.map((point) => ({
                x: geometry.x(point.period),
                y: geometry.y(transformValue(point.value, series, mode, trend.basePeriod)),
              }));
              const lastActual = series.points.at(-1);
              const forecastPoints = lastActual
                ? [
                    {
                      period: lastActual.period,
                      value: lastActual.value,
                    },
                    ...series.forecast.map((item) => ({ period: item.period, value: item.midpoint })),
                  ].map((point) => ({
                    x: geometry.x(point.period),
                    y: geometry.y(transformValue(point.value, series, mode, trend.basePeriod)),
                  }))
                : [];

              return (
                <g key={series.id} style={{ "--series-color": series.color } as CSSProperties}>
                  <path
                    className={series.kind === "target" ? "trend-series-line target" : "trend-series-line"}
                    d={pathFromPoints(actualPoints)}
                    strokeDasharray={series.dash || undefined}
                  />
                  <path
                    className={series.kind === "target" ? "trend-series-line forecast target" : "trend-series-line forecast"}
                    d={pathFromPoints(forecastPoints)}
                  />
                  {actualPoints.map((point, index) => (
                    <circle
                      key={`${series.id}-${series.points[index].period}`}
                      className={series.points[index].status === "provisional" ? "trend-point provisional" : "trend-point"}
                      cx={point.x}
                      cy={point.y}
                      r={series.kind === "target" ? 4.2 : 3.1}
                    />
                  ))}
                  {forecastPoints.slice(1).map((point, index) => (
                    <circle key={`${series.id}-forecast-${index}`} className="trend-point forecast" cx={point.x} cy={point.y} r={series.kind === "target" ? 4.2 : 3.1} />
                  ))}
                </g>
              );
            })}

            {periods.map((period) => (
              <text
                key={period}
                className={period === "2026" || period === "2027" ? "trend-axis-label forecast" : "trend-axis-label"}
                x={geometry.x(period)}
                y={plot.bottom + 28}
                textAnchor="middle"
              >
                {period}{period === "2025" ? "*" : ""}
              </text>
            ))}
            <text className="trend-axis-unit" x={plot.left} y={chartHeight - 4}>
              {mode === "index" ? `指数（${trend.basePeriod}=100）` : trend.unit}　* 2025年は暫定
            </text>
          </svg>
        </div>

        <div className="trend-readout-header">
          <div>
            <span>選択年</span>
            <strong>{activeYearLabel}</strong>
          </div>
          <p>{mode === "index" ? "伸び率を同じ起点で比較" : "実際の㎡単価水準を比較"}</p>
        </div>
        <div className="trend-readout" aria-live="polite">
          {visibleSeries.map((series) => {
            const item = valueForPeriod(series, activePeriod);
            if (!item) return null;
            const displayValue = transformValue(item.value, series, mode, trend.basePeriod);
            return (
              <div key={`${series.id}-${activePeriod}`} style={{ "--series-color": series.color } as CSSProperties}>
                <span><i aria-hidden="true" />{series.name}<em>{statusLabel(item.status)}</em></span>
                <strong>{mode === "index" ? formatIndex(displayValue) : formatAmount(displayValue)}</strong>
                <small>
                  {item.low !== undefined && item.high !== undefined
                    ? `中心 ${formatAmount(item.value)} ・ 80% ${item.low.toFixed(1)}〜${item.high.toFixed(1)}${series.id === "suginami" ? ` ・ 基礎 ${item.baseGrowthPercent?.toFixed(1)}% / 再開発 ${item.redevelopmentContributionBps === 0 ? "0.00" : `+${((item.redevelopmentContributionBps ?? 0) / 100).toFixed(2)}`}pt` : ""}`
                    : `${formatAmount(item.value)} ・ n=${item.sampleCount?.toLocaleString("ja-JP")}`}
                </small>
              </div>
            );
          })}
        </div>

        <figcaption>
          実線は取引実績、破線はモデル推計です。杉並区の破線は再開発の確度差分を含みます。薄い帯は杉並区・東京23区の80%予測レンジで、80%の確率を保証するものではありません。
          縦軸は差を読みやすくするため0起点ではありません。
        </figcaption>
      </figure>

      <div className="trend-model-grid">
        <section aria-labelledby="trend-signal-title">
          <p className="eyebrow">LATEST SIGNALS</p>
          <h3 id="trend-signal-title">予測を動かす直近材料</h3>
          <div className="trend-signal-list">
            {trend.currentSignals.map((signal) => (
              <div key={signal.label}>
                <span>{signal.label}</span>
                <strong className={signal.direction === "up" ? "positive" : signal.direction === "down" ? "risk-text" : ""}>{signal.value}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="trend-model-note" aria-labelledby="trend-model-title">
          <div><p className="eyebrow">MODEL CARD</p><span>信頼度 {trend.model.confidence}</span></div>
          <h3 id="trend-model-title">{trend.model.name}</h3>
          <p>{trend.model.updateRule}</p>
          <p>{trend.model.validation}</p>
          <dl>
            <div><dt>学習データ</dt><dd>{trend.model.trainedThrough}</dd></div>
            <div><dt>直近シグナル</dt><dd>{trend.model.nowcastAsOf}</dd></div>
          </dl>
        </section>
      </div>

      <details className="trend-data-table">
        <summary>年ごとの元数値・予測レンジを見る</summary>
        <div className="trend-table-scroll">
          <table>
            <thead>
              <tr><th>年</th>{trend.series.map((series) => <th key={series.id}>{series.name}</th>)}</tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period}>
                  <th>{period}{period === "2025" ? " 暫定" : period === "2026" ? " ナウキャスト" : period === "2027" ? " 予測" : ""}</th>
                  {trend.series.map((series) => {
                    const item = valueForPeriod(series, period);
                    return (
                      <td key={series.id}>
                        {item ? item.value.toFixed(1) : "—"}
                        {item?.low !== undefined && item.high !== undefined ? <small>{item.low.toFixed(1)}〜{item.high.toFixed(1)}</small> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div className="trend-method-note">
        <strong>集計方法</strong>
        <p>{trend.methodology}</p>
        <p>{trend.caveat}</p>
        <p>出典：国土交通省「不動産情報ライブラリ 不動産取引価格情報」をもとに当サイト作成。</p>
      </div>
    </article>
  );
}
