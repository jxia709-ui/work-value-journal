import fs from "node:fs";

const sourcePath = "scripts/apply-runtime-fixes.mjs";
const tempPath = "scripts/.apply-runtime-fixes.generated.mjs";
let source = fs.readFileSync(sourcePath, "utf8");

// The patch script contains a literal `${file.name}` from app/page.tsx inside
// one of its matching templates. Escape it before importing the generated
// script so Node does not try to evaluate it in the patcher itself.
source = source.replaceAll('${file.name}', '\\${file.name}');

fs.writeFileSync(tempPath, source);
try {
  await import(`./.apply-runtime-fixes.generated.mjs?${Date.now()}`);
  const pagePath = "app/page.tsx";
  let page = fs.readFileSync(pagePath, "utf8");
  page = page.replaceAll(" if (currentAccount) writeLocalRecords(currentAccount.id, next);", "");
  page = page.replaceAll(" writeLocalRecords(currentAccount.id, next);", "");
  fs.writeFileSync(pagePath, page);
} finally {
  fs.rmSync(tempPath, { force: true });
}
