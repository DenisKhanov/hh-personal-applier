import { copyFile, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const esbuildCli = join(root, "node_modules/esbuild-wasm/bin/esbuild");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} failed with ${signal ?? `exit code ${code}`}`));
    });
  });
}

await rm(dist, { force: true, recursive: true });
await mkdir(join(dist, "background"), { recursive: true });
await mkdir(join(dist, "content"), { recursive: true });
await mkdir(join(dist, "popup"), { recursive: true });

await Promise.all([
  copyFile(join(root, "manifest.json"), join(dist, "manifest.json")),
  copyFile(join(root, "src/popup/index.html"), join(dist, "popup/index.html")),
  copyFile(join(root, "src/popup/style.css"), join(dist, "popup/style.css"))
]);

await run(process.execPath, [
  esbuildCli,
  join(root, "src/background/index.ts"),
  join(root, "src/content/search.ts"),
  join(root, "src/popup/index.ts"),
  "--bundle",
  `--outdir=${dist}`,
  `--outbase=${join(root, "src")}`,
  "--platform=browser",
  "--target=es2022",
  "--format=esm",
  "--log-level=info"
]);
