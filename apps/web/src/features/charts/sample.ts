/** Example data for the editor when no market data key is set. Clearly labelled; not a real security. */
function build(): string {
  const rows = ["date,example"];
  let value = 20;
  const start = Date.UTC(2021, 0, 4);
  for (let week = 0; week < 260; week += 1) {
    const t = start + week * 7 * 86_400_000;
    value *= 1 + 0.012 * Math.sin(week / 9) + 0.006 + 0.01 * Math.sin(week * 1.7);
    rows.push(`${new Date(t).toISOString().slice(0, 10)},${value.toFixed(2)}`);
  }
  return rows.join("\n");
}

export const SAMPLE_CSV = build();
