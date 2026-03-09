/**
 * Tests for the compose-preview-audit MCP tool.
 *
 * Uses in-memory MCP transport with real tool registration.
 * Creates temp .kt files with various @Preview configurations
 * to test quality score computation and feature detection.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerComposePreviewAuditTool } from "../../../src/tools/compose-preview-audit.js";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Test fixture management ──────────────────────────────────────────────────

const TEST_ROOT = path.join(
  os.tmpdir(),
  "compose-preview-audit-test-" + process.pid,
);
const PROJECT_ROOT = path.join(TEST_ROOT, "test-project");

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(PROJECT_ROOT, { recursive: true });
}

function writeKtFile(relativePath: string, content: string): void {
  const fullPath = path.join(PROJECT_ROOT, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

// ── MCP client/server lifecycle ──────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerComposePreviewAuditTool(server, limiter);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(() => {
  ensureClean();
});

afterEach(() => {
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function callTool(args: Record<string, unknown>) {
  return client.callTool({
    name: "compose-preview-audit",
    arguments: args,
  });
}

function extractText(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

function extractJson(text: string): Record<string, unknown> {
  const jsonMatch = text.match(/```json\n([\s\S]+?)\n```/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[1]);
  }
  return JSON.parse(text);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("compose-preview-audit tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "compose-preview-audit");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("Preview");
  });

  it("returns zero score when no preview files found", async () => {
    // Write a .kt file without @Preview
    writeKtFile(
      "src/main/kotlin/com/example/MainActivity.kt",
      `
package com.example

import android.os.Bundle
import androidx.activity.ComponentActivity

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
    }
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      files_with_previews: number;
      overall_score: number;
    };

    expect(json.files_with_previews).toBe(0);
    expect(json.overall_score).toBe(0);
  });

  it("detects basic @Preview with score 25", async () => {
    writeKtFile(
      "src/main/kotlin/com/example/ui/ButtonPreview.kt",
      `
package com.example.ui

import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview

@Preview
@Composable
fun ButtonPreview() {
    Button(onClick = {}) {
        Text("Click me")
    }
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      files_with_previews: number;
      files: Array<{
        quality_score: number;
        has_preview_parameter: boolean;
        has_dark_mode: boolean;
        has_screen_sizes: boolean;
        recommendations: string[];
      }>;
    };

    expect(json.files_with_previews).toBe(1);
    const file = json.files[0];
    expect(file.quality_score).toBe(25);
    expect(file.has_preview_parameter).toBe(false);
    expect(file.has_dark_mode).toBe(false);
    expect(file.has_screen_sizes).toBe(false);
    expect(file.recommendations.length).toBe(3);
  });

  it("detects @PreviewParameter and awards points", async () => {
    writeKtFile(
      "src/main/kotlin/com/example/ui/CardPreview.kt",
      `
package com.example.ui

import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.tooling.preview.PreviewParameter
import androidx.compose.ui.tooling.preview.PreviewParameterProvider

class SampleProvider : PreviewParameterProvider<String> {
    override val values = sequenceOf("Hello", "World")
}

@Preview
@Composable
fun CardPreview(@PreviewParameter(SampleProvider::class) text: String) {
    Card(text)
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      files: Array<{
        quality_score: number;
        has_preview_parameter: boolean;
      }>;
    };

    const file = json.files[0];
    expect(file.has_preview_parameter).toBe(true);
    expect(file.quality_score).toBe(50); // 25 base + 25 for PreviewParameter
  });

  it("detects dark mode variant", async () => {
    writeKtFile(
      "src/main/kotlin/com/example/ui/ThemePreview.kt",
      `
package com.example.ui

import android.content.res.Configuration
import androidx.compose.ui.tooling.preview.Preview

@Preview
@Composable
fun ThemePreviewLight() {
    MyTheme { Text("Light") }
}

@Preview(uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
fun ThemePreviewDark() {
    MyTheme { Text("Dark") }
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      files: Array<{
        quality_score: number;
        has_dark_mode: boolean;
        preview_count: number;
      }>;
    };

    const file = json.files[0];
    expect(file.has_dark_mode).toBe(true);
    expect(file.preview_count).toBe(2);
    expect(file.quality_score).toBe(50); // 25 base + 25 for dark mode
  });

  it("detects screen size variants", async () => {
    writeKtFile(
      "src/main/kotlin/com/example/ui/ResponsivePreview.kt",
      `
package com.example.ui

import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.tooling.preview.Devices

@Preview(widthDp = 320, heightDp = 640)
@Composable
fun SmallScreenPreview() {
    MyScreen()
}

@Preview(device = Devices.PIXEL_4)
@Composable
fun PixelPreview() {
    MyScreen()
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      files: Array<{
        quality_score: number;
        has_screen_sizes: boolean;
      }>;
    };

    const file = json.files[0];
    expect(file.has_screen_sizes).toBe(true);
    expect(file.quality_score).toBe(50); // 25 base + 25 for screen sizes
  });

  it("awards full score 100 for complete preview", async () => {
    writeKtFile(
      "src/main/kotlin/com/example/ui/FullPreview.kt",
      `
package com.example.ui

import android.content.res.Configuration
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.tooling.preview.PreviewParameter
import androidx.compose.ui.tooling.preview.PreviewParameterProvider

class DataProvider : PreviewParameterProvider<String> {
    override val values = sequenceOf("A", "B")
}

@Preview(widthDp = 360, heightDp = 640)
@Composable
fun FullPreviewLight(@PreviewParameter(DataProvider::class) data: String) {
    MyComponent(data)
}

@Preview(uiMode = Configuration.UI_MODE_NIGHT_YES, widthDp = 360, heightDp = 640)
@Composable
fun FullPreviewDark(@PreviewParameter(DataProvider::class) data: String) {
    MyComponent(data)
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      files: Array<{
        quality_score: number;
        has_preview_parameter: boolean;
        has_dark_mode: boolean;
        has_screen_sizes: boolean;
        recommendations: string[];
      }>;
      overall_score: number;
    };

    const file = json.files[0];
    expect(file.quality_score).toBe(100);
    expect(file.has_preview_parameter).toBe(true);
    expect(file.has_dark_mode).toBe(true);
    expect(file.has_screen_sizes).toBe(true);
    expect(file.recommendations).toHaveLength(0);
    expect(json.overall_score).toBe(100);
  });

  it("computes average overall score across multiple files", async () => {
    // File 1: basic preview (score 25)
    writeKtFile(
      "src/main/kotlin/com/example/ui/BasicPreview.kt",
      `
@Preview
@Composable
fun BasicPreview() {
    Text("Hello")
}
`,
    );

    // File 2: preview with dark mode + screen sizes (score 75)
    writeKtFile(
      "src/main/kotlin/com/example/ui/BetterPreview.kt",
      `
import android.content.res.Configuration

@Preview
@Composable
fun LightPreview() {
    Text("Light")
}

@Preview(uiMode = Configuration.UI_MODE_NIGHT_YES, widthDp = 360)
@Composable
fun DarkPreview() {
    Text("Dark")
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      files_with_previews: number;
      overall_score: number;
    };

    expect(json.files_with_previews).toBe(2);
    // Average of 25 and 75 = 50
    expect(json.overall_score).toBe(50);
  });

  it("respects module_path parameter", async () => {
    // Write preview in feature module
    writeKtFile(
      "feature/home/src/main/kotlin/HomePreview.kt",
      `
@Preview
@Composable
fun HomePreview() {
    HomeScreen()
}
`,
    );

    // Write preview in different module (should not be found)
    writeKtFile(
      "feature/settings/src/main/kotlin/SettingsPreview.kt",
      `
@Preview
@Composable
fun SettingsPreview() {
    SettingsScreen()
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
      module_path: "feature/home",
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      files_with_previews: number;
      module_path: string;
    };

    expect(json.files_with_previews).toBe(1);
    expect(json.module_path).toBe("feature/home");
  });

  it("includes summary with feature counts", async () => {
    writeKtFile(
      "src/ui/A.kt",
      `
@Preview
@Composable
fun APreview() {}
`,
    );

    writeKtFile(
      "src/ui/B.kt",
      `
@Preview
@PreviewParameter(MyProvider::class)
@Composable
fun BPreview() {}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      summary: {
        with_preview_parameter: number;
        with_dark_mode: number;
        with_screen_sizes: number;
      };
    };

    expect(json.summary.with_preview_parameter).toBe(1);
    expect(json.summary.with_dark_mode).toBe(0);
    expect(json.summary.with_screen_sizes).toBe(0);
  });

  it("markdown output contains expected sections", async () => {
    writeKtFile(
      "src/ui/MyPreview.kt",
      `
@Preview
@Composable
fun MyPreview() {
    Text("Hello")
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    expect(text).toContain("## Compose Preview Audit Report");
    expect(text).toContain("**Overall quality score:**");
    expect(text).toContain("### Feature Coverage");
    expect(text).toContain("### Per-File Scores");
    expect(text).toContain("| File | Previews | Score | Parameter | Dark | Sizes |");
    expect(text).toContain("### Recommendations");
  });

  it("skips build directories", async () => {
    // Write a .kt file in build/ directory (should be ignored)
    writeKtFile(
      "build/generated/PreviewStub.kt",
      `
@Preview
@Composable
fun StubPreview() {}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      files_with_previews: number;
    };

    expect(json.files_with_previews).toBe(0);
  });
});
