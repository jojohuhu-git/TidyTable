// Privacy mode (build prompt §5): when we describe the workbook to the AI we
// must never send real cell contents. Real clinical files can hold names, MRNs,
// and dates of birth. Instead we send made-up look-alikes: the same shape, type,
// and format as the real value, but fabricated content.
//
// The look-alikes are generated from a seeded number stream, NOT from the real
// value's content, so two identical real values do not produce identical fakes
// (a fake that encoded the input could leak whether two cells matched). A fixed
// seed keeps the output stable, which makes tests reliable.

function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";

// Replace each character with a random one of the same class (upper/lower/digit),
// keeping spaces, punctuation, and layout exactly. "Dr. Smith" -> "Kp. Uwntq".
function fakeText(real, rng) {
  let out = "";
  for (const ch of real) {
    if (ch >= "a" && ch <= "z") out += LOWER[randInt(rng, 0, 25)];
    else if (ch >= "A" && ch <= "Z") out += UPPER[randInt(rng, 0, 25)];
    else if (ch >= "0" && ch <= "9") out += DIGITS[randInt(rng, 0, 9)];
    else out += ch;
  }
  return out;
}

// Keep sign, count of whole-number digits, and count of decimal places; randomize
// the digits. 1204 -> 8375, 50.5 -> 83.2, -0.75 -> -0.41.
function fakeNumber(real, rng) {
  const neg = real < 0;
  const s = Math.abs(real).toString();
  const [intPart, decPart = ""] = s.split(".");
  let intOut = "";
  for (let i = 0; i < intPart.length; i++) {
    // Avoid a leading zero on multi-digit numbers.
    intOut += i === 0 && intPart.length > 1 ? randInt(rng, 1, 9) : randInt(rng, 0, 9);
  }
  let out = Number(decPart ? `${intOut}.${fakeDigits(decPart.length, rng)}` : intOut);
  return neg ? -out : out;
}

function fakeDigits(n, rng) {
  let s = "";
  for (let i = 0; i < n; i++) s += randInt(rng, 0, 9);
  return s;
}

const pad2 = (n) => String(n).padStart(2, "0");

// Real dates arrive normalized as "YYYY-MM-DD" or "YYYY-MM-DD HH:MM". Produce a
// fake date in the same format, in a neutral range, preserving the time part.
function fakeDate(real, rng) {
  const hasTime = /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(real);
  const year = randInt(rng, 2001, 2019);
  const month = randInt(rng, 1, 12);
  const day = randInt(rng, 1, 28);
  const day0 = `${year}-${pad2(month)}-${pad2(day)}`;
  if (!hasTime) return day0;
  return `${day0} ${pad2(randInt(rng, 0, 23))}:${pad2(randInt(rng, 0, 59))}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2})?$/;

// Turn one real value into a look-alike. `rng` is a shared stream so callers get
// varied output across a whole pass.
export function fakeValue(real, rng) {
  if (real == null) return null;
  if (typeof real === "boolean") return real; // reveals nothing on its own
  if (typeof real === "number") return fakeNumber(real, rng);
  const str = String(real);
  if (ISO_DATE.test(str)) return fakeDate(str, rng);
  return fakeText(str, rng);
}

// Public: given a list of real sample strings for one column, return the same
// number of made-up look-alikes. Used for the "example values" line.
export function fakeSamples(samples, seed = 1) {
  const rng = makeRng(seed);
  return samples.map((s) => fakeValue(s, rng));
}

// Public: build a fresh seeded stream a caller can thread through many values so
// a whole sheet's fakes are stable and varied.
export function fakeStream(seed = 1) {
  return makeRng(seed);
}
