// Phase 7.4 (plan-2026-07-10-offline-smarts.md) — compound questions answered
// as a set. "average duration and most common drug by diagnosis" is really two
// questions joined by "and"; split them at the INTENT level, answer each with
// the existing plan machinery, and present one combined card.
//
// The split is deliberately conservative — the honesty risk is mistaking a
// VALUE set ("amoxicillin and cephalexin", "UTI and pneumonia" as one filter)
// for two questions. So a split is only accepted when EVERY resulting part
// independently expresses its own intent (an aggregation, a top-N ranking, or a
// count). If any part has no intent of its own, the "and" was joining values,
// not questions — we return null and leave the request to the normal engine.
//
// This module only rewrites the text into parts; the caller runs each part and
// only shows a combined answer when ALL parts answer confidently (never a
// half-answered compound).

import { detectIntent, detectTopN } from "./synonyms.js";
import { detectFollowUp } from "./followUp.js";

// A trailing "by X" / "per X" / "for each X" breakdown on the LAST part is a
// shared modifier — "average duration and most common drug by diagnosis" means
// both broken down by diagnosis. Distribute it to earlier parts that lack one.
const GROUP_TAIL_RE = /\b((?:grouped by|broken down by|for each|by|per)\s+.+)$/i;

export function splitCompound(request) {
  const raw = String(request || "").trim();
  if (!raw) return null;
  // A cross-turn follow-up or a nested "of those" chain is a different feature.
  if (detectFollowUp(raw)) return null;
  if (/\bof\s+(those|these|whom|them)\b/i.test(raw)) return null;

  // Split on " and " / ", and " into 2+ candidate parts.
  const parts = raw.split(/\s*,?\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  // Distribute a trailing group-by from the last part to earlier parts.
  const tailM = GROUP_TAIL_RE.exec(parts[parts.length - 1]);
  let distributed = parts;
  if (tailM) {
    const tail = tailM[1];
    distributed = parts.map((p, i) =>
      (i === parts.length - 1 || GROUP_TAIL_RE.test(p)) ? p : `${p} ${tail}`,
    );
  }

  // Every part must carry its own intent, or the "and" joined values, not
  // questions — decline the split so nothing is guessed.
  for (const p of distributed) {
    if (!detectIntent(p) && !detectTopN(p)) return null;
  }
  return distributed;
}
