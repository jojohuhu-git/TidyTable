// Deterministic RStudio scripts for a novice (build prompt §10). No AI. Every
// script: talks only about the Console (never menus or panes, which move between
// versions), installs what it needs behind a guard, uses file.choose() so there
// are no file paths and Windows and Mac feel identical, spells out both keystroke
// forms, and prints labelled output with a "you should see something like" block
// so a beginner can tell success from garbage. A plain comment sits above every
// step.

// Item 7: HEADER/key/wrap moved to shared.js so this file and chartPlan.js
// (the new chart-plan generator) never let the beginner-facing conventions
// drift apart.
import { key, wrap } from "./shared.js";

export function rTTest(numCol, grpCol) {
  const body =
`# Compare the average ${numCol} between the two groups in ${grpCol}.
# Welch's t-test does not assume the groups vary by the same amount.
result <- t.test(${key(numCol)} ~ ${key(grpCol)})
print(result)`;
  const notes =
`This installs readxl (for reading Excel), then runs Welch's t-test.
You should see something like:
  t = 2.1, df = 17.4, p-value = 0.05
  mean in group A   mean in group B
        4.2               3.1
Compare the p-value and the group means to the ones the app showed.`;
  return wrap(body, notes);
}

export function rChiSquare(colA, colB, useFisher) {
  const test = useFisher
    ? `# One expected count was small, so use Fisher's exact test (matches the app).
result <- fisher.test(tab)`
    : `# All expected counts are large enough, so use the chi-square test.
# correct = FALSE gives the plain (uncorrected) chi-square the app showed.
result <- chisq.test(tab, correct = FALSE)`;
  const body =
`# Build the same table the app built, from ${colA} (rows) and ${colB} (columns).
tab <- table(${key(colA)}, ${key(colB)})
print(tab)

${test}
print(result)`;
  const notes =
`This builds the counts table and runs the ${useFisher ? "Fisher's exact test" : "chi-square test"}.
You should see something like:
  X-squared = 5.0, df = 1, p-value = 0.025
Compare the table and the p-value to the ones the app showed.`;
  return wrap(body, notes);
}

export function rLogistic(outcomeCol, predictors) {
  const rhs = predictors.map(key).join(" + ");
  const body =
`# Predict the yes/no outcome ${outcomeCol} from your chosen variables.
# glm with family = binomial fits a logistic regression.
model <- glm(${key(outcomeCol)} ~ ${rhs}, family = binomial, data = data)
summary(model)

# Odds ratios with 95% intervals, easier to read than the raw output.
exp(cbind(OddsRatio = coef(model), confint(model)))`;
  const notes =
`This fits a logistic regression for ${outcomeCol}.
You should see a table of coefficients with p-values, then a table of odds
ratios with 2.5% and 97.5% columns. An odds ratio whose interval does not
cross 1 is the model's evidence of an association (not causation).`;
  return wrap(body, notes);
}

export function rLinear(outcomeCol, predictors) {
  const rhs = predictors.map(key).join(" + ");
  const body =
`# Predict the measurement ${outcomeCol} from your chosen variables.
model <- lm(${key(outcomeCol)} ~ ${rhs}, data = data)
summary(model)
confint(model)`;
  const notes =
`This fits a linear regression for ${outcomeCol}.
You should see each variable's estimate and p-value, then a table of 95%
intervals. Check the estimates make clinical sense in size and direction.`;
  return wrap(body, notes);
}

export function rSurvival(timeCol, eventCol, predictors) {
  const rhs = predictors.map(key).join(" + ");
  const body =
`# Time-until-event model (Cox). Needs the survival package.
if (!require("survival")) install.packages("survival")
library(survival)

# ${timeCol} is the follow-up time; ${eventCol} is 1 if the event happened, 0 if not.
model <- coxph(Surv(${key(timeCol)}, ${key(eventCol)}) ~ ${rhs}, data = data)
summary(model)`;
  const notes =
`This fits a Cox survival model.
You should see hazard ratios (exp(coef)) with 95% intervals and p-values.
A hazard ratio above 1 means a shorter time to the event, for that variable.`;
  return wrap(body, notes);
}

// Pick the right regression template from the wizard's method.
export function rRegression(method, { outcomeCol, timeCol, eventCol, predictors }) {
  if (method === "logistic") return rLogistic(outcomeCol, predictors);
  if (method === "linear") return rLinear(outcomeCol, predictors);
  if (method === "survival") return rSurvival(timeCol, eventCol, predictors);
  return null;
}
