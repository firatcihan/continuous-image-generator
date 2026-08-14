export function randomDurationMs(rangeSec: [number, number]): number {
  const [min, max] = rangeSec;
  return Math.round((min + Math.random() * (max - min)) * 1000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
