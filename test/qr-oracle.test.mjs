/**
 * Oracle test: this encoder must produce byte-identical matrices to the
 * reference implementation for every version, ECC level and mask it supports.
 *
 *   node test/qr-oracle.test.mjs
 */
import { encode } from "../assets/js/qr-encoder.js";
import { execFileSync } from "node:child_process";

const REFERENCE = `
import json, sys
import qrcode
from qrcode import util
from qrcode.constants import ERROR_CORRECT_H, ERROR_CORRECT_L, ERROR_CORRECT_M, ERROR_CORRECT_Q

ECC = {"L": ERROR_CORRECT_L, "M": ERROR_CORRECT_M, "Q": ERROR_CORRECT_Q, "H": ERROR_CORRECT_H}
cases = json.load(sys.stdin)
out = []
for case in cases:
    qr = qrcode.QRCode(version=case["version"], error_correction=ECC[case["ecc"]],
                       box_size=1, border=0, mask_pattern=case["mask"])
    qr.add_data(util.QRData(case["text"].encode("utf-8"),
                            mode=util.MODE_8BIT_BYTE, check_data=False))
    qr.make(fit=False)
    out.append([[1 if cell else 0 for cell in row] for row in qr.get_matrix()])
json.dump(out, sys.stdout)
`;

const SHORT_CASES = [
  "HELLO",
  "https://example.com",
  "https://eiad.engine/screenshot?device=iphone-15-pro&fullPage=true",
  "مرحبا بالعالم — رمز QR عربي",
  "0",
  " ",
];

const CASES = [];
for (const text of SHORT_CASES) {
  for (const ecc of ["L", "M", "Q", "H"]) CASES.push({ text, ecc });
}

// Boundary sizes: probe each level's real capacity, then sit at fractions of it
// and just past the previous version's limit so version rollover is exercised.
for (const ecc of ["L", "M", "Q", "H"]) {
  let capacity = 1;
  while (capacity < 1400) {
    try {
      encode("a".repeat(capacity), { ecc });
      break;
    } catch {
      capacity += 1;
    }
  }
  for (const fraction of [0.3, 0.75, 1]) {
    CASES.push({ text: "a".repeat(Math.max(1, Math.floor(capacity * fraction))), ecc });
  }
}

const payload = CASES.flatMap((base) => {
  const probe = encode(base.text, { ecc: base.ecc });
  return [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => ({
    text: base.text,
    ecc: base.ecc,
    version: probe.version,
    mask,
  }));
});

const reference = JSON.parse(
  execFileSync("python3", ["-c", REFERENCE], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 1 << 28,
  }),
);

let checked = 0;
let failures = 0;

payload.forEach((testCase, index) => {
  const mine = encode(testCase.text, { ecc: testCase.ecc, mask: testCase.mask });
  const theirs = reference[index];
  checked += 1;

  if (mine.size !== theirs.length) {
    failures += 1;
    console.error(
      `SIZE MISMATCH ${JSON.stringify({ ...testCase, text: `${testCase.text.slice(0, 24)}…` })}: ${mine.size} vs ${theirs.length}`,
    );
    return;
  }
  for (let y = 0; y < mine.size; y += 1) {
    for (let x = 0; x < mine.size; x += 1) {
      if (Number(mine.modules[y][x]) !== theirs[y][x]) {
        failures += 1;
        console.error(
          `MODULE MISMATCH ${JSON.stringify({ ...testCase, y, x })}: ` +
            `${mine.modules[y][x]} vs ${theirs[y][x]}`,
        );
        return;
      }
    }
  }
});

console.log(`checked ${checked} matrices across ${CASES.length} inputs, ${failures} failing`);

const auto = encode("https://example.com");
console.log(`auto-mask selection: v${auto.version} ecc${auto.ecc} mask=${auto.mask}`);
if (auto.mask !== 2) {
  console.error(`expected reference mask 2 for this input, got ${auto.mask}`);
  process.exitCode = 1;
}

if (failures) process.exitCode = 1;
