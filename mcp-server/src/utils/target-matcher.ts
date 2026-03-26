/**
 * Target matching utilities — shared by suggest-docs tool and doc-freshness-alert hook.
 *
 * Matches file paths against doc frontmatter `targets` values to determine
 * which pattern docs are relevant to a given file change.
 */

import path from "node:path";

export interface TargetMatch {
  slug: string;
  title: string;
  description: string;
  matchReason: string;
  category: string;
}

export interface DocEntry {
  slug: string;
  filepath: string;
  metadata: {
    description?: string;
    scope?: string;
    targets?: string[];
    category?: string;
    [key: string]: unknown;
  };
}

/**
 * Match a file path against a list of doc entries based on their `targets` frontmatter.
 *
 * Matching strategies (in order of specificity):
 * 1. Exact filename match: targets contains "ViewModel.kt" and file is "SomeViewModel.kt"
 * 2. Extension match: targets contains "*.kt" or Kotlin-related keywords
 * 3. Path component match: targets mentions "ViewModel" and file path contains "viewmodel"
 * 4. Scope keyword match: doc scope matches file path keywords
 */
export function matchFileAgainstDocs(
  filePath: string,
  docs: DocEntry[],
): TargetMatch[] {
  const basename = path.basename(filePath);
  const ext = path.extname(filePath);
  const pathLower = filePath.toLowerCase();
  const pathParts = pathLower.split(/[/\\]/).filter(Boolean);

  const matches: TargetMatch[] = [];

  for (const doc of docs) {
    const targets = doc.metadata.targets ?? [];
    const scope = (doc.metadata.scope ?? "").toLowerCase();
    const category = doc.metadata.category ?? "unknown";
    const description = doc.metadata.description ?? "";
    const title = path.basename(doc.filepath, ".md");

    for (const target of targets) {
      const targetLower = target.toLowerCase();

      // Strategy 1: Exact filename match
      if (basename.toLowerCase().includes(targetLower.replace("*", ""))) {
        matches.push({
          slug: doc.slug,
          title,
          description,
          matchReason: `File "${basename}" matches target "${target}"`,
          category,
        });
        break;
      }

      // Strategy 2: Extension match
      if (targetLower.startsWith("*") && ext === targetLower.replace("*", "")) {
        matches.push({
          slug: doc.slug,
          title,
          description,
          matchReason: `Extension "${ext}" matches target "${target}"`,
          category,
        });
        break;
      }

      // Strategy 3: Path component match
      if (
        targetLower.length > 3 &&
        pathParts.some((part) => part.includes(targetLower))
      ) {
        matches.push({
          slug: doc.slug,
          title,
          description,
          matchReason: `Path contains "${target}"`,
          category,
        });
        break;
      }
    }

    // Strategy 4: Scope keyword match (lower priority)
    if (
      !matches.some((m) => m.slug === doc.slug) &&
      scope &&
      pathParts.some((part) => scope.includes(part) && part.length > 3)
    ) {
      matches.push({
        slug: doc.slug,
        title,
        description,
        matchReason: `Scope "${scope}" relates to path`,
        category,
      });
    }
  }

  return matches;
}
