// The verification gate itself, pinned; the spec's Testing section carries why.
import {
  analyzePackage,
  SOURCE_FILE_PATTERNS,
} from "@n8n/scan-community-package/scanner/scanner.mjs";

// SOURCE_FILE_PATTERNS is the set the scanner lints on a submitted package, so
// a repo dev file cannot fail a gate n8n never applies to it.
const result = await analyzePackage(process.cwd(), SOURCE_FILE_PATTERNS);
if (result.passed) {
  console.log("n8n community-node scan: passed");
  process.exit(0);
}
console.error(`n8n community-node scan: ${result.message}`);
if (result.details) console.error(result.details);
process.exit(1);
