// B8: the header's privacy claim must stay true through the whole session —
// it can't permanently say "has not left this computer" once a Claude
// request has actually gone out. Pure so the reactive text is unit-testable
// without rendering.
export function privacyBadgeText(aiSends) {
  if (!aiSends || aiSends.length === 0) return "Your data has not left this computer.";
  const n = aiSends.length;
  const times = `${n} time${n === 1 ? "" : "s"}`;
  const anyFull = aiSends.some((s) => s.mode === "full");
  return anyFull
    ? `Sent to Claude ${times} this session (at least one request sent all values — full mode).`
    : `Sent to Claude ${times} this session (column names + made-up samples).`;
}
