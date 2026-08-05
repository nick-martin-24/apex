// Standard Coggan 7-zone model, as % of FTP
export const COGGAN_ZONES = [
  { zone: 1, name: "Active Recovery", min: 0, max: 0.55 },
  { zone: 2, name: "Endurance", min: 0.55, max: 0.75 },
  { zone: 3, name: "Tempo", min: 0.75, max: 0.9 },
  { zone: 4, name: "Threshold", min: 0.9, max: 1.05 },
  { zone: 5, name: "VO2 Max", min: 1.05, max: 1.2 },
  { zone: 6, name: "Anaerobic Capacity", min: 1.2, max: 1.5 },
  { zone: 7, name: "Neuromuscular Power", min: 1.5, max: Infinity },
] as const;

export interface ZoneResult {
  zone: number;
  name: string;
  seconds: number;
  percentOfRide: number;
}

// timeS: seconds-elapsed at each sample (from Strava's "time" stream)
// watts: power at each sample, same length/order as timeS (nulls allowed)
// ftp: athlete's current FTP in watts
export function computeTimeInZones(timeS: number[], watts: (number | null)[], ftp: number): ZoneResult[] {
  const secondsPerZone = new Array(COGGAN_ZONES.length).fill(0);
  let totalSeconds = 0;

  for (let i = 1; i < timeS.length; i++) {
    const dt = timeS[i] - timeS[i - 1];
    if (dt <= 0) continue; // guard against pauses/out-of-order samples
    const w = watts[i];
    if (w == null) continue;

    const pctFtp = w / ftp;
    const zoneIdx = COGGAN_ZONES.findIndex((z) => pctFtp >= z.min && pctFtp < z.max);
    const idx = zoneIdx === -1 ? COGGAN_ZONES.length - 1 : zoneIdx;
    secondsPerZone[idx] += dt;
    totalSeconds += dt;
  }

  return COGGAN_ZONES.map((z, i) => ({
    zone: z.zone,
    name: z.name,
    seconds: secondsPerZone[i],
    percentOfRide: totalSeconds > 0 ? (secondsPerZone[i] / totalSeconds) * 100 : 0,
  }));
}
