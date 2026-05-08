import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_AGENTS_DIR = path.join(__dirname, "..", "..", "..", "docs", "agents");

const TL_SUBDOCS = [
  "tl-session-start",
  "tl-session-setup",
  "tl-agent-roster",
  "tl-dispatch-topology",
  "tl-verification-gates",
  "tl-verification-done-criteria",
  "tl-quality-doc-pipeline",
  "tl-pm-absent-mode",
  "tl-git-workflow",
  "tl-skills-mcp-tools",
  "tl-release-workflow",
  "tl-ingestion-request-handler",
  "tl-phase-execution",
  "tl-model-profiles",
];

/** Reads the orchestration guide hub + all tl-* sub-docs as one combined string. */
export function readOrchestrationGuide(): string {
  const hub = fs.readFileSync(
    path.join(DOCS_AGENTS_DIR, "main-agent-orchestration-guide.md"),
    "utf-8",
  );
  const subDocs = TL_SUBDOCS.filter((slug) =>
    fs.existsSync(path.join(DOCS_AGENTS_DIR, `${slug}.md`)),
  ).map((slug) =>
    fs.readFileSync(path.join(DOCS_AGENTS_DIR, `${slug}.md`), "utf-8"),
  );
  return [hub, ...subDocs].join("\n\n");
}
