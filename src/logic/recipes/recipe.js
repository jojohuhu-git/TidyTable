// Recipes (build prompt §7). A recipe is an ordered list of the cleaning steps a
// user applied to one month's file, recorded so the same steps can be replayed on
// next month's file. Steps reference columns BY HEADER NAME (fuzzy-matched on
// replay), never by position — so a column that shifts left or right still lines
// up, and a column that was renamed is caught and announced as a surprise.
//
// A recipe serializes to plain JSON: it is saved in the browser (localStorage)
// and can be exported to a file and imported on another computer, since the owner
// works across synced machines.

export const RECIPE_VERSION = 1;

// Fuzzy column key: case-, space-, and punctuation-insensitive. "Patient ID",
// "patient_id", and "patientid" all fold to the same key so a small rename does
// not break replay; a real rename (to a different word) will not match and is
// reported as a surprise.
export function columnKey(name) {
  return String(name == null ? "" : name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Find the header in `headers` that fuzzy-matches a recorded column name.
// Returns the real current header name, or null if nothing matches.
export function matchColumn(recordedName, headers) {
  const key = columnKey(recordedName);
  if (!key) return null;
  const hit = headers.find((h) => columnKey(h.name) === key);
  return hit ? hit.name : null;
}

export function newRecipe(name) {
  return {
    version: RECIPE_VERSION,
    name: name && String(name).trim() ? String(name).trim() : "Monthly cleanup",
    createdAt: new Date().toISOString(),
    steps: [],
  };
}

export function addStep(recipe, step) {
  return { ...recipe, steps: [...recipe.steps, step] };
}

// A recipe's terminal step (report cards) must always be last. This drops any
// existing terminal step before adding a new one, and refuses to add a normal
// step after a terminal one.
export function isTerminal(step) {
  return step.type === "reportCards";
}

// --- Turning applied checkup fixes into recipe steps -------------------------

// A checkup fix is { normalizer, column?, params? } (the shape buildFixPlan
// takes). We record each as a step carrying the fix plus a plain-English label,
// so the recipe reads clearly and replays with the exact same rule.
export function checkupStep(fix) {
  return { type: "checkupFix", fix, label: labelForFix(fix) };
}

export function labelForFix(fix) {
  switch (fix.normalizer) {
    case "dedupeRows": return "Remove duplicate rows";
    case "coerceNumbers": return `Read text numbers in "${fix.column}" as numbers`;
    case "sentinelBlanks": return `Turn "not available" markers in "${fix.column}" into empty cells`;
    case "parseDates": return `Standardize the dates in "${fix.column}"`;
    case "trimCase": return `Merge different spellings in "${fix.column}"`;
    case "censoredValues": return `Handle below/above-limit results in "${fix.column}"`;
    case "splitList": return `Split multi-value cells in "${fix.column}" into separate rows`;
    case "dedupeEncounters": return `Remove exact-copy rows sharing the same "${fix.column}"`;
    case "keepOnePerPatient": return `Keep one row per patient in "${fix.column}"`;
    default: return `Clean "${fix.column}"`;
  }
}

export function deidentifyStep(column) {
  return { type: "deidentify", column, label: `Swap the names in "${column}" for stable codes` };
}

// W3: a successful, offline-answered Step 3 question is recorded as a routine
// step too, the same way a checkup fix is — so the routine IS the running
// results list. `match` is the "confident" result from matchRequest (see
// matcher.js), carrying the resolved column names/values so replay can
// re-resolve it against a new file without re-parsing the original English
// question. `answer` is the plain one-line answer shown on the results card
// at record time (e.g. "14 patients"), kept only for display in the routine
// steps list — replay always recomputes its own answer from the new file.
export function questionStep(request, match, answer) {
  return { type: "question", request, match, answer, label: `Answered: "${request}"` };
}

// W3: a friendly default routine name derived from the uploaded file, e.g.
// "DC antibiotics.xlsx" -> "DC antibiotics — monthly". Falls back to the
// generic default when there is no usable file name.
export function defaultRoutineName(fileName) {
  const base = String(fileName == null ? "" : fileName).replace(/\.[^./\\]+$/, "").trim();
  return base ? `${base} — monthly` : "Monthly cleanup";
}

export function reportCardsStep({ personColumn, valueColumn, groupColumn }) {
  return {
    type: "reportCards",
    personColumn,
    valueColumn: valueColumn || null,
    groupColumn: groupColumn || null,
    label: `Make one report card per person, comparing ${valueColumn ? `total "${valueColumn}"` : "how many rows each has"}`,
  };
}

// --- Serialize / file round-trip --------------------------------------------

export function serializeRecipe(recipe) {
  return JSON.stringify(recipe, null, 2);
}

// Parse a recipe from file text. Throws a plain-English error if the file is not
// a recipe, so the UI can show it as-is.
export function parseRecipe(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("This file is not a saved recipe — it could not be read.");
  }
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.steps)) {
    throw new Error("This file does not look like a TidyTable recipe (it has no steps).");
  }
  if (obj.version !== RECIPE_VERSION) {
    // Forward-compatible: accept, but say so plainly.
    obj = { ...obj, version: RECIPE_VERSION };
  }
  return {
    version: RECIPE_VERSION,
    name: typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : "Imported recipe",
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : new Date().toISOString(),
    steps: obj.steps,
  };
}

// --- localStorage recipe library --------------------------------------------

const STORE_KEY = "tidytable_recipes";

function readLibrary() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

export function listRecipes() {
  const lib = readLibrary();
  return Object.values(lib).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

// P2-20: saving under a name that already belongs to a *different* recipe
// used to silently overwrite it. Re-saving the same recipe (same createdAt)
// under its own name is still an in-place update, but a name collision with
// someone else's recipe gets auto-suffixed instead of clobbering it.
export function saveRecipe(recipe) {
  const lib = readLibrary();
  let name = recipe.name;
  if (lib[name] && lib[name].createdAt !== recipe.createdAt) {
    let n = 2;
    while (lib[`${recipe.name} (${n})`]) n++;
    name = `${recipe.name} (${n})`;
  }
  const toSave = { ...recipe, name };
  lib[name] = toSave;
  localStorage.setItem(STORE_KEY, JSON.stringify(lib));
  return toSave;
}

export function deleteRecipe(name) {
  const lib = readLibrary();
  delete lib[name];
  localStorage.setItem(STORE_KEY, JSON.stringify(lib));
}
