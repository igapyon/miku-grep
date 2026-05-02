import { Readable } from "node:stream";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import iconv from "iconv-lite";

export async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "node_modules", "x"), { recursive: true });
  await fs.writeFile(path.join(root, "README.md"), "hello RepositoryMap\nsecond line\n", "utf8");
  await fs.writeFile(path.join(root, "src", "RepositoryMap.java"), "class RepositoryMap {\n  RepositoryMap field;\n}\n", "utf8");
  await fs.writeFile(path.join(root, "src", "legacy.txt"), iconv.encode("こんにちは RepositoryMap\n", "shift_jis"));
  await fs.writeFile(path.join(root, "node_modules", "x", "skip.js"), "RepositoryMap\n", "utf8");
  return root;
}

export function writableCapture(): { stream: NodeJS.WritableStream; output: () => string } {
  const chunks: string[] = [];
  return {
    stream: {
      write(chunk: string | Uint8Array): boolean {
        chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      },
    } as NodeJS.WritableStream,
    output: () => chunks.join(""),
  };
}

export function stdinFromJson(value: unknown): Readable {
  return Readable.from([JSON.stringify(value)]);
}

export function baseRequest(root: string): Record<string, unknown> {
  return {
    version: 1,
    root,
    query: { type: "literal", text: "RepositoryMap" },
  };
}
