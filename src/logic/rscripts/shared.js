// Shared by every R-script generator (stats/regression templates.js, and
// item 7's chartPlan.js) so the beginner-facing conventions never drift
// between them: talk only about the Console (never menus/panes, which move
// between versions), install what's needed behind a guard, use
// file.choose() so there are no file paths, and print labelled output with
// a "you should see something like" note so a beginner can tell success
// from garbage.

export const HEADER = `# ----------------------------------------------------------------------
# How to use this: open RStudio, click once in the Console (the pane with a
# ">" prompt), paste this whole script, and press Enter. If a step needs you
# to run one line, press Ctrl+Enter (Windows) or Cmd+Enter (Mac).
# If anything on your screen looks different from these notes, the Console
# method above always works.
# ----------------------------------------------------------------------

# Install what we need only if it is missing (safe on a brand-new computer).
if (!require("readxl")) install.packages("readxl")
library(readxl)

# Pick your spreadsheet from the normal file window (no file paths to type).
data <- read_excel(file.choose())
`;

// Escape a column name for use as a data[["..."]] key and print label.
export const key = (name) => `data[["${String(name).replace(/"/g, '\\"')}"]]`;

export function wrap(body, notes) {
  return { script: HEADER + "\n" + body + "\n", r_run_notes: notes };
}
