const Module = require("node:module");
const { dirname, join } = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");

const { logDebug } = require("../utils");
const { resolveTracerPath } = require("./tracer");

let loaderRegistration;

function preloadPaths(arguments_, flags) {
    const paths = [];
    for (let index = 0; index < arguments_.length; index++) {
        const argument = arguments_[index];
        const separator = argument.indexOf("=");
        const flag = separator === -1 ? argument : argument.slice(0, separator);
        if (!flags.includes(flag)) continue;
        const value = separator === -1 ? arguments_[++index] : argument.slice(separator + 1);
        if (value !== undefined) paths.push(value.replace(/^"|"$/g, ""));
    }
    return paths;
}

function isSelectedLoader(specifier, tracerDirectory, filename) {
    try {
        const path = specifier.startsWith("file:") ? fileURLToPath(specifier) : specifier;
        return require.resolve(path, { paths: [process.cwd()] }) === join(tracerDirectory, filename);
    } catch {
        return false;
    }
}

/**
 * @param {string} tracerPath
 */
async function registerESMLoaderHooks(tracerPath) {
    if (typeof Module.register !== "function") {
        return;
    }

    const tracerDirectory = dirname(tracerPath);
    const registerPath = join(tracerDirectory, "register.js");
    if (require.cache[registerPath]?.loaded) return;
    const nodeOptions = process.env.NODE_OPTIONS?.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const arguments_ = [...nodeOptions, ...process.execArgv];
    const loaders = preloadPaths(arguments_, ["--loader", "--experimental-loader"]);
    if (loaders.some((specifier) => ["loader-hook.mjs", "initialize.mjs"].some(
        (filename) => isSelectedLoader(specifier, tracerDirectory, filename),
    ))) return;

    const imports = preloadPaths(arguments_, ["--import"]);
    try {
        if (imports.some((specifier) => isSelectedLoader(specifier, tracerDirectory, "initialize.mjs"))) {
            await import(pathToFileURL(join(tracerDirectory, "initialize.mjs")).href);
            return;
        }
        try {
            require(registerPath);
        } catch (error) {
            const registerMissing = error?.code === "MODULE_NOT_FOUND" &&
                error.message?.startsWith(`Cannot find module '${registerPath}'`);
            if (!registerMissing) {
                throw error;
            }
            Module.register(pathToFileURL(join(tracerDirectory, "loader-hook.mjs")));
        }
        logDebug("registered dd-trace ESM loader hooks for ESM instrumentation");
    } catch (error) {
        logDebug("failed to register dd-trace ESM loader hooks", { error });
    }
}

// Currently no way to prevent typescript from auto-transpiling import into require,
// so we expose a wrapper in js
exports.import = function (path) {
    return import(path);
}

exports.initTracer = async function () {
    // Looks for the function local version of dd-trace first, before using
    // the version provided by the layer
    const tracerPath = resolveTracerPath();
    // `_dd.origin: lambda` is set by the dd-trace Lambda plugin on the span
    // itself now, so there is nothing to inject into DD_TAGS here.
    const tracer = require(tracerPath).init();
    logDebug("automatically initialized dd-trace");

    // The extension blocklist moved into the dd-trace Lambda plugin defaults:
    // dd-trace owns which of its own HTTP calls it traces.
    // The durable runtime ignores NODE_OPTIONS, so install hooks explicitly.
    loaderRegistration ||= registerESMLoaderHooks(tracerPath);
    await loaderRegistration;
    return tracer;
}
