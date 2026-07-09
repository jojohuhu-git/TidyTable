// B2: a synthetic, clearly-fake workbook so a nervous novice (or anyone with
// real PHI they don't want to drop into a browser yet) can try the whole app
// risk-free — upload, checkup, ask a question, save/replay a recipe, reshape.
// The messy patterns here (text numbers, N/A, mixed date formats, duplicate
// rows, a censored lab value) mirror the fixtures used across the test suite,
// so this is a one-click stand-in for a real QA pass too. Two sheets, so
// Step 10 (combine and reshape) has something to work with.

import { deriveSheet } from "./workbook.js";

export const EXAMPLE_FILE_NAME = "example_data.xlsx (fake data)";

export function buildExampleWorkbook() {
  const encounters = deriveSheet("Encounters", [
    { PatientID: "P1", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: "10", Visit_date: "2024-01-05", Lab_value: "12.4" },
    { PatientID: "P2", Diagnosis: "pneumonia", Drug: "amoxicillin", Duration_days: 7, Visit_date: "1/9/2024", Lab_value: "<0.5" },
    { PatientID: "P3", Diagnosis: "UTI", Drug: "amoxicillin", Duration_days: "5", Visit_date: "2024-01-12", Lab_value: "9.8" },
    { PatientID: "P4", Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: "N/A", Visit_date: "2024-02-01", Lab_value: "N/A" },
    { PatientID: "P4", Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: "N/A", Visit_date: "2024-02-01", Lab_value: "N/A" },
    { PatientID: "P5", Diagnosis: "pneumonia", Drug: "cefpodoxime", Duration_days: 5, Visit_date: "2024-02-14", Lab_value: "15.1" },
  ]);
  const roster = deriveSheet("Roster", [
    { PatientID: "P1", Prescriber: "Dr. Alavi" },
    { PatientID: "P2", Prescriber: "Dr. Reyes" },
    { PatientID: "P3", Prescriber: "Dr. Alavi" },
    { PatientID: "P5", Prescriber: "Dr. Okafor" },
  ]);
  return { fileName: EXAMPLE_FILE_NAME, sheets: [encounters, roster], isExample: true };
}
