export function durationFormat(seconds: number): string {
  const total = Math.round(Math.max(0, seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
