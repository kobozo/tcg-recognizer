"use client";

type Point = { day: string; count: number };
type Props = { data: Point[] };

const W = 640;
const H = 240;
const PAD = { top: 16, right: 16, bottom: 40, left: 36 };

export default function SignupChart({ data }: Props) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded border border-dashed border-gray-300 text-sm text-gray-500">
        No signups yet.
      </div>
    );
  }

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // Cumulative totals.
  let running = 0;
  const cumulative = data.map((d) => (running += d.count));

  const maxDaily = Math.max(1, ...data.map((d) => d.count));
  const maxCum = Math.max(1, ...cumulative);

  // X position for each point (centered within its slot).
  const n = data.length;
  const slot = innerW / n;
  const xAt = (i: number) => PAD.left + slot * i + slot / 2;

  const barW = Math.max(2, slot * 0.6);
  const yBar = (v: number) => PAD.top + innerH - (v / maxDaily) * innerH;
  const yLine = (v: number) => PAD.top + innerH - (v / maxCum) * innerH;

  const linePath = cumulative
    .map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yLine(v).toFixed(1)}`)
    .join(" ");

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Daily and cumulative signups over time"
        className="max-w-full"
      >
        {/* axes */}
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={PAD.top + innerH}
          stroke="#d1d5db"
        />
        <line
          x1={PAD.left}
          y1={PAD.top + innerH}
          x2={PAD.left + innerW}
          y2={PAD.top + innerH}
          stroke="#d1d5db"
        />

        {/* daily bars */}
        {data.map((d, i) => {
          const h = PAD.top + innerH - yBar(d.count);
          return (
            <rect
              key={d.day}
              x={xAt(i) - barW / 2}
              y={yBar(d.count)}
              width={barW}
              height={Math.max(0, h)}
              fill="#93c5fd"
            >
              <title>{`${d.day}: ${d.count} signup(s)`}</title>
            </rect>
          );
        })}

        {/* cumulative line */}
        <path d={linePath} fill="none" stroke="#2563eb" strokeWidth={2} />
        {cumulative.map((v, i) => (
          <circle key={data[i].day} cx={xAt(i)} cy={yLine(v)} r={2.5} fill="#2563eb">
            <title>{`${data[i].day}: ${v} total`}</title>
          </circle>
        ))}

        {/* x labels (first, last, and middle to avoid clutter) */}
        {data.map((d, i) => {
          if (n > 3 && i !== 0 && i !== n - 1 && i !== Math.floor(n / 2)) return null;
          return (
            <text
              key={`lbl-${d.day}`}
              x={xAt(i)}
              y={H - 12}
              textAnchor="middle"
              className="fill-gray-500"
              fontSize={10}
            >
              {d.day.slice(5)}
            </text>
          );
        })}
      </svg>
      <div className="mt-2 flex gap-4 text-xs text-gray-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 bg-blue-300" /> Daily
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 bg-blue-600" /> Cumulative
        </span>
      </div>
    </div>
  );
}
