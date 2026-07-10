import Anthropic from "@anthropic-ai/sdk";
import { PLAN_SCHEMA } from "./schema.js";
import { fakeValue, fakeStream } from "./synthetic.js";
import { excelRowExtent } from "./workbook.js";

export const MODELS = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 — best quality (recommended)", supportsAdaptiveThinking: true },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 — fast, cheaper", supportsAdaptiveThinking: true },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — cheapest, simple requests only", supportsAdaptiveThinking: false },
];
export const DEFAULT_MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT = `You are the data-analyst engine inside TidyTable, a browser tool that cleans and extracts data from Excel workbooks. The user describes what they want in plain English. You return a plan as JSON (schema-enforced) with four deliverables that MUST all produce the same result, so the user can cross-validate them:

1. "summary" — plain English, no jargon. State exactly what will be pulled out, the rules you applied (filters, matching, how ties/missing values are handled), and any assumptions you made about ambiguous wording.

2. "transform_code" — the body of a JavaScript function. It will be executed as: new Function("sheets", transform_code)(sheets)
   - "sheets" is an object: { [sheetName]: arrayOfRowObjects }. Row object keys are the column header names EXACTLY as listed in the user message. Values are string | number | boolean | null. Dates are strings like "2024-03-15" or "2024-03-15 09:30".
   - It must RETURN an array of plain objects — the result table. Choose clear column names for the output.
   - Pure computation only: no imports, no fetch, no DOM, no async.
   - Be defensive: trim strings, compare text case-insensitively where sensible, tolerate null/missing values, parse numbers that arrive as strings (e.g. "1,204" or "$50"). You only saw a sample of rows; the code runs on the FULL dataset, so handle values you didn't see.
   - If the request is a summary (counts, averages, group totals), return one row per group.

3. "excel_steps" — a manual recipe the user follows in Excel to reproduce the SAME result and confirm the app got it right. Assume they know nothing about Excel:
   - Reference exact sheet names, column letters (given in the user message), and cell addresses, including the row range to fill down to (the row counts are given).
   - One action per step. Give the exact formula text to type. Explain what each formula does in one plain sentence.
   - Prefer simple, reliable functions available in both Windows and Mac Excel: IF, COUNTIFS, SUMIFS, AVERAGEIFS, FILTER (note if it needs Excel 365), TRIM, VALUE, TEXT, VLOOKUP/XLOOKUP.
   - End with a verification step: which single number (e.g. a COUNTIFS total or a sum) to compare with the app's result table.

4. "r_script" — a complete RStudio script that reproduces the same result, runnable by someone who has NEVER used R, on both Mac and Windows:
   - Start with package setup that auto-installs if missing:
     if (!require("readxl")) install.packages("readxl"); library(readxl)
     (same pattern for dplyr or other packages you use — keep the package list minimal).
   - Load the file with file.choose() so the user never edits a file path:
     data <- read_excel(file.choose(), sheet = "SheetNameHere")
   - Add a short comment above every block saying in plain English what it does.
   - End by: printing the number of result rows with message(), showing the table with View(result), and saving it:
     out_path <- file.path(path.expand("~"), "TidyTable_result.csv")
     write.csv(result, out_path, row.names = FALSE)
     message("Saved to: ", out_path)
   - Use only cross-platform code (no OS-specific paths).

5. "r_run_notes" — 2-5 short bullets (as plain text lines): which packages the script installs, what a successful run looks like, and which number to compare with the app and the Excel check.

Consistency is the whole point: the JavaScript result, the Excel recipe, and the R script must apply identical logic and produce identical rows/numbers. If parts of the request are ambiguous, pick the most reasonable interpretation, apply it identically in all three, and say what you assumed in "summary".

If the user's request cannot be answered from the columns available, still return valid JSON: explain the problem in "summary", return an empty-result transform ("return [];"), and leave excel_steps as a single step explaining what's missing.`;

const SYSTEM = SYSTEM_PROMPT;

// Build the data-description part of the user message.
//
// Privacy (build prompt §5): in the default "sample" mode we send only column
// names, letters, and types, with MADE-UP example values that copy the shape of
// the real data but never its contents. Real cell values are only ever sent in
// the explicit "full" mode, which the UI marks clearly.
export function buildDataContext(workbook, options) {
  const { excluded, privacyMode } = options; // excluded: Set of "sheet::column"
  const lines = [];
  lines.push(`Workbook file: "${workbook.fileName}"`);
  if (privacyMode !== "full") {
    lines.push("");
    lines.push("Privacy note: all example values below are made up. They copy the shape and format of the real data (so you can write correct logic) but are not real cell contents.");
  }
  lines.push("");

  for (const sheet of workbook.sheets) {
    const extent = excelRowExtent(sheet);
    const rowNote = extent.needsNote
      ? ` Header is in row ${extent.firstDataRow - 1}; data rows run from row ${extent.firstDataRow} to row ${extent.lastRow} (this sheet has ${extent.droppedBlankRows} blank row${extent.droppedBlankRows === 1 ? "" : "s"} inside that range that were skipped, so the physical range is longer than the ${sheet.rowCount.toLocaleString()} data rows).`
      : ` Data rows span row ${extent.firstDataRow} to row ${extent.lastRow}.`;
    lines.push(`Sheet "${sheet.name}" — ${sheet.rowCount.toLocaleString()} data rows (data starts in row ${extent.firstDataRow}; row ${extent.firstDataRow - 1} is headers).${rowNote}`);
    const exampleLabel = privacyMode === "full" ? "example values" : "made-up example values";
    lines.push(`Columns (Excel letter | header name | type | ${exampleLabel}):`);
    // A single seeded stream per sheet keeps fakes stable and varied.
    const rng = fakeStream(sheet.name.length + 7);
    for (const h of sheet.headers) {
      const key = `${sheet.name}::${h.name}`;
      if (excluded.has(key)) {
        lines.push(`  ${h.letter} | "${h.name}" | [values withheld by the user for privacy — the column exists in the real data; do not use its values in logic unless the user asks, and never echo them]`);
      } else {
        const samples = privacyMode === "full" ? h.samples : h.samples.map((s) => fakeValue(s, rng));
        const ex = samples.length ? samples.map((s) => JSON.stringify(s)).join(", ") : "(no examples — column mostly empty)";
        lines.push(`  ${h.letter} | "${h.name}" | ${h.type} | ${ex}`);
      }
    }

    const strip = (row) => {
      const out = {};
      for (const h of sheet.headers) {
        const key = `${sheet.name}::${h.name}`;
        out[h.name] = excluded.has(key) ? "[withheld]" : row[h.name];
      }
      return out;
    };

    if (privacyMode === "full") {
      lines.push(`All ${sheet.rowCount} rows (JSON):`);
      lines.push(JSON.stringify(sheet.rows.map(strip)));
    } else {
      // Made-up sample rows: same columns and shape, fabricated contents.
      const fake = (row) => {
        const out = {};
        for (const h of sheet.headers) {
          const key = `${sheet.name}::${h.name}`;
          out[h.name] = excluded.has(key) ? "[withheld]" : fakeValue(row[h.name], rng);
        }
        return out;
      };
      const sample = sheet.rows.slice(0, 10).map(fake);
      lines.push("First 10 rows as a made-up sample (JSON) — real data has more rows and other values; these examples are fabricated look-alikes, not real cell contents:");
      lines.push(JSON.stringify(sample, null, 1));
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function estimateTokens(text) {
  return Math.ceil(text.length / 3.6);
}

// Rough input pricing per million tokens, for the pre-flight cost hint.
// P2-21: Sonnet 5's $2/MTok is an introductory price that ends 2026-08-31 and
// reverts to $3/MTok — compute it from the date instead of hardcoding the
// intro price, so the estimate doesn't quietly go stale after that date.
const SONNET_5_INTRO_PRICE_ENDS = new Date("2026-09-01T00:00:00Z");
const INPUT_PRICE = { "claude-opus-4-8": 5, "claude-haiku-4-5": 1 };
export function estimateCostUSD(model, tokens, now = new Date()) {
  const per = model === "claude-sonnet-5"
    ? (now < SONNET_5_INTRO_PRICE_ENDS ? 2 : 3)
    : (INPUT_PRICE[model] ?? 5);
  return (tokens / 1_000_000) * per;
}

// P0-3: adaptive thinking is only supported on Claude 4.6+ models. Sending it
// to Haiku 4.5 gets a 400 that breaks every request. Build the request params
// per model so this is testable without a network call, and so a model that
// doesn't support the param never gets it (no budget_tokens fallback either —
// just omit "thinking" entirely for those models).
export function buildRequestParams(model, { system, userMessage }) {
  const entry = MODELS.find((m) => m.id === model);
  const params = {
    model,
    max_tokens: 64000,
    system,
    output_config: { format: { type: "json_schema", schema: PLAN_SCHEMA } },
    messages: [{ role: "user", content: userMessage }],
  };
  if (entry?.supportsAdaptiveThinking) {
    params.thinking = { type: "adaptive" };
  }
  return params;
}

export async function requestPlan({ apiKey, model, dataContext, userRequest, onStatus }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const userMessage = [
    "Here is the user's workbook:",
    "",
    dataContext,
    "---",
    "The user's request, in their own words:",
    "",
    userRequest.trim(),
  ].join("\n");

  onStatus?.("Claude is reading your data and writing the plan…");

  const stream = client.messages.stream(buildRequestParams(model, { system: SYSTEM, userMessage }));

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("The AI declined this request. Try rewording it, or remove sensitive content.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("The plan was too long and got cut off. Try a simpler or more specific request.");
  }

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  let plan;
  try {
    plan = JSON.parse(text);
  } catch {
    throw new Error("The AI response could not be read. Please try again.");
  }
  return plan;
}

export function friendlyApiError(err) {
  const status = err?.status;
  if (status === 401) return "Your API key was rejected. Check that you pasted the whole key (it starts with sk-ant-).";
  if (status === 429) return "You hit the rate limit for your API key. Wait a minute and try again.";
  if (status === 400 && /credit/i.test(err?.message || "")) return "Your Anthropic account is out of credits. Add credits at console.anthropic.com.";
  if (status === 413) return "Your data is too large to send. Switch to 'Headers + sample rows' mode or exclude columns.";
  if (status >= 500) return "Anthropic's service is temporarily unavailable. Try again in a moment.";
  return err?.message || "Something went wrong talking to the AI.";
}
