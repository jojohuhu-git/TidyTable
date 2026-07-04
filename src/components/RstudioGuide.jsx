import { useState } from "react";

export default function RstudioGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rguide">
      <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide" : "Show"} first-time setup: installing and using RStudio (Mac & Windows)
      </button>
      {open && (
        <div className="rguide-body">
          <h4>Part A — Install R, then RStudio (one time only, ~10 minutes)</h4>
          <p className="hint">
            You need two free programs: <strong>R</strong> (the engine) and{" "}
            <strong>RStudio</strong> (the friendly window you'll actually use). Install R first.
          </p>
          <ol>
            <li>
              <strong>Install R.</strong> Go to{" "}
              <a href="https://cran.r-project.org" target="_blank" rel="noreferrer">cran.r-project.org</a>.
              <ul>
                <li>
                  <strong>Windows:</strong> click "Download R for Windows" → "base" →
                  "Download R for Windows". Open the downloaded file and click Next through
                  the installer, accepting everything it suggests.
                </li>
                <li>
                  <strong>Mac:</strong> click "Download R for macOS" and choose the file that
                  matches your Mac: <em>arm64</em> for newer Macs with Apple chips (M1/M2/M3/M4),{" "}
                  <em>x86_64</em> for older Intel Macs. (Not sure? Click the Apple menu → About
                  This Mac — "Chip: Apple…" means arm64.) Open the downloaded .pkg and click
                  Continue through the installer.
                </li>
              </ul>
            </li>
            <li>
              <strong>Install RStudio.</strong> Go to{" "}
              <a href="https://posit.co/download/rstudio-desktop/" target="_blank" rel="noreferrer">
                posit.co/download/rstudio-desktop
              </a>{" "}
              and click the big download button (it detects Windows/Mac automatically).
              <ul>
                <li><strong>Windows:</strong> open the installer, click Next until it finishes.</li>
                <li><strong>Mac:</strong> open the .dmg and drag the RStudio icon into the Applications folder.</li>
              </ul>
            </li>
            <li>
              <strong>Open RStudio</strong> (not "R"). You'll see several panels; the big one
              on the left with a <code>&gt;</code> symbol is the "Console".
            </li>
          </ol>

          <h4>Part B — Run your script (every time)</h4>
          <ol>
            <li>
              Download the script below with the <em>"Download script (.R)"</em> button (or copy it).
            </li>
            <li>
              In RStudio: <strong>File → Open File…</strong> and choose the downloaded{" "}
              <code>tidytable_check.R</code>. (If you copied instead: File → New File → R Script,
              then paste.) The script appears in a new panel at the top left.
            </li>
            <li>
              Click anywhere inside the script, then press{" "}
              <strong>Cmd+A then Cmd+Enter</strong> on Mac or <strong>Ctrl+A then Ctrl+Enter</strong>{" "}
              on Windows. That means "select everything and run it". (You can also click the{" "}
              <em>Source</em> button at the top right of the script panel.)
            </li>
            <li>
              The first run may spend a minute installing packages — lines of red/black text in
              the Console are normal. If a window asks you to pick a "CRAN mirror", pick any one.
            </li>
            <li>
              A file-picker window will open (it can appear <em>behind</em> RStudio — check your
              taskbar/dock). Choose your <strong>original Excel file</strong>, the same one you
              uploaded to TidyTable.
            </li>
            <li>
              When it finishes, a spreadsheet-like view of the result opens in RStudio, the
              Console prints how many rows were found and where a CSV copy was saved. Compare
              those rows/numbers with the TidyTable result — they should match.
            </li>
          </ol>

          <h4>If something goes wrong</h4>
          <ul>
            <li>
              <em>"could not find function read_excel"</em> — the packages didn't install. Run this
              line in the Console and press Enter: <code>install.packages("readxl")</code>, then
              run the script again.
            </li>
            <li>
              <em>The file picker never appeared</em> — it's hiding behind other windows; minimize
              RStudio to find it.
            </li>
            <li>
              <em>"sheet not found"</em> — your Excel file's tab name changed; make sure you picked
              the original file.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
