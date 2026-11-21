"use client";
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis } from "recharts";

type Point = { day: string; sent: number; delivered: number };
const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** One highlighted series, a dashed neutral comparison, no y-axis or grid (bar.md #5). */
export function DeliveredChart({ data }: { data: Point[] }) {
  const total = data.reduce((a, p) => a + p.delivered, 0);
  const step = Math.max(1, Math.ceil(data.length / 5));
  return (
    <div role="img" aria-label={`Delivered messages per day over ${data.length} days, ${total} in total`} className="h-[180px] w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="deliveredFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity={0.16} />
              <stop offset="1" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="day" tickFormatter={fmt} interval={step - 1} padding={{ left: 24, right: 24 }} tickLine={false} axisLine={false} tick={{ fill: "var(--text2)", fontSize: 12 }} />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            contentStyle={{ background: "var(--raised)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text)" }}
            labelFormatter={(d) => fmt(String(d))}
          />
          <Line dataKey="sent" name="Sent" type="monotone" stroke="var(--border-strong)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Area dataKey="delivered" name="Delivered" type="monotone" stroke="var(--accent)" strokeWidth={2} fill="url(#deliveredFill)" dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
