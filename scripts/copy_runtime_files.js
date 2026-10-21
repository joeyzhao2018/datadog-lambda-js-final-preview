const { copyFileSync, mkdirSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

for (const file of ["handler.mjs", "runtime/module_importer.js"]) {
  const destination = resolve(__dirname, "../dist", file);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(__dirname, "../src", file), destination);
}
