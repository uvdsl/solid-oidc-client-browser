const fs = require("fs/promises");
const path = require("path");

const buildDir = "./dist/esm";

async function createEsmModulePackageJson() {
    const packageJsonFile = path.join(buildDir, "package.json");
    const {name, version} = require("../package.json");
    await fs.writeFile(packageJsonFile, JSON.stringify({name, version, type: "module" }));
}

createEsmModulePackageJson();