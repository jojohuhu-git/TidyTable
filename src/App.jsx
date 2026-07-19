import { useEffect, useMemo, useRef, useState } from "react";
import ApiKeyPanel from "./components/ApiKeyPanel.jsx";
import UploadPanel from "./components/UploadPanel.jsx";
import CheckupPanel from "./components/CheckupPanel.jsx";
import PromptPanel from "./components/PromptPanel.jsx";
import PooledRankPicker from "./components/PooledRankPicker.jsx";
import ResultsListPanel from "./components/ResultsListPanel.jsx";
import RecipePanel from "./components/RecipePanel.jsx";
import ReplayPanel from "./components/ReplayPanel.jsx";
import {
  buildDataContext,
  requestPlan,
  friendlyApiError,
  DEFAULT_MODEL,
} from "./logic/claude.js";
import { runTransform } from "./logic/runTransform.js";
import { deriveSheet, downloadText, downloadWorkbookAsXlsx } from "./logic/workbook.js";
import { foldKey } from "./logic/checkup/normalizers.js";
import { buildFixPlan } from "./logic/checkup/buildFixPlan.js";
import { makeLogEvent, formatCleaningLog } from "./logic/checkup/cleaningLog.js";
import { newRecipe, addStep, checkupStep, questionStep, defaultRoutineName } from "./logic/recipes/recipe.js";
import { loadKeyStore } from "./logic/recipes/keyStore.js";
import { runOffline } from "./logic/offline/runOffline.js";
import { startRefinement, rejectShown, pickGroup } from "./logic/offline/refine.js";
import { logRefinement, listMisses } from "./logic/offline/missLog.js";
import { logHit } from "./logic/offline/hitStore.js";
import { planShapeFromMatch, planShapeFromAiPlan } from "./logic/offline/planShape.js";
import { detectIntent, detectTopN } from "./logic/offline/synonyms.js";
import {
  loadGraduationStore, persistGraduationStore, rememberGraduation,
} from "./logic/offline/graduationStore.js";
import { summarizeAnswer } from "./logic/offline/fillPlan.js";
import { buildExampleWorkbook } from "./logic/exampleWorkbook.js";
import { saveSession, loadSession } from "./logic/sessionPersistence.js";
import ClarifyBox from "./components/ClarifyBox.jsx";
import StatsPanel from "./components/StatsPanel.jsx";
import RegressionWizard from "./components/RegressionWizard.jsx";
import ChartsPanel from "./components/ChartsPanel.jsx";
import { resolveChartRequest } from "./logic/charts/textToChart.js";
import ShelfPanel from "./components/ShelfPanel.jsx";
import ColumnProfileTable from "./components/ColumnProfileTable.jsx";
import DefinitionsEditor from "./components/DefinitionsEditor.jsx";
import TeachItForm from "./components/TeachItForm.jsx";
import { buildDefinitionEntry } from "./logic/offline/definitions.js";
import DefinitionsPanel from "./components/DefinitionsPanel.jsx";
import { privacyBadgeText } from "./logic/privacyBadge.js";
import { emptyDefinitionsStore, addDefinitionEntry } from "./logic/offline/definitionsStore.js";
import {
  loadAliasStore, persistAliasStore, rememberColumnAlias, columnAliasesFor, fileSignature,
} from "./logic/offline/aliasStore.js";
import { applyFollowUp, lastFilterValue } from "./logic/offline/followUp.js";
import { splitCompound } from "./logic/offline/compound.js";
import {
  loadGrainStore, persistGrainStore, rememberGrainChoice, forgetGrainChoice, grainChoicesFor,
} from "./logic/offline/grainStore.js";
import {
  loadPooledPolicyStore, persistPooledPolicyStore, rememberPooledPolicy, forgetPooledPolicy, pooledPolicyChoicesFor,
} from "./logic/offline/pooledPolicyStore.js";

// W3: how many result cards "Your results so far" keeps per session, oldest
// dropped first — the same bounded-history spirit the old run-history chips
// used, now applied to the full accumulating list.
const MAX_RESULTS = 20;

// P0-2: decline reasons a novice CAN fix by teaching the app what a word means
// (a word → column / word → values mapping). These are all "I know the
// operation, I just couldn't tell which column/value you meant" cases, so the
// teach-it form genuinely helps. Every OTHER decline (an unsupported operation
// like sort/list/reformat/reshape — reason "unrecognized"; or a text column
// that can't be averaged — "non-numeric-target") is something teaching a word
// can never change, so those show a plain capability message and NO form.
const TEACHABLE_DECLINE_REASONS = new Set([
  "no-conditions",
  "unsupported-average", "unsupported-sum", "unsupported-groupby",
  "unsupported-median", "unsupported-quartiles", "unsupported-stdev",
  "unsupported-min", "unsupported-max", "unsupported-range",
  "unsupported-describe", "unsupported-topn",
]);
const isTeachableDecline = (reason) => TEACHABLE_DECLINE_REASONS.has(reason);

// W1: "DC antibiotics.xlsx" -> "DC antibiotics (cleaned).xlsx". Drops any
// original extension (csv/xls/xlsx/tsv) and always writes a real .xlsx, since
// the downloaded copy is an Excel workbook regardless of what was uploaded.
function fixedFileName(originalName) {
  const name = originalName || "TidyTable_workbook";
  const base = name.replace(/\.(xlsx|xls|csv|tsv)$/i, "").trim() || "TidyTable_workbook";
  return `${base} (cleaned).xlsx`;
}

// Plain-English wording for the "Did you mean…?" box, for a value chip (W2d) or
// a Phase 3 column chip. Column chips ask which column an everyday word means.
// Phase 5: a chips round reads its current `options` and the loop's `phrase`; a
// group round supplies its own discriminating `question` directly.
function confirmQuestion(pending) {
  if (pending.mode === "group" && pending.question) return pending.question;
  const cands = pending.options || [];
  const phrase = pending.refine?.phrase;
  const first = cands[0];
  if (first?.kind === "column") {
    return cands.length === 1
      ? `Do you mean the "${first.column}" column?`
      : `Which column do you mean by "${phrase}"?`;
  }
  return cands.length === 1
    ? `Did you mean "${first?.value}" in "${first?.column}"?`
    : `"${phrase}" could mean a few things — which one?`;
}

// Phase 5: capitalize the first letter of a plain-word group label for a chip.
function capFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("tidytable_api_key") || "");
  const [model, setModel] = useState(() => localStorage.getItem("tidytable_model") || DEFAULT_MODEL);
  const [workbook, setWorkbook] = useState(null);
  const [originalWorkbook, setOriginalWorkbook] = useState(null); // B4: "start over" target
  const [excluded, setExcluded] = useState(() => new Set()); // "sheet::column"
  const [privacyMode, setPrivacyMode] = useState("sample"); // "sample" | "full"
  // Parked item 3e: PHI mode. While on, the AI "whole spreadsheet" option is
  // off and the results list is not persisted to browser storage. The flag
  // itself is remembered (it holds no data), so it stays on across visits —
  // fail-closed for someone who always works with patient files.
  const [phiMode, setPhiModeState] = useState(() => {
    try { return localStorage.getItem("tidytable_phi_mode") === "1"; } catch { return false; }
  });
  function setPhiMode(on) {
    setPhiModeState(on);
    try { localStorage.setItem("tidytable_phi_mode", on ? "1" : "0"); } catch { /* storage may be disabled */ }
    if (on && privacyMode === "full") setPrivacyMode("sample");
  }
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [plan, setPlan] = useState(null);
  const [resultRows, setResultRows] = useState(null);
  const [undoSnapshot, setUndoSnapshot] = useState(null); // B4: state just before the last apply
  // B5: the workbook itself is not restored (it may be large or sensitive), but
  // the small, JSON-safe log/recipe/results trail survives a refresh.
  const savedSession = useMemo(() => loadSession(), []);
  const [sessionLog, setSessionLog] = useState(() => savedSession?.sessionLog || []);
  const [checkupVersion, setCheckupVersion] = useState(0);
  const [recipe, setRecipe] = useState(() => savedSession?.recipe || newRecipe());
  // W3 (Step 4 — "Your results so far"): every checkup-fix apply and every
  // answered question accumulates here, newest first, instead of the old
  // single "most recent result" view. Each entry: { id, kind, label, answer,
  // timestamp, plan, resultRows, savedToRoutine }. `plan`/`resultRows` are not
  // persisted (they can be as large as the workbook) — after a refresh a card
  // still shows its label/answer, but expanding it explains detail isn't
  // available rather than showing stale or missing data.
  const [results, setResults] = useState(() => savedSession?.results || []);
  const [expandedResultId, setExpandedResultId] = useState(null);
  // Phase 8.4: a "Chart this" click seeds Step 9 with a request; the nonce lets
  // the same request re-trigger the chart if clicked again.
  const [chartSeed, setChartSeed] = useState(null); // { request, nonce }
  // Phase 8.4: Step 9 lives inside the collapsible "Analyze & chart" group;
  // "Chart this" opens it so the chart the click just built is actually visible.
  const [analyzeGroupOpen, setAnalyzeGroupOpen] = useState(false);
  const chartsRef = useRef(null);
  const [keyStore, setKeyStore] = useState(() => loadKeyStore());
  const [notice, setNotice] = useState(""); // plain, non-error message (e.g. "add a definition")
  // Parked item 4: runnable rephrasings offered with a decline (e.g. the two
  // one-column versions of a "by A and B" request). Rendered as chips under
  // the notice; clicking one fills the box and runs it.
  const [noticeAlts, setNoticeAlts] = useState([]);
  const [pendingGrain, setPendingGrain] = useState(null); // { grain, request } awaiting a combine-rows answer
  // Phase 7.1: the last question answered this session, so a short follow-up
  // ("of those, how many got cephalexin?" / "what about ceftriaxone?") can be
  // rewritten into a full request deterministically — never a new AI read.
  // { request, swapTerm } — swapTerm is the previous filter value to swap out.
  const [lastQuestion, setLastQuestion] = useState(null);
  // Phase 7.7: remember the per-patient vs per-row grain choice per file shape,
  // so it's asked once, not every question. Persistent, holds only column names
  // and the mode — never a cell value (see grainStore.js).
  const [grainStore, setGrainStore] = useState(() => loadGrainStore());
  // A small "counting per patient — change" note shown after an answer that used
  // a remembered grain choice. { entityColumn, mode, request }.
  const [grainNote, setGrainNote] = useState(null);
  // P1-4a: same never-ask-twice pattern as grain, for pooled-ranking's
  // counting policy (Decision D — occurrence / row / patient).
  const [pooledPolicyStore, setPooledPolicyStore] = useState(() => loadPooledPolicyStore());
  const [pendingPooledPolicy, setPendingPooledPolicy] = useState(null); // { columns, poolKey, suggestedPolicy, entityColumn, request }
  const [pooledPolicyNote, setPooledPolicyNote] = useState(null); // { columns, poolKey, policy, entityColumn, request }
  // Phase 7.9: when the engine declines and there's no API key, offer a small
  // "teach it" form so a novice can define a word and re-run — no key, no Excel
  // round-trip. { request }.
  const [pendingTeach, setPendingTeach] = useState(null);
  // P0-4: a small plain-English confirmation that a "remember" genuinely saved
  // (e.g. 'Learned: "visit date" means the Visit_date column — saved for this
  // file.'). The stores already work; this just makes the save visible so the
  // user believes it. Cleared on the next fresh ask.
  const [learnedNote, setLearnedNote] = useState("");
  // B7: in-app definitions, merged on top of a real Definitions sheet if the
  // workbook has one; resets with the workbook, like excluded columns.
  const [definitionsStore, setDefinitionsStore] = useState(() => emptyDefinitionsStore());
  const [pendingDefinitions, setPendingDefinitions] = useState(null); // { missingTerms, message, request, nearest }
  // W2d: "Did you mean…?" middle-path confirmation when the offline matcher
  // had to stretch (an abbreviation, a partial value match, a fuzzy column
  // scope, or a tie between candidates) to reach a value.
  const [pendingConfirm, setPendingConfirm] = useState(null); // { phrase, candidates, via, request }
  // Phase 2 "anticipate & suggest": after a stat answer, its standard
  // companion (mean <-> median, count -> n (%)) is offered as one chip.
  // Deterministic — fillPlan computed it alongside the answer, no AI.
  const [companionOffer, setCompanionOffer] = useState(null); // { companion, request, revealed? }
  // W2d: phrase (folded) -> the confirmed { column, value } candidate, so the
  // same stretch never asks twice in this session. Session-only, like the
  // rest of the in-memory state — cleared on a fresh upload.
  const [aliasMap, setAliasMap] = useState(() => new Map());
  // Phase 3: PERSISTENT learned column aliases ("treatment length" ->
  // Duration_days), filed per file shape and stored in localStorage. Unlike the
  // session aliasMap above, this survives reloads AND holds only column names —
  // never a cell value (see aliasStore.js privacy boundary).
  const [aliasStore, setAliasStore] = useState(() => loadAliasStore());
  // Phase 6: PERSISTENT AI-graduation store. When Claude answers a Step-3 request
  // the offline engine declined, we remember the value-free plan SHAPE (column
  // names + aggregation, never a cell value — planShape.js is the chokepoint),
  // keyed per file shape, so the SAME wording is answered OFFLINE next time with
  // no API call. Same localStorage-persistence pattern as the alias store.
  const [graduationStore, setGraduationStore] = useState(() => loadGraduationStore());
  // B8: the privacy badge must stay true — track every actual send to Claude
  // this session (mode at send time), instead of a permanent claim that never
  // updates once a full-mode request has gone out.
  const [aiSends, setAiSends] = useState([]); // [{ mode: "sample" | "full" }]
  // B11: a transform failure gets exactly one offered retry, so a Claude
  // hiccup isn't a dead end — set on the first failure, cleared on success,
  // a fresh request, or a second failure (only one retry, ever).
  const [retryInfo, setRetryInfo] = useState(null); // { request, hint, failedCode, error }
  // P4-6: "Questions I couldn't answer this session" — missLog/hitStore already
  // recorded every miss locally with no UI to see them. sessionStartAt scopes
  // the list to requests logged AFTER this page load (the persistent store
  // spans many sessions); missVersion is bumped anywhere a miss is logged so
  // the memo below re-reads localStorage and the list updates on screen.
  const [sessionStartAt] = useState(() => new Date().toISOString());
  const [missVersion, setMissVersion] = useState(0);
  const bumpMissVersion = () => setMissVersion((v) => v + 1);
  const sessionMisses = useMemo(
    () => listMisses().filter((m) => m.at >= sessionStartAt && m.reason !== "refined-success"),
    [missVersion, sessionStartAt],
  );
  const resultsRef = useRef(null);

  const dataContext = useMemo(() => {
    if (!workbook) return "";
    // Belt and braces: even if the "full" radio were somehow still set, PHI
    // mode caps what leaves the browser at sample mode.
    return buildDataContext(workbook, { excluded, privacyMode: phiMode ? "sample" : privacyMode });
  }, [workbook, excluded, privacyMode, phiMode]);

  // Phase 3: the current file's shape (its folded column set) and the column
  // aliases learned for that shape (and near-matching shapes, P4-1), so a
  // previously-confirmed everyday word is an exact hit again this visit even
  // after next month's export adds or renames one column.
  const signature = useMemo(
    () => (workbook ? fileSignature(workbook.sheets[0].headers) : ""),
    [workbook],
  );
  const columnAliases = useMemo(
    () => columnAliasesFor(aliasStore, workbook ? workbook.sheets[0].headers : []),
    [aliasStore, workbook],
  );
  // Phase 7.7: remembered grain choices for the current file shape.
  const grainChoices = useMemo(
    () => grainChoicesFor(grainStore, signature),
    [grainStore, signature],
  );
  // P1-4a: remembered pooled-ranking counting-policy choices for this file shape.
  const pooledPolicyChoices = useMemo(
    () => pooledPolicyChoicesFor(pooledPolicyStore, signature),
    [pooledPolicyStore, signature],
  );

  // B5/W3: persist the log/recipe/results trail (small JSON — results are
  // stripped of plan/resultRows first, see recordResult) so an accidental
  // refresh doesn't erase the record of what happened this session.
  useEffect(() => {
    // Parked item 3e: in PHI mode the results list (answers derived from real
    // data) never lands in browser storage — turning the toggle on also
    // rewrites the stored session without it.
    const persistableResults = phiMode
      ? []
      : results.map(({ plan: _plan, resultRows: _resultRows, removedRows: _removedRows, ...rest }) => rest);
    saveSession({ sessionLog, recipe, results: persistableResults });
  }, [sessionLog, recipe, results, phiMode]);

  // B5: warn before an accidental refresh/close loses the loaded workbook.
  useEffect(() => {
    if (!workbook) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [workbook]);

  // B3/W3: a fresh result should be easy to find on a long page. Every result
  // — a checkup-fix apply or an answered question, offline or AI — becomes a
  // new card at the top of "Your results so far" (Step 4), which doubles as
  // this session's undo-able history (the old chip-based run history is
  // folded into this one list). `kind` is "checkup" or "question"; a question
  // answered by the offline engine is also recorded into the routine
  // (`savedToRoutine: true`) by the caller.
  function recordResult({ label, answer, plan: newPlan, resultRows: newResultRows, removedRows, kind, savedToRoutine, chartRequest }) {
    const id = `${Date.now()}-${Math.random()}`;
    setPlan(newPlan);
    setResultRows(newResultRows);
    setResults((r) => [
      // Phase 8.4: `chartRequest` is set only when this answer's own wording
      // resolves to a chart through the shared pipeline — so the card can offer
      // a one-click "Chart this" that seeds Step 9 without re-typing.
      // Parked item 3d: `removedRows` (rows a dedupe fix dropped) rides along
      // so the card can show exactly what was removed — like plan/resultRows
      // it is never persisted to browser storage.
      { id, kind, label, answer, timestamp: Date.now(), plan: newPlan, resultRows: newResultRows, removedRows: removedRows?.length ? removedRows : null, savedToRoutine: Boolean(savedToRoutine), chartRequest: chartRequest || null },
      ...r,
    ].slice(0, MAX_RESULTS));
    setExpandedResultId(id);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  // Phase 8.4: a Step 3 answer offers "Chart this" when its wording resolves to
  // a chart — seed Step 9 and scroll to it. The chart engine re-resolves the
  // same request through the same shared pipeline (Phase 8.1), so the chart is
  // built from the same plan the answer used, never a re-typed guess.
  function chartThis(request) {
    setChartSeed({ request, nonce: Date.now() });
    setAnalyzeGroupOpen(true); // reveal Step 9 so the new chart is visible
    // Scroll after the section has a chance to expand.
    requestAnimationFrame(() => requestAnimationFrame(() => chartsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })));
  }

  // Decide if an answered question can be charted, cheaply, at record time —
  // its wording resolves to a chart plan through the shared pipeline.
  function chartRequestFor(request) {
    try {
      const s = workbook?.sheets?.[0];
      if (!s) return null;
      return resolveChartRequest(request, s).status === "resolved" ? request : null;
    } catch {
      return null;
    }
  }

  // W3: per-card "Remove" in "Your results so far" — takes the card out of
  // the visible list only. It does not undo a checkup fix already applied to
  // the workbook and does not remove a recorded routine step (removing a
  // routine step is done in the routine panel itself, step 5) — the two
  // lists can diverge on purpose, since a result card is a record of what
  // happened, not a live control over the routine.
  function removeResult(id) {
    setResults((r) => r.filter((entry) => entry.id !== id));
    setExpandedResultId((cur) => (cur === id ? null : cur));
  }

  // Every request tries the offline engine first (build prompt §3.3). A confident
  // answer needs no key; an undefined clinical term blocks plainly (B7: with an
  // in-app way to define it, not just the Definitions-sheet round-trip); a
  // per-patient question over repeating rows asks before answering; a
  // stretched value match (W2d) asks "Did you mean…?" before answering;
  // anything out of range declines and, if a key exists, is offered to Claude.
  // `storeOverride` lets a just-added definition be used immediately, without
  // waiting a render for `definitionsStore` state to update. `aliasOverride`
  // does the same for a just-confirmed "Did you mean…?" answer.
  async function runOfflineFlow(request, options, storeOverride, aliasOverride, columnAliasesOverride, teachContext = null) {
    const res = runOffline(request, workbook, {
      ...options,
      definitionsStore: storeOverride || definitionsStore,
      aliasMap: aliasOverride || aliasMap,
      // Phase 3: learned per-file column aliases (persistent). The override lets
      // a just-confirmed column chip apply immediately, before state re-renders.
      columnAliases: columnAliasesOverride || columnAliases,
      // Phase 6: a request that previously "graduated" from an AI answer is
      // reconstructed and answered offline here, before we would ever offer Claude.
      graduationStore,
      // Phase 7.7: remembered per-patient vs per-row grain choice for this file.
      // An explicit override (from "change") wins over current state, which may
      // not have re-rendered yet after forgetting a choice.
      grainChoices: options.grainChoices || grainChoices,
      // P1-4a: remembered pooled-ranking counting-policy choices for this file.
      pooledPolicyChoices: options.pooledPolicyChoices || pooledPolicyChoices,
    });
    if (res.kind === "answer") {
      // Phase 6 in-app growth: a confident offline answer is a success worth
      // remembering. Record its value-free shape to the hit store (bank-candidate
      // fuel the owner can export), whether it came straight from the matcher or
      // was reconstructed from an earlier AI graduation.
      logHit({ request, shape: planShapeFromMatch(res.match), via: res.match?.graduated ? "graduated" : "offline" });
      // W3: an offline answer is deterministic, so it is safe to replay later
      // without the AI — record it into the routine as a "question" step
      // (original wording + the resolved match), the same way a checkup fix
      // already is.
      const answer = summarizeAnswer(res.match, res.exec);
      recordResult({
        label: `Result of: your question "${request}"`,
        answer,
        plan: res.plan,
        resultRows: res.resultRows,
        kind: "question",
        savedToRoutine: true,
        chartRequest: chartRequestFor(request),
      });
      setRecipe((r) => addStep(r, questionStep(request, res.match, answer)));
      // Phase 7.1: remember this answered question so the NEXT turn can be a
      // short follow-up. `request` here is already the fully-expanded wording
      // (a chained "of those" follow-up accumulates against the expanded form).
      setLastQuestion({ request, swapTerm: lastFilterValue(res.match) });
      // Phase 2: offer the deterministic companion (median (IQR) for a mean,
      // mean (SD) for a median, n (%) for a count) as a one-click chip.
      setCompanionOffer(res.plan.companion ? { companion: res.plan.companion, request } : null);
      // Phase 7.7: if a remembered grain choice was applied (no ask this time),
      // show the small "counting per patient — change" note.
      setGrainNote(res.grainFromMemory && res.grainEntity
        ? { entityColumn: res.grainEntity, mode: res.grainMode, request }
        : null);
      // P1-4a: same "as you chose earlier — change" note, for a pooled-ranking
      // answer that applied a remembered counting policy.
      setPooledPolicyNote(res.pooledPolicyFromMemory && res.pooled
        ? { columns: res.pooled.columns, policy: res.pooled.policy, entityColumn: res.pooled.entityColumn, request }
        : null);
      return;
    }
    if (res.kind === "block") {
      if (res.missingTerms) {
        setPendingDefinitions({ missingTerms: res.missingTerms, message: res.message, request, nearest: res.nearest || [] });
      } else {
        setNotice(res.message);
        setNoticeAlts([]);
      }
      return;
    }
    if (res.kind === "clarify-grain") {
      setPendingGrain({ grain: res.grain, request });
      return;
    }
    if (res.kind === "clarify-pooled-policy") {
      setPendingPooledPolicy({
        columns: res.columns, poolKey: res.poolKey, suggestedPolicy: res.suggestedPolicy,
        entityColumn: res.entityColumn, request,
      });
      return;
    }
    if (res.kind === "confirm-value") {
      // Phase 5: start a refinement loop. Round 1 renders exactly as before
      // (same question + chips) but now carries a full ranked pool and a real
      // "None of these" path that pages to better guesses instead of giving up.
      const refine = startRefinement({
        phrase: res.phrase,
        candidates: res.candidates,
        allCandidates: res.allCandidates,
        via: res.via,
        request,
      });
      setPendingConfirm({ refine, mode: "chips", options: refine.shown, groups: null, question: null });
      return;
    }
    // res.kind === "decline"
    bumpMissVersion();
    if (!apiKey) {
      setNotice(res.message);
      setNoticeAlts(res.alternatives || []);
      // P0-3: if this run is itself a post-teach re-run and it STILL declined,
      // do not silently re-show the same form (the old infinite loop, which is
      // why "Remember this" looked dead). The learnedNote above already confirms
      // the save worked; res.message explains what still can't be done offline.
      if (teachContext) return;
      // P0-2: only offer the teach-it form when teaching a word can actually
      // change the outcome. For an unsupported operation (sort/list/reformat)
      // or a text column that can't be averaged, the message is the whole answer.
      if (isTeachableDecline(res.reason)) setPendingTeach({ request });
      return;
    }
    await runViaClaude(request, res.claudeHint);
  }

  // Phase 7.4: a compound "and" question ("average duration and most common drug
  // by diagnosis") is two questions. Run each part with the existing machinery
  // and, ONLY when EVERY part answers confidently, show one combined card — never
  // a half-answered compound. Returns true when it handled the request; false
  // (having changed nothing) when the caller should fall back to a single run.
  function runCompound(parts, originalRequest) {
    const partResults = [];
    for (const p of parts) {
      const res = runOffline(p, workbook, {
        definitionsStore, aliasMap, columnAliases, graduationStore,
      });
      if (res.kind !== "answer") { bumpMissVersion(); return false; } // not fully answerable → fall back
      partResults.push({ request: p, res });
    }
    const combinedPlan = {
      engine: "offline",
      combined: true,
      looked_for: `Answering ${parts.length} things at once, each on this computer:`,
      summary: partResults
        .map(({ res }) => res.plan.summary)
        .join("\n\n———\n\n"),
      parts: partResults.map(({ res }) => ({ plan: res.plan, rows: res.resultRows })),
    };
    const answer = partResults
      .map(({ res }) => summarizeAnswer(res.match, res.exec))
      .join("  ·  ");
    for (const { request, res } of partResults) {
      logHit({ request, shape: planShapeFromMatch(res.match), via: "offline" });
      const a = summarizeAnswer(res.match, res.exec);
      setRecipe((r) => addStep(r, questionStep(request, res.match, a)));
    }
    recordResult({
      label: `Result of: your question "${originalRequest}"`,
      answer,
      plan: combinedPlan,
      resultRows: [], // combined card renders its parts, not a single table
      kind: "question",
      savedToRoutine: true,
    });
    setLastQuestion(null); // a compound isn't a single cohort to follow up on
    return true;
  }

  // W2d: the user picked one of the "Did you mean…?" candidates. Remember the
  // mapping for the rest of the session so the same stretch never asks twice,
  // then re-run the same request — it now resolves immediately via the alias,
  // with no further stretch to confirm.
  // Phase 5: if this pick came after ≥1 "None of these" round, log the exchange
  // (round count + rejected COLUMN names only) so the owner sees which questions
  // needed more than one round.
  function answerConfirm(candidate) {
    const refine = pendingConfirm?.refine;
    const phrase = refine?.phrase;
    const request = refine?.request;
    setPendingConfirm(null);
    if (!phrase || !request) return;
    if (refine.round > 1) {
      logRefinement({
        request, phrase, rounds: refine.round, outcome: "refined-success",
        rejectedColumns: refine.rejected.map((c) => c.column),
      });
    }
    const next = new Map(aliasMap);
    next.set(foldKey(phrase), candidate);
    setAliasMap(next);
    // Phase 3: a COLUMN chip (kind: "column") is a durable everyday-word ->
    // column mapping — remember it PERSISTENTLY for this file shape so it's an
    // exact hit next visit. Only the column name is stored, never a cell value,
    // so a value chip stays session-only (in aliasMap above). The override
    // carries the new alias into the immediate re-run before state re-renders.
    let columnAliasesOverride;
    if (candidate?.kind === "column" && candidate.column && signature) {
      const nextStore = rememberColumnAlias(aliasStore, signature, phrase, candidate.column);
      setAliasStore(persistAliasStore(nextStore));
      columnAliasesOverride = columnAliasesFor(nextStore, workbook.sheets[0].headers);
    }
    runOfflineFlow(request, {}, null, next, columnAliasesOverride);
  }

  // Phase 5: "None of these" — reject the round's chips (or a whole group) and
  // move to a smarter next question. A chips round pages the next best guesses;
  // a large remainder gets a discriminating question ("the drug given, or the
  // diagnosis?"). When nothing survives, the loop honestly stops and offers AI.
  function refineReject() {
    const pc = pendingConfirm;
    if (!pc?.refine) return;
    const step = rejectShown(pc.refine, { headers: workbook?.sheets?.[0]?.headers || [] });
    if (step.done) {
      finishRefinementExhausted(step.state);
      return;
    }
    if (step.kind === "group") {
      setPendingConfirm({ refine: step.state, mode: "group", options: null, groups: step.groups, question: step.question });
    } else {
      setPendingConfirm({ refine: step.state, mode: "chips", options: step.options, groups: null, question: null });
    }
  }

  // Phase 5: the user picked one group of a discriminating question. Narrow the
  // pool to that group and show its best guesses as chips — never an answer yet.
  function refinePickGroup(groupKey) {
    const pc = pendingConfirm;
    if (!pc?.refine || !pc.groups) return;
    const step = pickGroup(pc.refine, groupKey, pc.groups);
    setPendingConfirm({ refine: step.state, mode: "chips", options: step.options, groups: null, question: null });
  }

  // Phase 5: every guess was shown and rejected. This is where the offline
  // engine honestly stops — reading the sentence a different way needs the AI.
  // Log the exhausted exchange, then show the honest-stop notice (and offer
  // Claude if a key exists), reusing the existing decline machinery.
  function finishRefinementExhausted(state) {
    setPendingConfirm(null);
    const message =
      `I showed you every guess I had for "${state.phrase}" and none of them fit. ` +
      `This is where the offline engine honestly stops — understanding the sentence a ` +
      `different way needs the AI.`;
    logRefinement({
      request: state.request, phrase: state.phrase, rounds: state.round,
      outcome: "refined-exhausted", rejectedColumns: state.rejected.map((c) => c.column),
      message,
    });
    bumpMissVersion();
    if (apiKey) {
      setNotice("");
      runViaClaude(
        state.request,
        "A local pre-check offered its ranked guesses for an ambiguous reference and the user rejected all of them.",
      );
    } else {
      setNotice(message);
    }
  }

  // Phase 2: the user clicked the companion chip. A "swap-stat" companion
  // (mean <-> median) is a full deterministic answer of its own — it becomes a
  // normal result card AND a replayable routine step, exactly as if the user
  // had asked for that stat directly. An "n-percent" companion is the same
  // numbers restated in the clinical n (%) convention — no new computation, so
  // it just reveals the formatted line in place.
  function applyCompanion() {
    if (!companionOffer) return;
    const { companion, request } = companionOffer;
    if (companion.kind === "n-percent") {
      setCompanionOffer({ ...companionOffer, revealed: true });
      return;
    }
    setCompanionOffer(null);
    const statName = companion.intent === "median" ? "median (IQR)" : "mean (SD)";
    const companionRequest = `${request} — as ${statName}`;
    recordResult({
      label: `Result of: your question "${request}" — ${statName} instead`,
      answer: companion.answer,
      plan: companion.plan,
      resultRows: companion.resultRows,
      kind: "question",
      savedToRoutine: true,
    });
    setRecipe((r) => addStep(r, questionStep(companionRequest, companion.match, companion.answer)));
  }

  // Phase 7.9: the teach-it form taught a phrase → a whole column. Save it as a
  // persistent column alias (the same Phase 3 store a confirmed chip feeds) and
  // re-run the declined question, which now resolves the phrase.
  function teachColumn(phrase, columnName) {
    setPendingTeach(null);
    setNotice("");
    const request = pendingTeach?.request;
    if (!request || !phrase || !columnName) return;
    let columnAliasesOverride;
    if (signature) {
      const nextStore = rememberColumnAlias(aliasStore, signature, phrase, columnName);
      setAliasStore(persistAliasStore(nextStore));
      columnAliasesOverride = columnAliasesFor(nextStore, workbook.sheets[0].headers);
    }
    // P0-4: confirm the save is real, then re-run flagged as a post-teach run
    // (P0-3) so a still-declining re-run explains itself instead of looping.
    setLearnedNote(`Learned: "${phrase}" means the ${columnName} column — saved for this file.`);
    runOfflineFlow(request, {}, null, null, columnAliasesOverride, { justTaught: true });
  }

  // Phase 7.9: the teach-it form taught a phrase → specific values in a column.
  // Save it as an in-app definition (the same B7 store) and re-run.
  function teachValues(phrase, columnName, valuesText) {
    setPendingTeach(null);
    setNotice("");
    const request = pendingTeach?.request;
    if (!request || !phrase || !columnName) return;
    const next = addDefinitionEntry(definitionsStore, buildDefinitionEntry(phrase, columnName, valuesText));
    setDefinitionsStore(next);
    // P0-4 + P0-3, same as teachColumn above.
    setLearnedNote(`Learned: "${phrase}" means ${valuesText} in the ${columnName} column — saved for this file.`);
    runOfflineFlow(request, {}, next, null, undefined, { justTaught: true });
  }

  // B7: record the typed definition and immediately re-run the question that
  // was blocked on it — the whole point is no Excel round-trip.
  function addDefinitionAndRerun(entry) {
    const next = addDefinitionEntry(definitionsStore, entry);
    setDefinitionsStore(next);
    const request = pendingDefinitions?.request;
    setPendingDefinitions(null);
    if (request) runOfflineFlow(request, {}, next);
  }

  // P2-19: requesting a plan from Claude and running its generated transform
  // locally are two different failure domains — an API problem (bad key, rate
  // limit, no credits) vs. a bug in the generated/executed code. Catch them
  // separately so a transform failure is shown as-is instead of being
  // funneled through friendlyApiError, which frames everything as an "AI"
  // problem even when the AI call itself succeeded.
  // B11: `retryContext` (set only when this call IS the one retry) appends
  // the prior failure to the request, asking Claude for corrected code.
  async function runViaClaude(request, hint, retryContext = null) {
    setBusy(true);
    let newPlan;
    try {
      setStatus(retryContext ? "Asking Claude to fix the extraction…" : "Sending your request to Claude…");
      let userRequest = hint ? `${request}\n\n(${hint})` : request;
      if (retryContext) {
        userRequest += `\n\nThe previous transform failed with: ${retryContext.error} — return corrected code.\n\nPrevious code:\n${retryContext.failedCode}`;
      }
      // B8: recorded at send time (not on success), since the data has left
      // the browser as soon as the request goes out, whether or not Claude's
      // reply comes back.
      setAiSends((s) => [...s, { mode: privacyMode }]);
      newPlan = await requestPlan({ apiKey, model, dataContext, userRequest, onStatus: setStatus });
    } catch (err) {
      setError(friendlyApiError(err));
      setStatus("");
      setBusy(false);
      setRetryInfo(null);
      return;
    }
    try {
      setStatus("Running the extraction on your full data (inside your browser)…");
      const sheetsByName = Object.fromEntries(workbook.sheets.map((s) => [s.name, s.rows]));
      const rows = await runTransform(newPlan.transform_code, sheetsByName);
      // W3: an AI answer is not deterministic the way the offline engine is —
      // it is still shown as a results card, but it is NOT recorded into the
      // routine, since replay never calls the AI and would otherwise have to
      // guess. The card says so plainly (see ResultsListPanel).
      recordResult({
        label: `Result of: your question "${request}"`,
        answer: `${rows.length} row${rows.length === 1 ? "" : "s"}`,
        plan: newPlan,
        resultRows: rows,
        kind: "question",
        savedToRoutine: false,
      });
      // Phase 6 AI graduation: remember the value-free SHAPE of this AI answer —
      // the intent (read offline from the user's own wording) and the column
      // names that appear verbatim in the returned plan, never a cell value
      // (planShape.js enforces this). Keyed per file shape so next time the same
      // wording is answered offline with no API call. Only a genuinely
      // reconstructable shape (a filter-free numeric/top-N/distinct over a named
      // column) will actually auto-answer; graduationStore.applyGraduation is the
      // gate. A hit is logged either way, as owner-curation fuel.
      if (signature && workbook?.sheets?.[0]?.headers) {
        const shape = planShapeFromAiPlan({
          request, plan: newPlan, headers: workbook.sheets[0].headers, detectIntent, detectTopN,
        });
        if (shape) {
          setGraduationStore((store) => persistGraduationStore(rememberGraduation(store, signature, request, shape)));
          logHit({ request, shape, via: "ai" });
        }
      }
      setStatus("");
      setRetryInfo(null);
    } catch (err) {
      const message = err?.message || "The extraction step failed.";
      setError(message);
      setStatus("");
      // Only the first failure offers a retry — a retry that also fails just
      // shows the error, no infinite loop of AI attempts.
      setRetryInfo(retryContext ? null : { request, hint, failedCode: newPlan.transform_code, error: message });
    } finally {
      setBusy(false);
    }
  }

  // B11: re-send the same request with the prior failure appended, asking
  // for corrected code. One retry, then the offer is gone either way.
  function retryTransform() {
    if (!retryInfo) return;
    const { request, hint, failedCode, error } = retryInfo;
    setRetryInfo(null);
    setError("");
    runViaClaude(request, hint, { failedCode, error });
  }

  async function handleRun(promptOverride) {
    // P1-4b: the checkbox picker builds request text and runs it immediately —
    // it can't go through the `prompt` state var (setPrompt+handleRun in the
    // same tick would run against last render's stale closure), so it passes
    // the text straight in instead.
    const raw = promptOverride !== undefined ? promptOverride : prompt;
    setError("");
    setNotice("");
    setNoticeAlts([]);
    setPendingGrain(null);
    setPendingPooledPolicy(null);
    setPendingDefinitions(null);
    setPendingConfirm(null);
    setCompanionOffer(null);
    setRetryInfo(null);
    setGrainNote(null);
    setPooledPolicyNote(null);
    setPendingTeach(null);
    setLearnedNote(""); // P0-4: a fresh ask starts without a stale "Learned:" line
    // Phase 7.1: a short follow-up ("of those, …" / "what about X?") is rewritten
    // into a full request using the last answered question, so the previous
    // cohort carries over. Deterministic; if no confident rewrite is possible
    // (no prior question, or the swap value can't be located), the user's raw
    // words run as-is and decline honestly.
    const followed = applyFollowUp(raw, lastQuestion);
    const effective = followed ? followed.request : raw;
    // Phase 7.4: try a compound "and" split first. If it fully answers, show one
    // combined card; otherwise fall through to a single run (nothing changed).
    const parts = splitCompound(effective);
    if (parts && runCompound(parts, effective)) return;
    await runOfflineFlow(effective, {});
  }

  // P1-4b: the no-typing pooled-rank picker hands over its chosen columns;
  // build the same English sentence P1-4a's matcher already parses ("most
  // common value across X and Y") so it rides the identical pipeline, and
  // fill the textarea too so the user sees what was asked.
  function runPooledColumns(columns) {
    const text = `most common value across ${columns.join(" and ")}`;
    setPrompt(text);
    handleRun(text);
  }

  // The user answered the grain question: "combine" runs per-entity, "rows" keeps
  // one row at a time. Either way we re-run the same request with that decision.
  // Phase 7.7: remember the choice per file shape + entity column so we don't
  // ask again for this file — only the column name and mode are stored.
  function answerGrain(mode) {
    const pending = pendingGrain;
    setPendingGrain(null);
    if (!pending?.request) return;
    if (signature && pending.grain?.entityColumn && (mode === "row" || mode === "group-then-test")) {
      const next = rememberGrainChoice(grainStore, signature, pending.grain.entityColumn, mode);
      setGrainStore(persistGrainStore(next));
    }
    runOfflineFlow(pending.request, { grainMode: mode });
  }

  // Phase 7.7: the user clicked "change" on the remembered-grain note — forget
  // the stored choice for this entity column and re-ask by re-running the same
  // question (which now has no memory to apply, so it asks again).
  function changeGrain() {
    const note = grainNote;
    setGrainNote(null);
    if (!note) return;
    let choices = grainChoices;
    if (signature && note.entityColumn) {
      const next = forgetGrainChoice(grainStore, signature, note.entityColumn);
      setGrainStore(persistGrainStore(next));
      choices = grainChoicesFor(next, signature);
    }
    // Re-run with the memory cleared so the grain question appears again.
    runOfflineFlow(note.request, { grainChoices: choices });
  }

  // P1-4a: the user answered the pooled-ranking counting-policy question —
  // remember it per file shape + column pair (Decision D), then re-run.
  function answerPooledPolicy(policy) {
    const pending = pendingPooledPolicy;
    setPendingPooledPolicy(null);
    if (!pending?.request) return;
    const entityColumn = policy === "patient" ? pending.entityColumn : null;
    if (signature && pending.columns?.length) {
      const next = rememberPooledPolicy(pooledPolicyStore, signature, pending.columns, policy, entityColumn);
      setPooledPolicyStore(persistPooledPolicyStore(next));
    }
    runOfflineFlow(pending.request, { pooledPolicy: policy });
  }

  // P1-4a: the user clicked "change" on the remembered pooled-policy note —
  // forget the stored choice for this column pair and re-ask.
  function changePooledPolicy() {
    const note = pooledPolicyNote;
    setPooledPolicyNote(null);
    if (!note) return;
    let choices = pooledPolicyChoices;
    if (signature && note.columns?.length) {
      const next = forgetPooledPolicy(pooledPolicyStore, signature, note.columns);
      setPooledPolicyStore(persistPooledPolicyStore(next));
      choices = pooledPolicyChoicesFor(next, signature);
    }
    runOfflineFlow(note.request, { pooledPolicyChoices: choices });
  }

  function handleWorkbook(wb) {
    setWorkbook(wb);
    setOriginalWorkbook(wb);
    setExcluded(new Set());
    setPlan(null);
    setResultRows(null);
    setResults([]); // W3: a fresh file starts a fresh "results so far" list
    setExpandedResultId(null);
    setUndoSnapshot(null);
    setError("");
    setNotice("");
    setPendingGrain(null);
    setPendingPooledPolicy(null);
    setPendingDefinitions(null);
    setPendingConfirm(null);
    setCompanionOffer(null);
    setLastQuestion(null); // Phase 7.1: a fresh file starts a fresh conversation
    setGrainNote(null); // Phase 7.7: no remembered-grain note until one applies
    setPooledPolicyNote(null); // P1-4a: no remembered-policy note until one applies
    setPendingTeach(null); // Phase 7.9: no teach-it form until a decline
    setAliasMap(new Map()); // W2d: a session-level alias map, fresh per workbook
    setDefinitionsStore(emptyDefinitionsStore());
    setAiSends([]); // B8: the badge tracks this workbook's sends, not a prior file's
    setRetryInfo(null);
    setSessionLog([]);
    // W3: pre-fill the routine name from the file, e.g. "DC antibiotics — monthly".
    setRecipe(newRecipe(defaultRoutineName(wb.fileName)));
    setCheckupVersion((v) => v + 1);
  }

  // B2: a synthetic, clearly-fake workbook so a novice (or anyone with real PHI
  // they're not ready to drop in yet) can try the whole app risk-free.
  function handleTryExample() {
    handleWorkbook(buildExampleWorkbook());
  }

  // B4: "Start over" drops every change and goes back to the file as uploaded.
  function handleStartOver() {
    if (!originalWorkbook) return;
    handleWorkbook(originalWorkbook);
  }

  // B4: "Undo last apply" restores the single snapshot taken just before the
  // most recent checkup apply — the sheet, the log event it added, and the
  // recipe steps it recorded all revert together.
  function handleUndo() {
    if (!undoSnapshot) return;
    setWorkbook(undoSnapshot.workbook);
    setSessionLog(undoSnapshot.sessionLog);
    setRecipe(undoSnapshot.recipe);
    setUndoSnapshot(null);
    setPlan(null);
    setResultRows(null);
    setResults((r) => r.slice(1)); // newest-first: the undone apply's card no longer applies
    setExpandedResultId(null);
    setCheckupVersion((v) => v + 1);
  }

  // Apply the checkup fixes the user picked: build an offline plan per affected
  // sheet, run it on the full data, show one result card per sheet, replace
  // each sheet with its cleaned rows (so later steps use them), and append to
  // the cleaning log. P4-4: fixes can now come from any sheet in the workbook
  // (Step 2 scans all of them) — group by the sheet each fix names and apply
  // each sheet's own fixes against that sheet only.
  async function handleApplyFixes(fixes) {
    if (!fixes.length) return;
    setError("");
    setBusy(true);
    setStatus("Applying your fixes on this computer…");
    setUndoSnapshot({ workbook, sessionLog, recipe });
    try {
      const bySheetName = new Map();
      for (const fix of fixes) {
        if (!bySheetName.has(fix.sheet)) bySheetName.set(fix.sheet, []);
        bySheetName.get(fix.sheet).push(fix);
      }
      let nextSheets = workbook.sheets;
      const newLogEvents = [];
      let nextRecipe = recipe;
      for (const [sheetName, sheetFixes] of bySheetName) {
        const idx = nextSheets.findIndex((s) => s.name === sheetName);
        const sheet = nextSheets[idx];
        const { plan: fixPlan, log, removedRows } = buildFixPlan(sheet, sheetFixes);
        const rows = await runTransform(fixPlan.transform_code, { [sheet.name]: sheet.rows });
        const cleaned = deriveSheet(sheet.name, rows, sheet);
        nextSheets = nextSheets.map((s, i) => (i === idx ? cleaned : s));
        newLogEvents.push(makeLogEvent({ fileName: workbook.fileName, sheet: sheet.name, entries: log }));
        nextRecipe = sheetFixes.reduce((acc, fix) => addStep(acc, checkupStep(fix)), nextRecipe);
        recordResult({
          label: `Result of: ${sheetFixes.length} checkup fix${sheetFixes.length === 1 ? "" : "es"}${bySheetName.size > 1 ? ` — sheet "${sheet.name}"` : ""}`,
          answer: `${rows.length} row${rows.length === 1 ? "" : "s"} cleaned${removedRows.length ? ` — ${removedRows.length} removed` : ""}`,
          plan: fixPlan,
          resultRows: rows,
          removedRows,
          kind: "checkup",
          savedToRoutine: true,
        });
      }
      setWorkbook({ ...workbook, sheets: nextSheets });
      setSessionLog((l) => [...l, ...newLogEvents]);
      setRecipe(nextRecipe);
      setCheckupVersion((v) => v + 1);
      setStatus("");
    } catch (err) {
      setUndoSnapshot(null);
      setError(friendlyApiError(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  // Dev-only hook so the pipeline can be exercised without an API key.
  if (import.meta.env.DEV) {
    window.__tidytable = {
      getWorkbook: () => workbook,
      applyPlan: async (fakePlan) => {
        const sheetsByName = Object.fromEntries(workbook.sheets.map((s) => [s.name, s.rows]));
        const rows = await runTransform(fakePlan.transform_code, sheetsByName);
        setPlan(fakePlan);
        setResultRows(rows);
        return rows.length;
      },
    };
  }

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1>TidyTable</h1>
          <p className="tagline">
            Upload a spreadsheet, ask for what you need in plain words, and get the
            cleaned data — plus an Excel recipe and an RStudio script to double-check it.
          </p>
          <p className="privacy-badge">{privacyBadgeText(aiSends)}</p>
        </div>
        <ApiKeyPanel apiKey={apiKey} setApiKey={setApiKey} model={model} setModel={setModel} />
      </header>

      <main>
        <section className="card">
          <h2><span className="step-label">Step 1</span> — Upload your spreadsheet</h2>
          <p className="section-intro">
            Drop an Excel file here, or click to choose one. Nothing is uploaded anywhere —
            the file stays on this computer, and you decide later what, if anything, is sent
            to the AI.
          </p>
          <UploadPanel
            workbook={workbook}
            onWorkbook={handleWorkbook}
            excluded={excluded}
            setExcluded={setExcluded}
            privacyMode={privacyMode}
            setPrivacyMode={setPrivacyMode}
            phiMode={phiMode}
            setPhiMode={setPhiMode}
          />
          {!workbook && (
            <p className="try-example-row">
              <button className="btn btn-ghost" onClick={handleTryExample}>
                Try it with example data
              </button>
              <span className="dim"> — synthetic, fake data, safe to explore. Nothing real.</span>
            </p>
          )}
          {workbook && <ColumnProfileTable sheet={workbook.sheets[0]} />}
        </section>

        {workbook && (
          <section className="card">
            <h2><span className="step-label">Step 2</span> — Check your data for problems</h2>
            <p className="section-intro">
              Before you do anything else, here is what an automatic check found in your data —
              tick the ones you want fixed and apply them.
            </p>
            <CheckupPanel
              key={`checkup-${checkupVersion}`}
              sheets={workbook.sheets}
              busy={busy}
              onApply={handleApplyFixes}
            />
            {sessionLog.length > 0 && (
              <div className="download-fixed-file">
                <button
                  className="btn btn-primary"
                  onClick={() => downloadWorkbookAsXlsx(workbook, fixedFileName(workbook.fileName))}
                >
                  Download your fixed file (.xlsx)
                </button>
                <p className="dim">
                  Same file, fixes applied. Cell colors and column widths are reset — the data
                  itself is untouched.
                </p>
              </div>
            )}
            <div className="workbook-actions">
              <button className="btn btn-ghost" onClick={handleUndo} disabled={!undoSnapshot || busy}>
                Undo last apply
              </button>
              <button className="btn btn-ghost" onClick={handleStartOver} disabled={busy}>
                Start over from the uploaded file
              </button>
            </div>
          </section>
        )}

        {sessionLog.length > 0 && (
          <section className="card">
            <h2>Cleaning log</h2>
            <p className="section-intro">
              A plain-English record of every change made in this session, with row counts. Keep
              it as your trail for reviewers or committees.
            </p>
            <div className="log-box">{formatCleaningLog(sessionLog)}</div>
            <div className="row-end">
              <button
                className="btn btn-ghost"
                onClick={() => downloadText(formatCleaningLog(sessionLog), "TidyTable_cleaning_log.txt")}
              >
                Download cleaning log
              </button>
            </div>
          </section>
        )}

        {workbook && (
          <section className="card">
            <h2><span className="step-label">Step 3</span> — Describe what you want</h2>
            <p className="section-intro">
              Ask for what you need the way you'd ask a colleague — no formulas, no jargon.
              You'll get a clear summary of what was done and a result you can download.
            </p>
            <PromptPanel
              prompt={prompt}
              setPrompt={setPrompt}
              onRun={() => handleRun()}
              busy={busy}
              status={status}
              canRun={Boolean(prompt.trim())}
              needsKey={!apiKey}
              dataContext={dataContext}
              model={model}
              privacyMode={privacyMode}
              workbook={workbook}
            />
            <PooledRankPicker sheet={workbook.sheets[0]} busy={busy} onRun={runPooledColumns} />
            <DefinitionsPanel store={definitionsStore} onChange={setDefinitionsStore} />
            {pendingGrain && (
              <ClarifyBox
                question={pendingGrain.grain.question}
                options={[
                  { value: "group-then-test", label: `Combine each ${pendingGrain.grain.entity}'s rows first`, detail: `count ${pendingGrain.grain.entity}s` },
                  { value: "row", label: "Count rows as they are", detail: "one row at a time" },
                ]}
                onAnswer={answerGrain}
                onCancel={() => setPendingGrain(null)}
              />
            )}
            {pendingPooledPolicy && (
              <ClarifyBox
                question={`When "${pendingPooledPolicy.columns.join('" and "')}" repeat a value, how should it be counted?`}
                options={[
                  { value: "occurrence", label: "Every occurrence", detail: "counts each non-blank cell" },
                  { value: "row", label: "Once per row", detail: "a repeat on the same row counts once" },
                  ...(pendingPooledPolicy.entityColumn
                    ? [{ value: "patient", label: `Once per "${pendingPooledPolicy.entityColumn}"`, detail: "a repeat for the same patient counts once" }]
                    : []),
                ]}
                onAnswer={answerPooledPolicy}
                onCancel={() => setPendingPooledPolicy(null)}
              />
            )}
            {pendingConfirm && (
              <ClarifyBox
                question={confirmQuestion(pendingConfirm)}
                // Phase 5: a group round shows one option per concept/column
                // group; a chips round shows candidate chips. Both append a real
                // "None of these" that pages to a smarter question (chips) or
                // ends the loop honestly (all guesses rejected).
                options={
                  pendingConfirm.mode === "group"
                    ? [
                        ...pendingConfirm.groups.map((g) => ({ value: `group:${g.key}`, label: capFirst(g.label) })),
                        { value: "none", label: "None of these" },
                      ]
                    : [
                        ...pendingConfirm.options.map((c, i) => (
                          c.kind === "column"
                            // Phase 3: a "did you mean this COLUMN?" chip.
                            ? { value: `cand:${i}`, label: `the "${c.column}" column`, detail: c.via || "" }
                            : { value: `cand:${i}`, label: String(c.value), detail: `in "${c.column}"` }
                        )),
                        { value: "none", label: "None of these" },
                      ]
                }
                onAnswer={(value) => {
                  if (value === "none") { refineReject(); return; }
                  if (String(value).startsWith("group:")) { refinePickGroup(String(value).slice(6)); return; }
                  const i = Number(String(value).slice(5)); // "cand:N"
                  answerConfirm(pendingConfirm.options[i]);
                }}
                onCancel={() => setPendingConfirm(null)}
                cancelLabel="Not now"
              />
            )}
            {pendingDefinitions && (
              <DefinitionsEditor
                missingTerms={pendingDefinitions.missingTerms}
                message={pendingDefinitions.message}
                nearest={pendingDefinitions.nearest}
                columns={workbook.sheets[0].headers.map((h) => h.name)}
                onAdd={addDefinitionAndRerun}
                onCancel={() => setPendingDefinitions(null)}
                onSendToClaude={apiKey ? () => {
                  const request = pendingDefinitions.request;
                  setPendingDefinitions(null);
                  if (request) runViaClaude(request, "A local pre-check found an undefined clinical term and the user chose to ask the AI instead of defining it.");
                } : null}
              />
            )}
            {grainNote && (
              <div className="notice-box grain-note" role="status" aria-live="polite">
                <span>
                  {grainNote.mode === "group-then-test"
                    ? `Counting per ${grainNote.entityColumn.replace(/id$/i, "").trim() || "patient"} (each one's rows combined first), as you chose earlier for this file. `
                    : `Counting rows as they are, as you chose earlier for this file. `}
                </span>
                <button type="button" className="btn btn-ghost" onClick={changeGrain}>
                  Change
                </button>
              </div>
            )}
            {pooledPolicyNote && (
              <div className="notice-box pooled-policy-note" role="status" aria-live="polite">
                <span>
                  {`Counting "${pooledPolicyNote.columns.join('" + "')}" `}
                  {pooledPolicyNote.policy === "row"
                    ? "once per row"
                    : pooledPolicyNote.policy === "patient"
                      ? `once per "${pooledPolicyNote.entityColumn}"`
                      : "by every occurrence"}
                  {", as you chose earlier for this file. "}
                </span>
                <button type="button" className="btn btn-ghost" onClick={changePooledPolicy}>
                  Change
                </button>
              </div>
            )}
            {learnedNote && (
              <div className="notice-box learned-note" role="status" aria-live="polite">{learnedNote}</div>
            )}
            {notice && (
              <div className="notice-box" role="status" aria-live="polite">
                {notice}
                {noticeAlts.length > 0 && (
                  <div className="notice-alternatives">
                    {noticeAlts.map((alt) => (
                      <button
                        key={alt}
                        type="button"
                        className="example-chip"
                        onClick={() => { setPrompt(alt); handleRun(alt); }}
                      >
                        {alt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {pendingTeach && (
              <TeachItForm
                request={pendingTeach.request}
                columns={workbook.sheets[0].headers.map((h) => h.name)}
                onTeachColumn={teachColumn}
                onTeachValues={teachValues}
                onCancel={() => setPendingTeach(null)}
              />
            )}
            {error && (
              <div className="error-box" role="alert">
                {error}
                {retryInfo && (
                  <div className="row-end" style={{ marginTop: "0.5rem" }}>
                    <button type="button" className="btn btn-ghost" onClick={retryTransform} disabled={busy}>
                      Try again — ask Claude to fix it
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {workbook && sessionMisses.length > 0 && (
          <section className="card">
            <h2>Questions I couldn't answer this session</h2>
            <p className="section-intro">
              Every request the offline engine couldn't confidently answer, in the order you asked —
              a teaching queue: rephrase one of these, or ask for it as a feature next.
            </p>
            <ul className="miss-list">
              {sessionMisses.map((m, i) => (
                <li key={i}>
                  <span className="miss-request">"{m.request}"</span> — {m.message || "couldn't be answered offline."}
                </li>
              ))}
            </ul>
          </section>
        )}

        {workbook && (
          <section className="card" ref={resultsRef}>
            <h2><span className="step-label">Step 4</span> — Your results so far</h2>
            <p className="section-intro">
              Every fix you apply and every question you ask lands here as a card, newest first.
              Click a card for the full result: a table, an Excel recipe, and an RStudio script.
              Questions answered on this computer (no AI needed) are saved into your routine
              automatically — see step 5 below.
            </p>
            {companionOffer && (
              companionOffer.revealed ? (
                <div className="notice-box companion-offer" role="status" aria-live="polite">
                  As n (%): {companionOffer.companion.answerText}. Same numbers as the card below — just the way a paper reports them.
                </div>
              ) : (
                <div className="notice-box companion-offer" role="group" aria-label="Also available">
                  <span>Also available, computed the same way on this computer: </span>
                  <button type="button" className="btn btn-ghost" onClick={applyCompanion}>
                    {companionOffer.companion.label}
                  </button>
                </div>
              )
            )}
            <ResultsListPanel
              results={results}
              expandedId={expandedResultId}
              onToggle={(id) => setExpandedResultId((cur) => (cur === id ? null : id))}
              onRemove={removeResult}
              onChart={chartThis}
            />
          </section>
        )}

        {/* B1: optional, goal-grouped sections. Collapsed by default so a novice
            with one question isn't forced to scroll past everything else to
            find it. Pre-upload, the replay tool has nothing to number against
            yet, so it's offered separately below without step numbering. */}
        {workbook && (
          <details className="step-group">
            <summary>Monthly routine — save this cleanup as a routine, replay it next month</summary>
            <section className="card">
              <h2><span className="step-label">Step 5</span> — Save this routine</h2>
              <p className="section-intro">
                If this is a file you clean every month, save these steps as a routine and run it
                on next month's file in step 6. The checkup fixes and questions you answered above
                are recorded automatically. Optional extras — swapping names for stable codes and
                making report cards — are folded below.
              </p>
              <RecipePanel recipe={recipe} sheet={workbook.sheets[0]} onChange={setRecipe} />
            </section>
            <section className="card">
              <h2><span className="step-label">Step 6</span> — Run a saved routine on next month's file</h2>
              <p className="section-intro">
                Pick a saved routine and next month's file. The recorded steps run again, and you get a
                plain report of what happened — including anything new the rules did not cover, said
                plainly rather than guessed. Report cards, if the routine makes them, show codes only.
              </p>
              <ReplayPanel keyStore={keyStore} onKeyStore={setKeyStore} />
            </section>
          </details>
        )}

        {!workbook && (
          <section className="card">
            <h2>Already have a saved routine?</h2>
            <p className="section-intro">
              Pick a saved routine and a file to run it on. The recorded steps run again, and you
              get a plain report of what happened — including anything new the rules did not cover.
            </p>
            <ReplayPanel keyStore={keyStore} onKeyStore={setKeyStore} />
          </section>
        )}

        {workbook && (
          <details className="step-group" open={analyzeGroupOpen} onToggle={(e) => setAnalyzeGroupOpen(e.currentTarget.open)}>
            <summary>Analyze &amp; chart — compare groups, run models, make a chart</summary>
            <section className="card">
              <h2><span className="step-label">Step 7</span> — Compare two groups (statistics)</h2>
              <p className="section-intro">
                Pick a grouping column and an outcome column and the app builds the table, picks
                the right test, and shows every step. No key needed.
                {workbook.sheets.length > 1 && (
                  <> Only the first sheet, "{workbook.sheets[0].name}", is used here.</>
                )}
              </p>
              <StatsPanel sheet={workbook.sheets[0]} />
            </section>
            <section className="card">
              <h2><span className="step-label">Step 8</span> — Advanced models (regression)</h2>
              <p className="section-intro">
                For models with several variables at once. Answer three questions first; the app
                checks whether your data can support the model and either recommends the right
                method with an RStudio script, or explains plainly why it would not be trustworthy.
                {workbook.sheets.length > 1 && (
                  <> Only the first sheet, "{workbook.sheets[0].name}", is used here.</>
                )}
              </p>
              <RegressionWizard sheet={workbook.sheets[0]} />
            </section>
            <section className="card">
              <h2><span className="step-label">Step 9</span> — Make a chart</h2>
              <p className="section-intro">
                Pick what to compare and the app recommends the one chart that fits, with numbered
                steps to build the same chart in Excel.
                {workbook.sheets.length > 1 && (
                  <> Only the first sheet, "{workbook.sheets[0].name}", is used here.</>
                )}
              </p>
              <div ref={chartsRef}>
                <ChartsPanel sheet={workbook.sheets[0]} seed={chartSeed} />
              </div>
            </section>
          </details>
        )}

        {workbook && (
          <details className="step-group">
            <summary>Reshape — combine sheets, split cells, switch row grain</summary>
            <section className="card">
              <h2><span className="step-label">Step 10</span> — Combine and reshape</h2>
              <p className="section-intro">
                Common multi-step moves: find rows missing from another sheet, look up a value, split
                paired list cells, or switch between one row per visit and one row per patient.
                {workbook.sheets.length > 1 && (
                  <> The first sheet, "{workbook.sheets[0].name}", is always the starting point; pick which other sheet to bring in below.</>
                )}
              </p>
              <ShelfPanel workbook={workbook} />
            </section>
          </details>
        )}
      </main>

      <footer className="footnote">
        Your spreadsheet is processed inside your browser. Only what you choose in the
        privacy settings is ever sent to the AI, using your own key. Nothing is stored on
        any TidyTable server (there isn't one).
      </footer>
    </div>
  );
}
