import type { Bar } from "../../src/types";

export const BASE_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

export function bar(
  hourOffset: number, o: number, h: number, l: number, c: number, v = 1000,
): Bar {
  return {
    Timestamp: new Date(BASE_EPOCH_MS + hourOffset * 3600_000).toISOString(),
    Open: o, High: h, Low: l, Close: c, Volume: v,
  };
}

export interface BaseFixture {
  bars: Bar[];
  expected: {
    obIndex: number;
    bosIndex: number;
    confirmIndex: number;
    obLow: number;
    obHigh: number;
    priorSwingHigh: number;
  };
}

export function buildBaseFixture(): BaseFixture {
  const bars: Bar[] = [];
  bars.push(bar(0, 100.0, 100.5, 99.6, 100.4));
  bars.push(bar(1, 100.4, 100.7, 100.0, 100.6));
  bars.push(bar(2, 100.6, 100.9, 99.5, 100.2));
  bars.push(bar(3, 100.2, 101.5, 100.1, 101.3));
  bars.push(bar(4, 101.3, 102.5, 101.0, 102.2));
  bars.push(bar(5, 102.2, 103.5, 102.0, 103.0));
  bars.push(bar(6, 103.0, 103.2, 102.0, 102.3));
  bars.push(bar(7, 102.3, 102.5, 101.5, 101.7));
  bars.push(bar(8, 101.7, 101.9, 100.6, 101.0));
  bars.push(bar(9, 101.0, 101.5, 100.7, 101.4));

  bars.push(bar(10, 101.4, 102.5, 101.2, 102.3));
  bars.push(bar(11, 102.3, 103.5, 102.1, 103.3));
  bars.push(bar(12, 103.3, 105.0, 103.0, 104.5));
  bars.push(bar(13, 104.5, 104.8, 103.5, 103.8));
  bars.push(bar(14, 103.8, 104.0, 102.8, 103.0));
  bars.push(bar(15, 103.0, 103.5, 102.7, 103.2));
  bars.push(bar(16, 103.2, 103.4, 102.5, 102.7));
  bars.push(bar(17, 102.7, 103.5, 102.6, 103.4));
  bars.push(bar(18, 103.4, 104.5, 103.3, 104.3));
  bars.push(bar(19, 104.3, 105.5, 104.1, 105.3));

  bars.push(bar(20, 105.3, 106.5, 105.1, 106.3));
  bars.push(bar(21, 106.3, 106.8, 106.0, 106.5));
  bars.push(bar(22, 106.5, 107.0, 106.0, 106.7));
  bars.push(bar(23, 106.7, 106.9, 105.5, 105.7));
  bars.push(bar(24, 105.7, 106.0, 104.5, 104.8));
  bars.push(bar(25, 104.8, 105.2, 104.2, 104.5));
  bars.push(bar(26, 104.5, 104.7, 104.0, 104.3));
  bars.push(bar(27, 104.3, 105.0, 104.2, 104.9));
  bars.push(bar(28, 104.9, 106.0, 104.7, 105.8));
  bars.push(bar(29, 105.8, 107.5, 105.6, 107.3));

  bars.push(bar(30, 107.3, 108.5, 107.1, 108.3));
  bars.push(bar(31, 108.3, 108.8, 108.0, 108.5));
  bars.push(bar(32, 108.5, 109.0, 108.0, 108.8));
  bars.push(bar(33, 108.8, 108.9, 107.8, 108.0));
  bars.push(bar(34, 108.0, 108.2, 107.2, 107.5));
  bars.push(bar(35, 107.5, 107.8, 106.8, 107.0));
  bars.push(bar(36, 107.0, 107.2, 106.5, 106.8));
  bars.push(bar(37, 106.8, 107.0, 106.3, 106.6));
  bars.push(bar(38, 106.6, 106.9, 106.2, 106.7));
  bars.push(bar(39, 106.7, 107.4, 106.5, 107.2));

  bars.push(bar(40, 107.5, 108.0, 106.5, 106.8));
  bars.push(bar(41, 106.8, 110.0, 106.5, 109.5));
  bars.push(bar(42, 109.5, 112.0, 109.0, 111.5));
  bars.push(bar(43, 111.5, 112.5, 110.5, 111.0));
  bars.push(bar(44, 111.0, 111.2, 109.0, 109.5));
  bars.push(bar(45, 109.5, 109.8, 107.0, 107.5));
  bars.push(bar(46, 107.5, 109.0, 107.0, 108.8));

  for (let i = 47; i < 60; i++) {
    bars.push(bar(i, 108.8, 109.5, 108.5, 109.0));
  }

  return {
    bars,
    expected: {
      obIndex: 40, bosIndex: 41, confirmIndex: 46,
      obLow: 106.5, obHigh: 108.0, priorSwingHigh: 109.0,
    },
  };
}
