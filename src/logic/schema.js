// JSON schema for the plan Claude returns (enforced via output_config.format).
export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "transform_code", "excel_steps", "r_script", "r_run_notes"],
  properties: {
    summary: {
      type: "string",
      description:
        "Plain-English explanation of what will be extracted or cleaned and the exact logic used (filters, matching rules, edge cases). Written for someone with no technical background.",
    },
    transform_code: {
      type: "string",
      description:
        "The body of a JavaScript function that receives `sheets` and returns the result table as an array of plain objects. See the contract in the system prompt.",
    },
    excel_steps: {
      type: "array",
      description:
        "Ordered, beginner-proof steps to reproduce the same result manually in Excel, so the user can validate the app's output.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "where", "formula", "instruction"],
        properties: {
          title: { type: "string", description: "Short name for the step." },
          where: {
            type: "string",
            description:
              "Exactly where to click or type, e.g. 'Sheet \"Patients\", cell H2, then drag the fill handle down to H501'. Empty string if not applicable.",
          },
          formula: {
            type: "string",
            description:
              "The exact formula to type, starting with =. Empty string if this step has no formula.",
          },
          instruction: {
            type: "string",
            description:
              "What to do and what the step accomplishes, in plain English for a total beginner.",
          },
        },
      },
    },
    r_script: {
      type: "string",
      description:
        "A complete, standalone R script (for RStudio) that reproduces the same result. See the contract in the system prompt.",
    },
    r_run_notes: {
      type: "string",
      description:
        "Query-specific notes for the R script: which packages it installs, what the user should see when it works, and what number(s) to compare against the app's result.",
    },
  },
};
