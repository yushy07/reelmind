export function durationFormat(seconds: number): string {
  const total = Math.round(Math.max(0, seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function timestampFormat(seconds: number): string {
  const total = Math.round(Math.max(0, seconds));
  const mins = String(Math.floor(total / 60)).padStart(2, '0');
  const secs = String(total % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

export function formatTimeRange(start: number, end: number): string {
  return `${timestampFormat(start)}–${timestampFormat(end)}`;
}

export function energyLabel(energy: number): string {
  if (energy >= 0.75) return '🔥 High Energy';
  if (energy >= 0.50) return '⚡ Mid Energy';
  return '🌙 Ambient';
}
