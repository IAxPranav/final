export function normalizePhase(value) {
  const phase = Number(value);
  if (!Number.isFinite(phase)) return 1;
  if (phase < 1) return 1;
  if (phase > 7) return 7;
  return phase;
}

export function getNextPhaseId(currentPhase) {
  return normalizePhase(currentPhase + 1);
}
