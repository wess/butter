import { test, expect, describe } from "bun:test";

// Replicate parseArgs from src/cli/sign.ts (not exported)

type SignOptions = {
  identity?: string;
  entitlements?: string;
  notarize?: boolean;
  appleId?: string;
  teamId?: string;
  password?: string;
  pfx?: string;
  pfxPassword?: string;
};

const parseArgs = (args: string[]): SignOptions => {
  const opts: SignOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--identity" && next) { opts.identity = next; i++; }
    else if (arg === "--entitlements" && next) { opts.entitlements = next; i++; }
    else if (arg === "--notarize") { opts.notarize = true; }
    else if (arg === "--apple-id" && next) { opts.appleId = next; i++; }
    else if (arg === "--team-id" && next) { opts.teamId = next; i++; }
    else if (arg === "--password" && next) { opts.password = next; i++; }
    else if (arg === "--pfx" && next) { opts.pfx = next; i++; }
    else if (arg === "--pfx-password" && next) { opts.pfxPassword = next; i++; }
  }
  return opts;
};

describe("sign parseArgs", () => {
  test("parses --identity", () => {
    const opts = parseArgs(["--identity", "Developer ID Application: Acme"]);
    expect(opts.identity).toBe("Developer ID Application: Acme");
  });

  test("parses --entitlements", () => {
    const opts = parseArgs(["--entitlements", "app.entitlements"]);
    expect(opts.entitlements).toBe("app.entitlements");
  });

  test("parses --notarize as boolean flag", () => {
    const opts = parseArgs(["--notarize"]);
    expect(opts.notarize).toBe(true);
  });

  test("parses --apple-id", () => {
    const opts = parseArgs(["--apple-id", "dev@example.com"]);
    expect(opts.appleId).toBe("dev@example.com");
  });

  test("parses --team-id", () => {
    const opts = parseArgs(["--team-id", "ABC123"]);
    expect(opts.teamId).toBe("ABC123");
  });

  test("parses --password", () => {
    const opts = parseArgs(["--password", "s3cret"]);
    expect(opts.password).toBe("s3cret");
  });

  test("parses --pfx", () => {
    const opts = parseArgs(["--pfx", "cert.pfx"]);
    expect(opts.pfx).toBe("cert.pfx");
  });

  test("parses --pfx-password", () => {
    const opts = parseArgs(["--pfx-password", "pfxpass"]);
    expect(opts.pfxPassword).toBe("pfxpass");
  });

  test("parses all arguments together", () => {
    const opts = parseArgs([
      "--identity", "My ID",
      "--entitlements", "ent.plist",
      "--notarize",
      "--apple-id", "a@b.com",
      "--team-id", "T1",
      "--password", "pw",
      "--pfx", "my.pfx",
      "--pfx-password", "pp",
    ]);
    expect(opts.identity).toBe("My ID");
    expect(opts.entitlements).toBe("ent.plist");
    expect(opts.notarize).toBe(true);
    expect(opts.appleId).toBe("a@b.com");
    expect(opts.teamId).toBe("T1");
    expect(opts.password).toBe("pw");
    expect(opts.pfx).toBe("my.pfx");
    expect(opts.pfxPassword).toBe("pp");
  });

  test("parses empty arguments returns empty options", () => {
    const opts = parseArgs([]);
    expect(opts).toEqual({});
  });

  test("partial arguments only set provided fields", () => {
    const opts = parseArgs(["--identity", "Dev", "--notarize"]);
    expect(opts.identity).toBe("Dev");
    expect(opts.notarize).toBe(true);
    expect(opts.entitlements).toBeUndefined();
    expect(opts.appleId).toBeUndefined();
    expect(opts.teamId).toBeUndefined();
    expect(opts.password).toBeUndefined();
    expect(opts.pfx).toBeUndefined();
    expect(opts.pfxPassword).toBeUndefined();
  });

  test("flag without value is ignored for value-requiring args", () => {
    // --identity at the end with no following value
    const opts = parseArgs(["--identity"]);
    expect(opts.identity).toBeUndefined();
  });

  test("--notarize can appear anywhere in args", () => {
    const opts = parseArgs(["--identity", "X", "--notarize", "--team-id", "T"]);
    expect(opts.notarize).toBe(true);
    expect(opts.identity).toBe("X");
    expect(opts.teamId).toBe("T");
  });

  test("unknown flags are silently ignored", () => {
    const opts = parseArgs(["--unknown", "val", "--identity", "ID"]);
    expect(opts.identity).toBe("ID");
    expect((opts as Record<string, unknown>)["unknown"]).toBeUndefined();
  });
});
