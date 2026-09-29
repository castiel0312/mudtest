import type { WellCompareSummary } from "./useWellCompareData";

export function wellLabel(item: WellCompareSummary): string {
  return item.well.well_name ?? item.well.well_id;
}

export interface DepthSample {
  md: number;
  value: number;
  order: number;
}

export interface NullableDepthSample {
  md: number;
  value: number | null;
  order: number;
}

export interface SampleBucket {
  first: DepthSample;
  minimum: DepthSample;
  maximum: DepthSample;
  last: DepthSample;
}

export function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function sortedFiniteSamples(samples: DepthSample[]): DepthSample[] {
  return samples.slice().sort((left, right) => left.md - right.md || left.order - right.order);
}

export function thinByDepth(samples: DepthSample[], bucketCount: number): DepthSample[] {
  const sorted = sortedFiniteSamples(samples);
  if (sorted.length <= bucketCount * 4) return sorted;
  const minMd = sorted[0]?.md;
  const maxMd = sorted.at(-1)?.md;
  if (minMd === undefined || maxMd === undefined || maxMd <= minMd) return sorted;
  const bucketWidth = (maxMd - minMd) / bucketCount;
  const buckets = new Map<number, SampleBucket>();

  for (const sample of sorted) {
    const bucketIndex = Math.min(bucketCount - 1, Math.floor((sample.md - minMd) / bucketWidth));
    const bucket = buckets.get(bucketIndex);
    if (!bucket) {
      buckets.set(bucketIndex, { first: sample, minimum: sample, maximum: sample, last: sample });
      continue;
    }
    bucket.last = sample;
    if (sample.value < bucket.minimum.value) bucket.minimum = sample;
    if (sample.value > bucket.maximum.value) bucket.maximum = sample;
  }

  const output: DepthSample[] = [];
  for (const bucket of buckets.values()) {
    const candidates = [bucket.first, bucket.minimum, bucket.maximum, bucket.last]
      .slice()
      .sort((left, right) => left.order - right.order);
    for (const candidate of candidates) {
      if (output.at(-1)?.order !== candidate.order) output.push(candidate);
    }
  }
  return output;
}

export function nearestByMd<T extends { md: number }>(samples: T[], md: number): T | null {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const sample = samples[middle];
    if (sample && sample.md < md) low = middle + 1;
    else high = middle;
  }
  const right = samples[low];
  const left = low > 0 ? samples[low - 1] : undefined;
  if (!left) return right ?? null;
  if (!right) return left;
  return Math.abs(left.md - md) <= Math.abs(right.md - md) ? left : right;
}

export function splitAtNull(samples: NullableDepthSample[]): NullableDepthSample[][] {
  const segments: NullableDepthSample[][] = [];
  let segment: NullableDepthSample[] = [];
  for (const sample of samples) {
    if (sample.value === null || !Number.isFinite(sample.value)) {
      if (segment.length) segments.push(segment);
      segment = [];
      continue;
    }
    segment.push(sample);
  }
  if (segment.length) segments.push(segment);
  return segments;
}
