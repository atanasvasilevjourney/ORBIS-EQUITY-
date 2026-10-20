import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { Candle } from "@/components/chart/TradingChart";

type RibbonPoint = {
  time: Time;
  lo: number;
  hi: number;
  close: number;
};

export type Ema200RibbonPrimitiveOptions = {
  fillBull: string;
  fillBear: string;
};

/** Filled band between EMA200 close & high (PB-EMA distance channel). */
export function createEma200RibbonPrimitive(
  candles: Candle[],
  ema200: (number | null)[],
  ema200High: (number | null)[],
  options: Ema200RibbonPrimitiveOptions
): ISeriesPrimitive<Time> {
  const points: RibbonPoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = ema200[i];
    const h = ema200High[i];
    if (c == null || h == null) continue;
    const lo = Math.min(c, h);
    const hi = Math.max(c, h);
    points.push({
      time: candles[i].time as Time,
      lo,
      hi,
      close: candles[i].close,
    });
  }

  let attached: SeriesAttachedParameter<Time, "Candlestick"> | null = null;

  return {
    attached(param) {
      attached = param as SeriesAttachedParameter<Time, "Candlestick">;
    },
    detached() {
      attached = null;
    },
    paneViews() {
      return [
        {
          zOrder: () => "bottom",
          renderer: () => ({
            draw(target) {
              if (!attached || points.length < 2) return;
              const { chart, series } = attached;
              const timeScale = chart.timeScale();

              target.useMediaCoordinateSpace(({ context: ctx }) => {
                const visible: RibbonPoint[] = [];
                for (const p of points) {
                  const x = timeScale.timeToCoordinate(p.time);
                  if (x == null) continue;
                  visible.push(p);
                }
                if (visible.length < 2) return;

                const segments: { pts: RibbonPoint[]; bull: boolean }[] = [];
                let current: RibbonPoint[] = [];
                let bull = visible[0].close >= visible[0].lo;
                for (const p of visible) {
                  const isBull = p.close >= p.lo;
                  if (current.length && isBull !== bull) {
                    segments.push({ pts: current, bull });
                    current = [current[current.length - 1], p];
                    bull = isBull;
                  } else {
                    current.push(p);
                  }
                }
                if (current.length) segments.push({ pts: current, bull });

                for (const seg of segments) {
                  const fill = seg.bull ? options.fillBull : options.fillBear;
                  ctx.beginPath();
                  let started = false;
                  for (const p of seg.pts) {
                    const x = timeScale.timeToCoordinate(p.time);
                    const yHi = series.priceToCoordinate(p.hi);
                    if (x == null || yHi == null) continue;
                    if (!started) {
                      ctx.moveTo(x, yHi);
                      started = true;
                    } else ctx.lineTo(x, yHi);
                  }
                  for (let i = seg.pts.length - 1; i >= 0; i--) {
                    const p = seg.pts[i];
                    const x = timeScale.timeToCoordinate(p.time);
                    const yLo = series.priceToCoordinate(p.lo);
                    if (x == null || yLo == null) continue;
                    ctx.lineTo(x, yLo);
                  }
                  ctx.closePath();
                  ctx.fillStyle = fill;
                  ctx.fill();
                }
              });
            },
          }),
        },
      ];
    },
  };
}
