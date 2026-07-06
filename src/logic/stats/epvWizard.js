// The appropriateness double-check the owner requires before any regression /
// LASSO script is generated (build prompt §9). Three plain questions, then an
// events-per-variable check computed from the real counts. The wizard either
// recommends the right method or declines — it never generates a script it just
// argued against.

const EPV_MIN = 10; // widely used rule of thumb: ~10 outcome events per predictor

// answers: { outcomeType: "yesno"|"measurement"|"time", repeated: boolean,
//            events: number, predictors: number }
// For a measurement outcome, `events` is the number of patients (sample size).
export function assessRegression(answers) {
  const { outcomeType, repeated, events, predictors } = answers;

  if (repeated) {
    return {
      decision: "refuse",
      method: null,
      message:
        "You said the same patients are measured more than once, or are matched. That needs a more advanced model (a mixed-effects or conditional model) that keeps those repeats honest. This is past what a generated script should attempt — this is the point to involve a statistician.",
    };
  }

  const method = { yesno: "logistic", measurement: "linear", time: "survival" }[outcomeType];
  if (!method) {
    return { decision: "refuse", method: null, message: "Choose what kind of outcome you have so the right method can be picked." };
  }

  const epv = predictors > 0 ? events / predictors : Infinity;
  const unit = outcomeType === "measurement" ? "patients" : "outcome events";

  if (predictors < 1) {
    return { decision: "refuse", method, epv, message: "List at least one predictor variable." };
  }

  if (epv < EPV_MIN) {
    const suggested = Math.max(1, Math.floor(events / EPV_MIN));
    return {
      decision: "refuse",
      method,
      epv,
      message:
        `You have ${events} ${unit} and listed ${predictors} variable${predictors === 1 ? "" : "s"}. ` +
        `That is about ${round(epv)} ${unit} per variable, below the ~${EPV_MIN} needed for a stable model. ` +
        `Pick your ${suggested} most important variable${suggested === 1 ? "" : "s"}, or collect more data, then try again.`,
    };
  }

  return {
    decision: "proceed",
    method,
    epv,
    message:
      `With ${events} ${unit} and ${predictors} variable${predictors === 1 ? "" : "s"} ` +
      `(about ${round(epv)} per variable), a ${methodName(method)} is a reasonable choice. ` +
      "Read the checklist below before trusting the result.",
    checklist: TRUST_CHECKLIST,
  };
}

function methodName(method) {
  return { logistic: "logistic regression", linear: "linear regression", survival: "survival (Cox) model" }[method] || method;
}

const round = (x) => Math.round(x * 10) / 10;

// The honest "before you trust this" checklist that ships with every complex
// result (build prompt §9).
export const TRUST_CHECKLIST = [
  "Every variable was decided before looking at the results, not chosen because it looked interesting.",
  "Missing values were handled on purpose, not dropped silently.",
  "The number of outcome events comfortably exceeds the number of variables (you checked this above).",
  "Someone can explain why each variable is in the model.",
  "This is the area where this app stands in for software, not for a statistician — if the result matters, have one look.",
];

export { methodName };
