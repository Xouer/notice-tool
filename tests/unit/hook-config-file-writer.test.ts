import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfigFile, writeConfigFileAtomic } from "../../src/hooks/config-file-writer.js";

describe("hook config file writer / 配置文件原子读写（T016）", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "notice-writer-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("读取不存在的文件返回 undefined", () => {
    expect(readConfigFile(join(dir, "nope.json"))).toBeUndefined();
  });

  it("原子写入并读回内容", () => {
    const path = join(dir, "a", "b", "settings.json");
    writeConfigFileAtomic(path, '{"hooks":{}}\n');
    expect(readConfigFile(path)).toBe('{"hooks":{}}\n');
    expect(readFileSync(path, "utf8")).toBe('{"hooks":{}}\n');
  });
});
