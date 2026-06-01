type ByteScale = {
  factor: number;
  suffix: string;
};

function detectByteScale(maxValue: number): ByteScale {
  if (maxValue >= 1_099_511_627_776) return { factor: 1_099_511_627_776, suffix: "TB" };
  if (maxValue >= 1_073_741_824) return { factor: 1_073_741_824, suffix: "GB" };
  if (maxValue >= 1_048_576) return { factor: 1_048_576, suffix: "MB" };
  if (maxValue >= 1_024) return { factor: 1_024, suffix: "KB" };
  return { factor: 1, suffix: "B" };
}

type SampleLike = { avg: number };

export function scaleSeriesData<T extends SampleLike>(
  data: T[],
  unit: string | null
): { data: T[]; displayUnit: string | null } {
  if (unit !== "bytes") {
    return { data, displayUnit: unit };
  }

  const maxVal = data.reduce((max, d) => Math.max(max, d.avg), 0);
  const scale = detectByteScale(maxVal);
  return {
    data: data.map((d) => ({ ...d, avg: d.avg / scale.factor })) as T[],
    displayUnit: scale.suffix,
  };
}

export function formatValue(value: number, unit: string | null): string {
  if (unit === "load") {
    return value.toFixed(2);
  }
  return value.toFixed(1);
}
