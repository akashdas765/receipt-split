// Ordered for max adjacent CVD separation (validated via dataviz skill) —
// keep this order intact, don't re-sort alphabetically or by hue.
export const AVATAR_COLORS = ['#ef4444','#10b981','#a855f7','#f59e0b','#0ea5e9','#ec4899','#22c55e','#6366f1','#f97316','#14b8a6','#d946ef','#84cc16','#3b82f6'];

// Color by position in the group roster, not a name hash — guarantees every
// member gets a distinct color (up to AVATAR_COLORS.length) instead of
// colliding whenever two names hash to the same slot.
export function memberColor(memberId, members) {
  const idx = members.findIndex(m => String(m.id) === String(memberId));
  return AVATAR_COLORS[(idx < 0 ? 0 : idx) % AVATAR_COLORS.length];
}
