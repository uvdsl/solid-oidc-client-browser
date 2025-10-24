const fs = require("fs/promises");
const path = require("path");

const {name, version} = require("../package.json");

async function createModulePackageJson(dir) {
    const packageJsonFile = path.join(dir, "package.json");
    await fs.writeFile(packageJsonFile, JSON.stringify({name, version, type: "module" }));
}

async function main() {
    const buildDir = "./dist/esm";
    const entryPoints = ["web", "core"]; // subdirectories for your entry points
    for (const entry of entryPoints) {
        await createModulePackageJson(path.join(buildDir, entry));
    }
}

main();