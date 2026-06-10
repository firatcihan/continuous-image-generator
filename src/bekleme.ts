export function rastgeleSureMs(aralikSn: [number, number]): number {
  const [min, maks] = aralikSn;
  return Math.round((min + Math.random() * (maks - min)) * 1000);
}

export function uyu(ms: number): Promise<void> {
  return new Promise((coz) => setTimeout(coz, ms));
}
