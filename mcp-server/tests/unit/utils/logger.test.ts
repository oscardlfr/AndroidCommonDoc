import { describe, it, expect, vi, afterEach } from "vitest";

describe("logger", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MCP_DEBUG;
  });

  it("logger.info writes to stderr via console.error, not stdout", async () => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { logger } = await import("../../../src/utils/logger.js");
    logger.info("test message");

    expect(consoleErrorSpy).toHaveBeenCalledWith("[INFO] test message");
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("logger.warn writes to stderr via console.error", async () => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { logger } = await import("../../../src/utils/logger.js");
    logger.warn("warning message");

    expect(consoleErrorSpy).toHaveBeenCalledWith("[WARN] warning message");
  });

  it("logger.error writes to stderr via console.error", async () => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { logger } = await import("../../../src/utils/logger.js");
    logger.error("error message");

    expect(consoleErrorSpy).toHaveBeenCalledWith("[ERROR] error message");
  });

  it("logger.debug does NOT write when MCP_DEBUG is unset", async () => {
    delete process.env.MCP_DEBUG;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { logger } = await import("../../../src/utils/logger.js");
    logger.debug("debug message");

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("logger.debug writes when MCP_DEBUG is set", async () => {
    process.env.MCP_DEBUG = "1";
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { logger } = await import("../../../src/utils/logger.js");
    logger.debug("debug message");

    expect(consoleErrorSpy).toHaveBeenCalledWith("[DEBUG] debug message");
  });
});
