import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { isWithinDir } from "@/lib/utils-server";

describe("isWithinDir", () => {
  const tmpRoots: string[] = [];

  afterEach(() => {
    for (const root of tmpRoots) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    tmpRoots.length = 0;
  });

  function makeDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iwd-"));
    tmpRoots.push(dir);
    return fs.realpathSync(dir);
  }

  it("returns true for a child file of the base", () => {
    const base = makeDir();
    const child = path.join(base, "file.txt");
    fs.writeFileSync(child, "x");
    expect(isWithinDir(child, base)).toBe(true);
  });

  it("returns true for a nested file", () => {
    const base = makeDir();
    const sub = path.join(base, "sub");
    fs.mkdirSync(sub);
    const nested = path.join(sub, "deep.txt");
    fs.writeFileSync(nested, "x");
    expect(isWithinDir(nested, base)).toBe(true);
  });

  it("returns true when path equals base", () => {
    const base = makeDir();
    expect(isWithinDir(base, base)).toBe(true);
  });

  it("rejects lexical path traversal with ..", () => {
    const base = makeDir();
    const outside = path.join(base, "..", "outside.txt");
    expect(isWithinDir(outside, base)).toBe(false);
  });

  it("rejects paths that share a prefix but are not inside base", () => {
    const base = makeDir();
    // base ends with e.g. "iwd-AbC"; trying "iwd-AbCevil.txt" in parent
    // should not be considered inside base.
    const sibling = base + "-sibling";
    expect(isWithinDir(sibling, base)).toBe(false);
  });

  it("rejects an absolute path to a completely different location", () => {
    const base = makeDir();
    expect(isWithinDir("/etc/passwd", base)).toBe(false);
  });

  it("rejects a symlink that escapes the base", () => {
    const base = makeDir();
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "iwd-outside-"));
    tmpRoots.push(outsideDir);
    const realTarget = fs.realpathSync(outsideDir);
    const secretFile = path.join(realTarget, "secret.txt");
    fs.writeFileSync(secretFile, "secret");

    // Create symlink inside base pointing outside
    const linkInside = path.join(base, "escape-link");
    fs.symlinkSync(secretFile, linkInside);

    expect(isWithinDir(linkInside, base)).toBe(false);
  });

  it("accepts a symlink that stays within the base", () => {
    const base = makeDir();
    const target = path.join(base, "target.txt");
    fs.writeFileSync(target, "x");
    const link = path.join(base, "link.txt");
    fs.symlinkSync(target, link);
    expect(isWithinDir(link, base)).toBe(true);
  });

  it("returns true for a non-existent file whose lexical path is inside base (future creation)", () => {
    const base = makeDir();
    const notYet = path.join(base, "will-create.txt");
    expect(isWithinDir(notYet, base)).toBe(true);
  });

  it("returns false for a non-existent file whose lexical path escapes base", () => {
    const base = makeDir();
    const escapes = path.join(base, "..", "..", "etc", "passwd");
    expect(isWithinDir(escapes, base)).toBe(false);
  });

  it("returns false if base itself cannot be resolved", () => {
    // Pass a base that definitely doesn't exist
    expect(
      isWithinDir("/tmp/some-file", "/nonexistent-base-dir-abc123xyz")
    ).toBe(false);
  });
});
