import fs from "node:fs";

const sourcePath = "scripts/apply-runtime-fixes.mjs";
const tempPath = "scripts/.apply-runtime-fixes.generated.mjs";
let source = fs.readFileSync(sourcePath, "utf8");

// The main patch first removes browser cache writes. Keep its later exact-match
// replacement aligned with that intermediate source state.
source = source.replaceAll(
  "        if (currentAccount) writeLocalRecords(currentAccount.id, next);\n",
  "",
);

fs.writeFileSync(tempPath, source);
try {
  await import(`./.apply-runtime-fixes.generated.mjs?${Date.now()}`);
} finally {
  fs.rmSync(tempPath, { force: true });
}
