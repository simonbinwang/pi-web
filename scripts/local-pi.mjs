#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = resolve(SCRIPT_DIR, "..");

export const LOCAL_PI_PACKAGES = Object.freeze({
  "@earendil-works/pi-ai": "packages/ai",
  "@earendil-works/pi-agent-core": "packages/agent",
  "@earendil-works/pi-coding-agent": "packages/coding-agent",
  "@earendil-works/pi-tui": "packages/tui",
  "@earendil-works/pi-client": "packages/client",
  "@earendil-works/pi-protocol": "packages/protocol",
  "@earendil-works/pi-telemetry": "packages/telemetry",
});

function readJson(path, description) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${description} at ${path}: ${error.message}`);
  }
}

export function resolvePiRoot(
  environment = process.env,
  cwd = process.cwd(),
  webRoot = WEB_ROOT,
) {
  const environmentPath = environment.PI_SOURCE_DIR?.trim();
  if (environmentPath) return resolve(cwd, environmentPath);

  const configPath = join(webRoot, "local-pi.json");
  if (existsSync(configPath)) {
    const config = readJson(configPath, "local Pi configuration");
    const configuredPath = config.piSourceDir;
    if (typeof configuredPath !== "string" || !configuredPath.trim()) {
      throw new Error(`${configPath} must contain a non-empty string field named piSourceDir.`);
    }
    return resolve(webRoot, configuredPath);
  }

  throw new Error(
    "Local Pi is not configured. Create local-pi.json in the Pi Web root, for example:\n" +
      '  { "piSourceDir": "/home/me/code/pi" }\n' +
      "Or set PI_SOURCE_DIR for a one-off override.",
  );
}

export function validatePiRoot(piRoot) {
  const rootManifestPath = join(piRoot, "package.json");
  if (!existsSync(rootManifestPath)) {
    throw new Error(`PI_SOURCE_DIR is not a Pi checkout: ${rootManifestPath} does not exist.`);
  }

  const rootManifest = readJson(rootManifestPath, "Pi package manifest");
  if (rootManifest.name !== "pi-monorepo") {
    throw new Error(
      `PI_SOURCE_DIR must point at the Pi monorepo root; found package ${JSON.stringify(rootManifest.name)}.`,
    );
  }

  for (const [packageName, packagePath] of Object.entries(LOCAL_PI_PACKAGES)) {
    const manifestPath = join(piRoot, packagePath, "package.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`Local Pi package is missing: ${manifestPath}`);
    }
    const manifest = readJson(manifestPath, packageName);
    if (manifest.name !== packageName) {
      throw new Error(
        `Expected ${packageName} at ${manifestPath}, found ${JSON.stringify(manifest.name)}.`,
      );
    }
  }
}

function assertLocalPiIsBuilt(piRoot) {
  const missing = [];
  for (const [packageName, packagePath] of Object.entries(LOCAL_PI_PACKAGES)) {
    const entry = join(piRoot, packagePath, "dist", "index.js");
    if (!existsSync(entry)) missing.push(`${packageName}: ${entry}`);
  }
  if (missing.length > 0) {
    throw new Error(
      "Local Pi build output is missing. Run `npm run local-pi:build` first.\n" +
        missing.map((item) => `  - ${item}`).join("\n"),
    );
  }
}

function currentLinkTarget(path) {
  try {
    if (!lstatSync(path).isSymbolicLink()) return undefined;
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

export function linkLocalPiPackages({ piRoot, webRoot = WEB_ROOT }) {
  validatePiRoot(piRoot);

  const scopeRoot = join(webRoot, "node_modules", "@earendil-works");
  mkdirSync(scopeRoot, { recursive: true });

  const linked = [];
  for (const [packageName, packagePath] of Object.entries(LOCAL_PI_PACKAGES)) {
    const source = realpathSync(join(piRoot, packagePath));
    const target = join(scopeRoot, packageName.slice("@earendil-works/".length));
    const existingTarget = currentLinkTarget(target);

    if (existingTarget !== source) {
      rmSync(target, { recursive: true, force: true });
      symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
    }

    linked.push({ packageName, source, changed: existingTarget !== source });
  }
  return linked;
}

function printLinks(links, webRoot) {
  console.log("Local Pi packages:");
  for (const { packageName, source, changed } of links) {
    const displayPath = relative(webRoot, source) || ".";
    console.log(`  ${changed ? "linked" : "ready "} ${packageName} -> ${displayPath}`);
  }
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by signal ${signal}.`));
      } else if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}.`));
      } else {
        resolvePromise();
      }
    });
  });
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function buildPi(piRoot) {
  console.log(`Building local Pi at ${piRoot}...`);
  await run(npmCommand(), ["run", "build:offline"], piRoot);
  assertLocalPiIsBuilt(piRoot);
}

function assertNoDevelopmentBuild(webRoot) {
  const devLock = join(webRoot, ".next", "dev", "lock");
  if (existsSync(devLock)) {
    throw new Error(
      "A Next.js development server appears to be running. Stop it before building Pi Web so both commands do not share .next/.",
    );
  }
}

function assertProductionBuild(webRoot) {
  if (!existsSync(join(webRoot, ".next", "BUILD_ID"))) {
    throw new Error("No Pi Web production build found. Run `npm run build:local-pi` first.");
  }
}

function usage() {
  console.log(`Usage: node scripts/local-pi.mjs <command>

Commands:
  link       Link Pi Web's Pi packages to PI_SOURCE_DIR
  build      Build local Pi and refresh package links
  dev        Refresh links and start the Pi Web development server
  build-web  Build local Pi, refresh links, and build Pi Web
  start-web  Refresh links and run an existing Pi Web production build

Configuration:
  local-pi.json  { "piSourceDir": "/path/to/pi" } (relative paths use the Pi Web root)
  PI_SOURCE_DIR  Optional one-off override; relative paths use the current directory`);
}

export async function main(argv = process.argv.slice(2)) {
  const [command] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  const supported = new Set(["link", "build", "dev", "build-web", "start-web"]);
  if (!supported.has(command)) {
    usage();
    throw new Error(`Unknown local Pi command: ${command}`);
  }

  const piRoot = resolvePiRoot();
  validatePiRoot(piRoot);

  if (command === "build" || command === "build-web") {
    if (command === "build-web") assertNoDevelopmentBuild(WEB_ROOT);
    await buildPi(piRoot);
  }

  const links = linkLocalPiPackages({ piRoot });
  printLinks(links, WEB_ROOT);

  if (command === "link") return;
  assertLocalPiIsBuilt(piRoot);

  if (command === "dev") {
    await run(npmCommand(), ["run", "dev"], WEB_ROOT);
  } else if (command === "build-web") {
    assertNoDevelopmentBuild(WEB_ROOT);
    await run(npmCommand(), ["run", "build"], WEB_ROOT);
  } else if (command === "start-web") {
    assertProductionBuild(WEB_ROOT);
    await run(npmCommand(), ["run", "start"], WEB_ROOT);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    console.error(`local-pi: ${error.message}`);
    process.exitCode = 1;
  });
}
