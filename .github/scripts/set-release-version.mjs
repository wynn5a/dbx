// Sync the app version to the release tag and strip release-workflow-only
// build settings from tauri.conf.json. Usage: node set-release-version.mjs <version>
import fs from "node:fs";

const version = process.argv[2] ?? "";
if (!/^[0-9]+\.[0-9]+\.[0-9]+/.test(version)) {
  console.error(`Not a semver version: ${version}`);
  process.exit(1);
}

const confPath = "src-tauri/tauri.conf.json";
const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
conf.version = version;
// Updater artifacts (.sig + latest.json) require the signing key; without
// the TAURI_SIGNING_PRIVATE_KEY secret, generating them would fail the build.
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  conf.bundle.createUpdaterArtifacts = false;
}
// dist/ is built once in the prepare job and shared as an artifact, so the
// per-platform build must not rebuild the frontend.
conf.build.beforeBuildCommand = "";
fs.writeFileSync(confPath, JSON.stringify(conf, null, 2));

const pkgPath = "package.json";
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
