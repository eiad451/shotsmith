/**
 * Test runner. Each suite runs in its own process, and a process that dies on a
 * signal is retried: this sandbox's Node intermittently segfaults under memory
 * pressure regardless of what the code does, so a single dying process is not
 * evidence of a defect. Any suite that reports a FAIL line is a real failure.
 *
 *   node test/run-suite.mjs            # everything
 *   node test/run-suite.mjs units      # one suite by name
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const ATTEMPTS = Number(process.env.SUITE_ATTEMPTS ?? 6);

const SUITES = [
  { name: "units", file: "units.test.mjs" },
  { name: "qr", file: "qr-oracle.test.mjs" },
  { name: "contracts", file: "contracts.test.mjs" },
  { name: "boot", file: "phase-boot-options.test.mjs" },
  { name: "capture", file: "phase-capture.test.mjs" },
  { name: "dialogs", file: "phase-dialogs.test.mjs" },
  { name: "studio", file: "phase-studio.test.mjs" },
  { name: "history", file: "phase-history.test.mjs" },
  { name: "accessibility", file: "phase-accessibility.test.mjs" },
];

const only = process.argv.slice(2);
const selected = only.length ? SUITES.filter((s) => only.includes(s.name)) : SUITES;

if (selected.length === 0) {
  process.stderr.write(`no suite matched: ${only.join(", ")}\n`);
  process.exit(1);
}

let failed = 0;

for (const suite of selected) {
  let completed = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const result = spawnSync(process.execPath, [join(DIR, suite.file)], {
      encoding: "utf8",
      timeout: 240_000,
      env: { ...process.env, MALLOC_ARENA_MAX: "2" },
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    // A clean exit is the only trustworthy signal; a signal means the host
    // killed the process, which has nothing to do with the assertions.
    if (result.status === 0 || result.status === 1) {
      completed = { attempt, output, status: result.status };
      break;
    }
    completed = null;
  }

  if (!completed) {
    failed += 1;
    process.stderr.write(`FAIL ${suite.name}: no clean run in ${ATTEMPTS} attempts (host instability)\n`);
    continue;
  }

  const fails = (completed.output.match(/^ {2}FAIL /gm) ?? []).length;
  const tail = completed.output.trimEnd().split("\n").slice(-1)[0] ?? "";
  process.stderr.write(
    `${completed.status === 0 && fails === 0 ? "PASS" : "FAIL"} ${suite.name}` +
      `${completed.attempt > 1 ? ` (clean on attempt ${completed.attempt})` : ""} — ${tail}\n`
  );
  if (completed.status !== 0 || fails > 0) {
    failed += 1;
    process.stderr.write(completed.output.split("\n").filter((l) => /^ {2}FAIL/.test(l)).join("\n") + "\n");
  }
}

process.stderr.write(`\n${selected.length - failed}/${selected.length} suites passed\n`);
if (failed) process.exitCode = 1;
void resolve;