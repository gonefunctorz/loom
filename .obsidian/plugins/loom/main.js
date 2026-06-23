"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => loomPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian6 = require("obsidian");
var import_state = require("@codemirror/state");
var import_view2 = require("@codemirror/view");
var import_path10 = require("path");

// src/execution/containerRunner.ts
var import_obsidian = require("obsidian");
var import_fs = require("fs");
var import_promises2 = require("fs/promises");
var import_path2 = require("path");
var import_child_process2 = require("child_process");

// src/execution/processRunner.ts
var import_promises = require("fs/promises");
var import_os = require("os");
var import_path = require("path");
var import_child_process = require("child_process");
async function withNamedTempSourceFile(fileName, source, callback) {
  const tempDir = await (0, import_promises.mkdtemp)((0, import_path.join)((0, import_os.tmpdir)(), "loom-"));
  const tempFile = (0, import_path.join)(tempDir, fileName);
  try {
    await (0, import_promises.writeFile)(tempFile, normalizeExecutableSource(source), "utf8");
    return await callback({ tempDir, tempFile });
  } finally {
    await (0, import_promises.rm)(tempDir, { recursive: true, force: true });
  }
}
async function withTempSourceFile(fileExtension, source, callback) {
  return withNamedTempSourceFile(`snippet${fileExtension}`, source, callback);
}
function normalizeExecutableSource(source) {
  const lines = source.split("\n");
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  if (!nonEmptyLines.length) {
    return source;
  }
  let sharedIndent = getLeadingWhitespace(nonEmptyLines[0]);
  for (const line of nonEmptyLines.slice(1)) {
    sharedIndent = sharedWhitespacePrefix(sharedIndent, getLeadingWhitespace(line));
    if (!sharedIndent) {
      return source;
    }
  }
  if (!sharedIndent) {
    return source;
  }
  return lines.map((line) => line.trim().length === 0 ? line : line.startsWith(sharedIndent) ? line.slice(sharedIndent.length) : line).join("\n");
}
function getLeadingWhitespace(line) {
  const match = line.match(/^[\t ]*/);
  return match?.[0] ?? "";
}
function sharedWhitespacePrefix(left, right) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return left.slice(0, index);
}
async function runProcess(spec) {
  const startedAt = /* @__PURE__ */ new Date();
  let stdout = "";
  let stderr = "";
  let exitCode = null;
  let timedOut = false;
  let cancelled = false;
  let child = null;
  let timeoutHandle = null;
  let abortHandler = null;
  try {
    await new Promise((resolve, reject) => {
      child = (0, import_child_process.spawn)(spec.executable, spec.args, {
        cwd: spec.workingDirectory,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ...spec.env
        }
      });
      child.stdin?.end(spec.stdin ?? "");
      const abort = () => {
        cancelled = true;
        child?.kill("SIGTERM");
      };
      abortHandler = abort;
      if (spec.signal.aborted) {
        abort();
      } else {
        spec.signal.addEventListener("abort", abort, { once: true });
      }
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child?.kill("SIGTERM");
      }, spec.timeoutMs);
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        reject(error);
      });
      child.on("close", (code) => {
        exitCode = code;
        resolve();
      });
    });
  } catch (error) {
    stderr = stderr || formatProcessError(error, spec.executable);
    exitCode = exitCode ?? -1;
  } finally {
    if (abortHandler) {
      spec.signal.removeEventListener("abort", abortHandler);
    }
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
  const finishedAt = /* @__PURE__ */ new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const success = !timedOut && !cancelled && exitCode === 0;
  return {
    runnerId: spec.runnerId,
    runnerName: spec.runnerName,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    exitCode,
    stdout,
    stderr,
    success,
    timedOut,
    cancelled
  };
}
function formatProcessError(error, executable) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return `Executable not found: ${executable}`;
  }
  return error instanceof Error ? error.message : String(error);
}
async function runTempFileProcess(spec) {
  return withTempSourceFile(
    spec.fileExtension,
    spec.source,
    async ({ tempFile, tempDir }) => runProcess({
      runnerId: spec.runnerId,
      runnerName: spec.runnerName,
      executable: spec.executable,
      args: spec.args.map((value) => value.replaceAll("{file}", tempFile).replaceAll("{tempDir}", tempDir)),
      workingDirectory: spec.workingDirectory,
      timeoutMs: spec.timeoutMs,
      signal: spec.signal,
      stdin: spec.stdin,
      env: expandTemplatedEnv(spec.env, tempFile, tempDir)
    })
  );
}
function expandTemplatedEnv(env, tempFile, tempDir) {
  if (!env) {
    return void 0;
  }
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      typeof value === "string" ? value.replaceAll("{file}", tempFile).replaceAll("{tempDir}", tempDir) : value
    ])
  );
}

// src/utils/command.ts
function splitCommandLine(input) {
  const parts = [];
  let current = "";
  let quote = null;
  let escaping = false;
  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

// src/execution/containerRunner.ts
var loomContainerRunner = class {
  constructor(app, pluginDir) {
    this.app = app;
    this.pluginDir = pluginDir;
    this.builtImages = /* @__PURE__ */ new Set();
  }
  getContainerGroupName(file) {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const value = frontmatter?.["loom-container"];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  async getGroupSummaries() {
    const containersPath = this.getContainersPath();
    if (!(0, import_fs.existsSync)(containersPath)) {
      return [];
    }
    const entries = await (0, import_promises2.readdir)(containersPath, { withFileTypes: true });
    return Promise.all(
      entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
        const groupPath = (0, import_path2.join)(containersPath, entry.name);
        const hasConfig = (0, import_fs.existsSync)((0, import_path2.join)(groupPath, "config.json"));
        const hasDockerfile = (0, import_fs.existsSync)((0, import_path2.join)(groupPath, "Dockerfile"));
        if (!hasConfig) {
          return {
            name: entry.name,
            status: "missing config.json"
          };
        }
        try {
          const config = await this.readConfig(groupPath);
          const pieces = [`runtime: ${config.runtime}`];
          if ((config.runtime === "docker" || config.runtime === "podman") && hasDockerfile) {
            pieces.push("Dockerfile");
          }
          if (config.runtime === "qemu" && config.qemu?.sshTarget) {
            pieces.push(`ssh: ${config.qemu.sshTarget}`);
          }
          if (config.runtime === "qemu" && config.qemu?.manager?.enabled) {
            pieces.push(`manager: ${await this.getManagedQemuStatus(groupPath, config.qemu.manager)}`);
          }
          if (config.runtime === "custom" && config.custom?.executable) {
            pieces.push(`wrapper: ${config.custom.executable}`);
          }
          const languageCount = Object.keys(config.languages).length;
          pieces.push(`${languageCount} language${languageCount === 1 ? "" : "s"}`);
          return {
            name: entry.name,
            status: pieces.join(", ")
          };
        } catch (error) {
          return {
            name: entry.name,
            status: `invalid config.json: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      })
    );
  }
  async run(block, context, settings, groupName) {
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    const configLang = config.languages[block.language] ?? config.languages[block.languageAlias];
    let isFallback = false;
    let language = null;
    if (configLang) {
      if (configLang.useDefault) {
        language = this.getDefaultLanguageConfig(block.language, settings) ?? this.getDefaultLanguageConfig(block.languageAlias, settings);
      } else {
        language = configLang;
      }
    } else {
      language = this.getDefaultLanguageConfig(block.language, settings) ?? this.getDefaultLanguageConfig(block.languageAlias, settings);
      isFallback = true;
    }
    if (!language || !language.command || !language.extension) {
      throw new Error(`Container group ${groupName} has no command for ${block.language}.`);
    }
    await (0, import_promises2.mkdir)(groupPath, { recursive: true });
    await this.runHealthCheck(config.healthCheck, groupPath, context.timeoutMs, context.signal, `container:${groupName}:health`, `Container ${groupName} health check`);
    const tempFileName = `temp_${Date.now()}_${Math.random().toString(16).slice(2)}${normalizeExtension(language.extension)}`;
    const tempFilePath = (0, import_path2.join)(groupPath, tempFileName);
    try {
      await (0, import_promises2.writeFile)(tempFilePath, block.content, "utf8");
      let result;
      switch (config.runtime) {
        case "docker":
        case "podman":
          result = await this.runOciContainer(groupName, groupPath, config, language, tempFileName, context, settings);
          break;
        case "qemu":
          result = await this.runQemu(groupName, groupPath, config, language, tempFileName, context);
          break;
        case "custom":
          result = await this.runCustom(groupName, groupPath, config, block, language, tempFileName, tempFilePath, context);
          break;
        case "wsl":
          result = await this.runWslContainer(groupName, groupPath, config, language, tempFileName, context);
          break;
        default:
          throw new Error(`Unsupported runtime: ${config.runtime}`);
      }
      if (isFallback) {
        const fallbackMsg = `[Loom] Language '${block.language}' was not declared in container group. Running using default command: ${language.command}`;
        result.warning = result.warning ? `${result.warning}
${fallbackMsg}` : fallbackMsg;
      }
      return result;
    } finally {
      await (0, import_promises2.rm)(tempFilePath, { force: true });
    }
  }
  async buildGroup(groupName, timeoutMs, signal) {
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    await (0, import_promises2.mkdir)(groupPath, { recursive: true });
    await this.runHealthCheck(config.healthCheck, groupPath, timeoutMs, signal, `container:${groupName}:health`, `Container ${groupName} health check`);
    switch (config.runtime) {
      case "docker":
      case "podman":
        return this.buildImage(groupName, groupPath, config, timeoutMs, signal);
      case "qemu":
        return this.buildQemu(groupName, groupPath, config, timeoutMs, signal);
      case "custom":
        return this.runCustomWrapper(groupName, groupPath, config, this.createCustomRequest("build", groupName, groupPath, config, timeoutMs), timeoutMs, signal);
      case "wsl":
        return this.createSyntheticResult(
          `container:${groupName}:wsl:build`,
          `WSL ${groupName} build`,
          `WSL environment ${config.image || "(default)"} does not require a build step.
`
        );
    }
  }
  async runOciContainer(groupName, groupPath, config, language, tempFileName, context, settings) {
    const image = await this.resolveImage(groupName, groupPath, config, context, settings);
    const command = splitCommandLine(language.command.replaceAll("{file}", tempFileName));
    if (!command.length) {
      throw new Error("Container command is empty.");
    }
    return await runProcess({
      runnerId: `container:${groupName}`,
      runnerName: `${runtimeLabel(config.runtime)} ${groupName}`,
      executable: this.runtimeExecutable(config),
      args: [
        "run",
        "--rm",
        ...context.stdin != null ? ["-i"] : [],
        "-v",
        `${groupPath}:/workspace`,
        "-w",
        "/workspace",
        image,
        ...command
      ],
      workingDirectory: groupPath,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
      stdin: context.stdin
    });
  }
  async runQemu(groupName, groupPath, config, language, tempFileName, context) {
    const qemu = this.requireQemuConfig(config);
    await this.runOptionalCommand(qemu.startCommand, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:start`, `QEMU ${groupName} start`);
    await this.ensureManagedQemu(groupName, groupPath, qemu, context.timeoutMs, context.signal);
    await this.runHealthCheck(qemu.healthCheck, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:health`, `QEMU ${groupName} health check`);
    try {
      const remoteFile = import_path2.posix.join(qemu.remoteWorkspace, tempFileName);
      const remoteCommand = language.command.replaceAll("{file}", shellQuote(remoteFile));
      if (!remoteCommand.trim()) {
        throw new Error("QEMU command is empty.");
      }
      return await runProcess({
        runnerId: `container:${groupName}:qemu`,
        runnerName: `QEMU ${groupName}`,
        executable: qemu.sshExecutable || "ssh",
        args: [
          ...splitCommandLine(qemu.sshArgs || ""),
          qemu.sshTarget,
          `cd ${shellQuote(qemu.remoteWorkspace)} && ${remoteCommand}`
        ],
        workingDirectory: groupPath,
        timeoutMs: context.timeoutMs,
        signal: context.signal,
        stdin: context.stdin
      });
    } finally {
      await this.runOptionalCommand(qemu.teardownCommand, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:teardown`, `QEMU ${groupName} teardown`);
      await this.stopManagedQemuIfNeeded(groupName, groupPath, qemu, context.timeoutMs, context.signal);
    }
  }
  async runCustom(groupName, groupPath, config, block, language, tempFileName, tempFilePath, context) {
    const command = language.command.replaceAll("{file}", tempFileName);
    const result = await this.runCustomWrapper(
      groupName,
      groupPath,
      config,
      this.createCustomRequest("run", groupName, groupPath, config, context.timeoutMs, {
        language: block.language,
        languageAlias: block.languageAlias,
        fileName: tempFileName,
        filePath: tempFilePath,
        command,
        stdin: context.stdin
      }),
      context.timeoutMs,
      context.signal
    );
    if (config.custom?.teardown) {
      const teardown = await this.runCustomWrapper(
        groupName,
        groupPath,
        config,
        this.createCustomRequest("teardown", groupName, groupPath, config, context.timeoutMs, {
          language: block.language,
          languageAlias: block.languageAlias,
          fileName: tempFileName,
          filePath: tempFilePath,
          command,
          stdin: context.stdin
        }),
        context.timeoutMs,
        context.signal
      );
      if (!teardown.success) {
        result.warning = `Custom runtime teardown failed: ${teardown.stderr || teardown.stdout || `exit ${teardown.exitCode}`}`;
      }
    }
    return result;
  }
  async runWslContainer(groupName, groupPath, config, language, tempFileName, context) {
    const wslGroupPath = this.translateToWslPath(groupPath);
    const command = language.command.replaceAll("{file}", tempFileName);
    if (!command.trim()) {
      throw new Error("WSL command is empty.");
    }
    const shellFlags = config.wsl?.interactive ? ["-i", "-l", "-c"] : ["-l", "-c"];
    const wslArgs = ["bash", ...shellFlags, `cd "${wslGroupPath.replaceAll('"', '\\"')}" && ${command}`];
    if (config.image?.trim()) {
      wslArgs.unshift("-d", config.image.trim());
    }
    return await runProcess({
      runnerId: `container:${groupName}:wsl`,
      runnerName: `WSL ${groupName}`,
      executable: "wsl",
      args: wslArgs,
      workingDirectory: groupPath,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
      stdin: context.stdin
    });
  }
  translateToWslPath(windowsPath) {
    const match = windowsPath.match(/^([A-Za-z]):\\(.*)/);
    if (match) {
      const drive = match[1].toLowerCase();
      const rest = match[2].replace(/\\/g, "/");
      return `/mnt/${drive}/${rest}`;
    }
    if (windowsPath.includes("\\")) {
      return windowsPath.replace(/\\/g, "/");
    }
    return windowsPath;
  }
  async resolveImage(groupName, groupPath, config, context, settings) {
    const dockerfile = (0, import_path2.join)(groupPath, "Dockerfile");
    if (!(0, import_fs.existsSync)(dockerfile)) {
      return config.image || "ubuntu:latest";
    }
    const image = this.imageNameForGroup(groupName);
    const cacheKey = `${this.runtimeExecutable(config)}:${image}`;
    if (this.builtImages.has(cacheKey)) {
      return image;
    }
    const result = await this.buildImage(groupName, groupPath, config, Math.max(context.timeoutMs, settings.defaultTimeoutMs, 12e4), context.signal);
    if (!result.success) {
      throw new Error(result.stderr || result.stdout || `${runtimeLabel(config.runtime)} build failed for ${groupName}.`);
    }
    this.builtImages.add(cacheKey);
    return image;
  }
  async buildImage(groupName, groupPath, config, timeoutMs, signal) {
    const image = this.imageNameForGroup(groupName);
    if (!(0, import_fs.existsSync)((0, import_path2.join)(groupPath, "Dockerfile"))) {
      return this.createSyntheticResult(
        `container:${groupName}:build`,
        `${runtimeLabel(config.runtime)} ${groupName} build`,
        `No Dockerfile configured. Using image ${config.image || "ubuntu:latest"}.
`
      );
    }
    return runProcess({
      runnerId: `container:${groupName}:build`,
      runnerName: `${runtimeLabel(config.runtime)} ${groupName} build`,
      executable: this.runtimeExecutable(config),
      args: ["build", "-t", image, groupPath],
      workingDirectory: groupPath,
      timeoutMs,
      signal
    });
  }
  async buildQemu(groupName, groupPath, config, timeoutMs, signal) {
    const qemu = this.requireQemuConfig(config);
    if (!qemu.buildCommand?.trim()) {
      return this.createSyntheticResult(`container:${groupName}:qemu:build`, `QEMU ${groupName} build`, "No QEMU build command configured.\n");
    }
    return this.runCommandLine(qemu.buildCommand, groupPath, timeoutMs, signal, `container:${groupName}:qemu:build`, `QEMU ${groupName} build`);
  }
  async readConfig(groupPath) {
    const configPath = (0, import_path2.join)(groupPath, "config.json");
    let raw;
    try {
      raw = JSON.parse(await (0, import_promises2.readFile)(configPath, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read container config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Container config must be an object.");
    }
    const data = raw;
    const runtime = this.readRuntime(data.runtime);
    if (data.executable != null && typeof data.executable !== "string") {
      throw new Error("Container config executable must be a string.");
    }
    if (data.image != null && typeof data.image !== "string") {
      throw new Error("Container config image must be a string.");
    }
    if (!data.languages || typeof data.languages !== "object" || Array.isArray(data.languages)) {
      throw new Error("Container config languages must be an object.");
    }
    const languages = {};
    for (const [language, value] of Object.entries(data.languages)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Container language ${language} must be an object.`);
      }
      const languageConfig = value;
      const useDefault = languageConfig.useDefault === true;
      if (!useDefault && (typeof languageConfig.command !== "string" || !languageConfig.command.trim())) {
        throw new Error(`Container language ${language} must define command or useDefault.`);
      }
      languages[language] = {
        command: typeof languageConfig.command === "string" ? languageConfig.command : void 0,
        extension: typeof languageConfig.extension === "string" ? languageConfig.extension : useDefault ? void 0 : `.${language}`,
        useDefault: useDefault || void 0
      };
    }
    return {
      runtime,
      executable: typeof data.executable === "string" && data.executable.trim() ? data.executable.trim() : void 0,
      image: typeof data.image === "string" ? data.image : void 0,
      wsl: this.readWslConfig(data.wsl),
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config healthCheck"),
      qemu: this.readQemuConfig(data.qemu),
      custom: this.readCustomConfig(data.custom),
      languages
    };
  }
  readRuntime(value) {
    if (value == null) {
      return "docker";
    }
    if (value === "docker" || value === "podman" || value === "qemu" || value === "custom" || value === "wsl") {
      return value;
    }
    throw new Error("Container config runtime must be docker, podman, qemu, custom, or wsl.");
  }
  readWslConfig(value) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config wsl must be an object.");
    }
    const data = value;
    return {
      interactive: data.interactive === true
    };
  }
  readQemuConfig(value) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config qemu must be an object.");
    }
    const data = value;
    if (typeof data.sshTarget !== "string" || !data.sshTarget.trim()) {
      throw new Error("Container config qemu.sshTarget must be a string.");
    }
    if (typeof data.remoteWorkspace !== "string" || !data.remoteWorkspace.trim()) {
      throw new Error("Container config qemu.remoteWorkspace must be a string.");
    }
    return {
      sshTarget: data.sshTarget.trim(),
      remoteWorkspace: data.remoteWorkspace.trim(),
      sshExecutable: optionalString(data.sshExecutable),
      sshArgs: optionalString(data.sshArgs),
      startCommand: optionalString(data.startCommand),
      buildCommand: optionalString(data.buildCommand),
      teardownCommand: optionalString(data.teardownCommand),
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config qemu.healthCheck"),
      manager: this.readQemuManagerConfig(data.manager)
    };
  }
  readQemuManagerConfig(value) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config qemu.manager must be an object.");
    }
    const data = value;
    return {
      enabled: data.enabled !== false,
      executable: optionalString(data.executable),
      args: optionalString(data.args),
      image: optionalString(data.image),
      imageFormat: optionalString(data.imageFormat),
      pidFile: optionalString(data.pidFile),
      logFile: optionalString(data.logFile),
      readinessTimeoutMs: optionalPositiveInteger(data.readinessTimeoutMs, "Container config qemu.manager.readinessTimeoutMs"),
      readinessIntervalMs: optionalPositiveInteger(data.readinessIntervalMs, "Container config qemu.manager.readinessIntervalMs"),
      bootDelayMs: optionalNonNegativeInteger(data.bootDelayMs, "Container config qemu.manager.bootDelayMs"),
      shutdownCommand: optionalString(data.shutdownCommand),
      shutdownTimeoutMs: optionalPositiveInteger(data.shutdownTimeoutMs, "Container config qemu.manager.shutdownTimeoutMs"),
      killSignal: optionalSignal(data.killSignal, "Container config qemu.manager.killSignal"),
      persist: typeof data.persist === "boolean" ? data.persist : void 0
    };
  }
  readCustomConfig(value) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config custom must be an object.");
    }
    const data = value;
    if (typeof data.executable !== "string" || !data.executable.trim()) {
      throw new Error("Container config custom.executable must be a string.");
    }
    return {
      executable: data.executable.trim(),
      args: optionalString(data.args),
      build: optionalString(data.build),
      commandStructure: optionalString(data.commandStructure),
      teardown: optionalString(data.teardown),
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config custom.healthCheck")
    };
  }
  readHealthCheck(value, label) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} must be an object.`);
    }
    const data = value;
    if (typeof data.command !== "string" || !data.command.trim()) {
      throw new Error(`${label}.command must be a string.`);
    }
    return {
      command: data.command.trim(),
      positiveResponse: optionalString(data.positiveResponse ?? data.positive_response ?? data["positive response"] ?? data.possitiveResponse),
      negativeResponse: optionalString(data.negativeResponse ?? data.negative_response ?? data["negative response"])
    };
  }
  requireQemuConfig(config) {
    if (!config.qemu) {
      throw new Error("QEMU runtime requires a qemu config object.");
    }
    return config.qemu;
  }
  requireCustomConfig(config) {
    if (!config.custom) {
      throw new Error("Custom runtime requires a custom config object.");
    }
    return config.custom;
  }
  runtimeExecutable(config) {
    if (config.executable?.trim()) {
      return config.executable.trim();
    }
    return config.runtime === "podman" ? "podman" : "docker";
  }
  async runHealthCheck(healthCheck, workingDirectory, timeoutMs, signal, runnerId, runnerName) {
    if (!healthCheck) {
      return;
    }
    const result = await this.runCommandLine(healthCheck.command, workingDirectory, timeoutMs, signal, runnerId, runnerName);
    const combinedOutput = `${result.stdout}
${result.stderr}`;
    if (!result.success) {
      throw new Error(`${runnerName} failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
    }
    if (healthCheck.negativeResponse && combinedOutput.includes(healthCheck.negativeResponse)) {
      throw new Error(`${runnerName} returned negative response: ${healthCheck.negativeResponse}`);
    }
    if (healthCheck.positiveResponse && !combinedOutput.includes(healthCheck.positiveResponse)) {
      throw new Error(`${runnerName} did not return positive response: ${healthCheck.positiveResponse}`);
    }
  }
  async runOptionalCommand(command, workingDirectory, timeoutMs, signal, runnerId, runnerName) {
    if (!command?.trim()) {
      return;
    }
    const result = await this.runCommandLine(command, workingDirectory, timeoutMs, signal, runnerId, runnerName);
    if (!result.success) {
      throw new Error(`${runnerName} failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
    }
  }
  async runCommandLine(command, workingDirectory, timeoutMs, signal, runnerId, runnerName) {
    const parts = splitCommandLine(command);
    if (!parts.length) {
      throw new Error(`${runnerName} command is empty.`);
    }
    return runProcess({
      runnerId,
      runnerName,
      executable: parts[0],
      args: parts.slice(1),
      workingDirectory,
      timeoutMs,
      signal
    });
  }
  async ensureManagedQemu(groupName, groupPath, qemu, timeoutMs, signal) {
    const manager = qemu.manager;
    if (!manager?.enabled) {
      return;
    }
    const pidPath = this.resolveGroupFilePath(groupPath, manager.pidFile || ".loom-qemu.pid");
    const existingPid = await this.readPidFile(pidPath);
    if (existingPid && this.isProcessRunning(existingPid)) {
      await this.waitForManagedQemuReadiness(groupName, groupPath, qemu, timeoutMs, signal);
      return;
    }
    if (existingPid) {
      await (0, import_promises2.rm)(pidPath, { force: true });
    }
    const executable = manager.executable || "qemu-system-x86_64";
    const args = this.buildManagedQemuArgs(groupPath, manager);
    if (!args.length) {
      throw new Error(`QEMU manager for ${groupName} needs qemu.manager.args or qemu.manager.image.`);
    }
    const logPath = manager.logFile ? this.resolveGroupFilePath(groupPath, manager.logFile) : null;
    const logFd = logPath ? (0, import_fs.openSync)(logPath, "a") : null;
    try {
      const child = (0, import_child_process2.spawn)(executable, args, {
        cwd: groupPath,
        detached: true,
        stdio: ["ignore", logFd ?? "ignore", logFd ?? "ignore"]
      });
      child.on("error", () => void 0);
      child.unref();
      if (!child.pid) {
        throw new Error(`QEMU manager for ${groupName} did not return a process id.`);
      }
      await (0, import_promises2.writeFile)(pidPath, `${child.pid}
`, "utf8");
      await this.waitForManagedQemuReadiness(groupName, groupPath, qemu, timeoutMs, signal);
    } finally {
      if (logFd != null) {
        (0, import_fs.closeSync)(logFd);
      }
    }
  }
  buildManagedQemuArgs(groupPath, manager) {
    const args = splitCommandLine(manager.args || "");
    if (manager.image) {
      const imagePath = this.resolveGroupFilePath(groupPath, manager.image);
      args.push("-drive", `file=${imagePath},if=virtio,format=${manager.imageFormat || "qcow2"}`);
    }
    return args;
  }
  async waitForManagedQemuReadiness(groupName, groupPath, qemu, timeoutMs, signal) {
    const manager = qemu.manager;
    if (!manager?.enabled) {
      return;
    }
    if (!qemu.healthCheck) {
      await sleepWithSignal(manager.bootDelayMs ?? 0, signal);
      return;
    }
    const timeout = Math.min(manager.readinessTimeoutMs ?? 6e4, Math.max(timeoutMs, 1));
    const interval = manager.readinessIntervalMs ?? 1e3;
    const startedAt = Date.now();
    let lastError = "";
    while (Date.now() - startedAt <= timeout) {
      if (signal.aborted) {
        throw new Error(`QEMU ${groupName} readiness wait cancelled.`);
      }
      try {
        await this.runHealthCheck(qemu.healthCheck, groupPath, Math.min(interval, timeout), signal, `container:${groupName}:qemu:ready`, `QEMU ${groupName} readiness check`);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await sleepWithSignal(interval, signal);
    }
    throw new Error(`QEMU ${groupName} did not become ready within ${timeout} ms${lastError ? `: ${lastError}` : "."}`);
  }
  async stopManagedQemuIfNeeded(groupName, groupPath, qemu, timeoutMs, signal) {
    const manager = qemu.manager;
    if (!manager?.enabled || manager.persist !== false) {
      return;
    }
    const pidPath = this.resolveGroupFilePath(groupPath, manager.pidFile || ".loom-qemu.pid");
    const pid = await this.readPidFile(pidPath);
    if (!pid) {
      return;
    }
    if (manager.shutdownCommand) {
      await this.runOptionalCommand(
        manager.shutdownCommand,
        groupPath,
        Math.min(manager.shutdownTimeoutMs ?? timeoutMs, timeoutMs),
        signal,
        `container:${groupName}:qemu:shutdown`,
        `QEMU ${groupName} shutdown`
      );
    } else if (this.isProcessRunning(pid)) {
      process.kill(pid, manager.killSignal || "SIGTERM");
    }
    const stopped = await this.waitForProcessExit(pid, manager.shutdownTimeoutMs ?? 1e4, signal);
    if (!stopped && this.isProcessRunning(pid)) {
      process.kill(pid, "SIGKILL");
      await this.waitForProcessExit(pid, 2e3, signal);
    }
    await (0, import_promises2.rm)(pidPath, { force: true });
  }
  async getManagedQemuStatus(groupPath, manager) {
    const pidPath = this.resolveGroupFilePath(groupPath, manager.pidFile || ".loom-qemu.pid");
    const pid = await this.readPidFile(pidPath);
    if (!pid) {
      return "stopped";
    }
    return this.isProcessRunning(pid) ? `running pid ${pid}` : `stale pid ${pid}`;
  }
  async readPidFile(pidPath) {
    try {
      const value = (await (0, import_promises2.readFile)(pidPath, "utf8")).trim();
      const pid = Number.parseInt(value, 10);
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }
  isProcessRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  async waitForProcessExit(pid, timeoutMs, signal) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      if (signal.aborted) {
        return false;
      }
      if (!this.isProcessRunning(pid)) {
        return true;
      }
      await sleepWithSignal(250, signal);
    }
    return !this.isProcessRunning(pid);
  }
  async runCustomWrapper(groupName, groupPath, config, request, timeoutMs, signal) {
    const custom = this.requireCustomConfig(config);
    await this.runHealthCheck(custom.healthCheck, groupPath, timeoutMs, signal, `container:${groupName}:custom:health`, `Custom ${groupName} health check`);
    const requestFileName = `request_${Date.now()}_${Math.random().toString(16).slice(2)}.json`;
    const requestPath = (0, import_path2.join)(groupPath, requestFileName);
    try {
      await (0, import_promises2.writeFile)(requestPath, `${JSON.stringify(request, null, 2)}
`, "utf8");
      const args = splitCommandLine(custom.args || "{request}").map(
        (arg) => arg.replaceAll("{request}", requestPath).replaceAll("{group}", groupName).replaceAll("{groupPath}", groupPath)
      );
      return await runProcess({
        runnerId: `container:${groupName}:custom:${request.action}`,
        runnerName: `Custom ${groupName} ${request.action}`,
        executable: custom.executable,
        args,
        workingDirectory: groupPath,
        timeoutMs,
        signal
      });
    } finally {
      await (0, import_promises2.rm)(requestPath, { force: true });
    }
  }
  createCustomRequest(action, groupName, groupPath, config, timeoutMs, extra = {}) {
    return {
      action,
      groupName,
      groupPath,
      runtime: config.runtime,
      image: config.image,
      build: config.custom?.build,
      commandStructure: config.custom?.commandStructure,
      teardown: config.custom?.teardown,
      timeoutMs,
      config: {
        executable: config.executable,
        custom: config.custom,
        qemu: config.qemu,
        healthCheck: config.healthCheck
      },
      ...extra
    };
  }
  createSyntheticResult(runnerId, runnerName, stdout, success = true) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    return {
      runnerId,
      runnerName,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      exitCode: success ? 0 : -1,
      stdout,
      stderr: "",
      success,
      timedOut: false,
      cancelled: false
    };
  }
  getContainersPath() {
    const adapterBasePath = this.app.vault.adapter.basePath ?? "";
    return (0, import_path2.normalize)((0, import_path2.join)(adapterBasePath, this.pluginDir, "containers"));
  }
  resolveGroupPath(groupName) {
    const safeName = (0, import_path2.basename)(groupName);
    if (!safeName || safeName !== groupName) {
      throw new Error(`Invalid container group name: ${groupName}`);
    }
    return (0, import_path2.normalize)((0, import_path2.join)(this.getContainersPath(), safeName));
  }
  resolveGroupFilePath(groupPath, filePath) {
    const safePath = (0, import_path2.normalize)((0, import_path2.join)(groupPath, filePath));
    const normalizedGroupPath = (0, import_path2.normalize)(groupPath);
    const posixSafePath = safePath.replace(/\\/g, "/");
    const posixGroupPath = normalizedGroupPath.replace(/\\/g, "/");
    if (posixSafePath !== posixGroupPath && !posixSafePath.startsWith(`${posixGroupPath}/`)) {
      throw new Error(`Invalid QEMU manager path outside container group: ${filePath}`);
    }
    return safePath;
  }
  imageNameForGroup(groupName) {
    return `loom-container-${groupName.toLowerCase().replace(/[^a-z0-9_.-]/g, "-")}`;
  }
  getDefaultLanguageConfig(langId, settings) {
    if (!langId) return null;
    const normalized = langId.toLowerCase().trim();
    const custom = settings.customLanguages.find((c) => {
      const names = [c.name, ...c.aliases.split(",").map((s) => s.trim())].map((n) => n.toLowerCase());
      return names.includes(normalized);
    });
    if (custom) {
      return {
        command: `${custom.executable} ${custom.args}`.trim(),
        extension: custom.extension || ".txt"
      };
    }
    switch (normalized) {
      case "python":
      case "py":
        return {
          command: `${settings.pythonExecutable.trim() || "python3"} {file}`,
          extension: ".py"
        };
      case "javascript":
      case "js":
        return {
          command: `${settings.nodeExecutable.trim() || "node"} {file}`,
          extension: ".js"
        };
      case "typescript":
      case "ts":
        return {
          command: `${settings.typescriptTranspilerExecutable.trim() || "ts-node"} {file}`,
          extension: ".ts"
        };
      case "shell":
      case "sh":
      case "bash":
        return {
          command: `${settings.shellExecutable.trim() || "bash"} {file}`,
          extension: ".sh"
        };
      case "ruby":
      case "rb":
        return {
          command: `${settings.rubyExecutable.trim() || "ruby"} {file}`,
          extension: ".rb"
        };
      case "perl":
      case "pl":
        return {
          command: `${settings.perlExecutable.trim() || "perl"} {file}`,
          extension: ".pl"
        };
      case "lua":
        return {
          command: `${settings.luaExecutable.trim() || "lua"} {file}`,
          extension: ".lua"
        };
      case "php":
        return {
          command: `${settings.phpExecutable.trim() || "php"} {file}`,
          extension: ".php"
        };
      case "go":
        return {
          command: `${settings.goExecutable.trim() || "go"} run {file}`,
          extension: ".go"
        };
      case "haskell":
      case "hs":
        return {
          command: `${settings.haskellExecutable.trim() || "runghc"} {file}`,
          extension: ".hs"
        };
      case "ocaml":
      case "ml":
        if (settings.ocamlMode === "dune") {
          return {
            command: `${settings.ocamlExecutable.trim() || "dune"} exec -- ocaml {file}`,
            extension: ".ml"
          };
        }
        if (settings.ocamlMode === "ocamlc") {
          return {
            command: shellCommand(`${settings.ocamlExecutable.trim() || "ocamlc"} -o /tmp/loom-ocaml "$1" && /tmp/loom-ocaml`),
            extension: ".ml"
          };
        }
        return {
          command: `${settings.ocamlExecutable.trim() || "ocaml"} {file}`,
          extension: ".ml"
        };
      case "c":
        return {
          command: shellCommand(`${settings.cExecutable.trim() || "gcc"} "$1" -o /tmp/loom-c && /tmp/loom-c`),
          extension: ".c"
        };
      case "cpp":
      case "c++":
        return {
          command: shellCommand(`${settings.cppExecutable.trim() || "g++"} "$1" -o /tmp/loom-cpp && /tmp/loom-cpp`),
          extension: ".cpp"
        };
      case "ebpf":
      case "ebpf-c":
      case "bpf":
      case "bpf-c":
        return {
          command: shellCommand(`${settings.ebpfClangExecutable.trim() || "clang"} -target bpf -O2 -g -Wall "$1" -c -o /tmp/loom-ebpf.o && printf 'compiled /tmp/loom-ebpf.o\\n'`),
          extension: ".bpf.c"
        };
      case "bpftrace":
      case "bt":
        return {
          command: `${settings.bpftraceExecutable.trim() || "bpftrace"} -d {file}`,
          extension: ".bt"
        };
      case "rust":
      case "rs":
        return {
          command: shellCommand(`${settings.rustExecutable.trim() || "rustc"} "$1" -o /tmp/loom-rust && /tmp/loom-rust`),
          extension: ".rs"
        };
      case "java": {
        const compiler = settings.javaCompilerExecutable.trim() || "javac";
        return {
          command: shellCommand(`tmp=/tmp/loom-java-$$ && mkdir -p "$tmp" && cp "$1" "$tmp/Main.java" && ${compiler} "$tmp/Main.java" && ${settings.javaExecutable.trim() || "java"} -cp "$tmp" Main`),
          extension: ".java"
        };
      }
      case "llvm-ir":
      case "llvm":
      case "ll":
        return {
          command: `${settings.llvmInterpreterExecutable.trim() || "lli"} {file}`,
          extension: ".ll"
        };
      case "lean":
        return {
          command: `${settings.leanExecutable.trim() || "lean"} {file}`,
          extension: ".lean"
        };
      case "coq":
        return {
          command: `${settings.coqExecutable.trim() || "coqc"} -q {file}`,
          extension: ".v"
        };
      case "smtlib":
      case "smt":
      case "smt-lib":
        return {
          command: `${settings.smtExecutable.trim() || "z3"} {file}`,
          extension: ".smt2"
        };
    }
    return null;
  }
};
function shellCommand(command) {
  return `sh -lc ${quoteCommandArg(command)} sh {file}`;
}
function normalizeExtension(extension) {
  const trimmed = extension.trim();
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}
function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function optionalPositiveInteger(value, label) {
  if (value == null) {
    return void 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}
function optionalNonNegativeInteger(value, label) {
  if (value == null) {
    return void 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}
function optionalSignal(value, label) {
  if (value == null) {
    return void 0;
  }
  if (typeof value !== "string" || !/^SIG[A-Z0-9]+$/.test(value)) {
    throw new Error(`${label} must be a signal name like SIGTERM.`);
  }
  return value;
}
async function sleepWithSignal(durationMs, signal) {
  if (durationMs <= 0 || signal.aborted) {
    return;
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, durationMs);
    const abort = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
function runtimeLabel(runtime) {
  switch (runtime) {
    case "docker":
      return "Docker";
    case "podman":
      return "Podman";
    case "qemu":
      return "QEMU";
    case "custom":
      return "Custom";
    case "wsl":
      return "WSL";
  }
}
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function quoteCommandArg(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// src/executionContext.ts
var import_path3 = require("path");
var import_obsidian2 = require("obsidian");
function resolveExecutionContext(app, file, block, settings) {
  const note = readNoteExecutionContext(app, file);
  const defaultWorkingDirectory = resolveDefaultWorkingDirectory(file, settings);
  const noteWorkingDirectory = normalizeWorkingDirectory(note.workingDirectory);
  const blockWorkingDirectory = normalizeWorkingDirectory(block.executionContext.workingDirectory);
  const noteTimeout = note.timeoutMs;
  const blockTimeout = block.executionContext.timeoutMs;
  return {
    containerGroup: resolveContainerGroup(settings.defaultContainerGroup, note, block.executionContext),
    workingDirectory: blockWorkingDirectory ?? noteWorkingDirectory ?? defaultWorkingDirectory,
    timeoutMs: blockTimeout ?? noteTimeout ?? settings.defaultTimeoutMs,
    source: {
      container: resolveContainerSource(settings.defaultContainerGroup, note, block.executionContext),
      workingDirectory: blockWorkingDirectory ? "block" : noteWorkingDirectory ? "note" : settings.workingDirectory.trim() ? "global" : "default",
      timeout: blockTimeout ? "block" : noteTimeout ? "note" : "global"
    }
  };
}
function resolveContainerGroup(globalContainer, note, block) {
  if (block.disableContainer) {
    return void 0;
  }
  if (block.containerGroup?.trim()) {
    return block.containerGroup.trim();
  }
  if (note.disableContainer) {
    return void 0;
  }
  if (note.containerGroup?.trim()) {
    return note.containerGroup.trim();
  }
  return globalContainer.trim() || void 0;
}
function resolveContainerSource(globalContainer, note, block) {
  if (block.disableContainer || block.containerGroup?.trim()) {
    return "block";
  }
  if (note.disableContainer || note.containerGroup?.trim()) {
    return "note";
  }
  if (globalContainer.trim()) {
    return "global";
  }
  return "none";
}
function readNoteExecutionContext(app, file) {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter) {
    return {};
  }
  const container = frontmatter["loom-container"];
  const workingDirectory = frontmatter["loom-cwd"] ?? frontmatter["loom-working-directory"];
  const timeout = frontmatter["loom-timeout"];
  return {
    containerGroup: typeof container === "string" && !isDisabledValue(container) ? container.trim() : void 0,
    disableContainer: typeof container === "string" ? isDisabledValue(container) : void 0,
    workingDirectory: typeof workingDirectory === "string" ? workingDirectory : void 0,
    timeoutMs: typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0 ? Math.trunc(timeout) : typeof timeout === "string" ? parsePositiveInteger(timeout) : void 0
  };
}
function resolveDefaultWorkingDirectory(file, settings) {
  if (settings.workingDirectory.trim()) {
    return (0, import_obsidian2.normalizePath)(settings.workingDirectory.trim());
  }
  const adapterBasePath = file.vault.adapter.basePath ?? "";
  const fileFolder = (0, import_path3.dirname)(file.path);
  const resolved = fileFolder === "." ? adapterBasePath : `${adapterBasePath}/${fileFolder}`;
  return resolved || process.cwd();
}
function normalizeWorkingDirectory(value) {
  return value?.trim() ? (0, import_obsidian2.normalizePath)(value.trim()) : void 0;
}
function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : void 0;
}
function isDisabledValue(value) {
  return ["0", "false", "no", "off", "none", "native"].includes(value.trim().toLowerCase());
}

// src/llvmHighlight.ts
var import_view = require("@codemirror/view");
var LLVM_KEYWORDS = new Map([
  ...mapWords("loom-llvm-keyword-control", [
    "ret",
    "br",
    "switch",
    "indirectbr",
    "invoke",
    "callbr",
    "resume",
    "unreachable",
    "cleanupret",
    "catchret",
    "catchswitch"
  ]),
  ...mapWords("loom-llvm-keyword-declaration", [
    "define",
    "declare",
    "type",
    "global",
    "constant",
    "alias",
    "ifunc",
    "comdat",
    "attributes",
    "section",
    "gc",
    "prefix",
    "prologue",
    "personality",
    "uselistorder",
    "uselistorder_bb",
    "module",
    "asm",
    "source_filename",
    "target"
  ]),
  ...mapWords("loom-llvm-keyword-memory", [
    "alloca",
    "load",
    "store",
    "getelementptr",
    "fence",
    "cmpxchg",
    "atomicrmw",
    "extractvalue",
    "insertvalue",
    "extractelement",
    "insertelement",
    "shufflevector"
  ]),
  ...mapWords("loom-llvm-keyword-arithmetic", [
    "add",
    "sub",
    "mul",
    "udiv",
    "sdiv",
    "urem",
    "srem",
    "shl",
    "lshr",
    "ashr",
    "and",
    "or",
    "xor",
    "fneg",
    "fadd",
    "fsub",
    "fmul",
    "fdiv",
    "frem"
  ]),
  ...mapWords("loom-llvm-keyword-comparison", ["icmp", "fcmp"]),
  ...mapWords("loom-llvm-keyword-cast", [
    "trunc",
    "zext",
    "sext",
    "fptrunc",
    "fpext",
    "fptoui",
    "fptosi",
    "uitofp",
    "sitofp",
    "ptrtoint",
    "inttoptr",
    "bitcast",
    "addrspacecast"
  ]),
  ...mapWords("loom-llvm-keyword-other", ["phi", "select", "freeze", "call", "landingpad", "catchpad", "cleanuppad", "va_arg"]),
  ...mapWords("loom-llvm-keyword-modifier", [
    "private",
    "internal",
    "available_externally",
    "linkonce",
    "weak",
    "common",
    "appending",
    "extern_weak",
    "linkonce_odr",
    "weak_odr",
    "external",
    "default",
    "hidden",
    "protected",
    "dllimport",
    "dllexport",
    "dso_local",
    "dso_preemptable",
    "externally_initialized",
    "thread_local",
    "localdynamic",
    "initialexec",
    "localexec",
    "unnamed_addr",
    "local_unnamed_addr",
    "atomic",
    "unordered",
    "monotonic",
    "acquire",
    "release",
    "acq_rel",
    "seq_cst",
    "syncscope",
    "volatile",
    "singlethread",
    "ccc",
    "fastcc",
    "coldcc",
    "webkit_jscc",
    "anyregcc",
    "preserve_mostcc",
    "preserve_allcc",
    "cxx_fast_tlscc",
    "swiftcc",
    "tailcc",
    "cfguard_checkcc",
    "tail",
    "musttail",
    "notail",
    "fast",
    "nnan",
    "ninf",
    "nsz",
    "arcp",
    "contract",
    "afn",
    "reassoc",
    "nuw",
    "nsw",
    "exact",
    "inbounds",
    "to",
    "x"
  ]),
  ...mapWords("loom-llvm-predicate", [
    "eq",
    "ne",
    "ugt",
    "uge",
    "ult",
    "ule",
    "sgt",
    "sge",
    "slt",
    "sle",
    "oeq",
    "ogt",
    "oge",
    "olt",
    "ole",
    "one",
    "ord",
    "ueq",
    "une",
    "uno"
  ]),
  ...mapWords("loom-llvm-attribute", [
    "alwaysinline",
    "argmemonly",
    "builtin",
    "byref",
    "byval",
    "cold",
    "convergent",
    "dereferenceable",
    "dereferenceable_or_null",
    "distinct",
    "immarg",
    "inalloca",
    "inreg",
    "mustprogress",
    "nest",
    "noalias",
    "nocallback",
    "nocapture",
    "nofree",
    "noinline",
    "nonlazybind",
    "nonnull",
    "norecurse",
    "noredzone",
    "noreturn",
    "nosync",
    "nounwind",
    "null_pointer_is_valid",
    "opaque",
    "optnone",
    "optsize",
    "preallocated",
    "readnone",
    "readonly",
    "returned",
    "returns_twice",
    "sanitize_address",
    "sanitize_hwaddress",
    "sanitize_memory",
    "sanitize_thread",
    "signext",
    "speculatable",
    "sret",
    "ssp",
    "sspreq",
    "sspstrong",
    "swiftasync",
    "swiftself",
    "swifterror",
    "uwtable",
    "willreturn",
    "writeonly",
    "zeroext"
  ]),
  ...mapWords("loom-llvm-constant", ["true", "false", "null", "none", "undef", "poison", "zeroinitializer"])
]);
var LLVM_PRIMITIVE_TYPES = /* @__PURE__ */ new Set([
  "void",
  "label",
  "token",
  "metadata",
  "x86_mmx",
  "x86_amx",
  "half",
  "bfloat",
  "float",
  "double",
  "fp128",
  "x86_fp80",
  "ppc_fp128",
  "ptr"
]);
var PUNCTUATION_CLASS = "loom-llvm-punctuation";
function highlightLlvmElement(codeElement, source) {
  codeElement.empty();
  codeElement.addClass("loom-llvm-code");
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    appendHighlightedLine(codeElement, line);
    if (index < lines.length - 1) {
      codeElement.appendText("\n");
    }
  });
}
function addLlvmDecorations(builder, view, block) {
  const contentLineCount = getContentLineCount(block);
  if (!contentLineCount) {
    return;
  }
  const lines = block.content.split("\n");
  for (let index = 0; index < contentLineCount; index += 1) {
    const line = lines[index] ?? "";
    const tokens = tokenizeLlvmLine(line);
    if (!tokens.length) {
      continue;
    }
    const docLine = view.state.doc.line(block.startLine + 2 + index);
    for (const token of tokens) {
      if (token.from === token.to) {
        continue;
      }
      builder.add(
        docLine.from + token.from,
        docLine.from + token.to,
        import_view.Decoration.mark({ class: token.className })
      );
    }
  }
}
function appendHighlightedLine(container, line) {
  let cursor = 0;
  for (const token of tokenizeLlvmLine(line)) {
    if (token.from > cursor) {
      container.appendText(line.slice(cursor, token.from));
    }
    const span = container.createSpan({ cls: token.className });
    span.setText(line.slice(token.from, token.to));
    cursor = token.to;
  }
  if (cursor < line.length) {
    container.appendText(line.slice(cursor));
  }
}
function tokenizeLlvmLine(line) {
  const tokens = [];
  let index = 0;
  addLabelToken(line, tokens);
  while (index < line.length) {
    const current = line[index];
    if (current === ";") {
      tokens.push({ from: index, to: line.length, className: "loom-llvm-comment" });
      break;
    }
    if (/\s/.test(current)) {
      index += 1;
      continue;
    }
    const stringToken = readStringToken(line, index);
    if (stringToken) {
      if (stringToken.prefixEnd > index) {
        tokens.push({ from: index, to: stringToken.prefixEnd, className: "loom-llvm-string-prefix" });
      }
      tokens.push({ from: stringToken.valueStart, to: stringToken.valueEnd, className: "loom-llvm-string" });
      index = stringToken.valueEnd;
      continue;
    }
    const matched = matchRegexToken(line, index, /@llvm\.[A-Za-z$._0-9]+/y, "loom-llvm-intrinsic", tokens) || matchRegexToken(line, index, /@[A-Za-z$._-][A-Za-z$._0-9-]*|@\d+\b/y, "loom-llvm-global", tokens) || matchRegexToken(line, index, /%[A-Za-z$._-][A-Za-z$._0-9-]*|%\d+\b/y, "loom-llvm-local", tokens) || matchRegexToken(line, index, /![A-Za-z$._-][A-Za-z$._0-9-]*|!\d+\b/y, "loom-llvm-metadata", tokens) || matchRegexToken(line, index, /\$[A-Za-z$._-][A-Za-z$._0-9-]*/y, "loom-llvm-comdat", tokens) || matchRegexToken(line, index, /#\d+\b/y, "loom-llvm-attribute-group", tokens) || matchRegexToken(line, index, /\baddrspace\s*\(\s*\d+\s*\)/y, "loom-llvm-type", tokens) || matchRegexToken(line, index, /[-+]?0x[0-9A-Fa-f]+\b/y, "loom-llvm-number", tokens) || matchRegexToken(line, index, /[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)\b/y, "loom-llvm-number", tokens) || matchRegexToken(line, index, /[-+]?(?:\d+\.\d*|\.\d+)\b/y, "loom-llvm-number", tokens) || matchRegexToken(line, index, /[-+]?\d+\b/y, "loom-llvm-number", tokens) || matchRegexToken(line, index, /\.\.\./y, "loom-llvm-punctuation", tokens);
    if (matched) {
      index = matched;
      continue;
    }
    const word = readWord(line, index);
    if (word) {
      tokens.push({
        from: index,
        to: word.end,
        className: classifyWord(word.value)
      });
      index = word.end;
      continue;
    }
    if ("()[]{}<>,:=*".includes(current)) {
      tokens.push({ from: index, to: index + 1, className: PUNCTUATION_CLASS });
      index += 1;
      continue;
    }
    index += 1;
  }
  return normalizeTokens(tokens);
}
function addLabelToken(line, tokens) {
  const match = line.match(/^(\s*)(?:([A-Za-z$._-][A-Za-z$._0-9-]*|\d+)|(%[A-Za-z$._-][A-Za-z$._0-9-]*|%\d+))(:)/);
  if (!match || match.index == null) {
    return;
  }
  const labelStart = match[1].length;
  const labelText = match[2] ?? match[3];
  if (!labelText) {
    return;
  }
  tokens.push({
    from: labelStart,
    to: labelStart + labelText.length,
    className: "loom-llvm-label"
  });
  tokens.push({
    from: labelStart + labelText.length,
    to: labelStart + labelText.length + 1,
    className: PUNCTUATION_CLASS
  });
}
function classifyWord(word) {
  if (/^i\d+$/.test(word) || LLVM_PRIMITIVE_TYPES.has(word)) {
    return "loom-llvm-type";
  }
  return LLVM_KEYWORDS.get(word) ?? "loom-llvm-plain";
}
function readWord(line, index) {
  const match = /[A-Za-z_][A-Za-z0-9_.-]*/y;
  match.lastIndex = index;
  const result = match.exec(line);
  if (!result) {
    return null;
  }
  return {
    value: result[0],
    end: match.lastIndex
  };
}
function readStringToken(line, index) {
  let cursor = index;
  if (line[cursor] === "c" && line[cursor + 1] === '"') {
    cursor += 1;
  }
  if (line[cursor] !== '"') {
    return null;
  }
  const valueStart = cursor;
  cursor += 1;
  while (cursor < line.length) {
    if (line[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (line[cursor] === '"') {
      cursor += 1;
      break;
    }
    cursor += 1;
  }
  return {
    prefixEnd: valueStart,
    valueStart,
    valueEnd: cursor
  };
}
function matchRegexToken(line, index, regex, className, tokens) {
  regex.lastIndex = index;
  const match = regex.exec(line);
  if (!match) {
    return null;
  }
  tokens.push({ from: index, to: regex.lastIndex, className });
  return regex.lastIndex;
}
function normalizeTokens(tokens) {
  tokens.sort((left, right) => left.from - right.from || left.to - right.to);
  const normalized = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.to <= cursor) {
      continue;
    }
    const from = Math.max(token.from, cursor);
    normalized.push({ ...token, from });
    cursor = token.to;
  }
  return normalized;
}
function getContentLineCount(block) {
  if (block.endLine === block.startLine) {
    return 0;
  }
  if (block.content.length === 0) {
    return block.endLine > block.startLine + 1 ? 1 : 0;
  }
  return block.content.split("\n").length;
}
function mapWords(className, words) {
  return words.map((word) => [word, className]);
}

// src/utils/hash.ts
var import_crypto = require("crypto");
function shortHash(input) {
  return (0, import_crypto.createHash)("sha256").update(input).digest("hex").slice(0, 16);
}

// src/languagePackages.ts
var BUILT_IN_LANGUAGE_PACKAGES = [
  {
    id: "interpreted",
    displayName: "Interpreted",
    description: "Script and REPL-oriented languages for operational notes and quick experiments.",
    languages: [
      { id: "python", displayName: "Python", aliases: ["python", "py"] },
      { id: "javascript", displayName: "JavaScript", aliases: ["javascript", "js"] },
      { id: "typescript", displayName: "TypeScript", aliases: ["typescript", "ts"] },
      { id: "shell", displayName: "Shell", aliases: ["shell", "sh", "bash", "zsh"] },
      { id: "ruby", displayName: "Ruby", aliases: ["ruby", "rb"] },
      { id: "perl", displayName: "Perl", aliases: ["perl", "pl"] },
      { id: "lua", displayName: "Lua", aliases: ["lua"] },
      { id: "php", displayName: "PHP", aliases: ["php"] },
      { id: "go", displayName: "Go", aliases: ["go", "golang"] },
      { id: "haskell", displayName: "Haskell", aliases: ["haskell", "hs"] },
      { id: "ocaml", displayName: "OCaml", aliases: ["ocaml", "ml"] }
    ]
  },
  {
    id: "native-compiled",
    displayName: "Native Compiled",
    description: "Languages compiled into native binaries by local toolchains.",
    languages: [
      { id: "c", displayName: "C", aliases: ["c", "h"] },
      { id: "cpp", displayName: "C++", aliases: ["cpp", "cxx", "cc", "c++"] }
    ]
  },
  {
    id: "managed-compiled",
    displayName: "Managed Compiled",
    description: "Compiled languages with managed runtimes or structured build/run phases.",
    languages: [
      { id: "rust", displayName: "Rust", aliases: ["rust", "rs"] },
      { id: "java", displayName: "Java", aliases: ["java"] }
    ]
  },
  {
    id: "proofs",
    displayName: "Proofs",
    description: "Proof assistants and solver-oriented languages.",
    languages: [
      { id: "lean", displayName: "Lean", aliases: ["lean", "lean4"] },
      { id: "coq", displayName: "Coq", aliases: ["coq", "v"] },
      { id: "smtlib", displayName: "SMT-LIB", aliases: ["smt", "smt2", "smtlib", "smt-lib", "z3"] }
    ]
  },
  {
    id: "llvm",
    displayName: "LLVM",
    description: "LLVM IR tooling for compiler and PL research vaults.",
    languages: [
      { id: "llvm-ir", displayName: "LLVM IR", aliases: ["llvm", "llvmir", "llvm-ir", "ll"] }
    ]
  },
  {
    id: "ebpf",
    displayName: "eBPF",
    description: "Kernel instrumentation languages for BPF object compilation, verifier checks, and bpftrace scripts.",
    languages: [
      { id: "ebpf-c", displayName: "eBPF C", aliases: ["ebpf", "ebpf-c", "bpf-c", "bpf"] },
      { id: "bpftrace", displayName: "bpftrace", aliases: ["bpftrace", "bt"] }
    ]
  }
];
var CUSTOM_LANGUAGE_PACKAGE_ID = "custom";
var LANGUAGE_CONFIGURATION_VERSION = 2;
function getDefaultLanguagePackIds() {
  return [...BUILT_IN_LANGUAGE_PACKAGES.map((pack) => pack.id), CUSTOM_LANGUAGE_PACKAGE_ID];
}
function getDefaultLanguageIds() {
  return BUILT_IN_LANGUAGE_PACKAGES.flatMap((pack) => pack.languages.map((language) => language.id));
}
function normalizeLanguageConfiguration(settings) {
  if (!Array.isArray(settings.enabledLanguagePacks) || !settings.enabledLanguagePacks.length) {
    settings.enabledLanguagePacks = getDefaultLanguagePackIds();
  }
  if (!Array.isArray(settings.enabledLanguages) || !settings.enabledLanguages.length) {
    settings.enabledLanguages = getDefaultLanguageIds();
  }
  if (!Number.isFinite(settings.languageConfigurationVersion)) {
    settings.languageConfigurationVersion = 1;
  }
  if (settings.languageConfigurationVersion < 2) {
    enableLanguagePackage(settings, "ebpf");
    settings.languageConfigurationVersion = LANGUAGE_CONFIGURATION_VERSION;
  }
}
function enableLanguagePackage(settings, packageId) {
  const pack = BUILT_IN_LANGUAGE_PACKAGES.find((candidate) => candidate.id === packageId);
  if (!pack) {
    return;
  }
  appendUnique(settings.enabledLanguagePacks, pack.id);
  for (const language of pack.languages) {
    appendUnique(settings.enabledLanguages, language.id);
  }
}
function appendUnique(values, value) {
  if (!values.includes(value)) {
    values.push(value);
  }
}
function getEnabledLanguageDefinitions(settings) {
  normalizeLanguageConfiguration(settings);
  const enabledPacks = new Set(settings.enabledLanguagePacks);
  const enabledLanguages = new Set(settings.enabledLanguages);
  return BUILT_IN_LANGUAGE_PACKAGES.filter((pack) => enabledPacks.has(pack.id)).flatMap((pack) => pack.languages).filter((language) => enabledLanguages.has(language.id));
}
function getEnabledLanguageAliasMap(settings) {
  return Object.fromEntries(
    getEnabledLanguageDefinitions(settings).flatMap(
      (language) => language.aliases.map((alias) => [alias.toLowerCase(), language.id])
    )
  );
}
function isLanguageEnabled(languageId, settings) {
  normalizeLanguageConfiguration(settings);
  return getEnabledLanguageDefinitions(settings).some((language) => language.id === languageId);
}
function areCustomLanguagesEnabled(settings) {
  normalizeLanguageConfiguration(settings);
  return settings.enabledLanguagePacks.includes(CUSTOM_LANGUAGE_PACKAGE_ID);
}

// src/parser.ts
var OUTPUT_START = /^<!--\s*loom:output:start\s+id=([a-f0-9]+)\s*-->$/i;
var OUTPUT_END = /^<!--\s*loom:output:end\s*-->$/i;
var FENCE_START = /^(```+|~~~+)\s*([^\s`]*)?(.*)$/;
function normalizeLanguage(rawLanguage, settings) {
  const normalized = rawLanguage.trim().toLowerCase();
  if (!settings) {
    return null;
  }
  if (areCustomLanguagesEnabled(settings)) {
    for (const language of settings.customLanguages ?? []) {
      const name = language.name.trim().toLowerCase();
      const aliases2 = parseAliasList(language.aliases);
      if (name && (name === normalized || aliases2.includes(normalized))) {
        return language.name.trim();
      }
    }
  }
  const aliases = getEnabledLanguageAliasMap(settings);
  return aliases[normalized] ?? null;
}
function getSupportedLanguageAliases(settings) {
  if (!settings) {
    return [];
  }
  const customAliases = areCustomLanguagesEnabled(settings) ? (settings.customLanguages ?? []).flatMap((language) => {
    const name = language.name.trim().toLowerCase();
    return [name, ...parseAliasList(language.aliases)];
  }) : [];
  return [
    ...Object.keys(getEnabledLanguageAliasMap(settings)),
    ...customAliases
  ].map((alias) => alias.toLowerCase()).filter(Boolean);
}
function parseMarkdownCodeBlocks(filePath, source, settings) {
  const lines = source.split(/\r?\n/);
  const blocks = [];
  let ordinal = 0;
  let insideManagedOutput = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (insideManagedOutput) {
      if (OUTPUT_END.test(line.trim())) {
        insideManagedOutput = false;
      }
      continue;
    }
    if (OUTPUT_START.test(line.trim())) {
      insideManagedOutput = true;
      continue;
    }
    const fenceMatch = line.match(FENCE_START);
    if (!fenceMatch) {
      continue;
    }
    const startLine = i;
    const fenceIndent = getLeadingWhitespace2(line);
    const fenceToken = fenceMatch[1];
    const sourceLanguage = (fenceMatch[2] ?? "").trim();
    const infoAttributes = parseInfoAttributes(fenceMatch[3] ?? "");
    const sourceReference = parseSourceReference(infoAttributes);
    const executionContext = parseExecutionContext(infoAttributes);
    const language = normalizeLanguage(sourceLanguage, settings);
    let endLine = i;
    const contentLines = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const innerLine = lines[j];
      const trimmed = innerLine.trim();
      if (trimmed.startsWith(fenceToken) && /^(```+|~~~+)\s*$/.test(trimmed)) {
        endLine = j;
        i = j;
        break;
      }
      contentLines.push(stripFenceIndent(innerLine, fenceIndent));
      endLine = j;
    }
    if (!language) {
      continue;
    }
    ordinal += 1;
    const content = contentLines.join("\n");
    const referenceHash = sourceReference ? `:${JSON.stringify(sourceReference)}` : "";
    const executionHash = executionContextHasValues(executionContext) ? `:${JSON.stringify(executionContext)}` : "";
    const attributeHash = Object.keys(infoAttributes).length ? `:${JSON.stringify(infoAttributes)}` : "";
    const contentHash = shortHash(`${content}${referenceHash}${executionHash}${attributeHash}`);
    const id = shortHash(`${filePath}:${ordinal}:${language}:${contentHash}`);
    blocks.push({
      id,
      ordinal,
      filePath,
      language,
      languageAlias: sourceLanguage.toLowerCase(),
      sourceLanguage,
      content,
      attributes: infoAttributes,
      sourceReference,
      executionContext,
      startLine,
      endLine,
      fenceStart: 0,
      fenceEnd: 0
    });
  }
  return blocks;
}
function executionContextHasValues(context) {
  return Boolean(context.containerGroup || context.disableContainer || context.workingDirectory || context.timeoutMs);
}
function parseAliasList(value) {
  return value.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
}
function parseSourceReference(attrs) {
  const filePath = attrs["loom-file"] ?? attrs.file ?? attrs.src ?? attrs.source;
  if (!filePath) {
    return void 0;
  }
  const lines = attrs["loom-lines"] ?? attrs.lines ?? attrs.line;
  const lineRange = lines ? parseLineRange(lines) : null;
  const symbolName = attrs["loom-symbol"] ?? attrs.symbol ?? attrs.fn ?? attrs.function;
  const traceValue = attrs["loom-deps"] ?? attrs.deps ?? attrs.trace;
  const callExpression = attrs["loom-call"] ?? attrs.call;
  const callArgs = attrs["loom-args"] ?? attrs.args;
  const printValue = attrs["loom-print"] ?? attrs.print;
  const call = callExpression != null || callArgs != null ? {
    expression: normalizeBooleanAttribute(callExpression) === "true" ? void 0 : callExpression,
    args: callArgs,
    print: printValue == null ? true : !["0", "false", "no", "off"].includes(printValue.toLowerCase())
  } : void 0;
  return {
    filePath,
    lineStart: lineRange?.start,
    lineEnd: lineRange?.end,
    symbolName,
    traceDependencies: traceValue == null ? true : !["0", "false", "no", "off"].includes(traceValue.toLowerCase()),
    call
  };
}
function parseExecutionContext(attrs) {
  const container = attrs["loom-container"] ?? attrs.container;
  const timeout = attrs["loom-timeout"] ?? attrs.timeout;
  const workingDirectory = attrs["loom-cwd"] ?? attrs.cwd ?? attrs["working-directory"];
  const timeoutMs = timeout ? parsePositiveInteger2(timeout) : void 0;
  return {
    containerGroup: container && !isDisabledValue2(container) ? container : void 0,
    disableContainer: container ? isDisabledValue2(container) : void 0,
    workingDirectory,
    timeoutMs
  };
}
function parsePositiveInteger2(value) {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : void 0;
}
function isDisabledValue2(value) {
  return ["0", "false", "no", "off", "none", "native"].includes(value.trim().toLowerCase());
}
function normalizeBooleanAttribute(value) {
  return value == null ? void 0 : value.trim().toLowerCase();
}
function parseInfoAttributes(input) {
  const attrs = {};
  const pattern = /([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let match;
  while ((match = pattern.exec(input)) != null) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}
function parseLineRange(value) {
  const match = value.trim().match(/^L?(\d+)(?:\s*[-:]\s*L?(\d+))?$/i);
  if (!match) {
    return null;
  }
  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2] ?? match[1], 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
    return null;
  }
  return { start, end };
}
function findBlockAtLine(blocks, line) {
  return blocks.find((block) => line >= block.startLine && line <= block.endLine) ?? null;
}
function getLeadingWhitespace2(line) {
  const match = line.match(/^[\t ]*/);
  return match?.[0] ?? "";
}
function stripFenceIndent(line, fenceIndent) {
  if (!fenceIndent) {
    return line;
  }
  let index = 0;
  while (index < fenceIndent.length && index < line.length && line[index] === fenceIndent[index]) {
    index += 1;
  }
  return line.slice(index);
}

// src/languageCapabilities.ts
var BUILT_IN_CAPABILITIES = {
  python: {
    language: "python",
    symbolExtraction: "ast",
    dependencyTracing: "ast",
    callHarness: "built-in",
    sourcePreview: true
  },
  javascript: {
    language: "javascript",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  typescript: {
    language: "typescript",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  c: {
    language: "c",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  cpp: {
    language: "cpp",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  "llvm-ir": {
    language: "llvm-ir",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "raw",
    sourcePreview: true
  },
  haskell: {
    language: "haskell",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "raw",
    sourcePreview: true
  },
  ocaml: {
    language: "ocaml",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  java: {
    language: "java",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "raw",
    sourcePreview: true
  },
  "ebpf-c": {
    language: "ebpf-c",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "raw",
    sourcePreview: true
  },
  bpftrace: {
    language: "bpftrace",
    symbolExtraction: "generic",
    dependencyTracing: "generic",
    callHarness: "raw",
    sourcePreview: true
  }
};
function getLanguageCapability(language, hasExternalExtractor = false) {
  if (hasExternalExtractor) {
    return {
      language,
      symbolExtraction: "external",
      dependencyTracing: "external",
      callHarness: "external",
      sourcePreview: true
    };
  }
  return BUILT_IN_CAPABILITIES[language] ?? {
    language,
    symbolExtraction: "generic",
    dependencyTracing: "generic",
    callHarness: "raw",
    sourcePreview: true
  };
}

// src/runners/node.ts
var NodeRunner = class {
  constructor() {
    this.id = "node";
    this.displayName = "Node.js";
    this.languages = ["javascript", "typescript"];
  }
  canRun(block, settings) {
    if (block.language === "javascript") {
      return Boolean(settings.nodeExecutable.trim());
    }
    return Boolean(settings.typescriptTranspilerExecutable.trim());
  }
  async run(block, context, settings) {
    if (block.language === "javascript") {
      return runTempFileProcess({
        runnerId: this.id,
        runnerName: this.displayName,
        executable: settings.nodeExecutable.trim(),
        args: ["{file}"],
        fileExtension: ".js",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal,
        stdin: context.stdin
      });
    }
    const executable = settings.typescriptTranspilerExecutable.trim();
    const runnerName = settings.typescriptMode === "tsx" ? "TypeScript (tsx)" : "TypeScript (ts-node)";
    return runTempFileProcess({
      runnerId: `${this.id}:${settings.typescriptMode}`,
      runnerName,
      executable,
      args: ["{file}"],
      fileExtension: ".ts",
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
      stdin: context.stdin
    });
  }
};

// src/runners/custom.ts
var CustomLanguageRunner = class {
  constructor() {
    this.id = "custom";
    this.displayName = "Custom language";
    this.languages = [];
  }
  canRun(block, settings) {
    return Boolean(this.getCustomLanguage(block, settings)?.executable.trim());
  }
  run(block, context, settings) {
    const language = this.getCustomLanguage(block, settings);
    if (!language) {
      throw new Error(`Unsupported custom language: ${block.language}`);
    }
    return runTempFileProcess({
      runnerId: `${this.id}:${language.name}`,
      runnerName: language.name,
      executable: language.executable.trim(),
      args: splitCommandLine(language.args || "{file}"),
      fileExtension: normalizeExtension2(language.extension, language.name),
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
      stdin: context.stdin
    });
  }
  getCustomLanguage(block, settings) {
    const normalized = block.language.trim().toLowerCase();
    return settings.customLanguages.find((language) => {
      const name = language.name.trim().toLowerCase();
      const aliases = language.aliases.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
      return name === normalized || aliases.includes(normalized);
    });
  }
};
function normalizeExtension2(extension, name) {
  const trimmed = extension.trim();
  if (!trimmed) {
    return `.${name}`;
  }
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

// src/runners/interpreted.ts
var INTERPRETED_SPECS = [
  {
    language: "shell",
    displayName: "Shell",
    executable: (settings) => settings.shellExecutable,
    fileExtension: ".sh"
  },
  {
    language: "ruby",
    displayName: "Ruby",
    executable: (settings) => settings.rubyExecutable,
    fileExtension: ".rb"
  },
  {
    language: "perl",
    displayName: "Perl",
    executable: (settings) => settings.perlExecutable,
    fileExtension: ".pl"
  },
  {
    language: "lua",
    displayName: "Lua",
    executable: (settings) => settings.luaExecutable,
    fileExtension: ".lua"
  },
  {
    language: "php",
    displayName: "PHP",
    executable: (settings) => settings.phpExecutable,
    fileExtension: ".php"
  },
  {
    language: "go",
    displayName: "Go",
    executable: (settings) => settings.goExecutable,
    fileExtension: ".go",
    args: ["run", "{file}"],
    env: {
      GOCACHE: "{tempDir}/gocache"
    },
    minimumTimeoutMs: 3e4
  },
  {
    language: "haskell",
    displayName: "Haskell",
    executable: (settings) => settings.haskellExecutable,
    fileExtension: ".hs",
    minimumTimeoutMs: 3e4
  }
];
var InterpretedRunner = class {
  constructor() {
    this.id = "interpreted";
    this.displayName = "Interpreted";
    this.languages = INTERPRETED_SPECS.map((spec) => spec.language);
  }
  canRun(block, settings) {
    const spec = this.getSpec(block.language);
    return Boolean(spec?.executable(settings).trim());
  }
  run(block, context, settings) {
    const spec = this.getSpec(block.language);
    if (!spec) {
      throw new Error(`Unsupported language: ${block.language}`);
    }
    return runTempFileProcess({
      runnerId: `${this.id}:${block.language}`,
      runnerName: spec.displayName,
      executable: spec.executable(settings).trim(),
      args: spec.args ?? ["{file}"],
      fileExtension: spec.fileExtension,
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, spec.minimumTimeoutMs ?? 0),
      signal: context.signal,
      stdin: context.stdin,
      env: spec.env
    });
  }
  getSpec(language) {
    return INTERPRETED_SPECS.find((spec) => spec.language === language);
  }
};

// src/runners/ebpf.ts
var import_path4 = require("path");
var EbpfRunner = class {
  constructor() {
    this.id = "ebpf";
    this.displayName = "eBPF";
    this.languages = ["ebpf-c", "bpftrace"];
  }
  canRun(block, settings) {
    if (block.language === "ebpf-c") {
      return Boolean(settings.ebpfClangExecutable.trim());
    }
    if (block.language === "bpftrace") {
      return Boolean(settings.bpftraceExecutable.trim());
    }
    return false;
  }
  async run(block, context, settings) {
    if (block.language === "ebpf-c") {
      return this.runEbpfC(block, context, settings);
    }
    if (block.language === "bpftrace") {
      return this.runBpftrace(block, context, settings);
    }
    throw new Error(`Unsupported eBPF language: ${block.language}`);
  }
  async runEbpfC(block, context, settings) {
    const mode = readEbpfCMode(block);
    const cflags = readListAttribute(block, "loom-ebpf-cflags", "ebpf-cflags").flatMap(splitCommandLine);
    const includePaths = [
      ...splitCsv(settings.ebpfIncludePaths),
      ...readListAttribute(block, "loom-ebpf-includes", "ebpf-includes")
    ];
    return withTempSourceFile(".bpf.c", block.content, async ({ tempDir, tempFile }) => {
      const objectPath = (0, import_path4.join)(tempDir, "snippet.bpf.o");
      const compileResult = await runProcess({
        runnerId: `${this.id}:clang`,
        runnerName: "eBPF clang",
        executable: settings.ebpfClangExecutable.trim(),
        args: [
          "-target",
          "bpf",
          "-O2",
          "-g",
          "-Wall",
          ...includePaths.flatMap((includePath) => ["-I", includePath]),
          ...cflags,
          "-c",
          tempFile,
          "-o",
          objectPath
        ],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
      if (!compileResult.success) {
        return compileResult;
      }
      compileResult.stdout = appendSection(compileResult.stdout, "Compile", `eBPF object compiled successfully: ${objectPath}`);
      await this.appendObjectInspection(compileResult, objectPath, context, settings);
      if (mode === "compile") {
        return compileResult;
      }
      return this.loadEbpfObject(block, objectPath, context, settings, compileResult);
    });
  }
  async appendObjectInspection(result, objectPath, context, settings) {
    const objdump = settings.ebpfLlvmObjdumpExecutable.trim();
    if (!objdump) {
      result.warning = appendLine(result.warning, "eBPF object inspection skipped because no object inspector is configured.");
      return;
    }
    const inspect = await runProcess({
      runnerId: `${this.id}:objdump`,
      runnerName: "eBPF object inspection",
      executable: objdump,
      args: ["-h", objectPath],
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, 3e4),
      signal: context.signal
    });
    if (inspect.success) {
      result.stdout = appendSection(result.stdout, "Object sections", inspect.stdout.trim() || "(no sections reported)");
    } else {
      result.warning = appendLine(result.warning, `eBPF object inspection failed: ${inspect.stderr || inspect.stdout || `exit ${inspect.exitCode}`}`);
    }
  }
  async loadEbpfObject(block, objectPath, context, settings, compileResult) {
    if (!settings.ebpfAllowKernelLoad) {
      return {
        ...compileResult,
        success: false,
        exitCode: -1,
        stderr: appendLine(compileResult.stderr, "eBPF kernel loading is disabled. Enable Allow eBPF kernel load in settings before using loom-ebpf-mode=load.")
      };
    }
    const pinPath = readStringAttribute(block, "loom-ebpf-pin", "ebpf-pin");
    if (!pinPath) {
      return {
        ...compileResult,
        success: false,
        exitCode: -1,
        stderr: appendLine(compileResult.stderr, "loom-ebpf-mode=load requires loom-ebpf-pin=/sys/fs/bpf/<path>.")
      };
    }
    const load = await runProcess({
      runnerId: `${this.id}:bpftool:load`,
      runnerName: "bpftool eBPF load",
      executable: settings.ebpfBpftoolExecutable.trim() || "bpftool",
      args: ["-d", "prog", "loadall", objectPath, pinPath],
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, 3e4),
      signal: context.signal
    });
    load.stdout = appendSection(compileResult.stdout, "bpftool stdout", load.stdout.trim());
    load.stderr = appendSection(compileResult.stderr, "bpftool stderr", load.stderr.trim());
    load.warning = appendLine(compileResult.warning, `eBPF object load requested with pin path ${pinPath}.`);
    return load;
  }
  async runBpftrace(block, context, settings) {
    const mode = readBpftraceMode(block);
    const extraArgs = readListAttribute(block, "loom-bpftrace-args", "bpftrace-args").flatMap(splitCommandLine);
    const args = mode === "check" ? ["-d", ...extraArgs, "{file}"] : [...extraArgs, "{file}"];
    return withTempSourceFile(
      ".bt",
      block.content,
      async ({ tempFile }) => runProcess({
        runnerId: `${this.id}:bpftrace:${mode}`,
        runnerName: mode === "check" ? "bpftrace check" : "bpftrace",
        executable: settings.bpftraceExecutable.trim(),
        args: args.map((arg) => arg.replaceAll("{file}", tempFile)),
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal,
        stdin: mode === "run" ? context.stdin : void 0
      })
    );
  }
};
function readEbpfCMode(block) {
  const value = readStringAttribute(block, "loom-ebpf-mode", "ebpf-mode") || "compile";
  if (value === "compile" || value === "load") {
    return value;
  }
  throw new Error(`Unsupported eBPF mode: ${value}. Use compile or load.`);
}
function readBpftraceMode(block) {
  const value = readStringAttribute(block, "loom-bpftrace-mode", "bpftrace-mode") || "check";
  if (value === "check" || value === "run") {
    return value;
  }
  throw new Error(`Unsupported bpftrace mode: ${value}. Use check or run.`);
}
function readStringAttribute(block, primary, fallback) {
  return block.attributes[primary]?.trim() || block.attributes[fallback]?.trim() || void 0;
}
function readListAttribute(block, primary, fallback) {
  return splitCsv(readStringAttribute(block, primary, fallback) || "");
}
function splitCsv(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
function appendLine(existing, line) {
  return [existing, line].filter((part) => part?.trim()).join("\n");
}
function appendSection(existing, title, body) {
  const content = body.trim();
  if (!content) {
    return existing;
  }
  return [existing.trim(), `${title}:
${content}`].filter(Boolean).join("\n\n");
}

// src/runners/llvm.ts
var LlvmRunner = class {
  constructor() {
    this.id = "llvm-ir";
    this.displayName = "LLVM IR";
    this.languages = ["llvm-ir"];
  }
  canRun(block, settings) {
    return block.language === "llvm-ir" && Boolean(settings.llvmInterpreterExecutable.trim());
  }
  async run(block, context, settings) {
    const result = await runTempFileProcess({
      runnerId: this.id,
      runnerName: this.displayName,
      executable: settings.llvmInterpreterExecutable.trim(),
      args: ["{file}"],
      fileExtension: ".ll",
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, 3e4),
      signal: context.signal,
      stdin: context.stdin
    });
    if (!result.timedOut && !result.cancelled && result.exitCode != null && !result.stderr.trim()) {
      if (result.exitCode !== 0) {
        result.success = true;
        result.warning = `Program returned i32 ${result.exitCode}. Under lli, that becomes the process exit status.`;
      }
      if (!result.stdout.trim()) {
        result.stdout = result.exitCode === 0 ? "LLVM program exited with code 0." : `LLVM program returned i32 ${result.exitCode}.
Use stdout in the IR itself if you want printable program output.`;
      }
    }
    return result;
  }
};

// src/runners/managedCompiled.ts
var import_path5 = require("path");
var ManagedCompiledRunner = class {
  constructor() {
    this.id = "managed-compiled";
    this.displayName = "Managed compiler";
    this.languages = ["rust", "java"];
  }
  canRun(block, settings) {
    if (block.language === "rust") {
      return Boolean(settings.rustExecutable.trim());
    }
    if (block.language === "java") {
      return Boolean(settings.javaExecutable.trim());
    }
    return false;
  }
  async run(block, context, settings) {
    if (block.language === "rust") {
      return this.runRust(block, context, settings);
    }
    if (block.language === "java") {
      return this.runJava(block, context, settings);
    }
    throw new Error(`Unsupported language: ${block.language}`);
  }
  async runRust(block, context, settings) {
    return withTempSourceFile(".rs", block.content, async ({ tempDir, tempFile }) => {
      const binaryPath = (0, import_path5.join)(tempDir, "snippet.out");
      const compileResult = await runProcess({
        runnerId: `${this.id}:rust:compile`,
        runnerName: "Rust",
        executable: settings.rustExecutable.trim(),
        args: [tempFile, "-o", binaryPath],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal,
        stdin: context.stdin
      });
      if (!compileResult.success) {
        return compileResult;
      }
      return runProcess({
        runnerId: `${this.id}:rust:run`,
        runnerName: "Rust",
        executable: binaryPath,
        args: [],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    });
  }
  async runJava(block, context, settings) {
    return withNamedTempSourceFile("Main.java", block.content, async ({ tempDir, tempFile }) => {
      if (!settings.javaCompilerExecutable.trim()) {
        return runProcess({
          runnerId: `${this.id}:java:source`,
          runnerName: "Java",
          executable: settings.javaExecutable.trim(),
          args: [tempFile],
          workingDirectory: context.workingDirectory,
          timeoutMs: Math.max(context.timeoutMs, 3e4),
          signal: context.signal,
          stdin: context.stdin
        });
      }
      const compileResult = await runProcess({
        runnerId: `${this.id}:java:compile`,
        runnerName: "Java",
        executable: settings.javaCompilerExecutable.trim(),
        args: [tempFile],
        workingDirectory: tempDir,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
      if (!compileResult.success) {
        return compileResult;
      }
      return runProcess({
        runnerId: `${this.id}:java:run`,
        runnerName: "Java",
        executable: settings.javaExecutable.trim(),
        args: ["-cp", tempDir, "Main"],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal,
        stdin: context.stdin
      });
    });
  }
};

// src/runners/nativeCompiled.ts
var import_path6 = require("path");
var NativeCompiledRunner = class {
  constructor() {
    this.id = "native-compiled";
    this.displayName = "Native compiler";
    this.languages = ["c", "cpp"];
  }
  canRun(block, settings) {
    if (block.language === "c") {
      return Boolean(settings.cExecutable.trim());
    }
    if (block.language === "cpp") {
      return Boolean(settings.cppExecutable.trim());
    }
    return false;
  }
  async run(block, context, settings) {
    const executable = block.language === "c" ? settings.cExecutable.trim() : settings.cppExecutable.trim();
    const fileExtension = block.language === "c" ? ".c" : ".cpp";
    const runnerName = block.language === "c" ? "C (GCC)" : "C++ (G++)";
    return withTempSourceFile(fileExtension, block.content, async ({ tempDir, tempFile }) => {
      const binaryPath = (0, import_path6.join)(tempDir, "snippet.out");
      const compileResult = await runProcess({
        runnerId: `${this.id}:${block.language}:compile`,
        runnerName,
        executable,
        args: [tempFile, "-o", binaryPath],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal,
        stdin: context.stdin
      });
      if (!compileResult.success) {
        return compileResult;
      }
      return runProcess({
        runnerId: `${this.id}:${block.language}:run`,
        runnerName,
        executable: binaryPath,
        args: [],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    });
  }
};

// src/runners/ocaml.ts
var import_path7 = require("path");
var OcamlRunner = class {
  constructor() {
    this.id = "ocaml";
    this.displayName = "OCaml";
    this.languages = ["ocaml"];
  }
  canRun(block, settings) {
    return block.language === "ocaml" && Boolean(settings.ocamlExecutable.trim());
  }
  async run(block, context, settings) {
    const mode = settings.ocamlMode;
    const executable = settings.ocamlExecutable.trim();
    if (mode === "ocaml") {
      return runTempFileProcess({
        runnerId: `${this.id}:ocaml`,
        runnerName: "OCaml",
        executable,
        args: ["{file}"],
        fileExtension: ".ml",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal,
        stdin: context.stdin
      });
    }
    if (mode === "dune") {
      return runTempFileProcess({
        runnerId: `${this.id}:dune`,
        runnerName: "Dune / OCaml",
        executable,
        args: ["exec", "--", "ocaml", "{file}"],
        fileExtension: ".ml",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal,
        stdin: context.stdin
      });
    }
    return withTempSourceFile(".ml", block.content, async ({ tempDir, tempFile }) => {
      const binaryPath = (0, import_path7.join)(tempDir, "snippet.out");
      const compileResult = await runProcess({
        runnerId: `${this.id}:ocamlc-compile`,
        runnerName: "OCamlc",
        executable,
        args: ["-o", binaryPath, tempFile],
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal,
        stdin: context.stdin
      });
      if (!compileResult.success) {
        return compileResult;
      }
      return runProcess({
        runnerId: `${this.id}:ocamlc-run`,
        runnerName: "OCamlc",
        executable: binaryPath,
        args: [],
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
    });
  }
};

// src/runners/python.ts
var PythonRunner = class {
  constructor() {
    this.id = "python";
    this.displayName = "Python";
    this.languages = ["python"];
  }
  canRun(block, settings) {
    return block.language === "python" && Boolean(settings.pythonExecutable.trim());
  }
  run(block, context, settings) {
    return runTempFileProcess({
      runnerId: this.id,
      runnerName: this.displayName,
      executable: settings.pythonExecutable.trim(),
      args: ["{file}"],
      fileExtension: ".py",
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
      stdin: context.stdin
    });
  }
};

// src/runners/proof.ts
var import_fs2 = require("fs");
var import_path8 = require("path");
var ProofRunner = class {
  constructor() {
    this.id = "proof";
    this.displayName = "Proof checker";
    this.languages = ["lean", "coq", "smtlib"];
  }
  canRun(block, settings) {
    if (block.language === "lean") {
      return Boolean(settings.leanExecutable.trim());
    }
    if (block.language === "coq") {
      return Boolean(resolveCoqExecutable(settings).trim());
    }
    if (block.language === "smtlib") {
      return Boolean(settings.smtExecutable.trim());
    }
    return false;
  }
  run(block, context, settings) {
    if (block.language === "lean") {
      return runTempFileProcess({
        runnerId: `${this.id}:lean`,
        runnerName: "Lean",
        executable: settings.leanExecutable.trim(),
        args: ["{file}"],
        fileExtension: ".lean",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal,
        stdin: context.stdin
      });
    }
    if (block.language === "coq") {
      return runTempFileProcess({
        runnerId: `${this.id}:coq`,
        runnerName: "Coq",
        executable: resolveCoqExecutable(settings),
        args: ["-q", "{file}"],
        fileExtension: ".v",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal,
        stdin: context.stdin
      });
    }
    if (block.language === "smtlib") {
      return runTempFileProcess({
        runnerId: `${this.id}:smtlib`,
        runnerName: "SMT-LIB (Z3)",
        executable: settings.smtExecutable.trim(),
        args: ["{file}"],
        fileExtension: ".smt2",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal,
        stdin: context.stdin
      });
    }
    throw new Error(`Unsupported proof language: ${block.language}`);
  }
};
function resolveCoqExecutable(settings) {
  const configured = settings.coqExecutable.trim();
  if (configured && configured !== "coqc") {
    return configured;
  }
  const opamCoqc = (0, import_path8.join)(process.env.HOME ?? "", ".opam", "default", "bin", "coqc");
  return (0, import_fs2.existsSync)(opamCoqc) ? opamCoqc : configured || "coqc";
}

// src/runners/registry.ts
var loomRunnerRegistry = class {
  constructor(runners) {
    this.runners = runners;
  }
  getRunnerForBlock(block, settings) {
    if (!this.isBlockLanguageEnabled(block, settings)) {
      return null;
    }
    return this.runners.find((runner) => (!runner.languages.length || runner.languages.includes(block.language)) && runner.canRun(block, settings)) ?? null;
  }
  getSupportedLanguages() {
    return [...new Set(this.runners.flatMap((runner) => runner.languages))];
  }
  isBlockLanguageEnabled(block, settings) {
    if (isLanguageEnabled(block.language, settings)) {
      return true;
    }
    return areCustomLanguagesEnabled(settings) && settings.customLanguages.some((language) => {
      const name = language.name.trim().toLowerCase();
      const aliases = language.aliases.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
      return name === block.language.trim().toLowerCase() || aliases.includes(block.languageAlias.trim().toLowerCase());
    });
  }
};

// src/defaultSettings.ts
var DEFAULT_SETTINGS = {
  enableLocalExecution: false,
  hasAcknowledgedExecutionRisk: false,
  preserveSourceMode: true,
  defaultTimeoutMs: 8e3,
  workingDirectory: "",
  pythonExecutable: "python3",
  nodeExecutable: "node",
  typescriptMode: "ts-node",
  typescriptTranspilerExecutable: "ts-node",
  ocamlMode: "ocaml",
  ocamlExecutable: "ocaml",
  cExecutable: "gcc",
  cppExecutable: "g++",
  shellExecutable: "bash",
  rubyExecutable: "ruby",
  perlExecutable: "perl",
  luaExecutable: "lua",
  phpExecutable: "php",
  goExecutable: "go",
  rustExecutable: "rustc",
  haskellExecutable: "runghc",
  javaCompilerExecutable: "",
  javaExecutable: "java",
  llvmInterpreterExecutable: "lli",
  ebpfClangExecutable: "clang",
  ebpfBpftoolExecutable: "bpftool",
  ebpfLlvmObjdumpExecutable: "llvm-objdump",
  ebpfIncludePaths: "",
  ebpfAllowKernelLoad: false,
  bpftraceExecutable: "bpftrace",
  leanExecutable: "lean",
  coqExecutable: "coqc",
  smtExecutable: "z3",
  writeOutputToNote: false,
  outputVisibleLines: 0,
  autoRunOnFileOpen: false,
  extractedSourcePreviewMode: "collapsed",
  showLanguageCapabilityMetadata: true,
  languageConfigurationVersion: 2,
  enabledLanguagePacks: getDefaultLanguagePackIds(),
  enabledLanguages: getDefaultLanguageIds(),
  customLanguages: [],
  pdfExportMode: "both",
  defaultContainerGroup: ""
};

// src/settings.ts
var import_obsidian3 = require("obsidian");
var loomSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(loomPlugin2) {
    super(loomPlugin2.app, loomPlugin2);
    this.loomPlugin = loomPlugin2;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "loom" });
    containerEl.createEl("p", { text: "Run supported code fences directly from notes while preserving native syntax highlighting." });
    this.renderGeneralSettings(this.createSection(containerEl, "General Settings", true));
    this.renderLanguagePackages(this.createSection(containerEl, "Language Packages"));
    this.renderBuiltInRuntimes(this.createSection(containerEl, "Built-in Runtimes"));
    this.renderCustomLanguages(this.createSection(containerEl, "Custom Languages"));
    void this.renderContainerGroups(this.createSection(containerEl, "Containerization Groups"));
  }
  createSection(containerEl, title, open = false) {
    const details = containerEl.createEl("details", { cls: "loom-settings-section" });
    details.open = open;
    details.createEl("summary", { text: title, cls: "loom-settings-summary" });
    return details.createDiv({ cls: "loom-settings-section-body" });
  }
  renderGeneralSettings(containerEl) {
    new import_obsidian3.Setting(containerEl).setName("Enable local execution").setDesc("Disabled by default. loom runs code on your local machine and does not provide sandboxing.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.enableLocalExecution).onChange(async (value) => {
        this.loomPlugin.settings.enableLocalExecution = value;
        if (value) {
          this.loomPlugin.settings.hasAcknowledgedExecutionRisk = true;
        }
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Keep loom notes in source mode").setDesc("Preserve raw fenced code in the editor instead of letting live preview collapse research snippets.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.preserveSourceMode).onChange(async (value) => {
        this.loomPlugin.settings.preserveSourceMode = value;
        await this.loomPlugin.saveSettings();
        if (value) {
          void this.loomPlugin.enforceSourceModeForActiveView();
        } else {
          void this.loomPlugin.disableSourceModeForActiveView();
        }
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Default timeout").setDesc("Maximum execution time in milliseconds before loom terminates the process.").addText(
      (text) => text.setPlaceholder("8000").setValue(String(this.loomPlugin.settings.defaultTimeoutMs)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          this.loomPlugin.settings.defaultTimeoutMs = parsed;
          await this.loomPlugin.saveSettings();
        }
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Working directory").setDesc("Optional. Empty uses the current note folder when possible, otherwise the vault root.").addText(
      (text) => text.setPlaceholder("Vault root").setValue(this.loomPlugin.settings.workingDirectory).onChange(async (value) => {
        this.loomPlugin.settings.workingDirectory = value.trim() ? (0, import_obsidian3.normalizePath)(value.trim()) : "";
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Write output back to note").setDesc("Insert managed loom output sections beneath code blocks instead of keeping results purely in the UI.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.writeOutputToNote).onChange(async (value) => {
        this.loomPlugin.settings.writeOutputToNote = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Visible output lines").setDesc("Limit each stdout, stderr, and warning panel to this many visible lines. Use 0 for unlimited output.").addText(
      (text) => text.setPlaceholder("0").setValue(String(this.loomPlugin.settings.outputVisibleLines ?? 0)).onChange(async (value) => {
        const parsed = Number.parseInt(value.trim(), 10);
        if (!Number.isNaN(parsed) && parsed >= 0) {
          this.loomPlugin.settings.outputVisibleLines = Math.min(parsed, 2e3);
          await this.loomPlugin.saveSettings();
        }
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Auto-run on file open").setDesc("Run all supported blocks in the active note when it opens. Disabled by default.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.autoRunOnFileOpen).onChange(async (value) => {
        this.loomPlugin.settings.autoRunOnFileOpen = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Extracted source preview").setDesc("Choose how loom shows the materialized source for blocks that use loom-file.").addDropdown(
      (dropdown) => dropdown.addOption("collapsed", "Collapsed").addOption("expanded", "Expanded").addOption("hidden", "Hidden").setValue(this.loomPlugin.settings.extractedSourcePreviewMode || "collapsed").onChange(async (value) => {
        this.loomPlugin.settings.extractedSourcePreviewMode = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Show capability metadata").setDesc("Show symbol, dependency, and harness capability metadata in extracted source preview headers.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.showLanguageCapabilityMetadata ?? true).onChange(async (value) => {
        this.loomPlugin.settings.showLanguageCapabilityMetadata = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("PDF export mode").setDesc("Choose what to include when exporting notes containing loom code blocks to PDF.").addDropdown(
      (dropdown) => dropdown.addOption("both", "Both Code and Output").addOption("code", "Code Block Only").addOption("output", "Output Only").setValue(this.loomPlugin.settings.pdfExportMode || "both").onChange(async (value) => {
        this.loomPlugin.settings.pdfExportMode = value;
        await this.loomPlugin.saveSettings();
      })
    );
  }
  renderBuiltInRuntimes(containerEl) {
    if (this.isRuntimeLanguageEnabled("python")) {
      this.addTextSetting(containerEl, "Python executable", "Path or command name for Python.", "pythonExecutable");
    }
    if (this.isRuntimeLanguageEnabled("javascript")) {
      this.addTextSetting(containerEl, "Node executable", "Path or command name for JavaScript execution.", "nodeExecutable");
    }
    if (this.isRuntimeLanguageEnabled("typescript")) {
      new import_obsidian3.Setting(containerEl).setName("TypeScript runner mode").setDesc("Use ts-node or tsx for TypeScript blocks.").addDropdown(
        (dropdown) => dropdown.addOption("ts-node", "ts-node").addOption("tsx", "tsx").setValue(this.loomPlugin.settings.typescriptMode).onChange(async (value) => {
          this.loomPlugin.settings.typescriptMode = value;
          await this.loomPlugin.saveSettings();
        })
      );
      this.addTextSetting(containerEl, "TypeScript transpiler executable", "Command or path for ts-node or tsx.", "typescriptTranspilerExecutable");
    }
    if (this.isRuntimeLanguageEnabled("ocaml")) {
      new import_obsidian3.Setting(containerEl).setName("OCaml mode").setDesc("Choose between the OCaml toplevel, ocamlc compilation, or dune exec.").addDropdown(
        (dropdown) => dropdown.addOption("ocaml", "ocaml").addOption("ocamlc", "ocamlc").addOption("dune", "dune").setValue(this.loomPlugin.settings.ocamlMode).onChange(async (value) => {
          this.loomPlugin.settings.ocamlMode = value;
          await this.loomPlugin.saveSettings();
        })
      );
      this.addTextSetting(containerEl, "OCaml executable", "Command or path for ocaml, ocamlc, or dune depending on the selected mode.", "ocamlExecutable");
    }
    this.addRuntimeTextSetting(containerEl, ["c"], "C compiler", "Command or path for compiling C blocks.", "cExecutable");
    this.addRuntimeTextSetting(containerEl, ["cpp"], "C++ compiler", "Command or path for compiling C++ blocks.", "cppExecutable");
    this.addRuntimeTextSetting(containerEl, ["shell"], "Shell executable", "Command or path for Shell, Bash, and sh blocks.", "shellExecutable");
    this.addRuntimeTextSetting(containerEl, ["ruby"], "Ruby executable", "Command or path for Ruby blocks.", "rubyExecutable");
    this.addRuntimeTextSetting(containerEl, ["perl"], "Perl executable", "Command or path for Perl blocks.", "perlExecutable");
    this.addRuntimeTextSetting(containerEl, ["lua"], "Lua executable", "Command or path for Lua blocks.", "luaExecutable");
    this.addRuntimeTextSetting(containerEl, ["php"], "PHP executable", "Command or path for PHP blocks.", "phpExecutable");
    this.addRuntimeTextSetting(containerEl, ["go"], "Go executable", "Command or path for Go blocks.", "goExecutable");
    this.addRuntimeTextSetting(containerEl, ["rust"], "Rust compiler", "Command or path for compiling Rust blocks.", "rustExecutable");
    this.addRuntimeTextSetting(containerEl, ["haskell"], "Haskell executable", "Command or path for Haskell blocks. Defaults to runghc.", "haskellExecutable");
    if (this.isRuntimeLanguageEnabled("java")) {
      this.addTextSetting(containerEl, "Java compiler", "Optional command or path for javac. Leave empty to use Java source-file mode.", "javaCompilerExecutable");
      this.addTextSetting(containerEl, "Java executable", "Command or path for running compiled Java blocks.", "javaExecutable");
    }
    this.addRuntimeTextSetting(containerEl, ["llvm-ir"], "LLVM IR interpreter", "Command or path for running LLVM IR blocks with lli.", "llvmInterpreterExecutable");
    if (this.isRuntimeLanguageEnabled("ebpf-c")) {
      this.addTextSetting(containerEl, "eBPF clang executable", "Command or path for clang with BPF target support.", "ebpfClangExecutable");
      this.addTextSetting(containerEl, "eBPF bpftool executable", "Command or path for bpftool verifier and load operations.", "ebpfBpftoolExecutable");
      this.addTextSetting(containerEl, "eBPF object inspector", "Command or path for llvm-objdump. Leave empty to skip object section inspection.", "ebpfLlvmObjdumpExecutable");
      this.addTextSetting(containerEl, "eBPF include paths", "Comma-separated include directories passed to clang with -I.", "ebpfIncludePaths");
      new import_obsidian3.Setting(containerEl).setName("Allow eBPF kernel load").setDesc("Required before any block can use loom-ebpf-mode=load. Compile-only mode stays available without this.").addToggle(
        (toggle) => toggle.setValue(this.loomPlugin.settings.ebpfAllowKernelLoad).onChange(async (value) => {
          this.loomPlugin.settings.ebpfAllowKernelLoad = value;
          await this.loomPlugin.saveSettings();
        })
      );
    }
    this.addRuntimeTextSetting(containerEl, ["bpftrace"], "bpftrace executable", "Command or path for bpftrace scripts.", "bpftraceExecutable");
    this.addRuntimeTextSetting(containerEl, ["lean"], "Lean executable", "Command or path for checking Lean blocks.", "leanExecutable");
    this.addRuntimeTextSetting(containerEl, ["coq"], "Coq executable", "Command or path for checking Coq blocks with coqc.", "coqExecutable");
    this.addRuntimeTextSetting(containerEl, ["smtlib"], "SMT solver", "Command or path for SMT-LIB blocks. Defaults to z3.", "smtExecutable");
  }
  addRuntimeTextSetting(containerEl, languageIds, name, description, key) {
    if (languageIds.some((languageId) => this.isRuntimeLanguageEnabled(languageId))) {
      this.addTextSetting(containerEl, name, description, key);
    }
  }
  isRuntimeLanguageEnabled(languageId) {
    return isLanguageEnabled(languageId, this.loomPlugin.settings);
  }
  renderLanguagePackages(containerEl) {
    normalizeLanguageConfiguration(this.loomPlugin.settings);
    for (const pack of BUILT_IN_LANGUAGE_PACKAGES) {
      const packEl = containerEl.createEl("details", { cls: "loom-language-package" });
      packEl.open = this.loomPlugin.settings.enabledLanguagePacks.includes(pack.id);
      packEl.createEl("summary", { text: pack.displayName });
      packEl.createEl("p", { text: pack.description, cls: "setting-item-description" });
      new import_obsidian3.Setting(packEl).setName("Enable package").setDesc("Disable this to remove the package languages from parsing, command menus, and runners for this vault.").addToggle(
        (toggle) => toggle.setValue(this.loomPlugin.settings.enabledLanguagePacks.includes(pack.id)).onChange(async (value) => {
          this.setEnabledValue(this.loomPlugin.settings.enabledLanguagePacks, pack.id, value);
          for (const language of pack.languages) {
            this.setEnabledValue(this.loomPlugin.settings.enabledLanguages, language.id, value);
          }
          await this.loomPlugin.saveSettings();
          this.display();
        })
      );
      const packageEnabled = this.loomPlugin.settings.enabledLanguagePacks.includes(pack.id);
      for (const language of pack.languages) {
        new import_obsidian3.Setting(packEl).setName(language.displayName).setDesc(`Aliases: ${language.aliases.join(", ")}`).addToggle(
          (toggle) => toggle.setDisabled(!packageEnabled).setValue(packageEnabled && this.loomPlugin.settings.enabledLanguages.includes(language.id)).onChange(async (value) => {
            this.setEnabledValue(this.loomPlugin.settings.enabledLanguages, language.id, value);
            await this.loomPlugin.saveSettings();
          })
        );
      }
    }
    new import_obsidian3.Setting(containerEl).setName("Custom languages").setDesc("Enable user-defined languages from the Custom Languages section.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.enabledLanguagePacks.includes(CUSTOM_LANGUAGE_PACKAGE_ID)).onChange(async (value) => {
        this.setEnabledValue(this.loomPlugin.settings.enabledLanguagePacks, CUSTOM_LANGUAGE_PACKAGE_ID, value);
        await this.loomPlugin.saveSettings();
        this.display();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Reset language packages").setDesc("Re-enable every built-in package and every built-in language.").addButton(
      (button) => button.setButtonText("Reset").onClick(async () => {
        this.loomPlugin.settings.enabledLanguagePacks = getDefaultLanguagePackIds();
        this.loomPlugin.settings.enabledLanguages = getDefaultLanguageIds();
        await this.loomPlugin.saveSettings();
        this.display();
      })
    );
  }
  setEnabledValue(values, id, enabled) {
    const index = values.indexOf(id);
    if (enabled && index < 0) {
      values.push(id);
    } else if (!enabled && index >= 0) {
      values.splice(index, 1);
    }
  }
  renderCustomLanguages(containerEl) {
    const listEl = containerEl.createDiv({ cls: "loom-custom-language-list" });
    this.renderCustomLanguageList(listEl);
    new import_obsidian3.Setting(containerEl).setName("Add custom language").setDesc("Create a new local command-backed language.").addButton(
      (button) => button.setButtonText("+").onClick(async () => {
        this.loomPlugin.settings.customLanguages.push({
          name: "custom-language",
          aliases: "",
          executable: "",
          args: "{file}",
          extension: ".txt",
          extractorMode: "command",
          extractorExecutable: "",
          extractorArgs: "{request}",
          transpileExecutable: "",
          transpileArgs: "{request}"
        });
        await this.loomPlugin.saveSettings();
        this.display();
      })
    );
  }
  renderCustomLanguageList(containerEl) {
    containerEl.empty();
    if (!this.loomPlugin.settings.customLanguages.length) {
      containerEl.createEl("p", {
        text: "No custom languages configured.",
        cls: "setting-item-description"
      });
      return;
    }
    this.loomPlugin.settings.customLanguages.forEach((language, index) => {
      const details = containerEl.createEl("details", { cls: "loom-custom-language" });
      details.open = true;
      details.createEl("summary", { text: language.name || `Custom language ${index + 1}` });
      const body = details.createDiv({ cls: "loom-custom-language-body" });
      this.addCustomLanguageTextSetting(body, language, "Name", "Normalized language id used by loom.", "name");
      this.addCustomLanguageTextSetting(body, language, "Aliases", "Comma-separated fence aliases.", "aliases");
      this.addCustomLanguageTextSetting(body, language, "Executable", "Local command or absolute executable path.", "executable");
      this.addCustomLanguageTextSetting(body, language, "Arguments", "Space-separated arguments. Use {file} for the temp source file.", "args");
      this.addCustomLanguageTextSetting(body, language, "Extension", "Temp source file extension, for example .py.", "extension");
      new import_obsidian3.Setting(body).setName("Partial extraction strategy").setDesc("Choose how this custom language supports partial runnable source.").addDropdown(
        (dropdown) => dropdown.addOption("command", "Extractor command").addOption("transpile-c", "Transpile to C").setValue(language.extractorMode || "command").onChange(async (value) => {
          language.extractorMode = value;
          await this.loomPlugin.saveSettings();
        })
      );
      this.addCustomLanguageTextSetting(body, language, "Extractor executable", "Optional command for partial source extraction. Leave empty to use generic line and symbol extraction.", "extractorExecutable");
      this.addCustomLanguageTextSetting(body, language, "Extractor arguments", "Arguments for the extractor. Use {request}, {source}, {harness}, {symbol}, {lineStart}, {lineEnd}, {deps}, and {language}.", "extractorArgs");
      this.addCustomLanguageTextSetting(body, language, "Transpile to C executable", "Optional command that emits generated C and a symbol map as JSON.", "transpileExecutable");
      this.addCustomLanguageTextSetting(body, language, "Transpile to C arguments", "Arguments for the transpiler. Use the same placeholders as extractor arguments.", "transpileArgs");
      new import_obsidian3.Setting(body).setName("Delete language").setDesc("Remove this custom language.").addButton(
        (button) => button.setButtonText("Delete").setWarning().onClick(async () => {
          this.loomPlugin.settings.customLanguages.splice(index, 1);
          await this.loomPlugin.saveSettings();
          this.display();
        })
      );
    });
  }
  async renderContainerGroups(containerEl) {
    try {
      const groups = await this.loomPlugin.getContainerGroupSummaries();
      new import_obsidian3.Setting(containerEl).setName("Default containerization group").setDesc("The container group to run code blocks in by default if the note does not specify one.").addDropdown((dropdown) => {
        dropdown.addOption("", "None");
        for (const group of groups) {
          dropdown.addOption(group.name, group.name);
        }
        dropdown.setValue(this.loomPlugin.settings.defaultContainerGroup || "");
        dropdown.onChange(async (value) => {
          this.loomPlugin.settings.defaultContainerGroup = value;
          await this.loomPlugin.saveSettings();
        });
      });
      new import_obsidian3.Setting(containerEl).setName("Add new containerization group").setDesc("Create a new containerization group configuration folder.").addButton(
        (button) => button.setButtonText("+").onClick(() => {
          new ContainerGroupNameModal(this.app, async (groupName) => {
            const cleanName = groupName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
            if (!cleanName) {
              new import_obsidian3.Notice("Invalid group name.");
              return;
            }
            const pluginDir = this.loomPlugin.manifest.dir ?? ".obsidian/plugins/loom";
            const groupRelativePath = `${pluginDir}/containers/${cleanName}`;
            const configPath = `${groupRelativePath}/config.json`;
            const adapter = this.app.vault.adapter;
            if (await adapter.exists(groupRelativePath)) {
              new import_obsidian3.Notice("Container group folder already exists.");
              return;
            }
            await adapter.mkdir(groupRelativePath);
            const defaultConfig = {
              runtime: "docker",
              image: "ubuntu:latest",
              languages: {
                python: {
                  command: "python3 {file}",
                  extension: ".py"
                }
              }
            };
            await adapter.write(configPath, JSON.stringify(defaultConfig, null, 2));
            new import_obsidian3.Notice(`Container group "${cleanName}" created.`);
            this.display();
          }).open();
        })
      );
      const listEl = containerEl.createDiv({ cls: "loom-container-group-list" });
      if (!groups.length) {
        listEl.createEl("p", {
          text: "No container groups found in .obsidian/plugins/loom/containers.",
          cls: "setting-item-description"
        });
        return;
      }
      for (const group of groups) {
        new import_obsidian3.Setting(listEl).setName(group.name).setDesc(group.status).addButton(
          (button) => button.setButtonText("Build / rebuild").onClick(async () => {
            await this.loomPlugin.buildContainerGroup(group.name);
          })
        ).addButton(
          (button) => button.setButtonText("Edit").onClick(() => {
            const pluginDir = this.loomPlugin.manifest.dir ?? ".obsidian/plugins/loom";
            new EditContainerGroupModal(this.loomPlugin, group.name, pluginDir, () => {
              this.display();
            }).open();
          })
        );
      }
    } catch (error) {
      containerEl.empty();
      containerEl.createEl("p", {
        text: `Error loading container groups: ${error instanceof Error ? error.message : String(error)}`,
        cls: "loom-settings-error",
        attr: { style: "color: var(--text-error); font-weight: bold; margin: 1em 0;" }
      });
      console.error("loom: failed to render container groups:", error);
    }
  }
  addTextSetting(containerEl, name, description, key) {
    new import_obsidian3.Setting(containerEl).setName(name).setDesc(description).addText(
      (text) => text.setValue(String(this.loomPlugin.settings[key] ?? "")).onChange(async (value) => {
        this.loomPlugin.settings[key] = value.trim();
        await this.loomPlugin.saveSettings();
      })
    );
  }
  addCustomLanguageTextSetting(containerEl, language, name, description, key) {
    new import_obsidian3.Setting(containerEl).setName(name).setDesc(description).addText(
      (text) => text.setValue(String(language[key] ?? "")).onChange(async (value) => {
        language[key] = value.trim();
        await this.loomPlugin.saveSettings();
      })
    );
  }
};
function showExecutionDisabledNotice() {
  new import_obsidian3.Notice("loom local execution is disabled. Enable it in settings or confirm the execution warning first.");
}
var ContainerGroupNameModal = class extends import_obsidian3.Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
    this.name = "";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "New Container Group Name" });
    new import_obsidian3.Setting(contentEl).setName("Group Name").setDesc("Use lowercase letters, numbers, hyphens, and underscores.").addText(
      (text) => text.onChange((value) => {
        this.name = value;
      })
    );
    new import_obsidian3.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("Create").setCta().onClick(async () => {
        await this.onSubmit(this.name);
        this.close();
      })
    );
  }
};
var EditContainerGroupModal = class extends import_obsidian3.Modal {
  constructor(loomPlugin2, groupName, pluginDir, onSave) {
    super(loomPlugin2.app);
    this.loomPlugin = loomPlugin2;
    this.groupName = groupName;
    this.pluginDir = pluginDir;
    this.onSave = onSave;
    this.activeTab = "general";
    this.configObj = {};
    this.rawJsonText = "";
    this.dockerfileText = null;
    this.newLanguageName = "";
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `Edit Config: ${this.groupName}` });
    const configPath = `${this.pluginDir}/containers/${this.groupName}/config.json`;
    const dockerfilePath = `${this.pluginDir}/containers/${this.groupName}/Dockerfile`;
    const adapter = this.app.vault.adapter;
    try {
      const rawConfig = await adapter.read(configPath);
      this.configObj = JSON.parse(rawConfig);
      this.rawJsonText = rawConfig;
    } catch (e) {
      new import_obsidian3.Notice("Could not read configuration file.");
      this.close();
      return;
    }
    try {
      if (await adapter.exists(dockerfilePath)) {
        this.dockerfileText = await adapter.read(dockerfilePath);
      } else {
        this.dockerfileText = null;
      }
    } catch (e) {
      this.dockerfileText = null;
    }
    const container = contentEl.createDiv({ cls: "loom-tab-container" });
    this.tabHeaderEl = container.createDiv({ cls: "loom-tab-header" });
    this.renderTabs();
    this.tabContentEl = container.createDiv({ cls: "loom-tab-content" });
    const actions = contentEl.createDiv({ cls: "loom-modal-actions" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const saveBtn = actions.createEl("button", { text: "Save", cls: "mod-cta" });
    saveBtn.addEventListener("click", async () => {
      await this.saveAndClose();
    });
    this.renderActiveTab();
  }
  renderTabs() {
    this.tabHeaderEl.empty();
    const tabs = [
      { id: "general", label: "General" },
      { id: "languages", label: "Languages" },
      { id: "dockerfile", label: "Dockerfile" },
      { id: "raw", label: "Raw JSON" }
    ];
    for (const tab of tabs) {
      const btn = this.tabHeaderEl.createEl("button", {
        text: tab.label,
        cls: "loom-tab-btn" + (this.activeTab === tab.id ? " is-active" : "")
      });
      btn.addEventListener("click", () => {
        void this.switchTab(tab.id);
      });
    }
  }
  async switchTab(tab) {
    if (this.activeTab === "raw") {
      try {
        this.configObj = JSON.parse(this.rawJsonText);
      } catch (e) {
        new import_obsidian3.Notice("Invalid JSON syntax in Raw JSON tab. Please fix it before switching.");
        return;
      }
    }
    this.activeTab = tab;
    this.renderTabs();
    this.renderActiveTab();
  }
  renderActiveTab() {
    this.tabContentEl.empty();
    if (this.activeTab === "general") {
      this.renderGeneralTab(this.tabContentEl);
    } else if (this.activeTab === "languages") {
      this.renderLanguagesTab(this.tabContentEl);
    } else if (this.activeTab === "dockerfile") {
      this.renderDockerfileTab(this.tabContentEl);
    } else if (this.activeTab === "raw") {
      this.renderRawTab(this.tabContentEl);
    }
  }
  renderGeneralTab(containerEl) {
    new import_obsidian3.Setting(containerEl).setName("Runtime").setDesc("Choose the container/environment manager runtime.").addDropdown((dropdown) => {
      dropdown.addOption("docker", "Docker").addOption("podman", "Podman").addOption("wsl", "WSL").addOption("qemu", "QEMU").addOption("custom", "Custom").setValue(this.configObj.runtime || "docker").onChange((value) => {
        this.configObj.runtime = value;
        this.renderActiveTab();
      });
    });
    if (this.configObj.runtime === "docker" || this.configObj.runtime === "podman" || this.configObj.runtime === "wsl") {
      new import_obsidian3.Setting(containerEl).setName(this.configObj.runtime === "wsl" ? "WSL Distro" : "Base Image").setDesc(
        this.configObj.runtime === "wsl" ? "Optional. The target WSL distro name (leave empty for default distro)." : "Fallback Docker/Podman image if no Dockerfile is present."
      ).addText((text) => {
        text.setValue(this.configObj.image || "").onChange((val) => {
          this.configObj.image = val.trim();
        });
      });
    }
    if (this.configObj.runtime === "wsl") {
      if (!this.configObj.wsl) {
        this.configObj.wsl = {};
      }
      new import_obsidian3.Setting(containerEl).setName("Use Interactive Shell").setDesc("Use interactive login shell flags (-i -l) to ensure ~/.bashrc initialization works (e.g., for NVM).").addToggle((toggle) => {
        toggle.setValue(this.configObj.wsl.interactive ?? false).onChange((val) => {
          this.configObj.wsl.interactive = val;
        });
      });
    }
    if (this.configObj.runtime === "qemu") {
      if (!this.configObj.qemu) {
        this.configObj.qemu = { sshTarget: "", remoteWorkspace: "" };
      }
      new import_obsidian3.Setting(containerEl).setName("SSH Target").setDesc("SSH target address (e.g. user@hostname or localhost -p 2222).").addText((text) => {
        text.setValue(this.configObj.qemu.sshTarget || "").onChange((val) => {
          this.configObj.qemu.sshTarget = val.trim();
        });
      });
      new import_obsidian3.Setting(containerEl).setName("Remote Workspace").setDesc("Remote folder path to copy code snippets and run commands (e.g., /home/user/workspace).").addText((text) => {
        text.setValue(this.configObj.qemu.remoteWorkspace || "").onChange((val) => {
          this.configObj.qemu.remoteWorkspace = val.trim();
        });
      });
      new import_obsidian3.Setting(containerEl).setName("SSH Executable").setDesc("Optional. Path to SSH client executable (defaults to ssh).").addText((text) => {
        text.setValue(this.configObj.qemu.sshExecutable || "").onChange((val) => {
          this.configObj.qemu.sshExecutable = val.trim() || void 0;
        });
      });
      new import_obsidian3.Setting(containerEl).setName("SSH Arguments").setDesc("Optional. Additional SSH CLI flags.").addText((text) => {
        text.setValue(this.configObj.qemu.sshArgs || "").onChange((val) => {
          this.configObj.qemu.sshArgs = val.trim() || void 0;
        });
      });
    }
    if (this.configObj.runtime === "custom") {
      if (!this.configObj.custom) {
        this.configObj.custom = { executable: "" };
      }
      new import_obsidian3.Setting(containerEl).setName("Custom Executable").setDesc("Path to custom runtime wrapper executable or script.").addText((text) => {
        text.setValue(this.configObj.custom.executable || "").onChange((val) => {
          this.configObj.custom.executable = val.trim();
        });
      });
      new import_obsidian3.Setting(containerEl).setName("Custom Arguments").setDesc("Optional. Command arguments. Use {request} for JSON config path.").addText((text) => {
        text.setValue(this.configObj.custom.args || "").onChange((val) => {
          this.configObj.custom.args = val.trim() || void 0;
        });
      });
    }
  }
  renderLanguagesTab(containerEl) {
    containerEl.createEl("h3", { text: "Configured Languages" });
    if (!this.configObj.languages) {
      this.configObj.languages = {};
    }
    const langsListEl = containerEl.createDiv({ cls: "loom-languages-list" });
    const languages = Object.entries(this.configObj.languages);
    if (languages.length === 0) {
      langsListEl.createEl("p", { text: "No languages configured for this group.", cls: "setting-item-description" });
    } else {
      for (const [langName, langConfig] of languages) {
        const card = langsListEl.createDiv({ cls: "loom-language-card" });
        card.createEl("strong", { text: langName, attr: { style: "display: block; margin-bottom: 0.5rem; font-size: 1.1em;" } });
        const isDefault = langConfig.useDefault === true;
        new import_obsidian3.Setting(card).setName("Use default configuration").setDesc("If checked, Loom will run this language using its built-in commands/extensions.").addToggle((toggle) => {
          toggle.setValue(isDefault).onChange((val) => {
            if (val) {
              langConfig.useDefault = true;
              delete langConfig.command;
              delete langConfig.extension;
            } else {
              delete langConfig.useDefault;
              const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
              langConfig.command = defaults?.command || "";
              langConfig.extension = defaults?.extension || "";
            }
            this.renderActiveTab();
          });
        });
        new import_obsidian3.Setting(card).setName("Command").setDesc("Execution command. Use {file} for the code snippet filename.").addText((text) => {
          const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
          text.setPlaceholder(defaults?.command || "").setValue(langConfig.command || "").setDisabled(isDefault).onChange((val) => {
            langConfig.command = val.trim();
          });
        });
        new import_obsidian3.Setting(card).setName("Extension").setDesc("Source file extension (e.g. .py, .js).").addText((text) => {
          const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
          text.setPlaceholder(defaults?.extension || "").setValue(langConfig.extension || "").setDisabled(isDefault).onChange((val) => {
            langConfig.extension = val.trim();
          });
        });
        new import_obsidian3.Setting(card).addButton((btn) => {
          btn.setButtonText("Remove Language").setWarning().onClick(() => {
            delete this.configObj.languages[langName];
            this.renderActiveTab();
          });
        });
      }
    }
    containerEl.createEl("h3", { text: "Add Language Mapping", attr: { style: "margin-top: 1.5rem;" } });
    new import_obsidian3.Setting(containerEl).setName("Language ID").setDesc("e.g. python, javascript, node, sh").addText((text) => {
      text.setValue(this.newLanguageName).onChange((val) => {
        this.newLanguageName = val.trim().toLowerCase();
      });
    }).addButton((btn) => {
      btn.setButtonText("+ Add").setCta().onClick(() => {
        if (!this.newLanguageName) {
          new import_obsidian3.Notice("Please enter a language name.");
          return;
        }
        if (this.configObj.languages[this.newLanguageName]) {
          new import_obsidian3.Notice("Language already configured.");
          return;
        }
        this.configObj.languages[this.newLanguageName] = {
          command: `${this.newLanguageName} {file}`,
          extension: `.${this.newLanguageName}`
        };
        this.newLanguageName = "";
        this.renderActiveTab();
      });
    });
  }
  renderDockerfileTab(containerEl) {
    if (this.configObj.runtime !== "docker" && this.configObj.runtime !== "podman") {
      containerEl.createEl("p", {
        text: `Dockerfile editing is only available for Docker and Podman runtimes. Currently using: ${this.configObj.runtime}`,
        cls: "setting-item-description"
      });
      return;
    }
    if (this.dockerfileText === null) {
      containerEl.createEl("p", {
        text: "No Dockerfile exists in this container group directory.",
        cls: "setting-item-description"
      });
      new import_obsidian3.Setting(containerEl).addButton((btn) => {
        btn.setButtonText("Create Dockerfile").setCta().onClick(() => {
          this.dockerfileText = [
            "FROM ubuntu:latest",
            "",
            "# Install packages",
            "RUN apt-get update && apt-get install -y \\",
            "    python3 \\",
            "    nodejs \\",
            "    && rm -rf /var/lib/apt/lists/*",
            ""
          ].join("\n");
          this.renderActiveTab();
        });
      });
    } else {
      new import_obsidian3.Setting(containerEl).setName("Dockerfile Content").setDesc("Define the build steps for your environment container.").addTextArea((text) => {
        text.inputEl.rows = 15;
        text.inputEl.style.fontFamily = "monospace";
        text.inputEl.style.width = "100%";
        text.setValue(this.dockerfileText || "");
        text.onChange((val) => {
          this.dockerfileText = val;
        });
      });
    }
  }
  renderRawTab(containerEl) {
    this.rawJsonText = JSON.stringify(this.configObj, null, 2);
    new import_obsidian3.Setting(containerEl).setName("Configuration JSON").addTextArea((text) => {
      text.inputEl.rows = 15;
      text.inputEl.style.fontFamily = "monospace";
      text.inputEl.style.width = "100%";
      text.setValue(this.rawJsonText);
      text.onChange((val) => {
        this.rawJsonText = val;
      });
    });
  }
  async saveAndClose() {
    if (this.activeTab === "raw") {
      try {
        this.configObj = JSON.parse(this.rawJsonText);
      } catch (e) {
        new import_obsidian3.Notice("Invalid JSON syntax in Raw JSON tab. Please fix it before saving.");
        return;
      }
    }
    if (!this.configObj.runtime) {
      new import_obsidian3.Notice("Runtime is required.");
      return;
    }
    if (this.configObj.runtime === "qemu" && (!this.configObj.qemu?.sshTarget || !this.configObj.qemu?.remoteWorkspace)) {
      new import_obsidian3.Notice("QEMU runtime requires SSH Target and Remote Workspace.");
      return;
    }
    if (this.configObj.runtime === "custom" && !this.configObj.custom?.executable) {
      new import_obsidian3.Notice("Custom runtime requires Custom Executable.");
      return;
    }
    const adapter = this.app.vault.adapter;
    const configPath = `${this.pluginDir}/containers/${this.groupName}/config.json`;
    const dockerfilePath = `${this.pluginDir}/containers/${this.groupName}/Dockerfile`;
    try {
      const configStr = JSON.stringify(this.configObj, null, 2);
      await adapter.write(configPath, configStr);
      if (this.configObj.runtime === "docker" || this.configObj.runtime === "podman") {
        if (this.dockerfileText !== null) {
          await adapter.write(dockerfilePath, this.dockerfileText);
        }
      }
      new import_obsidian3.Notice("Container group configurations saved.");
      this.onSave();
      this.close();
    } catch (error) {
      new import_obsidian3.Notice(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};

// src/sourceExtract.ts
var import_child_process3 = require("child_process");
var import_promises3 = require("fs/promises");
var import_os2 = require("os");
var import_path9 = require("path");
async function resolveReferencedSource(source, reference, language, harness, host) {
  if (host?.externalExtractor?.executable.trim()) {
    return host.externalExtractor.mode === "transpile-c" ? resolveTranspileToCReferencedSource(source, reference, language, harness, host.externalExtractor) : resolveExternalReferencedSource(source, reference, language, harness, host.externalExtractor);
  }
  if (language === "python" && host) {
    return resolvePythonReferencedSource(source, reference, harness, host);
  }
  return resolveReferencedSourceFallback(source, reference, language, harness);
}
function resolveReferencedSourceFallback(source, reference, language, harness) {
  const lines = source.split(/\r?\n/);
  const selectedRange = reference.symbolName ? findSymbolRange(lines, language, reference.symbolName) : findLineRange(lines, reference);
  if (!selectedRange) {
    const target = reference.symbolName ? `symbol ${reference.symbolName}` : "line range";
    throw new Error(`Unable to extract ${target} from ${reference.filePath}.`);
  }
  const selected = renderRange(lines, selectedRange);
  const dependencies = reference.traceDependencies ? collectDependencySource(lines, language, selectedRange, selected) : "";
  const content = [dependencies, selected, harness.trim() ? harness : ""].filter((part) => part.trim()).join("\n\n");
  return {
    content,
    description: formatSourceDescription(reference, selectedRange)
  };
}
async function resolveExternalReferencedSource(source, reference, language, harness, extractor) {
  const tempDir = await (0, import_promises3.mkdtemp)((0, import_path9.join)((0, import_os2.tmpdir)(), "loom-extract-"));
  const sourceFile = (0, import_path9.join)(tempDir, "source.txt");
  const harnessFile = (0, import_path9.join)(tempDir, "harness.txt");
  const requestFile = (0, import_path9.join)(tempDir, "request.json");
  try {
    const request = {
      language,
      filePath: reference.filePath,
      symbolName: reference.symbolName ?? null,
      lineStart: reference.lineStart ?? null,
      lineEnd: reference.lineEnd ?? null,
      traceDependencies: reference.traceDependencies,
      sourceFile,
      harnessFile
    };
    await (0, import_promises3.writeFile)(sourceFile, source, "utf8");
    await (0, import_promises3.writeFile)(harnessFile, harness, "utf8");
    await (0, import_promises3.writeFile)(requestFile, JSON.stringify(request, null, 2), "utf8");
    const output = await runExternalExtractor(extractor, {
      language,
      sourceFile,
      harnessFile,
      requestFile,
      reference
    });
    const result = parseExternalExtractorResult(output);
    const content = result.content ?? [
      ...result.imports ?? [],
      ...result.dependencies ?? [],
      result.selected ?? "",
      harness.trim() ? harness : ""
    ].filter((part) => part.trim()).join("\n\n");
    if (!content.trim()) {
      throw new Error("Custom source extractor returned no content.");
    }
    return {
      content,
      description: result.description?.trim() || formatSourceDescription(reference, null)
    };
  } finally {
    await (0, import_promises3.rm)(tempDir, { recursive: true, force: true });
  }
}
async function resolveTranspileToCReferencedSource(source, reference, language, harness, extractor) {
  const tempDir = await (0, import_promises3.mkdtemp)((0, import_path9.join)((0, import_os2.tmpdir)(), "loom-extract-"));
  const sourceFile = (0, import_path9.join)(tempDir, "source.txt");
  const harnessFile = (0, import_path9.join)(tempDir, "harness.txt");
  const requestFile = (0, import_path9.join)(tempDir, "request.json");
  try {
    const request = {
      language,
      filePath: reference.filePath,
      symbolName: reference.symbolName ?? null,
      lineStart: reference.lineStart ?? null,
      lineEnd: reference.lineEnd ?? null,
      traceDependencies: reference.traceDependencies,
      sourceFile,
      harnessFile,
      targetLanguage: "c"
    };
    await (0, import_promises3.writeFile)(sourceFile, source, "utf8");
    await (0, import_promises3.writeFile)(harnessFile, harness, "utf8");
    await (0, import_promises3.writeFile)(requestFile, JSON.stringify(request, null, 2), "utf8");
    const output = await runExternalExtractor(extractor, {
      language,
      sourceFile,
      harnessFile,
      requestFile,
      reference
    });
    const result = parseTranspileToCResult(output);
    const generatedLanguage = result.language === "cpp" ? "cpp" : "c";
    const mappedSymbol = reference.symbolName ? result.symbols?.[reference.symbolName] ?? reference.symbolName : void 0;
    const generatedReference = {
      ...reference,
      filePath: `${reference.filePath}:generated.${generatedLanguage === "cpp" ? "cpp" : "c"}`,
      symbolName: mappedSymbol
    };
    const resolved = resolveReferencedSourceFallback(result.generatedSource, generatedReference, generatedLanguage, result.harness ?? harness);
    return {
      content: resolved.content,
      description: result.description?.trim() || `${reference.filePath}#${reference.symbolName ?? "generated-c"}`
    };
  } finally {
    await (0, import_promises3.rm)(tempDir, { recursive: true, force: true });
  }
}
async function runExternalExtractor(extractor, values) {
  const args = extractor.args.map((arg) => arg.replaceAll("{request}", values.requestFile).replaceAll("{source}", values.sourceFile).replaceAll("{file}", values.sourceFile).replaceAll("{harness}", values.harnessFile).replaceAll("{symbol}", values.reference.symbolName ?? "").replaceAll("{lineStart}", values.reference.lineStart == null ? "" : String(values.reference.lineStart)).replaceAll("{lineEnd}", values.reference.lineEnd == null ? "" : String(values.reference.lineEnd)).replaceAll("{deps}", values.reference.traceDependencies ? "true" : "false").replaceAll("{language}", values.language));
  return new Promise((resolve, reject) => {
    const child = (0, import_child_process3.spawn)(extractor.executable, args, {
      cwd: extractor.workingDirectory,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Custom source extractor timed out after ${extractor.timeoutMs} ms.`));
    }, extractor.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error((stderr || stdout || `Custom source extractor exited with code ${code}.`).trim()));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end(JSON.stringify({
      requestFile: values.requestFile,
      sourceFile: values.sourceFile,
      harnessFile: values.harnessFile,
      language: values.language,
      filePath: values.reference.filePath,
      symbolName: values.reference.symbolName ?? null,
      lineStart: values.reference.lineStart ?? null,
      lineEnd: values.reference.lineEnd ?? null,
      traceDependencies: values.reference.traceDependencies
    }));
  });
}
function parseExternalExtractorResult(output) {
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed !== "object" || parsed == null) {
      throw new Error("Custom source extractor must return a JSON object.");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Custom source extractor returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function parseTranspileToCResult(output) {
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed !== "object" || parsed == null || typeof parsed.generatedSource !== "string") {
      throw new Error("Transpile to C extractor must return generatedSource.");
    }
    if (parsed.language != null && parsed.language !== "c" && parsed.language !== "cpp") {
      throw new Error("Transpile to C language must be c or cpp.");
    }
    if (parsed.symbols != null && (typeof parsed.symbols !== "object" || Array.isArray(parsed.symbols))) {
      throw new Error("Transpile to C symbols must be an object.");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Transpile to C extractor returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function resolvePythonReferencedSource(source, reference, harness, host) {
  const lines = source.split(/\r?\n/);
  const moduleInfo = await inspectPythonModule(source, host);
  const selectedRange = reference.symbolName ? findPythonSymbolRange(moduleInfo, reference.symbolName) : findLineRange(lines, reference);
  if (!selectedRange) {
    const target = reference.symbolName ? `symbol ${reference.symbolName}` : "line range";
    throw new Error(`Unable to extract ${target} from ${reference.filePath}.`);
  }
  const selected = renderRange(lines, selectedRange);
  const state = createPythonDependencyState();
  const dependencies = reference.traceDependencies ? await collectPythonDependencySource(source, reference.filePath, selectedRange, selected, harness, host, state) : "";
  const content = [dependencies, selected, harness.trim() ? harness : ""].filter((part) => part.trim()).join("\n\n");
  return {
    content,
    description: formatSourceDescription(reference, selectedRange)
  };
}
function createPythonDependencyState() {
  return {
    includedRanges: /* @__PURE__ */ new Set(),
    includedImports: /* @__PURE__ */ new Set(),
    aliases: /* @__PURE__ */ new Set(),
    namespaceBindings: /* @__PURE__ */ new Map(),
    visitingSymbols: /* @__PURE__ */ new Set(),
    needsNamespaceRuntime: false
  };
}
async function collectPythonDependencySource(source, filePath, selectedRange, selected, harness, host, state) {
  const parts = [];
  await collectPythonDependencies(source, filePath, selectedRange, `${selected}
${harness}`, host, state, parts);
  const namespace = renderPythonNamespaceBindings(state);
  return [...state.includedImports, ...parts, namespace].filter((part) => part.trim()).join("\n\n");
}
async function collectPythonDependencies(source, filePath, selectedRange, seed, host, state, parts) {
  const lines = source.split(/\r?\n/);
  const moduleInfo = await inspectPythonModule(source, host);
  let haystack = seed;
  let collected = "";
  let changed = true;
  while (changed) {
    changed = false;
    const usage = await inspectPythonUsage(haystack, host);
    for (const definition of moduleInfo.definitions) {
      if (rangesOverlap(definition, selectedRange) || !pythonDefinitionIsUsed(definition, usage)) {
        continue;
      }
      const text = addPythonRange(lines, filePath, definition, state, parts);
      if (text) {
        const nested = await collectPythonDependencies(source, filePath, definition, text, host, state, parts);
        haystack += `
${text}
`;
        if (nested) {
          haystack += `
${nested}
`;
        }
        collected += `${nested}
${text}
`;
        changed = true;
      }
    }
    for (const importNode of moduleInfo.imports) {
      const text = await resolvePythonImportDependency(importNode, lines, filePath, usage, host, state, parts);
      if (text) {
        haystack += `
${text}
`;
        collected += `${text}
`;
        changed = true;
      }
    }
  }
  return collected;
}
async function resolvePythonImportDependency(importNode, lines, filePath, usage, host, state, parts) {
  if (importNode.kind === "from") {
    return resolvePythonFromImportDependency(importNode, lines, filePath, usage, host, state, parts);
  }
  return resolvePythonPlainImportDependency(importNode, lines, filePath, usage, host, state, parts);
}
async function resolvePythonFromImportDependency(importNode, lines, filePath, usage, host, state, parts) {
  const localModulePath = await host.resolvePythonImport(filePath, importNode.module, importNode.level);
  let added = "";
  for (const alias of importNode.names) {
    if (alias.name === "*") {
      if (!localModulePath) {
        if (usesUnknownImportedNames(usage) && addPythonImportLine(lines, importNode, state)) {
          added += `${renderRange(lines, importNode)}
`;
        }
        continue;
      }
      const source = await host.readFile(localModulePath);
      if (!source) {
        continue;
      }
      const moduleInfo = await inspectPythonModule(source, host);
      for (const definition of moduleInfo.definitions) {
        if (!pythonDefinitionIsUsed(definition, usage)) {
          continue;
        }
        added += await extractPythonSymbolFromFile(localModulePath, definition.name, host, state, parts);
      }
      continue;
    }
    const exposedName = alias.asname ?? alias.name;
    if (!usage.names.includes(exposedName)) {
      continue;
    }
    const submodulePath = await host.resolvePythonImport(filePath, joinPythonModule(importNode.module, alias.name), importNode.level);
    const importTargetPath = localModulePath ?? submodulePath;
    if (!importTargetPath) {
      if (addPythonImportLine(lines, importNode, state)) {
        added += `${renderRange(lines, importNode)}
`;
      }
      continue;
    }
    const extracted = await extractPythonSymbolFromFile(importTargetPath, alias.name, host, state, parts);
    if (extracted) {
      added += extracted;
      if (alias.asname && alias.asname !== alias.name) {
        added += addPythonAlias(alias.name, alias.asname, state, parts);
      }
      continue;
    }
    const moduleBinding = alias.asname ?? alias.name;
    const moduleAttributes = usage.attributes[moduleBinding] ?? [];
    if (submodulePath && moduleAttributes.length) {
      for (const attribute of moduleAttributes) {
        added += await extractPythonSymbolFromFile(submodulePath, attribute, host, state, parts);
        addPythonNamespaceBinding(moduleBinding, attribute, state);
      }
    }
  }
  return added;
}
async function resolvePythonPlainImportDependency(importNode, lines, filePath, usage, host, state, parts) {
  let added = "";
  for (const alias of importNode.names) {
    const binding = alias.asname ?? alias.name.split(".")[0];
    const usedAttributes = usage.attributes[binding] ?? [];
    const bindingIsUsed = usage.names.includes(binding) || usedAttributes.length > 0;
    if (!bindingIsUsed) {
      continue;
    }
    const localModulePath = await host.resolvePythonImport(filePath, alias.name, 0);
    if (!localModulePath) {
      if (addPythonImportLine(lines, importNode, state)) {
        added += `${renderRange(lines, importNode)}
`;
      }
      continue;
    }
    for (const attribute of usedAttributes) {
      added += await extractPythonSymbolFromFile(localModulePath, attribute, host, state, parts);
      addPythonNamespaceBinding(binding, attribute, state);
    }
  }
  return added;
}
async function extractPythonSymbolFromFile(filePath, symbolName, host, state, parts) {
  const visitKey = `${filePath}#${symbolName}`;
  if (state.visitingSymbols.has(visitKey)) {
    return "";
  }
  const source = await host.readFile(filePath);
  if (!source) {
    return "";
  }
  state.visitingSymbols.add(visitKey);
  try {
    const lines = source.split(/\r?\n/);
    const moduleInfo = await inspectPythonModule(source, host);
    const definition = moduleInfo.definitions.find((candidate) => (candidate.names ?? [candidate.name]).includes(symbolName));
    if (!definition) {
      return "";
    }
    const text = renderRange(lines, definition);
    const dependencyText = await collectPythonDependencies(source, filePath, definition, text, host, state, parts);
    const added = addPythonRange(lines, filePath, definition, state, parts);
    return [dependencyText, added].filter((part) => part.trim()).join("\n");
  } finally {
    state.visitingSymbols.delete(visitKey);
  }
}
function addPythonRange(lines, filePath, range, state, parts) {
  const key = `${filePath}:L${range.start + 1}-L${range.end + 1}`;
  if (state.includedRanges.has(key)) {
    return "";
  }
  state.includedRanges.add(key);
  const text = renderRange(lines, range);
  parts.push(text);
  return text;
}
function addPythonImportLine(lines, range, state) {
  const text = renderRange(lines, range);
  if (state.includedImports.has(text)) {
    return false;
  }
  state.includedImports.add(text);
  return true;
}
function addPythonAlias(name, asname, state, parts) {
  const key = `${asname}=${name}`;
  if (state.aliases.has(key)) {
    return "";
  }
  state.aliases.add(key);
  const text = `${asname} = ${name}`;
  parts.push(text);
  return `${text}
`;
}
function addPythonNamespaceBinding(binding, attribute, state) {
  state.needsNamespaceRuntime = true;
  const attributes = state.namespaceBindings.get(binding) ?? /* @__PURE__ */ new Set();
  attributes.add(attribute);
  state.namespaceBindings.set(binding, attributes);
}
function renderPythonNamespaceBindings(state) {
  if (!state.namespaceBindings.size) {
    return "";
  }
  const lines = state.needsNamespaceRuntime ? ["import types as _loom_types"] : [];
  for (const [binding, attributes] of state.namespaceBindings) {
    lines.push(`${binding} = _loom_types.SimpleNamespace()`);
    for (const attribute of attributes) {
      lines.push(`${binding}.${attribute} = ${attribute}`);
    }
  }
  return lines.join("\n");
}
function findPythonSymbolRange(moduleInfo, symbolName) {
  const exact = moduleInfo.definitions.find((definition) => (definition.names ?? [definition.name]).includes(symbolName));
  return exact ? { start: exact.start, end: exact.end } : null;
}
function pythonDefinitionIsUsed(definition, usage) {
  return (definition.names ?? [definition.name]).some((name) => usage.names.includes(name));
}
function usesUnknownImportedNames(usage) {
  return usage.names.length > 0;
}
function joinPythonModule(moduleName, name) {
  return moduleName ? `${moduleName}.${name}` : name;
}
async function inspectPythonModule(source, host) {
  return runPythonAst(source, "module", host);
}
async function inspectPythonUsage(source, host) {
  return runPythonAst(source, "usage", host);
}
async function runPythonAst(source, mode, host) {
  const command = splitCommandLine(host.pythonExecutable?.trim() || "python3");
  const executable = command[0] ?? "python3";
  const args = [...command.slice(1), "-c", PYTHON_AST_HELPER];
  return new Promise((resolve, reject) => {
    const child = (0, import_child_process3.spawn)(executable, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error((stderr || stdout || `Python AST helper exited with code ${code}.`).trim()));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify({ mode, source }));
  });
}
function findLineRange(lines, reference) {
  const start = Math.max((reference.lineStart ?? 1) - 1, 0);
  const end = Math.min((reference.lineEnd ?? reference.lineStart ?? lines.length) - 1, lines.length - 1);
  if (start > end || start >= lines.length) {
    return null;
  }
  return { start, end };
}
function findSymbolRange(lines, language, symbolName) {
  const definitions = collectDefinitions(lines, language);
  const exact = definitions.find((definition) => definitionNames(definition).includes(symbolName));
  if (exact) {
    return { start: exact.start, end: exact.end };
  }
  const symbolPattern = new RegExp(`\\b${escapeRegex(symbolName)}\\b`);
  const line = lines.findIndex((candidate) => symbolPattern.test(candidate));
  if (line < 0) {
    return null;
  }
  return lines[line].includes("{") ? { start: line, end: findBraceRangeEnd(lines, line) } : { start: line, end: line };
}
function collectDependencySource(lines, language, selectedRange, selected) {
  const prologue = collectPrologue(lines, language, selectedRange.start);
  const definitions = collectDefinitions(lines, language).filter((definition) => !rangesOverlap(definition, selectedRange));
  const selectedDefinitions = traceDefinitions(selected, definitions, lines);
  return [...prologue, ...selectedDefinitions.map((definition) => renderRange(lines, definition))].filter((part) => part.trim()).join("\n\n");
}
function traceDefinitions(seed, definitions, lines) {
  const selected = [];
  const selectedKeys = /* @__PURE__ */ new Set();
  let haystack = seed;
  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of definitions) {
      const key = `${definition.start}:${definition.end}:${definition.name}`;
      if (selectedKeys.has(key)) {
        continue;
      }
      if (!definitionNames(definition).some((name) => sourceUsesName(haystack, name))) {
        continue;
      }
      selectedKeys.add(key);
      selected.push(definition);
      haystack += `
${renderRange(lines, definition)}
`;
      changed = true;
    }
  }
  return selected.sort((left, right) => left.start - right.start);
}
function collectPrologue(lines, language, beforeLine) {
  const prologue = [];
  const max = Math.max(beforeLine, 0);
  for (let index = 0; index < max; index += 1) {
    const line = lines[index];
    if (isPrologueLine(line, language)) {
      prologue.push(line);
    }
  }
  return prologue.length ? [prologue.join("\n")] : [];
}
function isPrologueLine(line, language) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  switch (language) {
    case "python":
      return /^(from\s+\S+\s+import\s+|import\s+)/.test(trimmed);
    case "javascript":
    case "typescript":
      return /^(import\s+|export\s+.*\s+from\s+|(?:const|let|var)\s+\w+\s*=\s*require\s*\()/.test(trimmed);
    case "c":
    case "cpp":
    case "llvm-ir":
      return trimmed.startsWith("#") || trimmed.startsWith("target ") || trimmed.startsWith("source_filename");
    case "haskell":
      return /^(module\s+|import\s+)/.test(trimmed);
    case "ocaml":
      return /^(open\s+|include\s+|#use\s+)/.test(trimmed);
    case "java":
      return /^(package\s+|import\s+)/.test(trimmed);
    default:
      return false;
  }
}
function collectDefinitions(lines, language) {
  switch (language) {
    case "python":
      return collectPythonDefinitions(lines);
    case "javascript":
    case "typescript":
      return collectBraceDefinitions(lines, /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b|^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b|^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    case "c":
      return collectCDefinitions(lines, false);
    case "cpp":
      return collectCDefinitions(lines, true);
    case "haskell":
      return collectHaskellDefinitions(lines);
    case "ocaml":
      return collectOcamlDefinitions(lines);
    case "java":
      return collectBraceDefinitions(lines, /^\s*(?:public|private|protected|static|final|abstract|\s)*\s*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)\b|^\s*(?:public|private|protected|static|final|synchronized|native|\s)+[\w<>\[\],.?]+\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/);
    case "llvm-ir":
      return collectLlvmDefinitions(lines);
    default:
      return [];
  }
}
function collectPythonDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const assignment = lines[index].match(/^([A-Za-z_]\w*)\s*[:=]/);
    if (assignment) {
      definitions.push({ name: assignment[1], start: index, end: index });
      continue;
    }
    const match = lines[index].match(/^(\s*)(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)\b/);
    if (!match) {
      continue;
    }
    const indent = match[1].length;
    let start = index;
    while (start > 0 && lines[start - 1].trim().startsWith("@") && getIndent(lines[start - 1]) === indent) {
      start -= 1;
    }
    let end = index;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].trim() && getIndent(lines[cursor]) <= indent) {
        break;
      }
      end = cursor;
    }
    definitions.push({ name: match[2], start, end });
  }
  return definitions;
}
function collectCDefinitions(lines, isCpp) {
  const definitions = [];
  let depth = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const topLevel = depth === 0;
    if (topLevel && trimmed) {
      const macro = trimmed.match(/^#\s*define\s+([A-Za-z_]\w*)\b/);
      if (macro) {
        definitions.push({ name: macro[1], start: index, end: index });
      } else if (!trimmed.startsWith("#") && !isCCommentLine(trimmed)) {
        const typeDefinition = matchCTypeDefinition(lines, index, isCpp);
        if (typeDefinition) {
          definitions.push(typeDefinition);
          index = Math.max(index, typeDefinition.end);
        } else {
          const functionDefinition = matchCFunctionDefinition(lines, index);
          if (functionDefinition) {
            definitions.push(functionDefinition);
            index = Math.max(index, functionDefinition.end);
          } else {
            const globalDefinition = matchCGlobalDefinition(line, index);
            if (globalDefinition) {
              definitions.push(globalDefinition);
            }
          }
        }
      }
    }
    depth += braceDelta(line);
    if (depth < 0) {
      depth = 0;
    }
  }
  return definitions;
}
function matchCTypeDefinition(lines, start, isCpp) {
  const header = lines.slice(start, Math.min(lines.length, start + 8)).join(" ");
  const keywordPattern = isCpp ? "(?:typedef\\s+)?(?:struct|class|enum|union)" : "(?:typedef\\s+)?(?:struct|enum|union)";
  const named = header.match(new RegExp(`^\\s*${keywordPattern}\\s+([A-Za-z_]\\w*)\\b`));
  const anonymousTypedef = header.match(/^\s*typedef\s+(?:struct|enum|union)\b[\s\S]*?\}\s*([A-Za-z_]\w*)\s*;/);
  const name = named?.[1] ?? anonymousTypedef?.[1];
  if (!name) {
    return null;
  }
  const end = findCDeclarationEnd(lines, start);
  return { name, names: [name], start, end };
}
function matchCFunctionDefinition(lines, start) {
  const headerLines = lines.slice(start, Math.min(lines.length, start + 12));
  const joined = headerLines.join(" ");
  const braceOffset = headerLines.findIndex((line) => line.includes("{"));
  if (braceOffset < 0 || joined.indexOf(";") >= 0 && joined.indexOf(";") < joined.indexOf("{")) {
    return null;
  }
  const matches = [...joined.matchAll(/([A-Za-z_]\w*(?:::[A-Za-z_]\w*)?|operator\s*[^\s(]+)\s*\([^;{}]*\)\s*(?:const\b[^{}]*)?(?:noexcept\b[^{}]*)?(?:->\s*[^{}]+)?\{/g)];
  const name = matches[0]?.[1]?.replace(/\s+/g, "");
  if (!name || isCControlKeyword(name)) {
    return null;
  }
  const braceLine = start + braceOffset;
  const shortName = name.includes("::") ? name.split("::").pop() ?? name : name;
  return {
    name: shortName,
    names: [.../* @__PURE__ */ new Set([shortName, name])],
    start,
    end: findBraceRangeEnd(lines, braceLine)
  };
}
function matchCGlobalDefinition(line, index) {
  const trimmed = line.trim();
  if (!trimmed.endsWith(";") || trimmed.includes("(") || /^(return|using|namespace|template)\b/.test(trimmed)) {
    return null;
  }
  const withoutInitializer = trimmed.split("=")[0].replace(/\[[^\]]*]/g, "");
  const match = withoutInitializer.match(/([A-Za-z_]\w*)\s*(?:[,;]|$)/g)?.pop()?.match(/([A-Za-z_]\w*)/);
  const name = match?.[1];
  if (!name || /^(const|static|extern|volatile|unsigned|signed|long|short|int|char|float|double|void|auto)$/.test(name)) {
    return null;
  }
  return { name, start: index, end: index };
}
function collectLlvmDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const symbol = line.match(/^\s*(?:define|declare)\b.*@([A-Za-z$._-][A-Za-z$._0-9-]*)\s*\(/);
    if (symbol) {
      const end = line.trimStart().startsWith("define") ? findBraceRangeEnd(lines, index) : index;
      definitions.push({ name: symbol[1], names: [symbol[1], `@${symbol[1]}`], start: index, end });
      continue;
    }
    const global = line.match(/^\s*@([A-Za-z$._-][A-Za-z$._0-9-]*)\s*=/);
    if (global) {
      definitions.push({ name: global[1], names: [global[1], `@${global[1]}`], start: index, end: index });
    }
  }
  return definitions;
}
function collectHaskellDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || getIndent(lines[index]) > 0 || /^(module|import)\b/.test(trimmed)) {
      continue;
    }
    const names = getHaskellDefinitionNames(trimmed);
    if (!names.length) {
      continue;
    }
    const end = findHaskellRangeEnd(lines, index, names[0]);
    definitions.push({ name: names[0], names, start: index, end });
    index = end;
  }
  return definitions;
}
function collectOcamlDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || getIndent(lines[index]) > 0 || /^(open|include|#use)\b/.test(trimmed)) {
      continue;
    }
    const names = getOcamlDefinitionNames(trimmed);
    if (!names.length) {
      continue;
    }
    const end = findLayoutRangeEnd(lines, index, isOcamlTopLevelStart);
    definitions.push({ name: names[0], names, start: index, end });
    index = end;
  }
  return definitions;
}
function collectBraceDefinitions(lines, pattern) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern);
    const name = match?.slice(1).find(Boolean);
    if (!name) {
      continue;
    }
    definitions.push({ name, start: index, end: findBraceRangeEnd(lines, index) });
  }
  return definitions;
}
function findBraceRangeEnd(lines, start) {
  if (!lines[start].includes("{")) {
    return start;
  }
  let depth = 0;
  let sawBrace = false;
  for (let index = start; index < lines.length; index += 1) {
    for (const char of lines[index]) {
      if (char === "{") {
        depth += 1;
        sawBrace = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    if (sawBrace && depth <= 0) {
      return index;
    }
  }
  return start;
}
function findCDeclarationEnd(lines, start) {
  let sawBrace = false;
  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    for (const char of lines[index]) {
      if (char === "{") {
        depth += 1;
        sawBrace = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    if ((!sawBrace || depth <= 0) && lines[index].includes(";")) {
      return index;
    }
  }
  return start;
}
function braceDelta(line) {
  let delta = 0;
  for (const char of line) {
    if (char === "{") {
      delta += 1;
    } else if (char === "}") {
      delta -= 1;
    }
  }
  return delta;
}
function isCCommentLine(trimmed) {
  return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
}
function isCControlKeyword(name) {
  return ["if", "for", "while", "switch", "catch"].includes(name);
}
function getHaskellDefinitionNames(trimmed) {
  const signature = trimmed.match(/^([a-z_][\w']*)\s*::/);
  if (signature) {
    return [signature[1]];
  }
  const binding = trimmed.match(/^([a-z_][\w']*)\b.*=/);
  if (binding) {
    return [binding[1]];
  }
  const typeLike = trimmed.match(/^(?:data|newtype|type|class)\s+([A-Z][\w']*)\b/);
  if (typeLike) {
    return [typeLike[1]];
  }
  const instance = trimmed.match(/^instance\b.*?\b([A-Z][\w']*)\b/);
  return instance ? [instance[1]] : [];
}
function getOcamlDefinitionNames(trimmed) {
  const letBinding = trimmed.match(/^let\s+(?:rec\s+)?(?:\(([^)]+)\)|([a-z_][\w']*))/);
  if (letBinding) {
    return [letBinding[1] ?? letBinding[2]];
  }
  const typeBinding = trimmed.match(/^type\s+([a-z_][\w']*)/);
  if (typeBinding) {
    return [typeBinding[1]];
  }
  const moduleBinding = trimmed.match(/^module\s+([A-Z][\w']*)/);
  if (moduleBinding) {
    return [moduleBinding[1]];
  }
  return [];
}
function findLayoutRangeEnd(lines, start, isTopLevelStart) {
  let end = start;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && getIndent(line) === 0 && isTopLevelStart(line.trim())) {
      break;
    }
    end = index;
  }
  return end;
}
function findHaskellRangeEnd(lines, start, name) {
  let end = start;
  let allowMatchingEquation = lines[start].trim().startsWith(`${name} ::`);
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed && getIndent(line) === 0 && isHaskellTopLevelStart(trimmed)) {
      if (allowMatchingEquation && trimmed.startsWith(`${name} `) && trimmed.includes("=")) {
        allowMatchingEquation = false;
        end = index;
        continue;
      }
      break;
    }
    end = index;
  }
  return end;
}
function isHaskellTopLevelStart(trimmed) {
  return /^(module|import|data|newtype|type|class|instance)\b/.test(trimmed) || /^[a-z_][\w']*\s*(?:::|.*=)/.test(trimmed);
}
function isOcamlTopLevelStart(trimmed) {
  return /^(open|include|#use|let|type|module)\b/.test(trimmed);
}
function renderRange(lines, range) {
  return lines.slice(range.start, range.end + 1).join("\n");
}
function rangesOverlap(left, right) {
  return left.start <= right.end && right.start <= left.end;
}
function getIndent(line) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function definitionNames(definition) {
  return definition.names?.length ? definition.names : [definition.name];
}
function sourceUsesName(source, name) {
  if (name.startsWith("@")) {
    return new RegExp(`${escapeRegex(name)}\\b`).test(source);
  }
  return new RegExp(`\\b${escapeRegex(name)}\\b`).test(source);
}
function formatSourceDescription(reference, range) {
  if (reference.symbolName) {
    return `${reference.filePath}#${reference.symbolName}`;
  }
  if (range) {
    return `${reference.filePath}:L${range.start + 1}-L${range.end + 1}`;
  }
  return reference.filePath;
}
var PYTHON_AST_HELPER = String.raw`
import ast
import json
import sys

payload = json.loads(sys.stdin.read())
source = payload.get("source", "")
mode = payload.get("mode", "module")

def range_start(node):
    lineno = getattr(node, "lineno", 1)
    decorators = getattr(node, "decorator_list", None) or []
    if decorators:
        lineno = min(lineno, *(getattr(decorator, "lineno", lineno) for decorator in decorators))
    return lineno - 1

def range_end(node):
    return getattr(node, "end_lineno", getattr(node, "lineno", 1)) - 1

def target_names(target):
    if isinstance(target, ast.Name):
        return [target.id]
    if isinstance(target, (ast.Tuple, ast.List)):
        names = []
        for item in target.elts:
            names.extend(target_names(item))
        return names
    return []

def definition_names(node):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return [node.name]
    if isinstance(node, ast.Assign):
        names = []
        for target in node.targets:
            names.extend(target_names(target))
        return names
    if isinstance(node, (ast.AnnAssign, ast.AugAssign)):
        return target_names(node.target)
    return []

def inspect_module(tree):
    definitions = []
    imports = []
    for node in tree.body:
        names = definition_names(node)
        if names:
            definitions.append({
                "name": names[0],
                "names": names,
                "start": range_start(node),
                "end": range_end(node),
            })
            continue
        if isinstance(node, ast.Import):
            imports.append({
                "kind": "import",
                "module": "",
                "level": 0,
                "names": [{"name": item.name, "asname": item.asname} for item in node.names],
                "start": range_start(node),
                "end": range_end(node),
            })
            continue
        if isinstance(node, ast.ImportFrom):
            imports.append({
                "kind": "from",
                "module": node.module or "",
                "level": node.level,
                "names": [{"name": item.name, "asname": item.asname} for item in node.names],
                "start": range_start(node),
                "end": range_end(node),
            })
    return {"definitions": definitions, "imports": imports}

def attribute_chain(node):
    chain = []
    current = node
    while isinstance(current, ast.Attribute):
        chain.append(current.attr)
        current = current.value
    if isinstance(current, ast.Name):
        chain.append(current.id)
        chain.reverse()
        return chain
    return []

class UsageVisitor(ast.NodeVisitor):
    def __init__(self):
        self.names = set()
        self.attributes = {}

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            self.names.add(node.id)

    def visit_Attribute(self, node):
        chain = attribute_chain(node)
        if len(chain) >= 2:
            self.names.add(chain[0])
            self.attributes.setdefault(chain[0], set()).add(chain[1])
        self.generic_visit(node)

def inspect_usage(tree):
    visitor = UsageVisitor()
    visitor.visit(tree)
    return {
        "names": sorted(visitor.names),
        "attributes": {key: sorted(value) for key, value in visitor.attributes.items()},
    }

try:
    tree = ast.parse(source)
except SyntaxError:
    print(json.dumps({"definitions": [], "imports": []} if mode == "module" else {"names": [], "attributes": {}}))
    raise SystemExit(0)

if mode == "module":
    print(json.dumps(inspect_module(tree)))
else:
    print(json.dumps(inspect_usage(tree)))
`;

// src/sourceHarness.ts
function buildSourceReferenceHarness(block) {
  const call = block.sourceReference?.call;
  if (!call) {
    return block.content;
  }
  const symbolName = block.sourceReference?.symbolName?.trim();
  const input = block.content.trim();
  const expression = call.expression?.trim() ? renderSourceCallTemplate(call.expression, input, symbolName) : renderDefaultSourceCall(symbolName, call.args, input);
  return renderLanguageCallHarness(block.language, expression, call.print);
}
function renderDefaultSourceCall(symbolName, args, input) {
  if (!symbolName) {
    throw new Error("loom-call needs loom-symbol when no call expression is provided.");
  }
  const renderedArgs = renderSourceCallTemplate(args?.trim() || "{input}", input, symbolName);
  return `${symbolName}(${renderedArgs})`;
}
function renderSourceCallTemplate(template, input, symbolName) {
  return template.replaceAll("{input}", input).replaceAll("{symbol}", symbolName ?? "");
}
function renderLanguageCallHarness(language, expression, print) {
  if (!print) {
    return renderExpressionStatement(language, expression);
  }
  switch (language) {
    case "python":
      return `print(${expression})`;
    case "javascript":
    case "typescript":
      return `console.log(${expression});`;
    case "c":
      return `#include <stdio.h>
int main(void) { printf("%d\\n", ${expression}); return 0; }`;
    case "cpp":
      return `#include <iostream>
int main() { std::cout << (${expression}) << "\\n"; return 0; }`;
    case "ocaml":
      return `let () = print_endline (${expression})`;
    default:
      throw new Error(`loom-call cannot generate a printed harness for ${language}. Use loom-print=false or write the harness in the block body.`);
  }
}
function renderExpressionStatement(language, expression) {
  switch (language) {
    case "python":
    case "ocaml":
      return expression;
    default:
      return expression.endsWith(";") ? expression : `${expression};`;
  }
}

// src/ui/codeBlockToolbar.ts
var import_obsidian4 = require("obsidian");
function createCodeBlockToolbar(blockId, isRunning, handlers) {
  const toolbar = document.createElement("div");
  toolbar.className = "loom-code-toolbar";
  toolbar.dataset.loomBlockId = blockId;
  toolbar.appendChild(createButton("Run block", isRunning ? "loader-circle" : "play", handlers.onRun, isRunning));
  toolbar.appendChild(createButton("Toggle stdin input", "text-cursor-input", handlers.onToggleInput, false));
  toolbar.appendChild(createButton("Copy code", "copy", handlers.onCopy, false));
  toolbar.appendChild(createButton("Remove snippet", "trash-2", handlers.onRemove, false));
  toolbar.appendChild(createButton("Toggle output", "panel-bottom-open", handlers.onToggleOutput, false));
  return toolbar;
}
function createButton(label, iconName, onClick, spinning) {
  const button = document.createElement("button");
  button.className = `loom-toolbar-button${spinning ? " is-running" : ""}`;
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  (0, import_obsidian4.setIcon)(button, iconName);
  return button;
}

// src/ui/outputPanel.ts
var import_obsidian5 = require("obsidian");
function getStatusKind(output) {
  if (output.result.success) {
    return output.result.stderr.trim() || output.result.warning?.trim() ? "warning" : "success";
  }
  return "failure";
}
function createOutputPanel(output, options) {
  const panel = document.createElement("div");
  panel.className = `loom-output-panel is-${getStatusKind(output)}${output.visible ? "" : " is-hidden"}`;
  panel.dataset.loomBlockId = output.blockId;
  renderOutputPanel(panel, output, options);
  return panel;
}
function renderOutputPanel(panel, output, options) {
  const kind = getStatusKind(output);
  panel.className = `loom-output-panel is-${kind}${output.visible ? "" : " is-hidden"}${output.collapsed ? " is-collapsed" : ""}`;
  panel.empty();
  const visibleLines = resolveVisibleLines(output, options.defaultVisibleLines);
  const header = panel.createDiv({ cls: "loom-output-header" });
  const badge = header.createDiv({ cls: "loom-output-badge" });
  (0, import_obsidian5.setIcon)(badge, kind === "success" ? "check-circle-2" : kind === "warning" ? "alert-triangle" : "x-circle");
  const title = header.createDiv({ cls: "loom-output-title" });
  title.setText(`${output.result.runnerName} \xB7 exit ${output.result.exitCode ?? "?"}`);
  const meta = header.createDiv({ cls: "loom-output-meta" });
  meta.setText(`${output.result.durationMs} ms \xB7 ${new Date(output.result.finishedAt).toLocaleTimeString()}`);
  const body = panel.createDiv({ cls: "loom-output-body" });
  if (output.result.stdout.trim()) {
    createStream(body, "Stdout", output.result.stdout, visibleLines);
  }
  if (output.result.warning?.trim()) {
    createStream(body, "Warning", output.result.warning, visibleLines);
  }
  if (output.result.stderr.trim()) {
    createStream(body, "Stderr", output.result.stderr, visibleLines);
  }
  if (output.sourcePreview?.content.trim()) {
    createSourcePreview(body, output.sourcePreview);
  }
  if (!output.result.stdout.trim() && !output.result.warning?.trim() && !output.result.stderr.trim() && !output.sourcePreview?.content.trim()) {
    const empty = body.createDiv({ cls: "loom-output-empty" });
    empty.setText("No output");
  }
}
function createStream(container, label, content, visibleLines) {
  const section = container.createDiv({ cls: "loom-output-stream" });
  const lineCount = countLines(content);
  section.createDiv({ cls: "loom-output-stream-label", text: formatStreamLabel(label, lineCount, visibleLines) });
  const pre = section.createEl("pre", { cls: "loom-output-pre", text: content });
  if (visibleLines > 0 && lineCount > visibleLines) {
    pre.addClass("is-scroll-limited");
    pre.style.setProperty("--loom-output-visible-lines", String(visibleLines));
  }
}
function createSourcePreview(container, preview) {
  const details = container.createEl("details", { cls: "loom-source-preview" });
  details.open = preview.expanded;
  const summary = details.createEl("summary", { cls: "loom-source-preview-summary" });
  summary.createSpan({ text: "Extracted source" });
  summary.createSpan({ cls: "loom-source-preview-meta", text: formatSourcePreviewMeta(preview) });
  details.createEl("pre", { cls: "loom-output-pre loom-source-preview-pre", text: preview.content });
}
function formatSourcePreviewMeta(preview) {
  const capability = preview.capability;
  if (!capability || !preview.showCapabilityMetadata) {
    return `${preview.language} \xB7 ${preview.description}`;
  }
  return [
    preview.language,
    preview.description,
    `symbols:${capability.symbolExtraction}`,
    `deps:${capability.dependencyTracing}`,
    `call:${capability.callHarness}`
  ].join(" \xB7 ");
}
function resolveVisibleLines(output, defaultVisibleLines) {
  const override = output.block.attributes["loom-output-lines"] ?? output.block.attributes["output-lines"];
  if (override != null) {
    return normalizeVisibleLines(Number.parseInt(override.trim(), 10));
  }
  return normalizeVisibleLines(defaultVisibleLines);
}
function normalizeVisibleLines(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(Math.floor(value), 2e3);
}
function countLines(content) {
  return content.replace(/\n$/, "").split("\n").length;
}
function formatStreamLabel(label, lineCount, visibleLines) {
  if (visibleLines > 0 && lineCount > visibleLines) {
    return `${label} \xB7 ${lineCount} lines \xB7 showing ${visibleLines}`;
  }
  return label;
}
function createRunningPanel() {
  const panel = document.createElement("div");
  panel.className = "loom-output-panel is-running";
  const header = panel.createDiv({ cls: "loom-output-header" });
  const spinner = header.createDiv({ cls: "loom-spinner" });
  (0, import_obsidian5.setIcon)(spinner, "loader-circle");
  const title = header.createDiv({ cls: "loom-output-title" });
  title.setText("Running");
  const meta = header.createDiv({ cls: "loom-output-meta" });
  meta.setText("Executing...");
  spinner.setAttribute("aria-hidden", "true");
  return panel;
}

// src/main.ts
var loomRefreshEffect = import_state.StateEffect.define();
var ExecutionConsentModal = class extends import_obsidian6.Modal {
  constructor(app, onConfirm) {
    super(app);
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Enable loom local execution?" });
    contentEl.createEl("p", {
      text: "loom runs code from your notes on your local machine using the configured executables. It does not sandbox or isolate the process."
    });
    const actions = contentEl.createDiv({ cls: "loom-modal-actions" });
    const cancelButton = actions.createEl("button", { text: "Cancel" });
    const enableButton = actions.createEl("button", { text: "Enable and run", cls: "mod-cta" });
    cancelButton.addEventListener("click", () => this.close());
    enableButton.addEventListener("click", async () => {
      await this.onConfirm();
      this.close();
    });
  }
};
var loomToolbarRenderChild = class extends import_obsidian6.MarkdownRenderChild {
  constructor(containerEl, plugin, block, codeElement) {
    super(containerEl);
    this.plugin = plugin;
    this.block = block;
    this.codeElement = codeElement;
    this.panelContainer = null;
    this.unregisterOutputListener = null;
  }
  onload() {
    this.codeElement.parentElement?.addClass("loom-codeblock-shell");
    this.codeElement.parentElement?.appendChild(this.plugin.createToolbarElement(this.block));
    if (this.plugin.settings.pdfExportMode === "output") {
      this.codeElement.classList.add("loom-print-hide-code");
    }
    const hostClasses = ["loom-inline-output-host"];
    if (this.plugin.settings.pdfExportMode === "code") {
      hostClasses.push("loom-print-hide-output");
    }
    this.panelContainer = this.containerEl.createDiv({ cls: hostClasses.join(" ") });
    this.plugin.renderOutputInto(this.block, this.panelContainer);
    this.unregisterOutputListener = this.plugin.registerOutputListener(this.block.id, () => {
      if (this.panelContainer) {
        this.plugin.renderOutputInto(this.block, this.panelContainer);
      }
    });
  }
  onunload() {
    this.unregisterOutputListener?.();
  }
};
var loomToolbarWidget = class extends import_view2.WidgetType {
  constructor(plugin, block) {
    super();
    this.plugin = plugin;
    this.block = block;
    this.isRunning = plugin.isBlockRunning(block.id);
  }
  eq(other) {
    return other.block.id === this.block.id && other.isRunning === this.isRunning;
  }
  toDOM() {
    return this.plugin.createToolbarElement(this.block);
  }
};
var loomOutputWidget = class extends import_view2.WidgetType {
  constructor(plugin, block) {
    super();
    this.plugin = plugin;
    this.block = block;
  }
  eq(other) {
    return false;
  }
  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "loom-inline-output-host";
    this.plugin.renderOutputInto(this.block, wrapper);
    return wrapper;
  }
};
var loomPlugin = class extends import_obsidian6.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.registry = new loomRunnerRegistry([
      new PythonRunner(),
      new NodeRunner(),
      new OcamlRunner(),
      new NativeCompiledRunner(),
      new InterpretedRunner(),
      new ManagedCompiledRunner(),
      new EbpfRunner(),
      new LlvmRunner(),
      new ProofRunner(),
      new CustomLanguageRunner()
    ]);
    // Exposed as public and readonly so the settings panel and modals can access container configurations and default language mapping helpers.
    this.containerRunner = new loomContainerRunner(this.app, this.manifest.dir ?? ".obsidian/plugins/loom");
    this.registeredCodeBlockAliases = /* @__PURE__ */ new Set();
    this.outputs = /* @__PURE__ */ new Map();
    this.stdinInputs = /* @__PURE__ */ new Map();
    this.stdinPanels = /* @__PURE__ */ new Set();
    this.running = /* @__PURE__ */ new Map();
    this.outputListeners = /* @__PURE__ */ new Map();
    this.editorViews = /* @__PURE__ */ new Set();
    this.lastMarkdownFilePath = null;
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new loomSettingTab(this));
    this.statusBarItemEl = this.addStatusBarItem();
    this.updateStatusBar();
    this.app.workspace.onLayoutReady(() => {
      this.lastMarkdownFilePath = this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
      void this.enforceSourceModeForActiveView();
    });
    this.addCommand({
      id: "loom-run-current-code-block",
      name: "loom: Run Current Code Block",
      editorCallback: async (editor, view) => {
        const file = view.file;
        if (!file) {
          return;
        }
        const blocks = parseMarkdownCodeBlocks(file.path, editor.getValue(), this.settings);
        const block = findBlockAtLine(blocks, editor.getCursor().line);
        if (!block) {
          new import_obsidian6.Notice("No supported loom block at the current cursor.");
          return;
        }
        await this.runBlock(file, block);
      }
    });
    this.addCommand({
      id: "loom-run-all-code-blocks",
      name: "loom: Run All Supported Code Blocks in Current Note",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.runAllBlocksInFile(file);
        }
        return true;
      }
    });
    this.addCommand({
      id: "loom-clear-note-outputs",
      name: "loom: Clear loom Outputs in Current Note",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.clearOutputsForFile(file);
        }
        return true;
      }
    });
    this.registerCodeBlockProcessors();
    this.registerEditorExtension(this.createLivePreviewExtension());
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.lastMarkdownFilePath = file?.path ?? this.lastMarkdownFilePath;
        this.refreshAllViews();
        void this.enforceSourceModeForActiveView();
        if (file && this.settings.autoRunOnFileOpen) {
          void this.runAllBlocksInFile(file);
        }
      })
    );
    this.addCommand({
      id: "loom-validate-container-groups",
      name: "loom: Validate Container Groups",
      callback: async () => {
        const groups = await this.getContainerGroupSummaries();
        new import_obsidian6.Notice(groups.length ? groups.map((group) => `${group.name}: ${group.status}`).join("\n") : "No loom container groups found.", 8e3);
      }
    });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.lastMarkdownFilePath = this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
        void this.enforceSourceModeForActiveView();
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor, ctx) => {
        if (ctx instanceof import_obsidian6.MarkdownView) {
          void this.enforceSourceModeForLeaf(ctx.leaf);
        }
      })
    );
  }
  onunload() {
    for (const controller of this.running.values()) {
      controller.abort();
    }
  }
  async loadSettings() {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...await this.loadData()
    };
    normalizeLanguageConfiguration(this.settings);
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.registerCodeBlockProcessors();
    this.refreshAllViews();
  }
  isBlockRunning(blockId) {
    return this.running.has(blockId);
  }
  registerOutputListener(blockId, listener) {
    if (!this.outputListeners.has(blockId)) {
      this.outputListeners.set(blockId, /* @__PURE__ */ new Set());
    }
    this.outputListeners.get(blockId)?.add(listener);
    return () => {
      this.outputListeners.get(blockId)?.delete(listener);
    };
  }
  createToolbarElement(block) {
    return createCodeBlockToolbar(block.id, this.isBlockRunning(block.id), {
      onRun: () => void this.runActiveBlockById(block.id),
      onCopy: async () => {
        try {
          await navigator.clipboard.writeText(block.content);
          new import_obsidian6.Notice("Code copied");
        } catch {
          new import_obsidian6.Notice("Clipboard write failed.");
        }
      },
      onRemove: () => void this.removeSnippetById(block.id),
      onToggleInput: () => {
        if (this.stdinPanels.has(block.id)) {
          this.stdinPanels.delete(block.id);
        } else {
          this.stdinPanels.add(block.id);
        }
        this.notifyOutputChanged(block.id);
      },
      onToggleOutput: () => {
        const output = this.outputs.get(block.id);
        if (!output) {
          return;
        }
        output.visible = !output.visible;
        this.notifyOutputChanged(block.id);
      }
    });
  }
  renderOutputInto(block, container) {
    container.empty();
    const blockId = block.id;
    if (this.shouldRenderStdinPanel(block)) {
      container.appendChild(this.createStdinPanel(block));
    }
    const output = this.outputs.get(blockId);
    if (this.running.has(blockId)) {
      container.appendChild(createRunningPanel());
      return;
    }
    if (!output || !output.visible) {
      return;
    }
    container.appendChild(createOutputPanel(output, {
      defaultVisibleLines: this.settings.outputVisibleLines ?? 0
    }));
  }
  async runActiveBlockById(blockId) {
    const block = this.findActiveBlockById(blockId);
    const file = this.getActiveMarkdownFile();
    if (!block || !file) {
      return;
    }
    await this.runBlock(file, block);
  }
  async removeSnippetById(blockId) {
    const block = this.findActiveBlockById(blockId);
    if (!block) {
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(block.filePath);
    if (!(file instanceof import_obsidian6.TFile)) {
      return;
    }
    this.running.get(blockId)?.abort();
    this.running.delete(blockId);
    this.outputs.delete(blockId);
    await this.app.vault.process(file, (content) => {
      const lines = content.split(/\r?\n/);
      const blocks = parseMarkdownCodeBlocks(file.path, content, this.settings);
      const currentBlock = blocks.find((candidate) => candidate.id === blockId);
      if (!currentBlock) {
        return content;
      }
      const managedRange = this.findManagedOutputRange(lines, blockId);
      const removalStart = currentBlock.startLine;
      const removalEnd = managedRange ? managedRange.end : currentBlock.endLine;
      lines.splice(removalStart, removalEnd - removalStart + 1);
      while (removalStart < lines.length - 1 && lines[removalStart] === "" && lines[removalStart + 1] === "") {
        lines.splice(removalStart, 1);
      }
      return lines.join("\n");
    });
    this.notifyOutputChanged(blockId);
    this.updateStatusBar();
    new import_obsidian6.Notice("loom snippet removed.");
  }
  async runAllBlocksInFile(file) {
    const source = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings);
    const supportedBlocks = blocks.filter((block) => {
      const executionContext = resolveExecutionContext(this.app, file, block, this.settings);
      return executionContext.containerGroup || this.registry.getRunnerForBlock(block, this.settings);
    });
    if (!supportedBlocks.length) {
      new import_obsidian6.Notice("No supported loom blocks found in the current note.");
      return;
    }
    for (const block of supportedBlocks) {
      await this.runBlock(file, block);
    }
  }
  async clearOutputsForFile(file) {
    const source = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings);
    for (const block of blocks) {
      this.outputs.delete(block.id);
      this.notifyOutputChanged(block.id);
      await this.removeManagedOutputBlock(file.path, block.id);
    }
    new import_obsidian6.Notice("loom outputs cleared.");
  }
  async runBlock(file, block) {
    this.lastMarkdownFilePath = file.path;
    if (this.running.has(block.id)) {
      new import_obsidian6.Notice("This loom block is already running.");
      return;
    }
    if (!await this.ensureExecutionEnabled()) {
      showExecutionDisabledNotice();
      return;
    }
    const executionContext = resolveExecutionContext(this.app, file, block, this.settings);
    const containerGroup = executionContext.containerGroup;
    const runner = containerGroup ? null : this.registry.getRunnerForBlock(block, this.settings);
    if (!runner) {
      if (!containerGroup) {
        new import_obsidian6.Notice(`No configured runner for ${block.language}.`);
        return;
      }
    }
    const controller = new AbortController();
    const stdin = await this.resolveBlockStdin(file, block);
    const runContext = {
      file,
      workingDirectory: executionContext.workingDirectory,
      timeoutMs: executionContext.timeoutMs,
      signal: controller.signal,
      stdin
    };
    this.running.set(block.id, controller);
    this.notifyOutputChanged(block.id);
    this.updateStatusBar();
    try {
      const resolvedBlock = await this.resolveExecutableBlock(file, block);
      const result = containerGroup ? await this.containerRunner.run(resolvedBlock.block, runContext, this.settings, containerGroup) : await runner.run(resolvedBlock.block, runContext, this.settings);
      if (result.timedOut) {
        result.stderr = result.stderr || `Execution timed out after ${this.settings.defaultTimeoutMs} ms.`;
      } else if (result.cancelled) {
        result.stderr = result.stderr || "Execution cancelled.";
      } else if (!result.success && !result.stderr.trim()) {
        result.stderr = "Process exited unsuccessfully.";
      }
      if (resolvedBlock.sourcePreview) {
        const sourceNotice = `Ran extracted source from ${resolvedBlock.sourcePreview.description}.`;
        result.warning = result.warning ? `${sourceNotice}
${result.warning}` : sourceNotice;
      }
      if (this.hasExplicitExecutionContext(executionContext)) {
        const contextNotice = this.formatExecutionContextNotice(executionContext);
        result.warning = result.warning ? `${contextNotice}
${result.warning}` : contextNotice;
      }
      await this.writeOutputFileIfRequested(file, block, result);
      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        result,
        sourcePreview: resolvedBlock.sourcePreview,
        collapsed: false,
        visible: true
      });
      if (this.settings.writeOutputToNote) {
        await this.writeManagedOutputBlock(file, block, result);
      }
      const runnerName = containerGroup ? `container ${containerGroup}` : runner.displayName;
      new import_obsidian6.Notice(result.success ? `loom ran ${runnerName} block.` : `loom run failed for ${runnerName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        collapsed: false,
        visible: true,
        result: {
          runnerId: containerGroup ? `container:${containerGroup}` : runner?.id ?? "unknown",
          runnerName: containerGroup ? `Container ${containerGroup}` : runner?.displayName ?? "Unknown",
          startedAt: (/* @__PURE__ */ new Date()).toISOString(),
          finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
          durationMs: 0,
          exitCode: -1,
          stdout: "",
          stderr: message,
          success: false,
          timedOut: false,
          cancelled: false
        }
      });
      new import_obsidian6.Notice(`loom error: ${message}`);
    } finally {
      this.running.delete(block.id);
      this.notifyOutputChanged(block.id);
      this.updateStatusBar();
    }
  }
  async ensureExecutionEnabled() {
    if (this.settings.enableLocalExecution && this.settings.hasAcknowledgedExecutionRisk) {
      return true;
    }
    return await new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      const modal = new ExecutionConsentModal(this.app, async () => {
        this.settings.enableLocalExecution = true;
        this.settings.hasAcknowledgedExecutionRisk = true;
        await this.saveSettings();
        settle(true);
      });
      const originalClose = modal.close.bind(modal);
      modal.close = () => {
        originalClose();
        settle(this.settings.enableLocalExecution && this.settings.hasAcknowledgedExecutionRisk);
      };
      modal.open();
    });
  }
  async resolveExecutableBlock(file, block) {
    if (!block.sourceReference) {
      return { block };
    }
    const referencePath = this.resolveReferencedVaultPath(file, block.sourceReference.filePath);
    const sourceFile = this.app.vault.getAbstractFileByPath(referencePath);
    if (!(sourceFile instanceof import_obsidian6.TFile)) {
      throw new Error(`Referenced source file not found: ${referencePath}`);
    }
    const harness = buildSourceReferenceHarness(block);
    const externalExtractor = this.getCustomLanguageExtractor(block, file);
    const resolved = await resolveReferencedSource(
      await this.app.vault.cachedRead(sourceFile),
      { ...block.sourceReference, filePath: referencePath },
      block.language,
      harness,
      {
        pythonExecutable: this.settings.pythonExecutable.trim() || "python3",
        externalExtractor,
        readFile: async (filePath) => {
          const importedFile = this.app.vault.getAbstractFileByPath((0, import_obsidian6.normalizePath)(filePath));
          return importedFile instanceof import_obsidian6.TFile ? this.app.vault.cachedRead(importedFile) : null;
        },
        resolvePythonImport: async (fromFilePath, moduleName, level) => this.resolvePythonImportVaultPath(fromFilePath, moduleName, level)
      }
    );
    const capability = getLanguageCapability(block.language, Boolean(externalExtractor));
    const shouldShowPreview = (this.settings.extractedSourcePreviewMode || "collapsed") !== "hidden";
    return {
      block: {
        ...block,
        content: resolved.content
      },
      sourcePreview: shouldShowPreview ? {
        description: resolved.description,
        language: block.language,
        content: resolved.content,
        capability,
        expanded: this.settings.extractedSourcePreviewMode === "expanded",
        showCapabilityMetadata: this.settings.showLanguageCapabilityMetadata ?? true
      } : void 0
    };
  }
  resolveReferencedVaultPath(file, referencePath) {
    const trimmed = referencePath.trim();
    if (!trimmed) {
      return trimmed;
    }
    if (trimmed.startsWith("/")) {
      return (0, import_obsidian6.normalizePath)(trimmed.slice(1));
    }
    const baseDir = (0, import_path10.dirname)(file.path);
    return (0, import_obsidian6.normalizePath)(baseDir === "." ? trimmed : `${baseDir}/${trimmed}`);
  }
  resolvePythonImportVaultPath(fromFilePath, moduleName, level) {
    const modulePath = moduleName.split(".").map((part) => part.trim()).filter(Boolean).join("/");
    const fromDir = (0, import_path10.dirname)(fromFilePath);
    const baseDirs = level > 0 ? [this.ascendVaultPath(fromDir === "." ? "" : fromDir, level - 1)] : [fromDir === "." ? "" : fromDir, ""];
    for (const baseDir of baseDirs) {
      const candidates = this.getPythonImportCandidates(baseDir, modulePath);
      for (const candidate of candidates) {
        const normalized = (0, import_obsidian6.normalizePath)(candidate);
        if (this.app.vault.getAbstractFileByPath(normalized) instanceof import_obsidian6.TFile) {
          return normalized;
        }
      }
    }
    return null;
  }
  getPythonImportCandidates(baseDir, modulePath) {
    const prefix = baseDir ? `${baseDir}/` : "";
    if (!modulePath) {
      return [`${prefix}__init__.py`];
    }
    return [
      `${prefix}${modulePath}.py`,
      `${prefix}${modulePath}/__init__.py`
    ];
  }
  ascendVaultPath(path, levels) {
    let current = path;
    for (let index = 0; index < levels; index += 1) {
      const next = (0, import_path10.dirname)(current);
      current = next === "." ? "" : next;
    }
    return current;
  }
  async getContainerGroupSummaries() {
    return this.containerRunner.getGroupSummaries();
  }
  async buildContainerGroup(name) {
    const controller = new AbortController();
    const result = await this.containerRunner.buildGroup(name, Math.max(this.settings.defaultTimeoutMs, 12e4), controller.signal);
    new import_obsidian6.Notice(result.success ? `loom built container group ${name}.` : `loom container build failed for ${name}.`, 8e3);
  }
  registerCodeBlockProcessors() {
    for (const alias of getSupportedLanguageAliases(this.settings)) {
      const normalizedAlias = alias.toLowerCase();
      if (this.registeredCodeBlockAliases.has(normalizedAlias)) {
        continue;
      }
      if (/[^a-zA-Z0-9_-]/.test(normalizedAlias)) {
        continue;
      }
      this.registeredCodeBlockAliases.add(normalizedAlias);
      this.registerMarkdownCodeBlockProcessor(normalizedAlias, async (source, el, ctx) => {
        const filePath = ctx.sourcePath;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof import_obsidian6.TFile)) {
          return;
        }
        const fullText = await this.app.vault.cachedRead(file);
        const blocks = parseMarkdownCodeBlocks(filePath, fullText, this.settings);
        const section = ctx && typeof ctx.getSectionInfo === "function" ? ctx.getSectionInfo(el) : null;
        let block;
        if (section) {
          const lineStart = section.lineStart;
          block = blocks.find((candidate) => candidate.startLine === lineStart && candidate.content === source);
        } else {
          block = blocks.find((candidate) => candidate.content === source);
        }
        if (!block) {
          return;
        }
        let pre = el.querySelector("pre");
        if (!pre) {
          pre = el.createEl("pre");
          pre.addClass(`language-${normalizedAlias}`);
          const code = pre.createEl("code");
          code.addClass(`language-${normalizedAlias}`);
          code.setText(source);
        }
        if (block.language === "llvm-ir") {
          const code = pre.querySelector("code") ?? pre;
          highlightLlvmElement(code, source);
        }
        ctx.addChild(new loomToolbarRenderChild(el, this, block, pre));
      });
    }
  }
  updateStatusBar() {
    const activeRuns = this.running.size;
    this.statusBarItemEl.setText(activeRuns ? `loom: ${activeRuns} Active Run${activeRuns === 1 ? "" : "s"}` : "loom: Idle");
  }
  notifyOutputChanged(blockId) {
    this.outputListeners.get(blockId)?.forEach((listener) => listener());
    this.refreshAllViews();
  }
  refreshAllViews() {
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      const view = leaf.view;
      const previewMode = view.previewMode;
      previewMode?.rerender?.(true);
    });
    for (const editorView of this.editorViews) {
      editorView.dispatch({ effects: loomRefreshEffect.of(void 0) });
    }
  }
  getActiveMarkdownFile() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    return view?.file ?? null;
  }
  getCurrentEditorFilePath() {
    return this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
  }
  async enforceSourceModeForActiveView() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    if (!view) {
      return;
    }
    await this.enforceSourceModeForLeaf(view.leaf);
  }
  async disableSourceModeForActiveView() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    if (!view) {
      return;
    }
    const leaf = view.leaf;
    const viewState = leaf.getViewState();
    const state = { ...viewState.state ?? {} };
    if (state.mode === "source" && state.source === true) {
      state.source = false;
      await leaf.setViewState({
        ...viewState,
        state
      });
    }
  }
  async enforceSourceModeForLeaf(leaf) {
    if (!this.settings.preserveSourceMode) {
      return;
    }
    if (leaf.isDeferred) {
      await leaf.loadIfDeferred();
    }
    const view = leaf.view;
    if (!(view instanceof import_obsidian6.MarkdownView) || !view.file) {
      return;
    }
    const source = view.editor?.getValue?.() ?? await this.app.vault.cachedRead(view.file);
    const blocks = parseMarkdownCodeBlocks(view.file.path, source, this.settings);
    if (!blocks.length) {
      return;
    }
    const viewState = leaf.getViewState();
    const state = { ...viewState.state ?? {} };
    if (state.mode === "source" && state.source === true) {
      return;
    }
    state.mode = "source";
    state.source = true;
    await leaf.setViewState({
      ...viewState,
      state
    });
  }
  findActiveBlockById(blockId) {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    const file = view?.file;
    const editor = view?.editor;
    if (!file || !editor) {
      return this.outputs.get(blockId)?.block ?? null;
    }
    const blocks = parseMarkdownCodeBlocks(file.path, editor.getValue(), this.settings);
    return blocks.find((block) => block.id === blockId) ?? this.outputs.get(blockId)?.block ?? null;
  }
  createLivePreviewExtension() {
    const plugin = this;
    return import_view2.ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.view = view;
          plugin.editorViews.add(view);
          this.decorations = this.buildDecorations();
        }
        update(update) {
          if (update.docChanged || update.viewportChanged || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(loomRefreshEffect)))) {
            this.decorations = this.buildDecorations();
          }
        }
        destroy() {
          plugin.editorViews.delete(this.view);
        }
        buildDecorations() {
          const filePath = plugin.getCurrentEditorFilePath();
          if (!filePath) {
            return import_view2.Decoration.none;
          }
          const source = this.view.state.doc.toString();
          const blocks = parseMarkdownCodeBlocks(filePath, source, plugin.settings);
          const builder = new import_state.RangeSetBuilder();
          for (const block of blocks) {
            const startLine = this.view.state.doc.line(block.startLine + 1);
            builder.add(
              startLine.from,
              startLine.from,
              import_view2.Decoration.widget({
                widget: new loomToolbarWidget(plugin, block),
                side: -1
              })
            );
            if (plugin.outputs.has(block.id) || plugin.running.has(block.id) || plugin.shouldRenderStdinPanel(block)) {
              const endLine = this.view.state.doc.line(block.endLine + 1);
              builder.add(
                endLine.to,
                endLine.to,
                import_view2.Decoration.widget({
                  widget: new loomOutputWidget(plugin, block),
                  side: 1
                })
              );
            }
            if (block.language === "llvm-ir") {
              addLlvmDecorations(builder, this.view, block);
            }
          }
          return builder.finish();
        }
      },
      {
        decorations: (value) => value.decorations
      }
    );
  }
  hasExplicitExecutionContext(context) {
    return context.source.container !== "none" || context.source.workingDirectory !== "default" || context.source.timeout !== "global";
  }
  formatExecutionContextNotice(context) {
    const pieces = [
      `container=${context.containerGroup ?? "native"} (${context.source.container})`,
      `cwd=${context.workingDirectory} (${context.source.workingDirectory})`,
      `timeout=${context.timeoutMs}ms (${context.source.timeout})`
    ];
    return `Execution context: ${pieces.join(", ")}.`;
  }
  getCustomLanguageExtractor(block, file) {
    const languageId = block.language;
    const normalized = languageId.trim().toLowerCase();
    const language = this.settings.customLanguages.find((candidate) => {
      const name = candidate.name.trim().toLowerCase();
      const aliases = candidate.aliases.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
      return name === normalized || aliases.includes(normalized);
    });
    if (!language) {
      return void 0;
    }
    const mode = language.extractorMode || "command";
    const executable = mode === "transpile-c" ? language.transpileExecutable?.trim() : language.extractorExecutable?.trim();
    const args = mode === "transpile-c" ? language.transpileArgs || "{request}" : language.extractorArgs || "{request}";
    if (!executable) {
      return void 0;
    }
    const executionContext = resolveExecutionContext(this.app, file, block, this.settings);
    return {
      mode,
      language: language.name,
      executable,
      args: splitCommandLine(args),
      workingDirectory: executionContext.workingDirectory,
      timeoutMs: executionContext.timeoutMs
    };
  }
  async writeManagedOutputBlock(file, block, result) {
    await this.app.vault.process(file, (content) => {
      const lines = content.split(/\r?\n/);
      const blocks = parseMarkdownCodeBlocks(file.path, content, this.settings);
      const currentBlock = blocks.find((candidate) => candidate.id === block.id);
      const rendered = this.renderManagedOutputMarkdown(block.id, result);
      const existingRange = this.findManagedOutputRange(lines, block.id);
      if (existingRange) {
        lines.splice(existingRange.start, existingRange.end - existingRange.start + 1, ...rendered);
        return lines.join("\n");
      }
      if (!currentBlock) {
        return content;
      }
      lines.splice(currentBlock.endLine + 1, 0, ...rendered);
      return lines.join("\n");
    });
  }
  async writeOutputFileIfRequested(file, block, result) {
    try {
      const target = this.readOutputFileTarget(file, block);
      if (!target) {
        return;
      }
      await this.ensureVaultParentFolder(target.path);
      const rendered = target.format === "json" ? this.renderOutputFileJson(file, block, result, target) : this.renderOutputFileText(result, target);
      const current = target.mode === "append" && await this.app.vault.adapter.exists(target.path) ? await this.app.vault.adapter.read(target.path) : "";
      const next = target.mode === "append" && current ? `${current.replace(/\s*$/, "\n")}${rendered}` : rendered;
      await this.app.vault.adapter.write(target.path, next);
      const streamList = target.streams.join(",");
      const notice = `Wrote output file ${target.path} (${target.mode}, ${target.format}, ${streamList}).`;
      result.warning = result.warning ? `${notice}
${result.warning}` : notice;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const notice = `Failed to write output file: ${message}`;
      result.warning = result.warning ? `${notice}
${result.warning}` : notice;
    }
  }
  readOutputFileTarget(file, block) {
    const rawPath = block.attributes["loom-output-file"] ?? block.attributes["output-file"];
    if (!rawPath?.trim()) {
      return null;
    }
    return {
      path: this.resolveOutputVaultPath(file, rawPath),
      mode: this.readOutputFileMode(block),
      format: this.readOutputFileFormat(block),
      streams: this.readOutputFileStreams(block)
    };
  }
  readOutputFileMode(block) {
    const append = block.attributes["loom-output-append"] ?? block.attributes["output-append"];
    if (append && !["0", "false", "no", "off"].includes(append.trim().toLowerCase())) {
      return "append";
    }
    const mode = (block.attributes["loom-output-file-mode"] ?? block.attributes["output-file-mode"] ?? "replace").trim().toLowerCase();
    if (mode === "append") {
      return "append";
    }
    if (mode === "replace") {
      return "replace";
    }
    throw new Error(`Unsupported loom-output-file-mode: ${mode}. Use replace or append.`);
  }
  readOutputFileFormat(block) {
    const format = (block.attributes["loom-output-file-format"] ?? block.attributes["output-file-format"] ?? "text").trim().toLowerCase();
    if (format === "text" || format === "json") {
      return format;
    }
    throw new Error(`Unsupported loom-output-file-format: ${format}. Use text or json.`);
  }
  readOutputFileStreams(block) {
    const value = block.attributes["loom-output-file-streams"] ?? block.attributes["output-file-streams"] ?? "stdout";
    const parsed = value.split(",").map((stream) => stream.trim().toLowerCase()).filter(Boolean);
    const expanded = parsed.includes("all") ? ["metadata", "stdout", "warning", "stderr"] : parsed;
    const streams = expanded.map((stream) => {
      if (stream === "stdout" || stream === "stderr" || stream === "warning" || stream === "metadata") {
        return stream;
      }
      throw new Error(`Unsupported loom-output-file-streams entry: ${stream}.`);
    });
    return streams.length ? [...new Set(streams)] : ["stdout"];
  }
  resolveOutputVaultPath(file, rawPath) {
    const trimmed = rawPath.trim();
    if (!trimmed || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      throw new Error("loom-output-file must be a vault-relative path.");
    }
    const path = trimmed.startsWith("/") ? (0, import_obsidian6.normalizePath)(trimmed.slice(1)) : (0, import_obsidian6.normalizePath)((0, import_path10.dirname)(file.path) === "." ? trimmed : `${(0, import_path10.dirname)(file.path)}/${trimmed}`);
    const parts = path.split("/").filter(Boolean);
    if (!parts.length || parts.includes("..") || path.startsWith(".obsidian/") || path === ".obsidian" || path.startsWith(".git/") || path === ".git") {
      throw new Error(`Invalid loom-output-file path: ${rawPath}`);
    }
    return path;
  }
  async ensureVaultParentFolder(path) {
    const folder = (0, import_path10.dirname)(path);
    if (!folder || folder === ".") {
      return;
    }
    let current = "";
    for (const part of folder.split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (!await this.app.vault.adapter.exists(current)) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }
  renderOutputFileText(result, target) {
    const sections = target.streams.flatMap((stream) => {
      switch (stream) {
        case "metadata":
          return [
            `runner=${result.runnerName}`,
            `exit=${result.exitCode ?? "?"}`,
            `duration=${result.durationMs}ms`,
            `timestamp=${result.finishedAt}`
          ].join("\n");
        case "stdout":
          return result.stdout ? [result.stdout] : [];
        case "warning":
          return result.warning ? [result.warning] : [];
        case "stderr":
          return result.stderr ? [result.stderr] : [];
      }
    });
    return `${sections.join("\n\n").replace(/\s*$/, "")}
`;
  }
  renderOutputFileJson(file, block, result, target) {
    const payload = {
      note: file.path,
      blockId: block.id,
      language: block.language,
      runner: result.runnerName,
      exitCode: result.exitCode,
      success: result.success,
      durationMs: result.durationMs,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      streams: {
        ...target.streams.includes("stdout") ? { stdout: result.stdout } : {},
        ...target.streams.includes("warning") ? { warning: result.warning ?? "" } : {},
        ...target.streams.includes("stderr") ? { stderr: result.stderr } : {}
      }
    };
    return `${JSON.stringify(payload, null, 2)}
`;
  }
  async removeManagedOutputBlock(filePath, blockId) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof import_obsidian6.TFile)) {
      return;
    }
    await this.app.vault.process(file, (content) => {
      const lines = content.split(/\r?\n/);
      const range = this.findManagedOutputRange(lines, blockId);
      if (!range) {
        return content;
      }
      lines.splice(range.start, range.end - range.start + 1);
      return lines.join("\n");
    });
  }
  renderManagedOutputMarkdown(blockId, result) {
    const body = [
      `runner=${result.runnerName}`,
      `exit=${result.exitCode ?? "?"}`,
      `duration=${result.durationMs}ms`,
      `timestamp=${result.finishedAt}`,
      result.stdout ? `stdout:
${result.stdout}` : "",
      result.warning ? `warning:
${result.warning}` : "",
      result.stderr ? `stderr:
${result.stderr}` : ""
    ].filter(Boolean).join("\n\n");
    return [
      `<!-- loom:output:start id=${blockId} -->`,
      "```text",
      body,
      "```",
      "<!-- loom:output:end -->"
    ];
  }
  findManagedOutputRange(lines, blockId) {
    const startMarker = `<!-- loom:output:start id=${blockId} -->`;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].trim() !== startMarker) {
        continue;
      }
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].trim() === "<!-- loom:output:end -->") {
          return { start: i, end: j };
        }
      }
    }
    return null;
  }
  shouldRenderStdinPanel(block) {
    return this.stdinPanels.has(block.id) || this.hasEnabledStdinAttribute(block);
  }
  hasEnabledStdinAttribute(block) {
    const input = block.attributes["loom-input"] ?? block.attributes.input;
    if (input && !["0", "false", "no", "off"].includes(input.trim().toLowerCase())) {
      return true;
    }
    return block.attributes["loom-stdin"] != null || block.attributes.stdin != null || block.attributes["loom-stdin-file"] != null || block.attributes["stdin-file"] != null;
  }
  createStdinPanel(block) {
    const panel = document.createElement("div");
    panel.className = "loom-stdin-panel";
    const header = panel.createDiv({ cls: "loom-stdin-header" });
    header.createSpan({ text: "stdin" });
    const actions = header.createDiv({ cls: "loom-stdin-actions" });
    const runButton = actions.createEl("button", { text: "Run" });
    const clearButton = actions.createEl("button", { text: "Clear" });
    const textarea = panel.createEl("textarea", { cls: "loom-stdin-input" });
    textarea.placeholder = this.getStdinPlaceholder(block);
    textarea.value = this.stdinInputs.get(block.id) ?? block.attributes["loom-stdin"] ?? block.attributes.stdin ?? "";
    textarea.addEventListener("input", () => {
      this.stdinInputs.set(block.id, textarea.value);
    });
    runButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.stdinInputs.set(block.id, textarea.value);
      void this.runActiveBlockById(block.id);
    });
    clearButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      textarea.value = "";
      this.stdinInputs.set(block.id, "");
    });
    return panel;
  }
  getStdinPlaceholder(block) {
    const stdinFile = block.attributes["loom-stdin-file"] ?? block.attributes["stdin-file"];
    return stdinFile ? `stdin file: ${stdinFile}` : "standard input for this block";
  }
  async resolveBlockStdin(file, block) {
    if (this.stdinInputs.has(block.id)) {
      return this.stdinInputs.get(block.id);
    }
    const inline = block.attributes["loom-stdin"] ?? block.attributes.stdin;
    if (inline != null) {
      return decodeEscapedAttribute(inline);
    }
    const stdinFile = block.attributes["loom-stdin-file"] ?? block.attributes["stdin-file"];
    if (!stdinFile?.trim()) {
      return void 0;
    }
    const stdinPath = this.resolveReferencedVaultPath(file, stdinFile);
    const inputFile = this.app.vault.getAbstractFileByPath(stdinPath);
    if (!(inputFile instanceof import_obsidian6.TFile)) {
      throw new Error(`stdin file not found: ${stdinPath}`);
    }
    return this.app.vault.cachedRead(inputFile);
  }
};
function decodeEscapedAttribute(value) {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "	");
}
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXIudHMiLCAic3JjL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyLnRzIiwgInNyYy91dGlscy9jb21tYW5kLnRzIiwgInNyYy9leGVjdXRpb25Db250ZXh0LnRzIiwgInNyYy9sbHZtSGlnaGxpZ2h0LnRzIiwgInNyYy91dGlscy9oYXNoLnRzIiwgInNyYy9sYW5ndWFnZVBhY2thZ2VzLnRzIiwgInNyYy9wYXJzZXIudHMiLCAic3JjL2xhbmd1YWdlQ2FwYWJpbGl0aWVzLnRzIiwgInNyYy9ydW5uZXJzL25vZGUudHMiLCAic3JjL3J1bm5lcnMvY3VzdG9tLnRzIiwgInNyYy9ydW5uZXJzL2ludGVycHJldGVkLnRzIiwgInNyYy9ydW5uZXJzL2VicGYudHMiLCAic3JjL3J1bm5lcnMvbGx2bS50cyIsICJzcmMvcnVubmVycy9tYW5hZ2VkQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvbmF0aXZlQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvb2NhbWwudHMiLCAic3JjL3J1bm5lcnMvcHl0aG9uLnRzIiwgInNyYy9ydW5uZXJzL3Byb29mLnRzIiwgInNyYy9ydW5uZXJzL3JlZ2lzdHJ5LnRzIiwgInNyYy9kZWZhdWx0U2V0dGluZ3MudHMiLCAic3JjL3NldHRpbmdzLnRzIiwgInNyYy9zb3VyY2VFeHRyYWN0LnRzIiwgInNyYy9zb3VyY2VIYXJuZXNzLnRzIiwgInNyYy91aS9jb2RlQmxvY2tUb29sYmFyLnRzIiwgInNyYy91aS9vdXRwdXRQYW5lbC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHtcbiAgTWFya2Rvd25SZW5kZXJDaGlsZCxcbiAgTWFya2Rvd25WaWV3LFxuICBNb2RhbCxcbiAgTm90aWNlLFxuICBQbHVnaW4sXG4gIFRGaWxlLFxuICBXb3Jrc3BhY2VMZWFmLFxuICBub3JtYWxpemVQYXRoLFxufSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7IFJhbmdlU2V0QnVpbGRlciwgU3RhdGVFZmZlY3QgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivc3RhdGVcIjtcbmltcG9ydCB7IERlY29yYXRpb24sIEVkaXRvclZpZXcsIFZpZXdQbHVnaW4sIFZpZXdVcGRhdGUsIFdpZGdldFR5cGUgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xuaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBsb29tQ29udGFpbmVyUnVubmVyIH0gZnJvbSBcIi4vZXhlY3V0aW9uL2NvbnRhaW5lclJ1bm5lclwiO1xuaW1wb3J0IHsgcmVzb2x2ZUV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tIFwiLi9leGVjdXRpb25Db250ZXh0XCI7XG5pbXBvcnQgeyBhZGRMbHZtRGVjb3JhdGlvbnMsIGhpZ2hsaWdodExsdm1FbGVtZW50IH0gZnJvbSBcIi4vbGx2bUhpZ2hsaWdodFwiO1xuaW1wb3J0IHsgZmluZEJsb2NrQXRMaW5lLCBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXMsIHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzIH0gZnJvbSBcIi4vcGFyc2VyXCI7XG5pbXBvcnQgeyBnZXRMYW5ndWFnZUNhcGFiaWxpdHkgfSBmcm9tIFwiLi9sYW5ndWFnZUNhcGFiaWxpdGllc1wiO1xuaW1wb3J0IHsgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uIH0gZnJvbSBcIi4vbGFuZ3VhZ2VQYWNrYWdlc1wiO1xuaW1wb3J0IHsgTm9kZVJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvbm9kZVwiO1xuaW1wb3J0IHsgQ3VzdG9tTGFuZ3VhZ2VSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL2N1c3RvbVwiO1xuaW1wb3J0IHsgSW50ZXJwcmV0ZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL2ludGVycHJldGVkXCI7XG5pbXBvcnQgeyBFYnBmUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9lYnBmXCI7XG5pbXBvcnQgeyBMbHZtUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9sbHZtXCI7XG5pbXBvcnQgeyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL21hbmFnZWRDb21waWxlZFwiO1xuaW1wb3J0IHsgTmF0aXZlQ29tcGlsZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL25hdGl2ZUNvbXBpbGVkXCI7XG5pbXBvcnQgeyBPY2FtbFJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvb2NhbWxcIjtcbmltcG9ydCB7IFB5dGhvblJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvcHl0aG9uXCI7XG5pbXBvcnQgeyBQcm9vZlJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvcHJvb2ZcIjtcbmltcG9ydCB7IGxvb21SdW5uZXJSZWdpc3RyeSB9IGZyb20gXCIuL3J1bm5lcnMvcmVnaXN0cnlcIjtcbmltcG9ydCB7IERFRkFVTFRfU0VUVElOR1MgfSBmcm9tIFwiLi9kZWZhdWx0U2V0dGluZ3NcIjtcbmltcG9ydCB7IGxvb21TZXR0aW5nVGFiLCBzaG93RXhlY3V0aW9uRGlzYWJsZWROb3RpY2UgfSBmcm9tIFwiLi9zZXR0aW5nc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2UgfSBmcm9tIFwiLi9zb3VyY2VFeHRyYWN0XCI7XG5pbXBvcnQgeyBidWlsZFNvdXJjZVJlZmVyZW5jZUhhcm5lc3MgfSBmcm9tIFwiLi9zb3VyY2VIYXJuZXNzXCI7XG5pbXBvcnQgeyBjcmVhdGVDb2RlQmxvY2tUb29sYmFyIH0gZnJvbSBcIi4vdWkvY29kZUJsb2NrVG9vbGJhclwiO1xuaW1wb3J0IHsgY3JlYXRlT3V0cHV0UGFuZWwsIGNyZWF0ZVJ1bm5pbmdQYW5lbCB9IGZyb20gXCIuL3VpL291dHB1dFBhbmVsXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHQsIGxvb21TdG9yZWRPdXRwdXQgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5jb25zdCBsb29tUmVmcmVzaEVmZmVjdCA9IFN0YXRlRWZmZWN0LmRlZmluZTx2b2lkPigpO1xudHlwZSBsb29tT3V0cHV0RmlsZU1vZGUgPSBcInJlcGxhY2VcIiB8IFwiYXBwZW5kXCI7XG50eXBlIGxvb21PdXRwdXRGaWxlRm9ybWF0ID0gXCJ0ZXh0XCIgfCBcImpzb25cIjtcbnR5cGUgbG9vbU91dHB1dEZpbGVTdHJlYW0gPSBcInN0ZG91dFwiIHwgXCJzdGRlcnJcIiB8IFwid2FybmluZ1wiIHwgXCJtZXRhZGF0YVwiO1xuXG5pbnRlcmZhY2UgbG9vbU91dHB1dEZpbGVUYXJnZXQge1xuICBwYXRoOiBzdHJpbmc7XG4gIG1vZGU6IGxvb21PdXRwdXRGaWxlTW9kZTtcbiAgZm9ybWF0OiBsb29tT3V0cHV0RmlsZUZvcm1hdDtcbiAgc3RyZWFtczogbG9vbU91dHB1dEZpbGVTdHJlYW1bXTtcbn1cblxuY2xhc3MgRXhlY3V0aW9uQ29uc2VudE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IFBsdWdpbltcImFwcFwiXSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uQ29uZmlybTogKCkgPT4gUHJvbWlzZTx2b2lkPixcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgfVxuXG4gIG9uT3BlbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiRW5hYmxlIGxvb20gbG9jYWwgZXhlY3V0aW9uP1wiIH0pO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDogXCJsb29tIHJ1bnMgY29kZSBmcm9tIHlvdXIgbm90ZXMgb24geW91ciBsb2NhbCBtYWNoaW5lIHVzaW5nIHRoZSBjb25maWd1cmVkIGV4ZWN1dGFibGVzLiBJdCBkb2VzIG5vdCBzYW5kYm94IG9yIGlzb2xhdGUgdGhlIHByb2Nlc3MuXCIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBhY3Rpb25zID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW1vZGFsLWFjdGlvbnNcIiB9KTtcbiAgICBjb25zdCBjYW5jZWxCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJDYW5jZWxcIiB9KTtcbiAgICBjb25zdCBlbmFibGVCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJFbmFibGUgYW5kIHJ1blwiLCBjbHM6IFwibW9kLWN0YVwiIH0pO1xuXG4gICAgY2FuY2VsQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGVuYWJsZUJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5vbkNvbmZpcm0oKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9KTtcbiAgfVxufVxuXG5jbGFzcyBsb29tVG9vbGJhclJlbmRlckNoaWxkIGV4dGVuZHMgTWFya2Rvd25SZW5kZXJDaGlsZCB7XG4gIHByaXZhdGUgcGFuZWxDb250YWluZXI6IEhUTUxEaXZFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdW5yZWdpc3Rlck91dHB1dExpc3RlbmVyOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBjb250YWluZXJFbDogSFRNTEVsZW1lbnQsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvZGVFbGVtZW50OiBIVE1MRWxlbWVudCxcbiAgKSB7XG4gICAgc3VwZXIoY29udGFpbmVyRWwpO1xuICB9XG5cbiAgb25sb2FkKCk6IHZvaWQge1xuICAgIHRoaXMuY29kZUVsZW1lbnQucGFyZW50RWxlbWVudD8uYWRkQ2xhc3MoXCJsb29tLWNvZGVibG9jay1zaGVsbFwiKTtcbiAgICB0aGlzLmNvZGVFbGVtZW50LnBhcmVudEVsZW1lbnQ/LmFwcGVuZENoaWxkKHRoaXMucGx1Z2luLmNyZWF0ZVRvb2xiYXJFbGVtZW50KHRoaXMuYmxvY2spKTtcblxuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcIm91dHB1dFwiKSB7XG4gICAgICB0aGlzLmNvZGVFbGVtZW50LmNsYXNzTGlzdC5hZGQoXCJsb29tLXByaW50LWhpZGUtY29kZVwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBob3N0Q2xhc3NlcyA9IFtcImxvb20taW5saW5lLW91dHB1dC1ob3N0XCJdO1xuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcImNvZGVcIikge1xuICAgICAgaG9zdENsYXNzZXMucHVzaChcImxvb20tcHJpbnQtaGlkZS1vdXRwdXRcIik7XG4gICAgfVxuICAgIHRoaXMucGFuZWxDb250YWluZXIgPSB0aGlzLmNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogaG9zdENsYXNzZXMuam9pbihcIiBcIikgfSk7XG5cbiAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2ssIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgIHRoaXMudW5yZWdpc3Rlck91dHB1dExpc3RlbmVyID0gdGhpcy5wbHVnaW4ucmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcih0aGlzLmJsb2NrLmlkLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5wYW5lbENvbnRhaW5lcikge1xuICAgICAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2ssIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy51bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXI/LigpO1xuICB9XG59XG5cbmNsYXNzIGxvb21Ub29sYmFyV2lkZ2V0IGV4dGVuZHMgV2lkZ2V0VHlwZSB7XG4gIHByaXZhdGUgcmVhZG9ubHkgaXNSdW5uaW5nOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBsb29tUGx1Z2luLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4gICkge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5pc1J1bm5pbmcgPSBwbHVnaW4uaXNCbG9ja1J1bm5pbmcoYmxvY2suaWQpO1xuICB9XG5cbiAgZXEob3RoZXI6IGxvb21Ub29sYmFyV2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIG90aGVyLmJsb2NrLmlkID09PSB0aGlzLmJsb2NrLmlkICYmIG90aGVyLmlzUnVubmluZyA9PT0gdGhpcy5pc1J1bm5pbmc7XG4gIH1cblxuICB0b0RPTSgpOiBIVE1MRWxlbWVudCB7XG4gICAgcmV0dXJuIHRoaXMucGx1Z2luLmNyZWF0ZVRvb2xiYXJFbGVtZW50KHRoaXMuYmxvY2spO1xuICB9XG59XG5cbmNsYXNzIGxvb21PdXRwdXRXaWRnZXQgZXh0ZW5kcyBXaWRnZXRUeXBlIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgfVxuXG4gIGVxKG90aGVyOiBsb29tT3V0cHV0V2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgdG9ET00oKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IHdyYXBwZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHdyYXBwZXIuY2xhc3NOYW1lID0gXCJsb29tLWlubGluZS1vdXRwdXQtaG9zdFwiO1xuICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9jaywgd3JhcHBlcik7XG4gICAgcmV0dXJuIHdyYXBwZXI7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgbG9vbVBsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MgPSBERUZBVUxUX1NFVFRJTkdTO1xuICByZWFkb25seSByZWdpc3RyeSA9IG5ldyBsb29tUnVubmVyUmVnaXN0cnkoW1xuICAgIG5ldyBQeXRob25SdW5uZXIoKSxcbiAgICBuZXcgTm9kZVJ1bm5lcigpLFxuICAgIG5ldyBPY2FtbFJ1bm5lcigpLFxuICAgIG5ldyBOYXRpdmVDb21waWxlZFJ1bm5lcigpLFxuICAgIG5ldyBJbnRlcnByZXRlZFJ1bm5lcigpLFxuICAgIG5ldyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIoKSxcbiAgICBuZXcgRWJwZlJ1bm5lcigpLFxuICAgIG5ldyBMbHZtUnVubmVyKCksXG4gICAgbmV3IFByb29mUnVubmVyKCksXG4gICAgbmV3IEN1c3RvbUxhbmd1YWdlUnVubmVyKCksXG4gIF0pO1xuICAvLyBFeHBvc2VkIGFzIHB1YmxpYyBhbmQgcmVhZG9ubHkgc28gdGhlIHNldHRpbmdzIHBhbmVsIGFuZCBtb2RhbHMgY2FuIGFjY2VzcyBjb250YWluZXIgY29uZmlndXJhdGlvbnMgYW5kIGRlZmF1bHQgbGFuZ3VhZ2UgbWFwcGluZyBoZWxwZXJzLlxuICBwdWJsaWMgcmVhZG9ubHkgY29udGFpbmVyUnVubmVyID0gbmV3IGxvb21Db250YWluZXJSdW5uZXIodGhpcy5hcHAsIHRoaXMubWFuaWZlc3QuZGlyID8/IFwiLm9ic2lkaWFuL3BsdWdpbnMvbG9vbVwiKTtcbiAgcHJpdmF0ZSByZWFkb25seSByZWdpc3RlcmVkQ29kZUJsb2NrQWxpYXNlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBwcml2YXRlIHJlYWRvbmx5IG91dHB1dHMgPSBuZXcgTWFwPHN0cmluZywgbG9vbVN0b3JlZE91dHB1dD4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBzdGRpbklucHV0cyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgc3RkaW5QYW5lbHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBydW5uaW5nID0gbmV3IE1hcDxzdHJpbmcsIEFib3J0Q29udHJvbGxlcj4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBvdXRwdXRMaXN0ZW5lcnMgPSBuZXcgTWFwPHN0cmluZywgU2V0PCgpID0+IHZvaWQ+PigpO1xuICBwcml2YXRlIHN0YXR1c0Jhckl0ZW1FbCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIGVkaXRvclZpZXdzID0gbmV3IFNldDxFZGl0b3JWaWV3PigpO1xuICBwcml2YXRlIGxhc3RNYXJrZG93bkZpbGVQYXRoOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IGxvb21TZXR0aW5nVGFiKHRoaXMpKTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW1FbCA9IHRoaXMuYWRkU3RhdHVzQmFySXRlbSgpO1xuICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXJ1bi1jdXJyZW50LWNvZGUtYmxvY2tcIixcbiAgICAgIG5hbWU6IFwibG9vbTogUnVuIEN1cnJlbnQgQ29kZSBCbG9ja1wiLFxuICAgICAgZWRpdG9yQ2FsbGJhY2s6IGFzeW5jIChlZGl0b3IsIHZpZXcpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHZpZXcuZmlsZTtcbiAgICAgICAgaWYgKCFmaWxlKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBlZGl0b3IuZ2V0VmFsdWUoKSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICAgIGNvbnN0IGJsb2NrID0gZmluZEJsb2NrQXRMaW5lKGJsb2NrcywgZWRpdG9yLmdldEN1cnNvcigpLmxpbmUpO1xuICAgICAgICBpZiAoIWJsb2NrKSB7XG4gICAgICAgICAgbmV3IE5vdGljZShcIk5vIHN1cHBvcnRlZCBsb29tIGJsb2NrIGF0IHRoZSBjdXJyZW50IGN1cnNvci5cIik7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGF3YWl0IHRoaXMucnVuQmxvY2soZmlsZSwgYmxvY2spO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXJ1bi1hbGwtY29kZS1ibG9ja3NcIixcbiAgICAgIG5hbWU6IFwibG9vbTogUnVuIEFsbCBTdXBwb3J0ZWQgQ29kZSBCbG9ja3MgaW4gQ3VycmVudCBOb3RlXCIsXG4gICAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk7XG4gICAgICAgIGlmICghZmlsZSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWNoZWNraW5nKSB7XG4gICAgICAgICAgdm9pZCB0aGlzLnJ1bkFsbEJsb2Nrc0luRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS1jbGVhci1ub3RlLW91dHB1dHNcIixcbiAgICAgIG5hbWU6IFwibG9vbTogQ2xlYXIgbG9vbSBPdXRwdXRzIGluIEN1cnJlbnQgTm90ZVwiLFxuICAgICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpO1xuICAgICAgICBpZiAoIWZpbGUpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFjaGVja2luZykge1xuICAgICAgICAgIHZvaWQgdGhpcy5jbGVhck91dHB1dHNGb3JGaWxlKGZpbGUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMucmVnaXN0ZXJDb2RlQmxvY2tQcm9jZXNzb3JzKCk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRWRpdG9yRXh0ZW5zaW9uKHRoaXMuY3JlYXRlTGl2ZVByZXZpZXdFeHRlbnNpb24oKSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW9wZW5cIiwgKGZpbGUpID0+IHtcbiAgICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IGZpbGU/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgICAgdGhpcy5yZWZyZXNoQWxsVmlld3MoKTtcbiAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgICBpZiAoZmlsZSAmJiB0aGlzLnNldHRpbmdzLmF1dG9SdW5PbkZpbGVPcGVuKSB7XG4gICAgICAgICAgdm9pZCB0aGlzLnJ1bkFsbEJsb2Nrc0luRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXZhbGlkYXRlLWNvbnRhaW5lci1ncm91cHNcIixcbiAgICAgIG5hbWU6IFwibG9vbTogVmFsaWRhdGUgQ29udGFpbmVyIEdyb3Vwc1wiLFxuICAgICAgY2FsbGJhY2s6IGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZ3JvdXBzID0gYXdhaXQgdGhpcy5nZXRDb250YWluZXJHcm91cFN1bW1hcmllcygpO1xuICAgICAgICBuZXcgTm90aWNlKGdyb3Vwcy5sZW5ndGggPyBncm91cHMubWFwKChncm91cCkgPT4gYCR7Z3JvdXAubmFtZX06ICR7Z3JvdXAuc3RhdHVzfWApLmpvaW4oXCJcXG5cIikgOiBcIk5vIGxvb20gY29udGFpbmVyIGdyb3VwcyBmb3VuZC5cIiwgODAwMCk7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImVkaXRvci1jaGFuZ2VcIiwgKF9lZGl0b3IsIGN0eCkgPT4ge1xuICAgICAgICBpZiAoY3R4IGluc3RhbmNlb2YgTWFya2Rvd25WaWV3KSB7XG4gICAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yTGVhZihjdHgubGVhZik7XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IGNvbnRyb2xsZXIgb2YgdGhpcy5ydW5uaW5nLnZhbHVlcygpKSB7XG4gICAgICBjb250cm9sbGVyLmFib3J0KCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgbG9hZFNldHRpbmdzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc2V0dGluZ3MgPSB7XG4gICAgICAuLi5ERUZBVUxUX1NFVFRJTkdTLFxuICAgICAgLi4uKGF3YWl0IHRoaXMubG9hZERhdGEoKSksXG4gICAgfTtcbiAgICBub3JtYWxpemVMYW5ndWFnZUNvbmZpZ3VyYXRpb24odGhpcy5zZXR0aW5ncyk7XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgICB0aGlzLnJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpO1xuICAgIHRoaXMucmVmcmVzaEFsbFZpZXdzKCk7XG4gIH1cblxuICBpc0Jsb2NrUnVubmluZyhibG9ja0lkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5ydW5uaW5nLmhhcyhibG9ja0lkKTtcbiAgfVxuXG4gIHJlZ2lzdGVyT3V0cHV0TGlzdGVuZXIoYmxvY2tJZDogc3RyaW5nLCBsaXN0ZW5lcjogKCkgPT4gdm9pZCk6ICgpID0+IHZvaWQge1xuICAgIGlmICghdGhpcy5vdXRwdXRMaXN0ZW5lcnMuaGFzKGJsb2NrSWQpKSB7XG4gICAgICB0aGlzLm91dHB1dExpc3RlbmVycy5zZXQoYmxvY2tJZCwgbmV3IFNldCgpKTtcbiAgICB9XG4gICAgdGhpcy5vdXRwdXRMaXN0ZW5lcnMuZ2V0KGJsb2NrSWQpPy5hZGQobGlzdGVuZXIpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmRlbGV0ZShsaXN0ZW5lcik7XG4gICAgfTtcbiAgfVxuXG4gIGNyZWF0ZVRvb2xiYXJFbGVtZW50KGJsb2NrOiBsb29tQ29kZUJsb2NrKTogSFRNTEVsZW1lbnQge1xuICAgIHJldHVybiBjcmVhdGVDb2RlQmxvY2tUb29sYmFyKGJsb2NrLmlkLCB0aGlzLmlzQmxvY2tSdW5uaW5nKGJsb2NrLmlkKSwge1xuICAgICAgb25SdW46ICgpID0+IHZvaWQgdGhpcy5ydW5BY3RpdmVCbG9ja0J5SWQoYmxvY2suaWQpLFxuICAgICAgb25Db3B5OiBhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQoYmxvY2suY29udGVudCk7XG4gICAgICAgICAgbmV3IE5vdGljZShcIkNvZGUgY29waWVkXCIpO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiQ2xpcGJvYXJkIHdyaXRlIGZhaWxlZC5cIik7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBvblJlbW92ZTogKCkgPT4gdm9pZCB0aGlzLnJlbW92ZVNuaXBwZXRCeUlkKGJsb2NrLmlkKSxcbiAgICAgIG9uVG9nZ2xlSW5wdXQ6ICgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuc3RkaW5QYW5lbHMuaGFzKGJsb2NrLmlkKSkge1xuICAgICAgICAgIHRoaXMuc3RkaW5QYW5lbHMuZGVsZXRlKGJsb2NrLmlkKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLnN0ZGluUGFuZWxzLmFkZChibG9jay5pZCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIH0sXG4gICAgICBvblRvZ2dsZU91dHB1dDogKCkgPT4ge1xuICAgICAgICBjb25zdCBvdXRwdXQgPSB0aGlzLm91dHB1dHMuZ2V0KGJsb2NrLmlkKTtcbiAgICAgICAgaWYgKCFvdXRwdXQpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgb3V0cHV0LnZpc2libGUgPSAhb3V0cHV0LnZpc2libGU7XG4gICAgICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9jay5pZCk7XG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgcmVuZGVyT3V0cHV0SW50byhibG9jazogbG9vbUNvZGVCbG9jaywgY29udGFpbmVyOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnRhaW5lci5lbXB0eSgpO1xuICAgIGNvbnN0IGJsb2NrSWQgPSBibG9jay5pZDtcblxuICAgIGlmICh0aGlzLnNob3VsZFJlbmRlclN0ZGluUGFuZWwoYmxvY2spKSB7XG4gICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQodGhpcy5jcmVhdGVTdGRpblBhbmVsKGJsb2NrKSk7XG4gICAgfVxuXG4gICAgY29uc3Qgb3V0cHV0ID0gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKTtcbiAgICBpZiAodGhpcy5ydW5uaW5nLmhhcyhibG9ja0lkKSkge1xuICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGNyZWF0ZVJ1bm5pbmdQYW5lbCgpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIW91dHB1dCB8fCAhb3V0cHV0LnZpc2libGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlT3V0cHV0UGFuZWwob3V0cHV0LCB7XG4gICAgICBkZWZhdWx0VmlzaWJsZUxpbmVzOiB0aGlzLnNldHRpbmdzLm91dHB1dFZpc2libGVMaW5lcyA/PyAwLFxuICAgIH0pKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bkFjdGl2ZUJsb2NrQnlJZChibG9ja0lkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBibG9jayA9IHRoaXMuZmluZEFjdGl2ZUJsb2NrQnlJZChibG9ja0lkKTtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKTtcbiAgICBpZiAoIWJsb2NrIHx8ICFmaWxlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGF3YWl0IHRoaXMucnVuQmxvY2soZmlsZSwgYmxvY2spO1xuICB9XG5cbiAgYXN5bmMgcmVtb3ZlU25pcHBldEJ5SWQoYmxvY2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYmxvY2sgPSB0aGlzLmZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZCk7XG4gICAgaWYgKCFibG9jaykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoYmxvY2suZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLnJ1bm5pbmcuZ2V0KGJsb2NrSWQpPy5hYm9ydCgpO1xuICAgIHRoaXMucnVubmluZy5kZWxldGUoYmxvY2tJZCk7XG4gICAgdGhpcy5vdXRwdXRzLmRlbGV0ZShibG9ja0lkKTtcblxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBjb250ZW50LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgIGNvbnN0IGN1cnJlbnRCbG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gYmxvY2tJZCk7XG4gICAgICBpZiAoIWN1cnJlbnRCbG9jaykge1xuICAgICAgICByZXR1cm4gY29udGVudDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgbWFuYWdlZFJhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9ja0lkKTtcbiAgICAgIGNvbnN0IHJlbW92YWxTdGFydCA9IGN1cnJlbnRCbG9jay5zdGFydExpbmU7XG4gICAgICBjb25zdCByZW1vdmFsRW5kID0gbWFuYWdlZFJhbmdlID8gbWFuYWdlZFJhbmdlLmVuZCA6IGN1cnJlbnRCbG9jay5lbmRMaW5lO1xuICAgICAgbGluZXMuc3BsaWNlKHJlbW92YWxTdGFydCwgcmVtb3ZhbEVuZCAtIHJlbW92YWxTdGFydCArIDEpO1xuXG4gICAgICB3aGlsZSAocmVtb3ZhbFN0YXJ0IDwgbGluZXMubGVuZ3RoIC0gMSAmJiBsaW5lc1tyZW1vdmFsU3RhcnRdID09PSBcIlwiICYmIGxpbmVzW3JlbW92YWxTdGFydCArIDFdID09PSBcIlwiKSB7XG4gICAgICAgIGxpbmVzLnNwbGljZShyZW1vdmFsU3RhcnQsIDEpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcblxuICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9ja0lkKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuICAgIG5ldyBOb3RpY2UoXCJsb29tIHNuaXBwZXQgcmVtb3ZlZC5cIik7XG4gIH1cblxuICBhc3luYyBydW5BbGxCbG9ja3NJbkZpbGUoZmlsZTogVEZpbGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzb3VyY2UgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xuICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgc291cmNlLCB0aGlzLnNldHRpbmdzKTtcbiAgICBjb25zdCBzdXBwb3J0ZWRCbG9ja3MgPSBibG9ja3MuZmlsdGVyKChibG9jaykgPT4ge1xuICAgICAgY29uc3QgZXhlY3V0aW9uQ29udGV4dCA9IHJlc29sdmVFeGVjdXRpb25Db250ZXh0KHRoaXMuYXBwLCBmaWxlLCBibG9jaywgdGhpcy5zZXR0aW5ncyk7XG4gICAgICByZXR1cm4gZXhlY3V0aW9uQ29udGV4dC5jb250YWluZXJHcm91cCB8fCB0aGlzLnJlZ2lzdHJ5LmdldFJ1bm5lckZvckJsb2NrKGJsb2NrLCB0aGlzLnNldHRpbmdzKTtcbiAgICB9KTtcblxuICAgIGlmICghc3VwcG9ydGVkQmxvY2tzLmxlbmd0aCkge1xuICAgICAgbmV3IE5vdGljZShcIk5vIHN1cHBvcnRlZCBsb29tIGJsb2NrcyBmb3VuZCBpbiB0aGUgY3VycmVudCBub3RlLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGJsb2NrIG9mIHN1cHBvcnRlZEJsb2Nrcykge1xuICAgICAgYXdhaXQgdGhpcy5ydW5CbG9jayhmaWxlLCBibG9jayk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgY2xlYXJPdXRwdXRzRm9yRmlsZShmaWxlOiBURmlsZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNvdXJjZSA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSk7XG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBzb3VyY2UsIHRoaXMuc2V0dGluZ3MpO1xuICAgIGZvciAoY29uc3QgYmxvY2sgb2YgYmxvY2tzKSB7XG4gICAgICB0aGlzLm91dHB1dHMuZGVsZXRlKGJsb2NrLmlkKTtcbiAgICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9jay5pZCk7XG4gICAgICBhd2FpdCB0aGlzLnJlbW92ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlLnBhdGgsIGJsb2NrLmlkKTtcbiAgICB9XG4gICAgbmV3IE5vdGljZShcImxvb20gb3V0cHV0cyBjbGVhcmVkLlwiKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bkJsb2NrKGZpbGU6IFRGaWxlLCBibG9jazogbG9vbUNvZGVCbG9jayk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSBmaWxlLnBhdGg7XG4gICAgaWYgKHRoaXMucnVubmluZy5oYXMoYmxvY2suaWQpKSB7XG4gICAgICBuZXcgTm90aWNlKFwiVGhpcyBsb29tIGJsb2NrIGlzIGFscmVhZHkgcnVubmluZy5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5lbnN1cmVFeGVjdXRpb25FbmFibGVkKCkpKSB7XG4gICAgICBzaG93RXhlY3V0aW9uRGlzYWJsZWROb3RpY2UoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBleGVjdXRpb25Db250ZXh0ID0gcmVzb2x2ZUV4ZWN1dGlvbkNvbnRleHQodGhpcy5hcHAsIGZpbGUsIGJsb2NrLCB0aGlzLnNldHRpbmdzKTtcbiAgICBjb25zdCBjb250YWluZXJHcm91cCA9IGV4ZWN1dGlvbkNvbnRleHQuY29udGFpbmVyR3JvdXA7XG4gICAgY29uc3QgcnVubmVyID0gY29udGFpbmVyR3JvdXAgPyBudWxsIDogdGhpcy5yZWdpc3RyeS5nZXRSdW5uZXJGb3JCbG9jayhibG9jaywgdGhpcy5zZXR0aW5ncyk7XG4gICAgaWYgKCFydW5uZXIpIHtcbiAgICAgIGlmICghY29udGFpbmVyR3JvdXApIHtcbiAgICAgICAgbmV3IE5vdGljZShgTm8gY29uZmlndXJlZCBydW5uZXIgZm9yICR7YmxvY2subGFuZ3VhZ2V9LmApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICBjb25zdCBzdGRpbiA9IGF3YWl0IHRoaXMucmVzb2x2ZUJsb2NrU3RkaW4oZmlsZSwgYmxvY2spO1xuICAgIGNvbnN0IHJ1bkNvbnRleHQgPSB7XG4gICAgICBmaWxlLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZXhlY3V0aW9uQ29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBleGVjdXRpb25Db250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXG4gICAgICBzdGRpbixcbiAgICB9O1xuICAgIHRoaXMucnVubmluZy5zZXQoYmxvY2suaWQsIGNvbnRyb2xsZXIpO1xuICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9jay5pZCk7XG4gICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNvbHZlZEJsb2NrID0gYXdhaXQgdGhpcy5yZXNvbHZlRXhlY3V0YWJsZUJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRhaW5lckdyb3VwXG4gICAgICAgID8gYXdhaXQgdGhpcy5jb250YWluZXJSdW5uZXIucnVuKHJlc29sdmVkQmxvY2suYmxvY2ssIHJ1bkNvbnRleHQsIHRoaXMuc2V0dGluZ3MsIGNvbnRhaW5lckdyb3VwKVxuICAgICAgICA6IGF3YWl0IHJ1bm5lciEucnVuKHJlc29sdmVkQmxvY2suYmxvY2ssIHJ1bkNvbnRleHQsIHRoaXMuc2V0dGluZ3MpO1xuXG4gICAgICBpZiAocmVzdWx0LnRpbWVkT3V0KSB7XG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSByZXN1bHQuc3RkZXJyIHx8IGBFeGVjdXRpb24gdGltZWQgb3V0IGFmdGVyICR7dGhpcy5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zfSBtcy5gO1xuICAgICAgfSBlbHNlIGlmIChyZXN1bHQuY2FuY2VsbGVkKSB7XG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSByZXN1bHQuc3RkZXJyIHx8IFwiRXhlY3V0aW9uIGNhbmNlbGxlZC5cIjtcbiAgICAgIH0gZWxzZSBpZiAoIXJlc3VsdC5zdWNjZXNzICYmICFyZXN1bHQuc3RkZXJyLnRyaW0oKSkge1xuICAgICAgICByZXN1bHQuc3RkZXJyID0gXCJQcm9jZXNzIGV4aXRlZCB1bnN1Y2Nlc3NmdWxseS5cIjtcbiAgICAgIH1cblxuICAgICAgaWYgKHJlc29sdmVkQmxvY2suc291cmNlUHJldmlldykge1xuICAgICAgICBjb25zdCBzb3VyY2VOb3RpY2UgPSBgUmFuIGV4dHJhY3RlZCBzb3VyY2UgZnJvbSAke3Jlc29sdmVkQmxvY2suc291cmNlUHJldmlldy5kZXNjcmlwdGlvbn0uYDtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSByZXN1bHQud2FybmluZyA/IGAke3NvdXJjZU5vdGljZX1cXG4ke3Jlc3VsdC53YXJuaW5nfWAgOiBzb3VyY2VOb3RpY2U7XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5oYXNFeHBsaWNpdEV4ZWN1dGlvbkNvbnRleHQoZXhlY3V0aW9uQ29udGV4dCkpIHtcbiAgICAgICAgY29uc3QgY29udGV4dE5vdGljZSA9IHRoaXMuZm9ybWF0RXhlY3V0aW9uQ29udGV4dE5vdGljZShleGVjdXRpb25Db250ZXh0KTtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSByZXN1bHQud2FybmluZyA/IGAke2NvbnRleHROb3RpY2V9XFxuJHtyZXN1bHQud2FybmluZ31gIDogY29udGV4dE5vdGljZTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHRoaXMud3JpdGVPdXRwdXRGaWxlSWZSZXF1ZXN0ZWQoZmlsZSwgYmxvY2ssIHJlc3VsdCk7XG5cbiAgICAgIHRoaXMub3V0cHV0cy5zZXQoYmxvY2suaWQsIHtcbiAgICAgICAgYmxvY2tJZDogYmxvY2suaWQsXG4gICAgICAgIGJsb2NrLFxuICAgICAgICByZXN1bHQsXG4gICAgICAgIHNvdXJjZVByZXZpZXc6IHJlc29sdmVkQmxvY2suc291cmNlUHJldmlldyxcbiAgICAgICAgY29sbGFwc2VkOiBmYWxzZSxcbiAgICAgICAgdmlzaWJsZTogdHJ1ZSxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAodGhpcy5zZXR0aW5ncy53cml0ZU91dHB1dFRvTm90ZSkge1xuICAgICAgICBhd2FpdCB0aGlzLndyaXRlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGUsIGJsb2NrLCByZXN1bHQpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBydW5uZXJOYW1lID0gY29udGFpbmVyR3JvdXAgPyBgY29udGFpbmVyICR7Y29udGFpbmVyR3JvdXB9YCA6IHJ1bm5lciEuZGlzcGxheU5hbWU7XG4gICAgICBuZXcgTm90aWNlKHJlc3VsdC5zdWNjZXNzID8gYGxvb20gcmFuICR7cnVubmVyTmFtZX0gYmxvY2suYCA6IGBsb29tIHJ1biBmYWlsZWQgZm9yICR7cnVubmVyTmFtZX0uYCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG4gICAgICB0aGlzLm91dHB1dHMuc2V0KGJsb2NrLmlkLCB7XG4gICAgICAgIGJsb2NrSWQ6IGJsb2NrLmlkLFxuICAgICAgICBibG9jayxcbiAgICAgICAgY29sbGFwc2VkOiBmYWxzZSxcbiAgICAgICAgdmlzaWJsZTogdHJ1ZSxcbiAgICAgICAgcmVzdWx0OiB7XG4gICAgICAgICAgcnVubmVySWQ6IGNvbnRhaW5lckdyb3VwID8gYGNvbnRhaW5lcjoke2NvbnRhaW5lckdyb3VwfWAgOiBydW5uZXI/LmlkID8/IFwidW5rbm93blwiLFxuICAgICAgICAgIHJ1bm5lck5hbWU6IGNvbnRhaW5lckdyb3VwID8gYENvbnRhaW5lciAke2NvbnRhaW5lckdyb3VwfWAgOiBydW5uZXI/LmRpc3BsYXlOYW1lID8/IFwiVW5rbm93blwiLFxuICAgICAgICAgIHN0YXJ0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGZpbmlzaGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICBkdXJhdGlvbk1zOiAwLFxuICAgICAgICAgIGV4aXRDb2RlOiAtMSxcbiAgICAgICAgICBzdGRvdXQ6IFwiXCIsXG4gICAgICAgICAgc3RkZXJyOiBtZXNzYWdlLFxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgIHRpbWVkT3V0OiBmYWxzZSxcbiAgICAgICAgICBjYW5jZWxsZWQ6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBuZXcgTm90aWNlKGBsb29tIGVycm9yOiAke21lc3NhZ2V9YCk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMucnVubmluZy5kZWxldGUoYmxvY2suaWQpO1xuICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVFeGVjdXRpb25FbmFibGVkKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGlmICh0aGlzLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uICYmIHRoaXMuc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzaykge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IG5ldyBQcm9taXNlPGJvb2xlYW4+KChyZXNvbHZlKSA9PiB7XG4gICAgICBsZXQgc2V0dGxlZCA9IGZhbHNlO1xuICAgICAgY29uc3Qgc2V0dGxlID0gKHZhbHVlOiBib29sZWFuKSA9PiB7XG4gICAgICAgIGlmICghc2V0dGxlZCkge1xuICAgICAgICAgIHNldHRsZWQgPSB0cnVlO1xuICAgICAgICAgIHJlc29sdmUodmFsdWUpO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBtb2RhbCA9IG5ldyBFeGVjdXRpb25Db25zZW50TW9kYWwodGhpcy5hcHAsIGFzeW5jICgpID0+IHtcbiAgICAgICAgdGhpcy5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbiA9IHRydWU7XG4gICAgICAgIHRoaXMuc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzayA9IHRydWU7XG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHNldHRsZSh0cnVlKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBvcmlnaW5hbENsb3NlID0gbW9kYWwuY2xvc2UuYmluZChtb2RhbCk7XG4gICAgICBtb2RhbC5jbG9zZSA9ICgpID0+IHtcbiAgICAgICAgb3JpZ2luYWxDbG9zZSgpO1xuICAgICAgICBzZXR0bGUodGhpcy5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbiAmJiB0aGlzLnNldHRpbmdzLmhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2spO1xuICAgICAgfTtcbiAgICAgIG1vZGFsLm9wZW4oKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVzb2x2ZUV4ZWN1dGFibGVCbG9jayhmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2spOiBQcm9taXNlPHsgYmxvY2s6IGxvb21Db2RlQmxvY2s7IHNvdXJjZVByZXZpZXc/OiBsb29tU3RvcmVkT3V0cHV0W1wic291cmNlUHJldmlld1wiXSB9PiB7XG4gICAgaWYgKCFibG9jay5zb3VyY2VSZWZlcmVuY2UpIHtcbiAgICAgIHJldHVybiB7IGJsb2NrIH07XG4gICAgfVxuXG4gICAgY29uc3QgcmVmZXJlbmNlUGF0aCA9IHRoaXMucmVzb2x2ZVJlZmVyZW5jZWRWYXVsdFBhdGgoZmlsZSwgYmxvY2suc291cmNlUmVmZXJlbmNlLmZpbGVQYXRoKTtcbiAgICBjb25zdCBzb3VyY2VGaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHJlZmVyZW5jZVBhdGgpO1xuICAgIGlmICghKHNvdXJjZUZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVmZXJlbmNlZCBzb3VyY2UgZmlsZSBub3QgZm91bmQ6ICR7cmVmZXJlbmNlUGF0aH1gKTtcbiAgICB9XG5cbiAgICBjb25zdCBoYXJuZXNzID0gYnVpbGRTb3VyY2VSZWZlcmVuY2VIYXJuZXNzKGJsb2NrKTtcbiAgICBjb25zdCBleHRlcm5hbEV4dHJhY3RvciA9IHRoaXMuZ2V0Q3VzdG9tTGFuZ3VhZ2VFeHRyYWN0b3IoYmxvY2ssIGZpbGUpO1xuICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2UoXG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKHNvdXJjZUZpbGUpLFxuICAgICAgeyAuLi5ibG9jay5zb3VyY2VSZWZlcmVuY2UsIGZpbGVQYXRoOiByZWZlcmVuY2VQYXRoIH0sXG4gICAgICBibG9jay5sYW5ndWFnZSxcbiAgICAgIGhhcm5lc3MsXG4gICAgICB7XG4gICAgICAgIHB5dGhvbkV4ZWN1dGFibGU6IHRoaXMuc2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCkgfHwgXCJweXRob24zXCIsXG4gICAgICAgIGV4dGVybmFsRXh0cmFjdG9yLFxuICAgICAgICByZWFkRmlsZTogYXN5bmMgKGZpbGVQYXRoKSA9PiB7XG4gICAgICAgICAgY29uc3QgaW1wb3J0ZWRGaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKG5vcm1hbGl6ZVBhdGgoZmlsZVBhdGgpKTtcbiAgICAgICAgICByZXR1cm4gaW1wb3J0ZWRGaWxlIGluc3RhbmNlb2YgVEZpbGUgPyB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGltcG9ydGVkRmlsZSkgOiBudWxsO1xuICAgICAgICB9LFxuICAgICAgICByZXNvbHZlUHl0aG9uSW1wb3J0OiBhc3luYyAoZnJvbUZpbGVQYXRoLCBtb2R1bGVOYW1lLCBsZXZlbCkgPT4gdGhpcy5yZXNvbHZlUHl0aG9uSW1wb3J0VmF1bHRQYXRoKGZyb21GaWxlUGF0aCwgbW9kdWxlTmFtZSwgbGV2ZWwpLFxuICAgICAgfSxcbiAgICApO1xuICAgIGNvbnN0IGNhcGFiaWxpdHkgPSBnZXRMYW5ndWFnZUNhcGFiaWxpdHkoYmxvY2subGFuZ3VhZ2UsIEJvb2xlYW4oZXh0ZXJuYWxFeHRyYWN0b3IpKTtcbiAgICBjb25zdCBzaG91bGRTaG93UHJldmlldyA9ICh0aGlzLnNldHRpbmdzLmV4dHJhY3RlZFNvdXJjZVByZXZpZXdNb2RlIHx8IFwiY29sbGFwc2VkXCIpICE9PSBcImhpZGRlblwiO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGJsb2NrOiB7XG4gICAgICAgIC4uLmJsb2NrLFxuICAgICAgICBjb250ZW50OiByZXNvbHZlZC5jb250ZW50LFxuICAgICAgfSxcbiAgICAgIHNvdXJjZVByZXZpZXc6IHNob3VsZFNob3dQcmV2aWV3ID8ge1xuICAgICAgICBkZXNjcmlwdGlvbjogcmVzb2x2ZWQuZGVzY3JpcHRpb24sXG4gICAgICAgIGxhbmd1YWdlOiBibG9jay5sYW5ndWFnZSxcbiAgICAgICAgY29udGVudDogcmVzb2x2ZWQuY29udGVudCxcbiAgICAgICAgY2FwYWJpbGl0eSxcbiAgICAgICAgZXhwYW5kZWQ6IHRoaXMuc2V0dGluZ3MuZXh0cmFjdGVkU291cmNlUHJldmlld01vZGUgPT09IFwiZXhwYW5kZWRcIixcbiAgICAgICAgc2hvd0NhcGFiaWxpdHlNZXRhZGF0YTogdGhpcy5zZXR0aW5ncy5zaG93TGFuZ3VhZ2VDYXBhYmlsaXR5TWV0YWRhdGEgPz8gdHJ1ZSxcbiAgICAgIH0gOiB1bmRlZmluZWQsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZVJlZmVyZW5jZWRWYXVsdFBhdGgoZmlsZTogVEZpbGUsIHJlZmVyZW5jZVBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgdHJpbW1lZCA9IHJlZmVyZW5jZVBhdGgudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCkge1xuICAgICAgcmV0dXJuIHRyaW1tZWQ7XG4gICAgfVxuICAgIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgICByZXR1cm4gbm9ybWFsaXplUGF0aCh0cmltbWVkLnNsaWNlKDEpKTtcbiAgICB9XG5cbiAgICBjb25zdCBiYXNlRGlyID0gZGlybmFtZShmaWxlLnBhdGgpO1xuICAgIHJldHVybiBub3JtYWxpemVQYXRoKGJhc2VEaXIgPT09IFwiLlwiID8gdHJpbW1lZCA6IGAke2Jhc2VEaXJ9LyR7dHJpbW1lZH1gKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZVB5dGhvbkltcG9ydFZhdWx0UGF0aChmcm9tRmlsZVBhdGg6IHN0cmluZywgbW9kdWxlTmFtZTogc3RyaW5nLCBsZXZlbDogbnVtYmVyKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgY29uc3QgbW9kdWxlUGF0aCA9IG1vZHVsZU5hbWVcbiAgICAgIC5zcGxpdChcIi5cIilcbiAgICAgIC5tYXAoKHBhcnQpID0+IHBhcnQudHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKVxuICAgICAgLmpvaW4oXCIvXCIpO1xuICAgIGNvbnN0IGZyb21EaXIgPSBkaXJuYW1lKGZyb21GaWxlUGF0aCk7XG4gICAgY29uc3QgYmFzZURpcnMgPSBsZXZlbCA+IDBcbiAgICAgID8gW3RoaXMuYXNjZW5kVmF1bHRQYXRoKGZyb21EaXIgPT09IFwiLlwiID8gXCJcIiA6IGZyb21EaXIsIGxldmVsIC0gMSldXG4gICAgICA6IFtmcm9tRGlyID09PSBcIi5cIiA/IFwiXCIgOiBmcm9tRGlyLCBcIlwiXTtcblxuICAgIGZvciAoY29uc3QgYmFzZURpciBvZiBiYXNlRGlycykge1xuICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IHRoaXMuZ2V0UHl0aG9uSW1wb3J0Q2FuZGlkYXRlcyhiYXNlRGlyLCBtb2R1bGVQYXRoKTtcbiAgICAgIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICAgICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVBhdGgoY2FuZGlkYXRlKTtcbiAgICAgICAgaWYgKHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChub3JtYWxpemVkKSBpbnN0YW5jZW9mIFRGaWxlKSB7XG4gICAgICAgICAgcmV0dXJuIG5vcm1hbGl6ZWQ7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0UHl0aG9uSW1wb3J0Q2FuZGlkYXRlcyhiYXNlRGlyOiBzdHJpbmcsIG1vZHVsZVBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBwcmVmaXggPSBiYXNlRGlyID8gYCR7YmFzZURpcn0vYCA6IFwiXCI7XG4gICAgaWYgKCFtb2R1bGVQYXRoKSB7XG4gICAgICByZXR1cm4gW2Ake3ByZWZpeH1fX2luaXRfXy5weWBdO1xuICAgIH1cbiAgICByZXR1cm4gW1xuICAgICAgYCR7cHJlZml4fSR7bW9kdWxlUGF0aH0ucHlgLFxuICAgICAgYCR7cHJlZml4fSR7bW9kdWxlUGF0aH0vX19pbml0X18ucHlgLFxuICAgIF07XG4gIH1cblxuICBwcml2YXRlIGFzY2VuZFZhdWx0UGF0aChwYXRoOiBzdHJpbmcsIGxldmVsczogbnVtYmVyKTogc3RyaW5nIHtcbiAgICBsZXQgY3VycmVudCA9IHBhdGg7XG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxldmVsczsgaW5kZXggKz0gMSkge1xuICAgICAgY29uc3QgbmV4dCA9IGRpcm5hbWUoY3VycmVudCk7XG4gICAgICBjdXJyZW50ID0gbmV4dCA9PT0gXCIuXCIgPyBcIlwiIDogbmV4dDtcbiAgICB9XG4gICAgcmV0dXJuIGN1cnJlbnQ7XG4gIH1cblxuICBhc3luYyBnZXRDb250YWluZXJHcm91cFN1bW1hcmllcygpOiBQcm9taXNlPEFycmF5PHsgbmFtZTogc3RyaW5nOyBzdGF0dXM6IHN0cmluZyB9Pj4ge1xuICAgIHJldHVybiB0aGlzLmNvbnRhaW5lclJ1bm5lci5nZXRHcm91cFN1bW1hcmllcygpO1xuICB9XG5cbiAgYXN5bmMgYnVpbGRDb250YWluZXJHcm91cChuYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuY29udGFpbmVyUnVubmVyLmJ1aWxkR3JvdXAobmFtZSwgTWF0aC5tYXgodGhpcy5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zLCAxMjBfMDAwKSwgY29udHJvbGxlci5zaWduYWwpO1xuICAgIG5ldyBOb3RpY2UocmVzdWx0LnN1Y2Nlc3MgPyBgbG9vbSBidWlsdCBjb250YWluZXIgZ3JvdXAgJHtuYW1lfS5gIDogYGxvb20gY29udGFpbmVyIGJ1aWxkIGZhaWxlZCBmb3IgJHtuYW1lfS5gLCA4MDAwKTtcbiAgfVxuXG4gIHJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IGFsaWFzIG9mIGdldFN1cHBvcnRlZExhbmd1YWdlQWxpYXNlcyh0aGlzLnNldHRpbmdzKSkge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEFsaWFzID0gYWxpYXMudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmICh0aGlzLnJlZ2lzdGVyZWRDb2RlQmxvY2tBbGlhc2VzLmhhcyhub3JtYWxpemVkQWxpYXMpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZiAoL1teYS16QS1aMC05Xy1dLy50ZXN0KG5vcm1hbGl6ZWRBbGlhcykpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIHRoaXMucmVnaXN0ZXJlZENvZGVCbG9ja0FsaWFzZXMuYWRkKG5vcm1hbGl6ZWRBbGlhcyk7XG4gICAgICB0aGlzLnJlZ2lzdGVyTWFya2Rvd25Db2RlQmxvY2tQcm9jZXNzb3Iobm9ybWFsaXplZEFsaWFzLCBhc3luYyAoc291cmNlLCBlbCwgY3R4KSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGVQYXRoID0gY3R4LnNvdXJjZVBhdGg7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZVBhdGgpO1xuICAgICAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZnVsbFRleHQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xuICAgICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlUGF0aCwgZnVsbFRleHQsIHRoaXMuc2V0dGluZ3MpO1xuICAgICAgICBjb25zdCBzZWN0aW9uID0gKGN0eCAmJiB0eXBlb2YgY3R4LmdldFNlY3Rpb25JbmZvID09PSBcImZ1bmN0aW9uXCIpID8gY3R4LmdldFNlY3Rpb25JbmZvKGVsKSA6IG51bGw7XG4gICAgICAgIGxldCBibG9jazogbG9vbUNvZGVCbG9jayB8IHVuZGVmaW5lZDtcbiAgICAgICAgaWYgKHNlY3Rpb24pIHtcbiAgICAgICAgICBjb25zdCBsaW5lU3RhcnQgPSBzZWN0aW9uLmxpbmVTdGFydDtcbiAgICAgICAgICBibG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5zdGFydExpbmUgPT09IGxpbmVTdGFydCAmJiBjYW5kaWRhdGUuY29udGVudCA9PT0gc291cmNlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBibG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5jb250ZW50ID09PSBzb3VyY2UpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghYmxvY2spIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgcHJlID0gZWwucXVlcnlTZWxlY3RvcihcInByZVwiKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgICAgIGlmICghcHJlKSB7XG4gICAgICAgICAgcHJlID0gZWwuY3JlYXRlRWwoXCJwcmVcIik7XG4gICAgICAgICAgcHJlLmFkZENsYXNzKGBsYW5ndWFnZS0ke25vcm1hbGl6ZWRBbGlhc31gKTtcbiAgICAgICAgICBjb25zdCBjb2RlID0gcHJlLmNyZWF0ZUVsKFwiY29kZVwiKTtcbiAgICAgICAgICBjb2RlLmFkZENsYXNzKGBsYW5ndWFnZS0ke25vcm1hbGl6ZWRBbGlhc31gKTtcbiAgICAgICAgICBjb2RlLnNldFRleHQoc291cmNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsbHZtLWlyXCIpIHtcbiAgICAgICAgICBjb25zdCBjb2RlID0gKHByZS5xdWVyeVNlbGVjdG9yKFwiY29kZVwiKSBhcyBIVE1MRWxlbWVudCB8IG51bGwpID8/IHByZTtcbiAgICAgICAgICBoaWdobGlnaHRMbHZtRWxlbWVudChjb2RlLCBzb3VyY2UpO1xuICAgICAgICB9XG5cbiAgICAgICAgY3R4LmFkZENoaWxkKG5ldyBsb29tVG9vbGJhclJlbmRlckNoaWxkKGVsLCB0aGlzLCBibG9jaywgcHJlKSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZVN0YXR1c0JhcigpOiB2b2lkIHtcbiAgICBjb25zdCBhY3RpdmVSdW5zID0gdGhpcy5ydW5uaW5nLnNpemU7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtRWwuc2V0VGV4dChhY3RpdmVSdW5zID8gYGxvb206ICR7YWN0aXZlUnVuc30gQWN0aXZlIFJ1biR7YWN0aXZlUnVucyA9PT0gMSA/IFwiXCIgOiBcInNcIn1gIDogXCJsb29tOiBJZGxlXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSBub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrSWQ6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMub3V0cHV0TGlzdGVuZXJzLmdldChibG9ja0lkKT8uZm9yRWFjaCgobGlzdGVuZXIpID0+IGxpc3RlbmVyKCkpO1xuICAgIHRoaXMucmVmcmVzaEFsbFZpZXdzKCk7XG4gIH1cblxuICBwcml2YXRlIHJlZnJlc2hBbGxWaWV3cygpOiB2b2lkIHtcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikuZm9yRWFjaCgobGVhZikgPT4ge1xuICAgICAgY29uc3QgdmlldyA9IGxlYWYudmlldyBhcyBNYXJrZG93blZpZXc7XG4gICAgICBjb25zdCBwcmV2aWV3TW9kZSA9ICh2aWV3IGFzIHsgcHJldmlld01vZGU/OiB7IHJlcmVuZGVyPzogKGZvcmNlPzogYm9vbGVhbikgPT4gdm9pZCB9IH0pLnByZXZpZXdNb2RlO1xuICAgICAgcHJldmlld01vZGU/LnJlcmVuZGVyPy4odHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBmb3IgKGNvbnN0IGVkaXRvclZpZXcgb2YgdGhpcy5lZGl0b3JWaWV3cykge1xuICAgICAgZWRpdG9yVmlldy5kaXNwYXRjaCh7IGVmZmVjdHM6IGxvb21SZWZyZXNoRWZmZWN0Lm9mKHVuZGVmaW5lZCkgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBnZXRBY3RpdmVNYXJrZG93bkZpbGUoKTogVEZpbGUgfCBudWxsIHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICByZXR1cm4gdmlldz8uZmlsZSA/PyBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRDdXJyZW50RWRpdG9yRmlsZVBhdGgoKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgfVxuXG4gIGFzeW5jIGVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICBpZiAoIXZpZXcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yTGVhZih2aWV3LmxlYWYpO1xuICB9XG5cbiAgYXN5bmMgZGlzYWJsZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIGlmICghdmlldykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGxlYWYgPSB2aWV3LmxlYWY7XG4gICAgY29uc3Qgdmlld1N0YXRlID0gbGVhZi5nZXRWaWV3U3RhdGUoKTtcbiAgICBjb25zdCBzdGF0ZSA9IHsgLi4uKHZpZXdTdGF0ZS5zdGF0ZSA/PyB7fSkgfSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBcbiAgICBpZiAoc3RhdGUubW9kZSA9PT0gXCJzb3VyY2VcIiAmJiBzdGF0ZS5zb3VyY2UgPT09IHRydWUpIHtcbiAgICAgIHN0YXRlLnNvdXJjZSA9IGZhbHNlO1xuICAgICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoe1xuICAgICAgICAuLi52aWV3U3RhdGUsXG4gICAgICAgIHN0YXRlLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbmZvcmNlU291cmNlTW9kZUZvckxlYWYobGVhZjogV29ya3NwYWNlTGVhZik6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5zZXR0aW5ncy5wcmVzZXJ2ZVNvdXJjZU1vZGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobGVhZi5pc0RlZmVycmVkKSB7XG4gICAgICBhd2FpdCBsZWFmLmxvYWRJZkRlZmVycmVkKCk7XG4gICAgfVxuXG4gICAgY29uc3QgdmlldyA9IGxlYWYudmlldztcbiAgICBpZiAoISh2aWV3IGluc3RhbmNlb2YgTWFya2Rvd25WaWV3KSB8fCAhdmlldy5maWxlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgc291cmNlID0gdmlldy5lZGl0b3I/LmdldFZhbHVlPy4oKSA/PyAoYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZCh2aWV3LmZpbGUpKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2Nrcyh2aWV3LmZpbGUucGF0aCwgc291cmNlLCB0aGlzLnNldHRpbmdzKTtcbiAgICBpZiAoIWJsb2Nrcy5sZW5ndGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB2aWV3U3RhdGUgPSBsZWFmLmdldFZpZXdTdGF0ZSgpO1xuICAgIGNvbnN0IHN0YXRlID0geyAuLi4odmlld1N0YXRlLnN0YXRlID8/IHt9KSB9IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmIChzdGF0ZS5tb2RlID09PSBcInNvdXJjZVwiICYmIHN0YXRlLnNvdXJjZSA9PT0gdHJ1ZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHN0YXRlLm1vZGUgPSBcInNvdXJjZVwiO1xuICAgIHN0YXRlLnNvdXJjZSA9IHRydWU7XG5cbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7XG4gICAgICAuLi52aWV3U3RhdGUsXG4gICAgICBzdGF0ZSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZmluZEFjdGl2ZUJsb2NrQnlJZChibG9ja0lkOiBzdHJpbmcpOiBsb29tQ29kZUJsb2NrIHwgbnVsbCB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgY29uc3QgZmlsZSA9IHZpZXc/LmZpbGU7XG4gICAgY29uc3QgZWRpdG9yID0gdmlldz8uZWRpdG9yO1xuICAgIGlmICghZmlsZSB8fCAhZWRpdG9yKSB7XG4gICAgICByZXR1cm4gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKT8uYmxvY2sgPz8gbnVsbDtcbiAgICB9XG5cbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIGVkaXRvci5nZXRWYWx1ZSgpLCB0aGlzLnNldHRpbmdzKTtcbiAgICByZXR1cm4gYmxvY2tzLmZpbmQoKGJsb2NrKSA9PiBibG9jay5pZCA9PT0gYmxvY2tJZCkgPz8gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKT8uYmxvY2sgPz8gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlTGl2ZVByZXZpZXdFeHRlbnNpb24oKSB7XG4gICAgY29uc3QgcGx1Z2luID0gdGhpcztcblxuICAgIHJldHVybiBWaWV3UGx1Z2luLmZyb21DbGFzcyhcbiAgICAgIGNsYXNzIHtcbiAgICAgICAgZGVjb3JhdGlvbnM7XG5cbiAgICAgICAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSB2aWV3OiBFZGl0b3JWaWV3KSB7XG4gICAgICAgICAgcGx1Z2luLmVkaXRvclZpZXdzLmFkZCh2aWV3KTtcbiAgICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gdGhpcy5idWlsZERlY29yYXRpb25zKCk7XG4gICAgICAgIH1cblxuICAgICAgICB1cGRhdGUodXBkYXRlOiBWaWV3VXBkYXRlKTogdm9pZCB7XG4gICAgICAgICAgaWYgKHVwZGF0ZS5kb2NDaGFuZ2VkIHx8IHVwZGF0ZS52aWV3cG9ydENoYW5nZWQgfHwgdXBkYXRlLnRyYW5zYWN0aW9ucy5zb21lKCh0cikgPT4gdHIuZWZmZWN0cy5zb21lKChlZmZlY3QpID0+IGVmZmVjdC5pcyhsb29tUmVmcmVzaEVmZmVjdCkpKSkge1xuICAgICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IHRoaXMuYnVpbGREZWNvcmF0aW9ucygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGRlc3Ryb3koKTogdm9pZCB7XG4gICAgICAgICAgcGx1Z2luLmVkaXRvclZpZXdzLmRlbGV0ZSh0aGlzLnZpZXcpO1xuICAgICAgICB9XG5cbiAgICAgICAgcHJpdmF0ZSBidWlsZERlY29yYXRpb25zKCkge1xuICAgICAgICAgIGNvbnN0IGZpbGVQYXRoID0gcGx1Z2luLmdldEN1cnJlbnRFZGl0b3JGaWxlUGF0aCgpO1xuICAgICAgICAgIGlmICghZmlsZVBhdGgpIHtcbiAgICAgICAgICAgIHJldHVybiBEZWNvcmF0aW9uLm5vbmU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3Qgc291cmNlID0gdGhpcy52aWV3LnN0YXRlLmRvYy50b1N0cmluZygpO1xuICAgICAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGVQYXRoLCBzb3VyY2UsIHBsdWdpbi5zZXR0aW5ncyk7XG4gICAgICAgICAgY29uc3QgYnVpbGRlciA9IG5ldyBSYW5nZVNldEJ1aWxkZXI8RGVjb3JhdGlvbj4oKTtcblxuICAgICAgICAgIGZvciAoY29uc3QgYmxvY2sgb2YgYmxvY2tzKSB7XG4gICAgICAgICAgICBjb25zdCBzdGFydExpbmUgPSB0aGlzLnZpZXcuc3RhdGUuZG9jLmxpbmUoYmxvY2suc3RhcnRMaW5lICsgMSk7XG4gICAgICAgICAgICBidWlsZGVyLmFkZChcbiAgICAgICAgICAgICAgc3RhcnRMaW5lLmZyb20sXG4gICAgICAgICAgICAgIHN0YXJ0TGluZS5mcm9tLFxuICAgICAgICAgICAgICBEZWNvcmF0aW9uLndpZGdldCh7XG4gICAgICAgICAgICAgICAgd2lkZ2V0OiBuZXcgbG9vbVRvb2xiYXJXaWRnZXQocGx1Z2luLCBibG9jayksXG4gICAgICAgICAgICAgICAgc2lkZTogLTEsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgaWYgKHBsdWdpbi5vdXRwdXRzLmhhcyhibG9jay5pZCkgfHwgcGx1Z2luLnJ1bm5pbmcuaGFzKGJsb2NrLmlkKSB8fCBwbHVnaW4uc2hvdWxkUmVuZGVyU3RkaW5QYW5lbChibG9jaykpIHtcbiAgICAgICAgICAgICAgY29uc3QgZW5kTGluZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MubGluZShibG9jay5lbmRMaW5lICsgMSk7XG4gICAgICAgICAgICAgIGJ1aWxkZXIuYWRkKFxuICAgICAgICAgICAgICAgIGVuZExpbmUudG8sXG4gICAgICAgICAgICAgICAgZW5kTGluZS50byxcbiAgICAgICAgICAgICAgICBEZWNvcmF0aW9uLndpZGdldCh7XG4gICAgICAgICAgICAgICAgICB3aWRnZXQ6IG5ldyBsb29tT3V0cHV0V2lkZ2V0KHBsdWdpbiwgYmxvY2spLFxuICAgICAgICAgICAgICAgICAgc2lkZTogMSxcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxsdm0taXJcIikge1xuICAgICAgICAgICAgICBhZGRMbHZtRGVjb3JhdGlvbnMoYnVpbGRlciwgdGhpcy52aWV3LCBibG9jayk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGJ1aWxkZXIuZmluaXNoKCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGRlY29yYXRpb25zOiAodmFsdWUpID0+IHZhbHVlLmRlY29yYXRpb25zLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBoYXNFeHBsaWNpdEV4ZWN1dGlvbkNvbnRleHQoY29udGV4dDogbG9vbVJlc29sdmVkRXhlY3V0aW9uQ29udGV4dCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBjb250ZXh0LnNvdXJjZS5jb250YWluZXIgIT09IFwibm9uZVwiIHx8IGNvbnRleHQuc291cmNlLndvcmtpbmdEaXJlY3RvcnkgIT09IFwiZGVmYXVsdFwiIHx8IGNvbnRleHQuc291cmNlLnRpbWVvdXQgIT09IFwiZ2xvYmFsXCI7XG4gIH1cblxuICBwcml2YXRlIGZvcm1hdEV4ZWN1dGlvbkNvbnRleHROb3RpY2UoY29udGV4dDogbG9vbVJlc29sdmVkRXhlY3V0aW9uQ29udGV4dCk6IHN0cmluZyB7XG4gICAgY29uc3QgcGllY2VzID0gW1xuICAgICAgYGNvbnRhaW5lcj0ke2NvbnRleHQuY29udGFpbmVyR3JvdXAgPz8gXCJuYXRpdmVcIn0gKCR7Y29udGV4dC5zb3VyY2UuY29udGFpbmVyfSlgLFxuICAgICAgYGN3ZD0ke2NvbnRleHQud29ya2luZ0RpcmVjdG9yeX0gKCR7Y29udGV4dC5zb3VyY2Uud29ya2luZ0RpcmVjdG9yeX0pYCxcbiAgICAgIGB0aW1lb3V0PSR7Y29udGV4dC50aW1lb3V0TXN9bXMgKCR7Y29udGV4dC5zb3VyY2UudGltZW91dH0pYCxcbiAgICBdO1xuICAgIHJldHVybiBgRXhlY3V0aW9uIGNvbnRleHQ6ICR7cGllY2VzLmpvaW4oXCIsIFwiKX0uYDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VzdG9tTGFuZ3VhZ2VFeHRyYWN0b3IoYmxvY2s6IGxvb21Db2RlQmxvY2ssIGZpbGU6IFRGaWxlKTogeyBtb2RlOiBcImNvbW1hbmRcIiB8IFwidHJhbnNwaWxlLWNcIjsgbGFuZ3VhZ2U6IHN0cmluZzsgZXhlY3V0YWJsZTogc3RyaW5nOyBhcmdzOiBzdHJpbmdbXTsgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nOyB0aW1lb3V0TXM6IG51bWJlciB9IHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBsYW5ndWFnZUlkID0gYmxvY2subGFuZ3VhZ2U7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGxhbmd1YWdlSWQudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgbGFuZ3VhZ2UgPSB0aGlzLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5maW5kKChjYW5kaWRhdGUpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSBjYW5kaWRhdGUubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGFsaWFzZXMgPSBjYW5kaWRhdGUuYWxpYXNlc1xuICAgICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAgIC5tYXAoKGFsaWFzKSA9PiBhbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICAgIHJldHVybiBuYW1lID09PSBub3JtYWxpemVkIHx8IGFsaWFzZXMuaW5jbHVkZXMobm9ybWFsaXplZCk7XG4gICAgfSk7XG4gICAgaWYgKCFsYW5ndWFnZSkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlID0gbGFuZ3VhZ2UuZXh0cmFjdG9yTW9kZSB8fCBcImNvbW1hbmRcIjtcbiAgICBjb25zdCBleGVjdXRhYmxlID0gbW9kZSA9PT0gXCJ0cmFuc3BpbGUtY1wiID8gbGFuZ3VhZ2UudHJhbnNwaWxlRXhlY3V0YWJsZT8udHJpbSgpIDogbGFuZ3VhZ2UuZXh0cmFjdG9yRXhlY3V0YWJsZT8udHJpbSgpO1xuICAgIGNvbnN0IGFyZ3MgPSBtb2RlID09PSBcInRyYW5zcGlsZS1jXCIgPyBsYW5ndWFnZS50cmFuc3BpbGVBcmdzIHx8IFwie3JlcXVlc3R9XCIgOiBsYW5ndWFnZS5leHRyYWN0b3JBcmdzIHx8IFwie3JlcXVlc3R9XCI7XG4gICAgaWYgKCFleGVjdXRhYmxlKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGNvbnN0IGV4ZWN1dGlvbkNvbnRleHQgPSByZXNvbHZlRXhlY3V0aW9uQ29udGV4dCh0aGlzLmFwcCwgZmlsZSwgYmxvY2ssIHRoaXMuc2V0dGluZ3MpO1xuICAgIHJldHVybiB7XG4gICAgICBtb2RlLFxuICAgICAgbGFuZ3VhZ2U6IGxhbmd1YWdlLm5hbWUsXG4gICAgICBleGVjdXRhYmxlLFxuICAgICAgYXJnczogc3BsaXRDb21tYW5kTGluZShhcmdzKSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGV4ZWN1dGlvbkNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogZXhlY3V0aW9uQ29udGV4dC50aW1lb3V0TXMsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgd3JpdGVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrLCByZXN1bHQ6IGxvb21TdG9yZWRPdXRwdXRbXCJyZXN1bHRcIl0pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgY29udGVudCwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICBjb25zdCBjdXJyZW50QmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuaWQgPT09IGJsb2NrLmlkKTtcbiAgICAgIGNvbnN0IHJlbmRlcmVkID0gdGhpcy5yZW5kZXJNYW5hZ2VkT3V0cHV0TWFya2Rvd24oYmxvY2suaWQsIHJlc3VsdCk7XG4gICAgICBjb25zdCBleGlzdGluZ1JhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9jay5pZCk7XG5cbiAgICAgIGlmIChleGlzdGluZ1JhbmdlKSB7XG4gICAgICAgIGxpbmVzLnNwbGljZShleGlzdGluZ1JhbmdlLnN0YXJ0LCBleGlzdGluZ1JhbmdlLmVuZCAtIGV4aXN0aW5nUmFuZ2Uuc3RhcnQgKyAxLCAuLi5yZW5kZXJlZCk7XG4gICAgICAgIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWN1cnJlbnRCbG9jaykge1xuICAgICAgICByZXR1cm4gY29udGVudDtcbiAgICAgIH1cblxuICAgICAgbGluZXMuc3BsaWNlKGN1cnJlbnRCbG9jay5lbmRMaW5lICsgMSwgMCwgLi4ucmVuZGVyZWQpO1xuICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdyaXRlT3V0cHV0RmlsZUlmUmVxdWVzdGVkKGZpbGU6IFRGaWxlLCBibG9jazogbG9vbUNvZGVCbG9jaywgcmVzdWx0OiBsb29tU3RvcmVkT3V0cHV0W1wicmVzdWx0XCJdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHRhcmdldCA9IHRoaXMucmVhZE91dHB1dEZpbGVUYXJnZXQoZmlsZSwgYmxvY2spO1xuICAgICAgaWYgKCF0YXJnZXQpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLmVuc3VyZVZhdWx0UGFyZW50Rm9sZGVyKHRhcmdldC5wYXRoKTtcbiAgICAgIGNvbnN0IHJlbmRlcmVkID0gdGFyZ2V0LmZvcm1hdCA9PT0gXCJqc29uXCJcbiAgICAgICAgPyB0aGlzLnJlbmRlck91dHB1dEZpbGVKc29uKGZpbGUsIGJsb2NrLCByZXN1bHQsIHRhcmdldClcbiAgICAgICAgOiB0aGlzLnJlbmRlck91dHB1dEZpbGVUZXh0KHJlc3VsdCwgdGFyZ2V0KTtcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSB0YXJnZXQubW9kZSA9PT0gXCJhcHBlbmRcIiAmJiBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyh0YXJnZXQucGF0aClcbiAgICAgICAgPyBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLnJlYWQodGFyZ2V0LnBhdGgpXG4gICAgICAgIDogXCJcIjtcbiAgICAgIGNvbnN0IG5leHQgPSB0YXJnZXQubW9kZSA9PT0gXCJhcHBlbmRcIiAmJiBjdXJyZW50XG4gICAgICAgID8gYCR7Y3VycmVudC5yZXBsYWNlKC9cXHMqJC8sIFwiXFxuXCIpfSR7cmVuZGVyZWR9YFxuICAgICAgICA6IHJlbmRlcmVkO1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci53cml0ZSh0YXJnZXQucGF0aCwgbmV4dCk7XG5cbiAgICAgIGNvbnN0IHN0cmVhbUxpc3QgPSB0YXJnZXQuc3RyZWFtcy5qb2luKFwiLFwiKTtcbiAgICAgIGNvbnN0IG5vdGljZSA9IGBXcm90ZSBvdXRwdXQgZmlsZSAke3RhcmdldC5wYXRofSAoJHt0YXJnZXQubW9kZX0sICR7dGFyZ2V0LmZvcm1hdH0sICR7c3RyZWFtTGlzdH0pLmA7XG4gICAgICByZXN1bHQud2FybmluZyA9IHJlc3VsdC53YXJuaW5nID8gYCR7bm90aWNlfVxcbiR7cmVzdWx0Lndhcm5pbmd9YCA6IG5vdGljZTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIGNvbnN0IG5vdGljZSA9IGBGYWlsZWQgdG8gd3JpdGUgb3V0cHV0IGZpbGU6ICR7bWVzc2FnZX1gO1xuICAgICAgcmVzdWx0Lndhcm5pbmcgPSByZXN1bHQud2FybmluZyA/IGAke25vdGljZX1cXG4ke3Jlc3VsdC53YXJuaW5nfWAgOiBub3RpY2U7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSByZWFkT3V0cHV0RmlsZVRhcmdldChmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2spOiBsb29tT3V0cHV0RmlsZVRhcmdldCB8IG51bGwge1xuICAgIGNvbnN0IHJhd1BhdGggPSBibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1vdXRwdXQtZmlsZVwiXSA/PyBibG9jay5hdHRyaWJ1dGVzW1wib3V0cHV0LWZpbGVcIl07XG4gICAgaWYgKCFyYXdQYXRoPy50cmltKCkpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBwYXRoOiB0aGlzLnJlc29sdmVPdXRwdXRWYXVsdFBhdGgoZmlsZSwgcmF3UGF0aCksXG4gICAgICBtb2RlOiB0aGlzLnJlYWRPdXRwdXRGaWxlTW9kZShibG9jayksXG4gICAgICBmb3JtYXQ6IHRoaXMucmVhZE91dHB1dEZpbGVGb3JtYXQoYmxvY2spLFxuICAgICAgc3RyZWFtczogdGhpcy5yZWFkT3V0cHV0RmlsZVN0cmVhbXMoYmxvY2spLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRPdXRwdXRGaWxlTW9kZShibG9jazogbG9vbUNvZGVCbG9jayk6IGxvb21PdXRwdXRGaWxlTW9kZSB7XG4gICAgY29uc3QgYXBwZW5kID0gYmxvY2suYXR0cmlidXRlc1tcImxvb20tb3V0cHV0LWFwcGVuZFwiXSA/PyBibG9jay5hdHRyaWJ1dGVzW1wib3V0cHV0LWFwcGVuZFwiXTtcbiAgICBpZiAoYXBwZW5kICYmICFbXCIwXCIsIFwiZmFsc2VcIiwgXCJub1wiLCBcIm9mZlwiXS5pbmNsdWRlcyhhcHBlbmQudHJpbSgpLnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICByZXR1cm4gXCJhcHBlbmRcIjtcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlID0gKGJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLW91dHB1dC1maWxlLW1vZGVcIl0gPz8gYmxvY2suYXR0cmlidXRlc1tcIm91dHB1dC1maWxlLW1vZGVcIl0gPz8gXCJyZXBsYWNlXCIpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChtb2RlID09PSBcImFwcGVuZFwiKSB7XG4gICAgICByZXR1cm4gXCJhcHBlbmRcIjtcbiAgICB9XG4gICAgaWYgKG1vZGUgPT09IFwicmVwbGFjZVwiKSB7XG4gICAgICByZXR1cm4gXCJyZXBsYWNlXCI7XG4gICAgfVxuICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgbG9vbS1vdXRwdXQtZmlsZS1tb2RlOiAke21vZGV9LiBVc2UgcmVwbGFjZSBvciBhcHBlbmQuYCk7XG4gIH1cblxuICBwcml2YXRlIHJlYWRPdXRwdXRGaWxlRm9ybWF0KGJsb2NrOiBsb29tQ29kZUJsb2NrKTogbG9vbU91dHB1dEZpbGVGb3JtYXQge1xuICAgIGNvbnN0IGZvcm1hdCA9IChibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1vdXRwdXQtZmlsZS1mb3JtYXRcIl0gPz8gYmxvY2suYXR0cmlidXRlc1tcIm91dHB1dC1maWxlLWZvcm1hdFwiXSA/PyBcInRleHRcIikudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKGZvcm1hdCA9PT0gXCJ0ZXh0XCIgfHwgZm9ybWF0ID09PSBcImpzb25cIikge1xuICAgICAgcmV0dXJuIGZvcm1hdDtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBsb29tLW91dHB1dC1maWxlLWZvcm1hdDogJHtmb3JtYXR9LiBVc2UgdGV4dCBvciBqc29uLmApO1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkT3V0cHV0RmlsZVN0cmVhbXMoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBsb29tT3V0cHV0RmlsZVN0cmVhbVtdIHtcbiAgICBjb25zdCB2YWx1ZSA9IGJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLW91dHB1dC1maWxlLXN0cmVhbXNcIl0gPz8gYmxvY2suYXR0cmlidXRlc1tcIm91dHB1dC1maWxlLXN0cmVhbXNcIl0gPz8gXCJzdGRvdXRcIjtcbiAgICBjb25zdCBwYXJzZWQgPSB2YWx1ZVxuICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgLm1hcCgoc3RyZWFtKSA9PiBzdHJlYW0udHJpbSgpLnRvTG93ZXJDYXNlKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgIGNvbnN0IGV4cGFuZGVkID0gcGFyc2VkLmluY2x1ZGVzKFwiYWxsXCIpXG4gICAgICA/IFtcIm1ldGFkYXRhXCIsIFwic3Rkb3V0XCIsIFwid2FybmluZ1wiLCBcInN0ZGVyclwiXVxuICAgICAgOiBwYXJzZWQ7XG4gICAgY29uc3Qgc3RyZWFtcyA9IGV4cGFuZGVkLm1hcCgoc3RyZWFtKSA9PiB7XG4gICAgICBpZiAoc3RyZWFtID09PSBcInN0ZG91dFwiIHx8IHN0cmVhbSA9PT0gXCJzdGRlcnJcIiB8fCBzdHJlYW0gPT09IFwid2FybmluZ1wiIHx8IHN0cmVhbSA9PT0gXCJtZXRhZGF0YVwiKSB7XG4gICAgICAgIHJldHVybiBzdHJlYW07XG4gICAgICB9XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxvb20tb3V0cHV0LWZpbGUtc3RyZWFtcyBlbnRyeTogJHtzdHJlYW19LmApO1xuICAgIH0pO1xuICAgIHJldHVybiBzdHJlYW1zLmxlbmd0aCA/IFsuLi5uZXcgU2V0KHN0cmVhbXMpXSA6IFtcInN0ZG91dFwiXTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZU91dHB1dFZhdWx0UGF0aChmaWxlOiBURmlsZSwgcmF3UGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCB0cmltbWVkID0gcmF3UGF0aC50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkIHx8IC9eW2EtekEtWl1bYS16QS1aMC05Ky4tXSo6Ly50ZXN0KHRyaW1tZWQpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJsb29tLW91dHB1dC1maWxlIG11c3QgYmUgYSB2YXVsdC1yZWxhdGl2ZSBwYXRoLlwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBwYXRoID0gdHJpbW1lZC5zdGFydHNXaXRoKFwiL1wiKVxuICAgICAgPyBub3JtYWxpemVQYXRoKHRyaW1tZWQuc2xpY2UoMSkpXG4gICAgICA6IG5vcm1hbGl6ZVBhdGgoZGlybmFtZShmaWxlLnBhdGgpID09PSBcIi5cIiA/IHRyaW1tZWQgOiBgJHtkaXJuYW1lKGZpbGUucGF0aCl9LyR7dHJpbW1lZH1gKTtcbiAgICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoXCIvXCIpLmZpbHRlcihCb29sZWFuKTtcbiAgICBpZiAoIXBhcnRzLmxlbmd0aCB8fCBwYXJ0cy5pbmNsdWRlcyhcIi4uXCIpIHx8IHBhdGguc3RhcnRzV2l0aChcIi5vYnNpZGlhbi9cIikgfHwgcGF0aCA9PT0gXCIub2JzaWRpYW5cIiB8fCBwYXRoLnN0YXJ0c1dpdGgoXCIuZ2l0L1wiKSB8fCBwYXRoID09PSBcIi5naXRcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGxvb20tb3V0cHV0LWZpbGUgcGF0aDogJHtyYXdQYXRofWApO1xuICAgIH1cbiAgICByZXR1cm4gcGF0aDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlVmF1bHRQYXJlbnRGb2xkZXIocGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZm9sZGVyID0gZGlybmFtZShwYXRoKTtcbiAgICBpZiAoIWZvbGRlciB8fCBmb2xkZXIgPT09IFwiLlwiKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbGV0IGN1cnJlbnQgPSBcIlwiO1xuICAgIGZvciAoY29uc3QgcGFydCBvZiBmb2xkZXIuc3BsaXQoXCIvXCIpLmZpbHRlcihCb29sZWFuKSkge1xuICAgICAgY3VycmVudCA9IGN1cnJlbnQgPyBgJHtjdXJyZW50fS8ke3BhcnR9YCA6IHBhcnQ7XG4gICAgICBpZiAoIShhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhjdXJyZW50KSkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5ta2RpcihjdXJyZW50KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHJlbmRlck91dHB1dEZpbGVUZXh0KHJlc3VsdDogbG9vbVN0b3JlZE91dHB1dFtcInJlc3VsdFwiXSwgdGFyZ2V0OiBsb29tT3V0cHV0RmlsZVRhcmdldCk6IHN0cmluZyB7XG4gICAgY29uc3Qgc2VjdGlvbnMgPSB0YXJnZXQuc3RyZWFtcy5mbGF0TWFwKChzdHJlYW0pID0+IHtcbiAgICAgIHN3aXRjaCAoc3RyZWFtKSB7XG4gICAgICAgIGNhc2UgXCJtZXRhZGF0YVwiOlxuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICBgcnVubmVyPSR7cmVzdWx0LnJ1bm5lck5hbWV9YCxcbiAgICAgICAgICAgIGBleGl0PSR7cmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWAsXG4gICAgICAgICAgICBgZHVyYXRpb249JHtyZXN1bHQuZHVyYXRpb25Nc31tc2AsXG4gICAgICAgICAgICBgdGltZXN0YW1wPSR7cmVzdWx0LmZpbmlzaGVkQXR9YCxcbiAgICAgICAgICBdLmpvaW4oXCJcXG5cIik7XG4gICAgICAgIGNhc2UgXCJzdGRvdXRcIjpcbiAgICAgICAgICByZXR1cm4gcmVzdWx0LnN0ZG91dCA/IFtyZXN1bHQuc3Rkb3V0XSA6IFtdO1xuICAgICAgICBjYXNlIFwid2FybmluZ1wiOlxuICAgICAgICAgIHJldHVybiByZXN1bHQud2FybmluZyA/IFtyZXN1bHQud2FybmluZ10gOiBbXTtcbiAgICAgICAgY2FzZSBcInN0ZGVyclwiOlxuICAgICAgICAgIHJldHVybiByZXN1bHQuc3RkZXJyID8gW3Jlc3VsdC5zdGRlcnJdIDogW107XG4gICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIGAke3NlY3Rpb25zLmpvaW4oXCJcXG5cXG5cIikucmVwbGFjZSgvXFxzKiQvLCBcIlwiKX1cXG5gO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJPdXRwdXRGaWxlSnNvbihmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2ssIHJlc3VsdDogbG9vbVN0b3JlZE91dHB1dFtcInJlc3VsdFwiXSwgdGFyZ2V0OiBsb29tT3V0cHV0RmlsZVRhcmdldCk6IHN0cmluZyB7XG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIG5vdGU6IGZpbGUucGF0aCxcbiAgICAgIGJsb2NrSWQ6IGJsb2NrLmlkLFxuICAgICAgbGFuZ3VhZ2U6IGJsb2NrLmxhbmd1YWdlLFxuICAgICAgcnVubmVyOiByZXN1bHQucnVubmVyTmFtZSxcbiAgICAgIGV4aXRDb2RlOiByZXN1bHQuZXhpdENvZGUsXG4gICAgICBzdWNjZXNzOiByZXN1bHQuc3VjY2VzcyxcbiAgICAgIGR1cmF0aW9uTXM6IHJlc3VsdC5kdXJhdGlvbk1zLFxuICAgICAgc3RhcnRlZEF0OiByZXN1bHQuc3RhcnRlZEF0LFxuICAgICAgZmluaXNoZWRBdDogcmVzdWx0LmZpbmlzaGVkQXQsXG4gICAgICBzdHJlYW1zOiB7XG4gICAgICAgIC4uLih0YXJnZXQuc3RyZWFtcy5pbmNsdWRlcyhcInN0ZG91dFwiKSA/IHsgc3Rkb3V0OiByZXN1bHQuc3Rkb3V0IH0gOiB7fSksXG4gICAgICAgIC4uLih0YXJnZXQuc3RyZWFtcy5pbmNsdWRlcyhcIndhcm5pbmdcIikgPyB7IHdhcm5pbmc6IHJlc3VsdC53YXJuaW5nID8/IFwiXCIgfSA6IHt9KSxcbiAgICAgICAgLi4uKHRhcmdldC5zdHJlYW1zLmluY2x1ZGVzKFwic3RkZXJyXCIpID8geyBzdGRlcnI6IHJlc3VsdC5zdGRlcnIgfSA6IHt9KSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICByZXR1cm4gYCR7SlNPTi5zdHJpbmdpZnkocGF5bG9hZCwgbnVsbCwgMil9XFxuYDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVtb3ZlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGVQYXRoOiBzdHJpbmcsIGJsb2NrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IHJhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9ja0lkKTtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG4gICAgICBsaW5lcy5zcGxpY2UocmFuZ2Uuc3RhcnQsIHJhbmdlLmVuZCAtIHJhbmdlLnN0YXJ0ICsgMSk7XG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyTWFuYWdlZE91dHB1dE1hcmtkb3duKGJsb2NrSWQ6IHN0cmluZywgcmVzdWx0OiBsb29tU3RvcmVkT3V0cHV0W1wicmVzdWx0XCJdKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGJvZHkgPSBbXG4gICAgICBgcnVubmVyPSR7cmVzdWx0LnJ1bm5lck5hbWV9YCxcbiAgICAgIGBleGl0PSR7cmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWAsXG4gICAgICBgZHVyYXRpb249JHtyZXN1bHQuZHVyYXRpb25Nc31tc2AsXG4gICAgICBgdGltZXN0YW1wPSR7cmVzdWx0LmZpbmlzaGVkQXR9YCxcbiAgICAgIHJlc3VsdC5zdGRvdXQgPyBgc3Rkb3V0OlxcbiR7cmVzdWx0LnN0ZG91dH1gIDogXCJcIixcbiAgICAgIHJlc3VsdC53YXJuaW5nID8gYHdhcm5pbmc6XFxuJHtyZXN1bHQud2FybmluZ31gIDogXCJcIixcbiAgICAgIHJlc3VsdC5zdGRlcnIgPyBgc3RkZXJyOlxcbiR7cmVzdWx0LnN0ZGVycn1gIDogXCJcIixcbiAgICBdXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAuam9pbihcIlxcblxcblwiKTtcblxuICAgIHJldHVybiBbXG4gICAgICBgPCEtLSBsb29tOm91dHB1dDpzdGFydCBpZD0ke2Jsb2NrSWR9IC0tPmAsXG4gICAgICBcImBgYHRleHRcIixcbiAgICAgIGJvZHksXG4gICAgICBcImBgYFwiLFxuICAgICAgXCI8IS0tIGxvb206b3V0cHV0OmVuZCAtLT5cIixcbiAgICBdO1xuICB9XG5cbiAgcHJpdmF0ZSBmaW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzOiBzdHJpbmdbXSwgYmxvY2tJZDogc3RyaW5nKTogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gICAgY29uc3Qgc3RhcnRNYXJrZXIgPSBgPCEtLSBsb29tOm91dHB1dDpzdGFydCBpZD0ke2Jsb2NrSWR9IC0tPmA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgaWYgKGxpbmVzW2ldLnRyaW0oKSAhPT0gc3RhcnRNYXJrZXIpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGZvciAobGV0IGogPSBpICsgMTsgaiA8IGxpbmVzLmxlbmd0aDsgaiArPSAxKSB7XG4gICAgICAgIGlmIChsaW5lc1tqXS50cmltKCkgPT09IFwiPCEtLSBsb29tOm91dHB1dDplbmQgLS0+XCIpIHtcbiAgICAgICAgICByZXR1cm4geyBzdGFydDogaSwgZW5kOiBqIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBzaG91bGRSZW5kZXJTdGRpblBhbmVsKGJsb2NrOiBsb29tQ29kZUJsb2NrKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuc3RkaW5QYW5lbHMuaGFzKGJsb2NrLmlkKSB8fCB0aGlzLmhhc0VuYWJsZWRTdGRpbkF0dHJpYnV0ZShibG9jayk7XG4gIH1cblxuICBwcml2YXRlIGhhc0VuYWJsZWRTdGRpbkF0dHJpYnV0ZShibG9jazogbG9vbUNvZGVCbG9jayk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGlucHV0ID0gYmxvY2suYXR0cmlidXRlc1tcImxvb20taW5wdXRcIl0gPz8gYmxvY2suYXR0cmlidXRlcy5pbnB1dDtcbiAgICBpZiAoaW5wdXQgJiYgIVtcIjBcIiwgXCJmYWxzZVwiLCBcIm5vXCIsIFwib2ZmXCJdLmluY2x1ZGVzKGlucHV0LnRyaW0oKS50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1zdGRpblwiXSAhPSBudWxsIHx8XG4gICAgICBibG9jay5hdHRyaWJ1dGVzLnN0ZGluICE9IG51bGwgfHxcbiAgICAgIGJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLXN0ZGluLWZpbGVcIl0gIT0gbnVsbCB8fFxuICAgICAgYmxvY2suYXR0cmlidXRlc1tcInN0ZGluLWZpbGVcIl0gIT0gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlU3RkaW5QYW5lbChibG9jazogbG9vbUNvZGVCbG9jayk6IEhUTUxFbGVtZW50IHtcbiAgICBjb25zdCBwYW5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgcGFuZWwuY2xhc3NOYW1lID0gXCJsb29tLXN0ZGluLXBhbmVsXCI7XG5cbiAgICBjb25zdCBoZWFkZXIgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1zdGRpbi1oZWFkZXJcIiB9KTtcbiAgICBoZWFkZXIuY3JlYXRlU3Bhbih7IHRleHQ6IFwic3RkaW5cIiB9KTtcbiAgICBjb25zdCBhY3Rpb25zID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXN0ZGluLWFjdGlvbnNcIiB9KTtcbiAgICBjb25zdCBydW5CdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJSdW5cIiB9KTtcbiAgICBjb25zdCBjbGVhckJ1dHRvbiA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNsZWFyXCIgfSk7XG5cbiAgICBjb25zdCB0ZXh0YXJlYSA9IHBhbmVsLmNyZWF0ZUVsKFwidGV4dGFyZWFcIiwgeyBjbHM6IFwibG9vbS1zdGRpbi1pbnB1dFwiIH0pO1xuICAgIHRleHRhcmVhLnBsYWNlaG9sZGVyID0gdGhpcy5nZXRTdGRpblBsYWNlaG9sZGVyKGJsb2NrKTtcbiAgICB0ZXh0YXJlYS52YWx1ZSA9IHRoaXMuc3RkaW5JbnB1dHMuZ2V0KGJsb2NrLmlkKSA/PyBibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1zdGRpblwiXSA/PyBibG9jay5hdHRyaWJ1dGVzLnN0ZGluID8/IFwiXCI7XG4gICAgdGV4dGFyZWEuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsICgpID0+IHtcbiAgICAgIHRoaXMuc3RkaW5JbnB1dHMuc2V0KGJsb2NrLmlkLCB0ZXh0YXJlYS52YWx1ZSk7XG4gICAgfSk7XG4gICAgcnVuQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMuc3RkaW5JbnB1dHMuc2V0KGJsb2NrLmlkLCB0ZXh0YXJlYS52YWx1ZSk7XG4gICAgICB2b2lkIHRoaXMucnVuQWN0aXZlQmxvY2tCeUlkKGJsb2NrLmlkKTtcbiAgICB9KTtcbiAgICBjbGVhckJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0ZXh0YXJlYS52YWx1ZSA9IFwiXCI7XG4gICAgICB0aGlzLnN0ZGluSW5wdXRzLnNldChibG9jay5pZCwgXCJcIik7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcGFuZWw7XG4gIH1cblxuICBwcml2YXRlIGdldFN0ZGluUGxhY2Vob2xkZXIoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBzdHJpbmcge1xuICAgIGNvbnN0IHN0ZGluRmlsZSA9IGJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLXN0ZGluLWZpbGVcIl0gPz8gYmxvY2suYXR0cmlidXRlc1tcInN0ZGluLWZpbGVcIl07XG4gICAgcmV0dXJuIHN0ZGluRmlsZSA/IGBzdGRpbiBmaWxlOiAke3N0ZGluRmlsZX1gIDogXCJzdGFuZGFyZCBpbnB1dCBmb3IgdGhpcyBibG9ja1wiO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZXNvbHZlQmxvY2tTdGRpbihmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2spOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICAgIGlmICh0aGlzLnN0ZGluSW5wdXRzLmhhcyhibG9jay5pZCkpIHtcbiAgICAgIHJldHVybiB0aGlzLnN0ZGluSW5wdXRzLmdldChibG9jay5pZCk7XG4gICAgfVxuXG4gICAgY29uc3QgaW5saW5lID0gYmxvY2suYXR0cmlidXRlc1tcImxvb20tc3RkaW5cIl0gPz8gYmxvY2suYXR0cmlidXRlcy5zdGRpbjtcbiAgICBpZiAoaW5saW5lICE9IG51bGwpIHtcbiAgICAgIHJldHVybiBkZWNvZGVFc2NhcGVkQXR0cmlidXRlKGlubGluZSk7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RkaW5GaWxlID0gYmxvY2suYXR0cmlidXRlc1tcImxvb20tc3RkaW4tZmlsZVwiXSA/PyBibG9jay5hdHRyaWJ1dGVzW1wic3RkaW4tZmlsZVwiXTtcbiAgICBpZiAoIXN0ZGluRmlsZT8udHJpbSgpKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGNvbnN0IHN0ZGluUGF0aCA9IHRoaXMucmVzb2x2ZVJlZmVyZW5jZWRWYXVsdFBhdGgoZmlsZSwgc3RkaW5GaWxlKTtcbiAgICBjb25zdCBpbnB1dEZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoc3RkaW5QYXRoKTtcbiAgICBpZiAoIShpbnB1dEZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3RkaW4gZmlsZSBub3QgZm91bmQ6ICR7c3RkaW5QYXRofWApO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChpbnB1dEZpbGUpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGRlY29kZUVzY2FwZWRBdHRyaWJ1dGUodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB2YWx1ZS5yZXBsYWNlKC9cXFxcbi9nLCBcIlxcblwiKS5yZXBsYWNlKC9cXFxcdC9nLCBcIlxcdFwiKTtcbn1cbiIsICJpbXBvcnQgeyBOb3RpY2UsIHR5cGUgQXBwLCB0eXBlIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG9wZW5TeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBta2RpciwgcmVhZEZpbGUsIHJlYWRkaXIsIHJtLCB3cml0ZUZpbGUgfSBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IGJhc2VuYW1lLCBqb2luLCBub3JtYWxpemUgYXMgbm9ybWFsaXplRnNQYXRoLCBwb3NpeCBhcyBwb3NpeFBhdGggfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgc3Bhd24gfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xuaW1wb3J0IHsgcnVuUHJvY2VzcyB9IGZyb20gXCIuL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB7IHNwbGl0Q29tbWFuZExpbmUgfSBmcm9tIFwiLi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbnR5cGUgbG9vbUNvbnRhaW5lclJ1bnRpbWUgPSBcImRvY2tlclwiIHwgXCJwb2RtYW5cIiB8IFwicWVtdVwiIHwgXCJ3c2xcIiB8IFwiY3VzdG9tXCI7XG5cbmludGVyZmFjZSBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcge1xuICBjb21tYW5kPzogc3RyaW5nO1xuICBleHRlbnNpb24/OiBzdHJpbmc7XG4gIHVzZURlZmF1bHQ/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgbG9vbUNvbW1hbmRFeHBlY3RhdGlvbiB7XG4gIGNvbW1hbmQ6IHN0cmluZztcbiAgcG9zaXRpdmVSZXNwb25zZT86IHN0cmluZztcbiAgbmVnYXRpdmVSZXNwb25zZT86IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIGxvb21RZW11Q29uZmlnIHtcbiAgc3NoVGFyZ2V0OiBzdHJpbmc7XG4gIHJlbW90ZVdvcmtzcGFjZTogc3RyaW5nO1xuICBzc2hFeGVjdXRhYmxlPzogc3RyaW5nO1xuICBzc2hBcmdzPzogc3RyaW5nO1xuICBzdGFydENvbW1hbmQ/OiBzdHJpbmc7XG4gIGJ1aWxkQ29tbWFuZD86IHN0cmluZztcbiAgdGVhcmRvd25Db21tYW5kPzogc3RyaW5nO1xuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG4gIG1hbmFnZXI/OiBsb29tUWVtdU1hbmFnZXJDb25maWc7XG59XG5cbmludGVyZmFjZSBsb29tUWVtdU1hbmFnZXJDb25maWcge1xuICBlbmFibGVkOiBib29sZWFuO1xuICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICBhcmdzPzogc3RyaW5nO1xuICBpbWFnZT86IHN0cmluZztcbiAgaW1hZ2VGb3JtYXQ/OiBzdHJpbmc7XG4gIHBpZEZpbGU/OiBzdHJpbmc7XG4gIGxvZ0ZpbGU/OiBzdHJpbmc7XG4gIHJlYWRpbmVzc1RpbWVvdXRNcz86IG51bWJlcjtcbiAgcmVhZGluZXNzSW50ZXJ2YWxNcz86IG51bWJlcjtcbiAgYm9vdERlbGF5TXM/OiBudW1iZXI7XG4gIHNodXRkb3duQ29tbWFuZD86IHN0cmluZztcbiAgc2h1dGRvd25UaW1lb3V0TXM/OiBudW1iZXI7XG4gIGtpbGxTaWduYWw/OiBOb2RlSlMuU2lnbmFscztcbiAgcGVyc2lzdD86IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB7XG4gIGV4ZWN1dGFibGU6IHN0cmluZztcbiAgYXJncz86IHN0cmluZztcbiAgYnVpbGQ/OiBzdHJpbmc7XG4gIGNvbW1hbmRTdHJ1Y3R1cmU/OiBzdHJpbmc7XG4gIHRlYXJkb3duPzogc3RyaW5nO1xuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG59XG5cbmludGVyZmFjZSBsb29tV3NsQ29uZmlnIHtcbiAgaW50ZXJhY3RpdmU/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgbG9vbUNvbnRhaW5lckNvbmZpZyB7XG4gIHJ1bnRpbWU6IGxvb21Db250YWluZXJSdW50aW1lO1xuICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICBpbWFnZT86IHN0cmluZztcbiAgd3NsPzogbG9vbVdzbENvbmZpZztcbiAgaGVhbHRoQ2hlY2s/OiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uO1xuICBxZW11PzogbG9vbVFlbXVDb25maWc7XG4gIGN1c3RvbT86IGxvb21DdXN0b21SdW50aW1lQ29uZmlnO1xuICBsYW5ndWFnZXM6IFJlY29yZDxzdHJpbmcsIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZz47XG59XG5cbmludGVyZmFjZSBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3Qge1xuICBhY3Rpb246IFwiYnVpbGRcIiB8IFwicnVuXCIgfCBcInRlYXJkb3duXCI7XG4gIGdyb3VwTmFtZTogc3RyaW5nO1xuICBncm91cFBhdGg6IHN0cmluZztcbiAgcnVudGltZTogbG9vbUNvbnRhaW5lclJ1bnRpbWU7XG4gIGltYWdlPzogc3RyaW5nO1xuICBidWlsZD86IHN0cmluZztcbiAgY29tbWFuZFN0cnVjdHVyZT86IHN0cmluZztcbiAgdGVhcmRvd24/OiBzdHJpbmc7XG4gIGxhbmd1YWdlPzogc3RyaW5nO1xuICBsYW5ndWFnZUFsaWFzPzogc3RyaW5nO1xuICBmaWxlTmFtZT86IHN0cmluZztcbiAgZmlsZVBhdGg/OiBzdHJpbmc7XG4gIGNvbW1hbmQ/OiBzdHJpbmc7XG4gIHN0ZGluPzogc3RyaW5nO1xuICB0aW1lb3V0TXM6IG51bWJlcjtcbiAgY29uZmlnOiB7XG4gICAgZXhlY3V0YWJsZT86IHN0cmluZztcbiAgICBjdXN0b20/OiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZztcbiAgICBxZW11PzogbG9vbVFlbXVDb25maWc7XG4gICAgaGVhbHRoQ2hlY2s/OiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uO1xuICB9O1xufVxuXG5leHBvcnQgY2xhc3MgbG9vbUNvbnRhaW5lclJ1bm5lciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYnVpbHRJbWFnZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGFwcDogQXBwLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luRGlyOiBzdHJpbmcsXG4gICkgeyB9XG5cbiAgZ2V0Q29udGFpbmVyR3JvdXBOYW1lKGZpbGU6IFRGaWxlKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgY29uc3QgZnJvbnRtYXR0ZXIgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XG4gICAgY29uc3QgdmFsdWUgPSBmcm9udG1hdHRlcj8uW1wibG9vbS1jb250YWluZXJcIl07XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB2YWx1ZS50cmltKCkgPyB2YWx1ZS50cmltKCkgOiBudWxsO1xuICB9XG5cbiAgYXN5bmMgZ2V0R3JvdXBTdW1tYXJpZXMoKTogUHJvbWlzZTxBcnJheTx7IG5hbWU6IHN0cmluZzsgc3RhdHVzOiBzdHJpbmcgfT4+IHtcbiAgICBjb25zdCBjb250YWluZXJzUGF0aCA9IHRoaXMuZ2V0Q29udGFpbmVyc1BhdGgoKTtcbiAgICBpZiAoIWV4aXN0c1N5bmMoY29udGFpbmVyc1BhdGgpKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgY29uc3QgZW50cmllcyA9IGF3YWl0IHJlYWRkaXIoY29udGFpbmVyc1BhdGgsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgICByZXR1cm4gUHJvbWlzZS5hbGwoXG4gICAgICBlbnRyaWVzXG4gICAgICAgIC5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5pc0RpcmVjdG9yeSgpKVxuICAgICAgICAubWFwKGFzeW5jIChlbnRyeSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGdyb3VwUGF0aCA9IGpvaW4oY29udGFpbmVyc1BhdGgsIGVudHJ5Lm5hbWUpO1xuICAgICAgICAgIGNvbnN0IGhhc0NvbmZpZyA9IGV4aXN0c1N5bmMoam9pbihncm91cFBhdGgsIFwiY29uZmlnLmpzb25cIikpO1xuICAgICAgICAgIGNvbnN0IGhhc0RvY2tlcmZpbGUgPSBleGlzdHNTeW5jKGpvaW4oZ3JvdXBQYXRoLCBcIkRvY2tlcmZpbGVcIikpO1xuICAgICAgICAgIGlmICghaGFzQ29uZmlnKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBuYW1lOiBlbnRyeS5uYW1lLFxuICAgICAgICAgICAgICBzdGF0dXM6IFwibWlzc2luZyBjb25maWcuanNvblwiLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHRoaXMucmVhZENvbmZpZyhncm91cFBhdGgpO1xuICAgICAgICAgICAgY29uc3QgcGllY2VzID0gW2BydW50aW1lOiAke2NvbmZpZy5ydW50aW1lfWBdO1xuICAgICAgICAgICAgaWYgKChjb25maWcucnVudGltZSA9PT0gXCJkb2NrZXJcIiB8fCBjb25maWcucnVudGltZSA9PT0gXCJwb2RtYW5cIikgJiYgaGFzRG9ja2VyZmlsZSkge1xuICAgICAgICAgICAgICBwaWVjZXMucHVzaChcIkRvY2tlcmZpbGVcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY29uZmlnLnJ1bnRpbWUgPT09IFwicWVtdVwiICYmIGNvbmZpZy5xZW11Py5zc2hUYXJnZXQpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goYHNzaDogJHtjb25maWcucWVtdS5zc2hUYXJnZXR9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY29uZmlnLnJ1bnRpbWUgPT09IFwicWVtdVwiICYmIGNvbmZpZy5xZW11Py5tYW5hZ2VyPy5lbmFibGVkKSB7XG4gICAgICAgICAgICAgIHBpZWNlcy5wdXNoKGBtYW5hZ2VyOiAke2F3YWl0IHRoaXMuZ2V0TWFuYWdlZFFlbXVTdGF0dXMoZ3JvdXBQYXRoLCBjb25maWcucWVtdS5tYW5hZ2VyKX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjb25maWcucnVudGltZSA9PT0gXCJjdXN0b21cIiAmJiBjb25maWcuY3VzdG9tPy5leGVjdXRhYmxlKSB7XG4gICAgICAgICAgICAgIHBpZWNlcy5wdXNoKGB3cmFwcGVyOiAke2NvbmZpZy5jdXN0b20uZXhlY3V0YWJsZX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGxhbmd1YWdlQ291bnQgPSBPYmplY3Qua2V5cyhjb25maWcubGFuZ3VhZ2VzKS5sZW5ndGg7XG4gICAgICAgICAgICBwaWVjZXMucHVzaChgJHtsYW5ndWFnZUNvdW50fSBsYW5ndWFnZSR7bGFuZ3VhZ2VDb3VudCA9PT0gMSA/IFwiXCIgOiBcInNcIn1gKTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIG5hbWU6IGVudHJ5Lm5hbWUsXG4gICAgICAgICAgICAgIHN0YXR1czogcGllY2VzLmpvaW4oXCIsIFwiKSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIG5hbWU6IGVudHJ5Lm5hbWUsXG4gICAgICAgICAgICAgIHN0YXR1czogYGludmFsaWQgY29uZmlnLmpzb246ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MsIGdyb3VwTmFtZTogc3RyaW5nKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgZ3JvdXBQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBQYXRoKGdyb3VwTmFtZSk7XG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgdGhpcy5yZWFkQ29uZmlnKGdyb3VwUGF0aCk7XG4gICAgY29uc3QgY29uZmlnTGFuZyA9IGNvbmZpZy5sYW5ndWFnZXNbYmxvY2subGFuZ3VhZ2VdID8/IGNvbmZpZy5sYW5ndWFnZXNbYmxvY2subGFuZ3VhZ2VBbGlhc107XG5cbiAgICBsZXQgaXNGYWxsYmFjayA9IGZhbHNlO1xuICAgIGxldCBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnIHwgbnVsbCA9IG51bGw7XG5cbiAgICBpZiAoY29uZmlnTGFuZykge1xuICAgICAgaWYgKGNvbmZpZ0xhbmcudXNlRGVmYXVsdCkge1xuICAgICAgICBsYW5ndWFnZSA9IHRoaXMuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGJsb2NrLmxhbmd1YWdlLCBzZXR0aW5ncykgPz8gdGhpcy5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcoYmxvY2subGFuZ3VhZ2VBbGlhcywgc2V0dGluZ3MpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbGFuZ3VhZ2UgPSBjb25maWdMYW5nO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBsYW5ndWFnZSA9IHRoaXMuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGJsb2NrLmxhbmd1YWdlLCBzZXR0aW5ncykgPz8gdGhpcy5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcoYmxvY2subGFuZ3VhZ2VBbGlhcywgc2V0dGluZ3MpO1xuICAgICAgaXNGYWxsYmFjayA9IHRydWU7XG4gICAgfVxuXG4gICAgaWYgKCFsYW5ndWFnZSB8fCAhbGFuZ3VhZ2UuY29tbWFuZCB8fCAhbGFuZ3VhZ2UuZXh0ZW5zaW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnRhaW5lciBncm91cCAke2dyb3VwTmFtZX0gaGFzIG5vIGNvbW1hbmQgZm9yICR7YmxvY2subGFuZ3VhZ2V9LmApO1xuICAgIH1cblxuICAgIGF3YWl0IG1rZGlyKGdyb3VwUGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhjb25maWcuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpoZWFsdGhgLCBgQ29udGFpbmVyICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcbiAgICBjb25zdCB0ZW1wRmlsZU5hbWUgPSBgdGVtcF8ke0RhdGUubm93KCl9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygxNikuc2xpY2UoMil9JHtub3JtYWxpemVFeHRlbnNpb24obGFuZ3VhZ2UuZXh0ZW5zaW9uKX1gO1xuICAgIGNvbnN0IHRlbXBGaWxlUGF0aCA9IGpvaW4oZ3JvdXBQYXRoLCB0ZW1wRmlsZU5hbWUpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHdyaXRlRmlsZSh0ZW1wRmlsZVBhdGgsIGJsb2NrLmNvbnRlbnQsIFwidXRmOFwiKTtcbiAgICAgIGxldCByZXN1bHQ6IGxvb21SdW5SZXN1bHQ7XG4gICAgICBzd2l0Y2ggKGNvbmZpZy5ydW50aW1lKSB7XG4gICAgICAgIGNhc2UgXCJkb2NrZXJcIjpcbiAgICAgICAgY2FzZSBcInBvZG1hblwiOlxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuT2NpQ29udGFpbmVyKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGxhbmd1YWdlLCB0ZW1wRmlsZU5hbWUsIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcInFlbXVcIjpcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1blFlbXUoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgY29udGV4dCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJjdXN0b21cIjpcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkN1c3RvbShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBibG9jaywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgdGVtcEZpbGVQYXRoLCBjb250ZXh0KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcIndzbFwiOlxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuV3NsQ29udGFpbmVyKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGxhbmd1YWdlLCB0ZW1wRmlsZU5hbWUsIGNvbnRleHQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgcnVudGltZTogJHtjb25maWcucnVudGltZX1gKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGlzRmFsbGJhY2spIHtcbiAgICAgICAgY29uc3QgZmFsbGJhY2tNc2cgPSBgW0xvb21dIExhbmd1YWdlICcke2Jsb2NrLmxhbmd1YWdlfScgd2FzIG5vdCBkZWNsYXJlZCBpbiBjb250YWluZXIgZ3JvdXAuIFJ1bm5pbmcgdXNpbmcgZGVmYXVsdCBjb21tYW5kOiAke2xhbmd1YWdlLmNvbW1hbmR9YDtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSByZXN1bHQud2FybmluZyA/IGAke3Jlc3VsdC53YXJuaW5nfVxcbiR7ZmFsbGJhY2tNc2d9YCA6IGZhbGxiYWNrTXNnO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgcm0odGVtcEZpbGVQYXRoLCB7IGZvcmNlOiB0cnVlIH0pO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGJ1aWxkR3JvdXAoZ3JvdXBOYW1lOiBzdHJpbmcsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgZ3JvdXBQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBQYXRoKGdyb3VwTmFtZSk7XG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgdGhpcy5yZWFkQ29uZmlnKGdyb3VwUGF0aCk7XG4gICAgYXdhaXQgbWtkaXIoZ3JvdXBQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKGNvbmZpZy5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCB0aW1lb3V0TXMsIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06aGVhbHRoYCwgYENvbnRhaW5lciAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG4gICAgc3dpdGNoIChjb25maWcucnVudGltZSkge1xuICAgICAgY2FzZSBcImRvY2tlclwiOlxuICAgICAgY2FzZSBcInBvZG1hblwiOlxuICAgICAgICByZXR1cm4gdGhpcy5idWlsZEltYWdlKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICAgIGNhc2UgXCJxZW11XCI6XG4gICAgICAgIHJldHVybiB0aGlzLmJ1aWxkUWVtdShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgICBjYXNlIFwiY3VzdG9tXCI6XG4gICAgICAgIHJldHVybiB0aGlzLnJ1bkN1c3RvbVdyYXBwZXIoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGhpcy5jcmVhdGVDdXN0b21SZXF1ZXN0KFwiYnVpbGRcIiwgZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGltZW91dE1zKSwgdGltZW91dE1zLCBzaWduYWwpO1xuICAgICAgY2FzZSBcIndzbFwiOlxuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVTeW50aGV0aWNSZXN1bHQoXG4gICAgICAgICAgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06d3NsOmJ1aWxkYCxcbiAgICAgICAgICBgV1NMICR7Z3JvdXBOYW1lfSBidWlsZGAsXG4gICAgICAgICAgYFdTTCBlbnZpcm9ubWVudCAke2NvbmZpZy5pbWFnZSB8fCBcIihkZWZhdWx0KVwifSBkb2VzIG5vdCByZXF1aXJlIGEgYnVpbGQgc3RlcC5cXG5gLFxuICAgICAgICApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuT2NpQ29udGFpbmVyKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICAgIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGltYWdlID0gYXdhaXQgdGhpcy5yZXNvbHZlSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIGNvbnN0IGNvbW1hbmQgPSBzcGxpdENvbW1hbmRMaW5lKGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGVOYW1lKSk7XG4gICAgaWYgKCFjb21tYW5kLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbW1hbmQgaXMgZW1wdHkuXCIpO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfWAsXG4gICAgICBydW5uZXJOYW1lOiBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSAke2dyb3VwTmFtZX1gLFxuICAgICAgZXhlY3V0YWJsZTogdGhpcy5ydW50aW1lRXhlY3V0YWJsZShjb25maWcpLFxuICAgICAgYXJnczogW1xuICAgICAgICBcInJ1blwiLFxuICAgICAgICBcIi0tcm1cIixcbiAgICAgICAgLi4uKGNvbnRleHQuc3RkaW4gIT0gbnVsbCA/IFtcIi1pXCJdIDogW10pLFxuICAgICAgICBcIi12XCIsXG4gICAgICAgIGAke2dyb3VwUGF0aH06L3dvcmtzcGFjZWAsXG4gICAgICAgIFwiLXdcIixcbiAgICAgICAgXCIvd29ya3NwYWNlXCIsXG4gICAgICAgIGltYWdlLFxuICAgICAgICAuLi5jb21tYW5kLFxuICAgICAgXSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1blFlbXUoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHFlbXUgPSB0aGlzLnJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZyk7XG4gICAgYXdhaXQgdGhpcy5ydW5PcHRpb25hbENvbW1hbmQocWVtdS5zdGFydENvbW1hbmQsIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OnN0YXJ0YCwgYFFFTVUgJHtncm91cE5hbWV9IHN0YXJ0YCk7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVNYW5hZ2VkUWVtdShncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsKTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKHFlbXUuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OmhlYWx0aGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZW1vdGVGaWxlID0gcG9zaXhQYXRoLmpvaW4ocWVtdS5yZW1vdGVXb3Jrc3BhY2UsIHRlbXBGaWxlTmFtZSk7XG4gICAgICBjb25zdCByZW1vdGVDb21tYW5kID0gbGFuZ3VhZ2UuY29tbWFuZCEucmVwbGFjZUFsbChcIntmaWxlfVwiLCBzaGVsbFF1b3RlKHJlbW90ZUZpbGUpKTtcbiAgICAgIGlmICghcmVtb3RlQ29tbWFuZC50cmltKCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUUVNVSBjb21tYW5kIGlzIGVtcHR5LlwiKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IGBRRU1VICR7Z3JvdXBOYW1lfWAsXG4gICAgICAgIGV4ZWN1dGFibGU6IHFlbXUuc3NoRXhlY3V0YWJsZSB8fCBcInNzaFwiLFxuICAgICAgICBhcmdzOiBbXG4gICAgICAgICAgLi4uc3BsaXRDb21tYW5kTGluZShxZW11LnNzaEFyZ3MgfHwgXCJcIiksXG4gICAgICAgICAgcWVtdS5zc2hUYXJnZXQsXG4gICAgICAgICAgYGNkICR7c2hlbGxRdW90ZShxZW11LnJlbW90ZVdvcmtzcGFjZSl9ICYmICR7cmVtb3RlQ29tbWFuZH1gLFxuICAgICAgICBdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgfSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMucnVuT3B0aW9uYWxDb21tYW5kKHFlbXUudGVhcmRvd25Db21tYW5kLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTp0ZWFyZG93bmAsIGBRRU1VICR7Z3JvdXBOYW1lfSB0ZWFyZG93bmApO1xuICAgICAgYXdhaXQgdGhpcy5zdG9wTWFuYWdlZFFlbXVJZk5lZWRlZChncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkN1c3RvbShcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4gICAgbGFuZ3VhZ2U6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyxcbiAgICB0ZW1wRmlsZU5hbWU6IHN0cmluZyxcbiAgICB0ZW1wRmlsZVBhdGg6IHN0cmluZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgY29tbWFuZCA9IGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGVOYW1lKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkN1c3RvbVdyYXBwZXIoXG4gICAgICBncm91cE5hbWUsXG4gICAgICBncm91cFBhdGgsXG4gICAgICBjb25maWcsXG4gICAgICB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJydW5cIiwgZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dC50aW1lb3V0TXMsIHtcbiAgICAgICAgbGFuZ3VhZ2U6IGJsb2NrLmxhbmd1YWdlLFxuICAgICAgICBsYW5ndWFnZUFsaWFzOiBibG9jay5sYW5ndWFnZUFsaWFzLFxuICAgICAgICBmaWxlTmFtZTogdGVtcEZpbGVOYW1lLFxuICAgICAgICBmaWxlUGF0aDogdGVtcEZpbGVQYXRoLFxuICAgICAgICBjb21tYW5kLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pLFxuICAgICAgY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBjb250ZXh0LnNpZ25hbCxcbiAgICApO1xuXG4gICAgaWYgKGNvbmZpZy5jdXN0b20/LnRlYXJkb3duKSB7XG4gICAgICBjb25zdCB0ZWFyZG93biA9IGF3YWl0IHRoaXMucnVuQ3VzdG9tV3JhcHBlcihcbiAgICAgICAgZ3JvdXBOYW1lLFxuICAgICAgICBncm91cFBhdGgsXG4gICAgICAgIGNvbmZpZyxcbiAgICAgICAgdGhpcy5jcmVhdGVDdXN0b21SZXF1ZXN0KFwidGVhcmRvd25cIiwgZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dC50aW1lb3V0TXMsIHtcbiAgICAgICAgICBsYW5ndWFnZTogYmxvY2subGFuZ3VhZ2UsXG4gICAgICAgICAgbGFuZ3VhZ2VBbGlhczogYmxvY2subGFuZ3VhZ2VBbGlhcyxcbiAgICAgICAgICBmaWxlTmFtZTogdGVtcEZpbGVOYW1lLFxuICAgICAgICAgIGZpbGVQYXRoOiB0ZW1wRmlsZVBhdGgsXG4gICAgICAgICAgY29tbWFuZCxcbiAgICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgICAgfSksXG4gICAgICAgIGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBjb250ZXh0LnNpZ25hbCxcbiAgICAgICk7XG4gICAgICBpZiAoIXRlYXJkb3duLnN1Y2Nlc3MpIHtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSBgQ3VzdG9tIHJ1bnRpbWUgdGVhcmRvd24gZmFpbGVkOiAke3RlYXJkb3duLnN0ZGVyciB8fCB0ZWFyZG93bi5zdGRvdXQgfHwgYGV4aXQgJHt0ZWFyZG93bi5leGl0Q29kZX1gfWA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuV3NsQ29udGFpbmVyKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCB3c2xHcm91cFBhdGggPSB0aGlzLnRyYW5zbGF0ZVRvV3NsUGF0aChncm91cFBhdGgpO1xuICAgIGNvbnN0IGNvbW1hbmQgPSBsYW5ndWFnZS5jb21tYW5kIS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlTmFtZSk7XG4gICAgaWYgKCFjb21tYW5kLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiV1NMIGNvbW1hbmQgaXMgZW1wdHkuXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IHNoZWxsRmxhZ3MgPSBjb25maWcud3NsPy5pbnRlcmFjdGl2ZSA/IFtcIi1pXCIsIFwiLWxcIiwgXCItY1wiXSA6IFtcIi1sXCIsIFwiLWNcIl07XG4gICAgY29uc3Qgd3NsQXJncyA9IFtcImJhc2hcIiwgLi4uc2hlbGxGbGFncywgYGNkIFwiJHt3c2xHcm91cFBhdGgucmVwbGFjZUFsbCgnXCInLCAnXFxcXFwiJyl9XCIgJiYgJHtjb21tYW5kfWBdO1xuICAgIGlmIChjb25maWcuaW1hZ2U/LnRyaW0oKSkge1xuICAgICAgd3NsQXJncy51bnNoaWZ0KFwiLWRcIiwgY29uZmlnLmltYWdlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OndzbGAsXG4gICAgICBydW5uZXJOYW1lOiBgV1NMICR7Z3JvdXBOYW1lfWAsXG4gICAgICBleGVjdXRhYmxlOiBcIndzbFwiLFxuICAgICAgYXJnczogd3NsQXJncyxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHRyYW5zbGF0ZVRvV3NsUGF0aCh3aW5kb3dzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBtYXRjaCA9IHdpbmRvd3NQYXRoLm1hdGNoKC9eKFtBLVphLXpdKTpcXFxcKC4qKS8pO1xuICAgIGlmIChtYXRjaCkge1xuICAgICAgY29uc3QgZHJpdmUgPSBtYXRjaFsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgcmVzdCA9IG1hdGNoWzJdLnJlcGxhY2UoL1xcXFwvZywgXCIvXCIpO1xuICAgICAgcmV0dXJuIGAvbW50LyR7ZHJpdmV9LyR7cmVzdH1gO1xuICAgIH1cbiAgICBpZiAod2luZG93c1BhdGguaW5jbHVkZXMoXCJcXFxcXCIpKSB7XG4gICAgICByZXR1cm4gd2luZG93c1BhdGgucmVwbGFjZSgvXFxcXC9nLCBcIi9cIik7XG4gICAgfVxuICAgIHJldHVybiB3aW5kb3dzUGF0aDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVzb2x2ZUltYWdlKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgICBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLFxuICApOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IGRvY2tlcmZpbGUgPSBqb2luKGdyb3VwUGF0aCwgXCJEb2NrZXJmaWxlXCIpO1xuICAgIGlmICghZXhpc3RzU3luYyhkb2NrZXJmaWxlKSkge1xuICAgICAgcmV0dXJuIGNvbmZpZy5pbWFnZSB8fCBcInVidW50dTpsYXRlc3RcIjtcbiAgICB9XG5cbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjYWNoZUtleSA9IGAke3RoaXMucnVudGltZUV4ZWN1dGFibGUoY29uZmlnKX06JHtpbWFnZX1gO1xuICAgIGlmICh0aGlzLmJ1aWx0SW1hZ2VzLmhhcyhjYWNoZUtleSkpIHtcbiAgICAgIHJldHVybiBpbWFnZTtcbiAgICB9XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmJ1aWxkSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIHNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMsIDEyMF8wMDApLCBjb250ZXh0LnNpZ25hbCk7XG4gICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKHJlc3VsdC5zdGRlcnIgfHwgcmVzdWx0LnN0ZG91dCB8fCBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSBidWlsZCBmYWlsZWQgZm9yICR7Z3JvdXBOYW1lfS5gKTtcbiAgICB9XG5cbiAgICB0aGlzLmJ1aWx0SW1hZ2VzLmFkZChjYWNoZUtleSk7XG4gICAgcmV0dXJuIGltYWdlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBidWlsZEltYWdlKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lKTtcbiAgICBpZiAoIWV4aXN0c1N5bmMoam9pbihncm91cFBhdGgsIFwiRG9ja2VyZmlsZVwiKSkpIHtcbiAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChcbiAgICAgICAgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06YnVpbGRgLFxuICAgICAgICBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSAke2dyb3VwTmFtZX0gYnVpbGRgLFxuICAgICAgICBgTm8gRG9ja2VyZmlsZSBjb25maWd1cmVkLiBVc2luZyBpbWFnZSAke2NvbmZpZy5pbWFnZSB8fCBcInVidW50dTpsYXRlc3RcIn0uXFxuYCxcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpidWlsZGAsXG4gICAgICBydW5uZXJOYW1lOiBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSAke2dyb3VwTmFtZX0gYnVpbGRgLFxuICAgICAgZXhlY3V0YWJsZTogdGhpcy5ydW50aW1lRXhlY3V0YWJsZShjb25maWcpLFxuICAgICAgYXJnczogW1wiYnVpbGRcIiwgXCItdFwiLCBpbWFnZSwgZ3JvdXBQYXRoXSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYnVpbGRRZW11KGdyb3VwTmFtZTogc3RyaW5nLCBncm91cFBhdGg6IHN0cmluZywgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHFlbXUgPSB0aGlzLnJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZyk7XG4gICAgaWYgKCFxZW11LmJ1aWxkQ29tbWFuZD8udHJpbSgpKSB7XG4gICAgICByZXR1cm4gdGhpcy5jcmVhdGVTeW50aGV0aWNSZXN1bHQoYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpidWlsZGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBidWlsZGAsIFwiTm8gUUVNVSBidWlsZCBjb21tYW5kIGNvbmZpZ3VyZWQuXFxuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5ydW5Db21tYW5kTGluZShxZW11LmJ1aWxkQ29tbWFuZCwgZ3JvdXBQYXRoLCB0aW1lb3V0TXMsIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpidWlsZGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBidWlsZGApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWFkQ29uZmlnKGdyb3VwUGF0aDogc3RyaW5nKTogUHJvbWlzZTxsb29tQ29udGFpbmVyQ29uZmlnPiB7XG4gICAgY29uc3QgY29uZmlnUGF0aCA9IGpvaW4oZ3JvdXBQYXRoLCBcImNvbmZpZy5qc29uXCIpO1xuICAgIGxldCByYXc6IHVua25vd247XG4gICAgdHJ5IHtcbiAgICAgIHJhdyA9IEpTT04ucGFyc2UoYXdhaXQgcmVhZEZpbGUoY29uZmlnUGF0aCwgXCJ1dGY4XCIpKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gcmVhZCBjb250YWluZXIgY29uZmlnICR7Y29uZmlnUGF0aH06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICAgIH1cblxuICAgIGlmICghcmF3IHx8IHR5cGVvZiByYXcgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShyYXcpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhID0gcmF3IGFzIHtcbiAgICAgIHJ1bnRpbWU/OiB1bmtub3duO1xuICAgICAgZXhlY3V0YWJsZT86IHVua25vd247XG4gICAgICBpbWFnZT86IHVua25vd247XG4gICAgICB3c2w/OiB1bmtub3duO1xuICAgICAgaGVhbHRoQ2hlY2s/OiB1bmtub3duO1xuICAgICAgcWVtdT86IHVua25vd247XG4gICAgICBjdXN0b20/OiB1bmtub3duO1xuICAgICAgbGFuZ3VhZ2VzPzogdW5rbm93bjtcbiAgICB9O1xuICAgIGNvbnN0IHJ1bnRpbWUgPSB0aGlzLnJlYWRSdW50aW1lKGRhdGEucnVudGltZSk7XG4gICAgaWYgKGRhdGEuZXhlY3V0YWJsZSAhPSBudWxsICYmIHR5cGVvZiBkYXRhLmV4ZWN1dGFibGUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgZXhlY3V0YWJsZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgaWYgKGRhdGEuaW1hZ2UgIT0gbnVsbCAmJiB0eXBlb2YgZGF0YS5pbWFnZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBpbWFnZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgaWYgKCFkYXRhLmxhbmd1YWdlcyB8fCB0eXBlb2YgZGF0YS5sYW5ndWFnZXMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShkYXRhLmxhbmd1YWdlcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgbGFuZ3VhZ2VzIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBsYW5ndWFnZXM6IFJlY29yZDxzdHJpbmcsIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZz4gPSB7fTtcbiAgICBmb3IgKGNvbnN0IFtsYW5ndWFnZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGRhdGEubGFuZ3VhZ2VzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSkge1xuICAgICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb250YWluZXIgbGFuZ3VhZ2UgJHtsYW5ndWFnZX0gbXVzdCBiZSBhbiBvYmplY3QuYCk7XG4gICAgICB9XG4gICAgICBjb25zdCBsYW5ndWFnZUNvbmZpZyA9IHZhbHVlIGFzIHsgY29tbWFuZD86IHVua25vd247IGV4dGVuc2lvbj86IHVua25vd247IHVzZURlZmF1bHQ/OiB1bmtub3duIH07XG4gICAgICBjb25zdCB1c2VEZWZhdWx0ID0gbGFuZ3VhZ2VDb25maWcudXNlRGVmYXVsdCA9PT0gdHJ1ZTtcblxuICAgICAgaWYgKCF1c2VEZWZhdWx0ICYmICh0eXBlb2YgbGFuZ3VhZ2VDb25maWcuY29tbWFuZCAhPT0gXCJzdHJpbmdcIiB8fCAhbGFuZ3VhZ2VDb25maWcuY29tbWFuZC50cmltKCkpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGFpbmVyIGxhbmd1YWdlICR7bGFuZ3VhZ2V9IG11c3QgZGVmaW5lIGNvbW1hbmQgb3IgdXNlRGVmYXVsdC5gKTtcbiAgICAgIH1cblxuICAgICAgbGFuZ3VhZ2VzW2xhbmd1YWdlXSA9IHtcbiAgICAgICAgY29tbWFuZDogdHlwZW9mIGxhbmd1YWdlQ29uZmlnLmNvbW1hbmQgPT09IFwic3RyaW5nXCIgPyBsYW5ndWFnZUNvbmZpZy5jb21tYW5kIDogdW5kZWZpbmVkLFxuICAgICAgICBleHRlbnNpb246IHR5cGVvZiBsYW5ndWFnZUNvbmZpZy5leHRlbnNpb24gPT09IFwic3RyaW5nXCIgPyBsYW5ndWFnZUNvbmZpZy5leHRlbnNpb24gOiB1c2VEZWZhdWx0ID8gdW5kZWZpbmVkIDogYC4ke2xhbmd1YWdlfWAsXG4gICAgICAgIHVzZURlZmF1bHQ6IHVzZURlZmF1bHQgfHwgdW5kZWZpbmVkLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgcnVudGltZSxcbiAgICAgIGV4ZWN1dGFibGU6IHR5cGVvZiBkYXRhLmV4ZWN1dGFibGUgPT09IFwic3RyaW5nXCIgJiYgZGF0YS5leGVjdXRhYmxlLnRyaW0oKSA/IGRhdGEuZXhlY3V0YWJsZS50cmltKCkgOiB1bmRlZmluZWQsXG4gICAgICBpbWFnZTogdHlwZW9mIGRhdGEuaW1hZ2UgPT09IFwic3RyaW5nXCIgPyBkYXRhLmltYWdlIDogdW5kZWZpbmVkLFxuICAgICAgd3NsOiB0aGlzLnJlYWRXc2xDb25maWcoZGF0YS53c2wpLFxuICAgICAgaGVhbHRoQ2hlY2s6IHRoaXMucmVhZEhlYWx0aENoZWNrKGRhdGEuaGVhbHRoQ2hlY2ssIFwiQ29udGFpbmVyIGNvbmZpZyBoZWFsdGhDaGVja1wiKSxcbiAgICAgIHFlbXU6IHRoaXMucmVhZFFlbXVDb25maWcoZGF0YS5xZW11KSxcbiAgICAgIGN1c3RvbTogdGhpcy5yZWFkQ3VzdG9tQ29uZmlnKGRhdGEuY3VzdG9tKSxcbiAgICAgIGxhbmd1YWdlcyxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkUnVudGltZSh2YWx1ZTogdW5rbm93bik6IGxvb21Db250YWluZXJSdW50aW1lIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIFwiZG9ja2VyXCI7XG4gICAgfVxuICAgIGlmICh2YWx1ZSA9PT0gXCJkb2NrZXJcIiB8fCB2YWx1ZSA9PT0gXCJwb2RtYW5cIiB8fCB2YWx1ZSA9PT0gXCJxZW11XCIgfHwgdmFsdWUgPT09IFwiY3VzdG9tXCIgfHwgdmFsdWUgPT09IFwid3NsXCIpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBydW50aW1lIG11c3QgYmUgZG9ja2VyLCBwb2RtYW4sIHFlbXUsIGN1c3RvbSwgb3Igd3NsLlwiKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFdzbENvbmZpZyh2YWx1ZTogdW5rbm93bik6IGxvb21Xc2xDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyB3c2wgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgeyBpbnRlcmFjdGl2ZT86IHVua25vd24gfTtcbiAgICByZXR1cm4ge1xuICAgICAgaW50ZXJhY3RpdmU6IGRhdGEuaW50ZXJhY3RpdmUgPT09IHRydWUsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFFlbXVDb25maWcodmFsdWU6IHVua25vd24pOiBsb29tUWVtdUNvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKHR5cGVvZiBkYXRhLnNzaFRhcmdldCAhPT0gXCJzdHJpbmdcIiB8fCAhZGF0YS5zc2hUYXJnZXQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUuc3NoVGFyZ2V0IG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIGRhdGEucmVtb3RlV29ya3NwYWNlICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLnJlbW90ZVdvcmtzcGFjZS50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5yZW1vdGVXb3Jrc3BhY2UgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHNzaFRhcmdldDogZGF0YS5zc2hUYXJnZXQudHJpbSgpLFxuICAgICAgcmVtb3RlV29ya3NwYWNlOiBkYXRhLnJlbW90ZVdvcmtzcGFjZS50cmltKCksXG4gICAgICBzc2hFeGVjdXRhYmxlOiBvcHRpb25hbFN0cmluZyhkYXRhLnNzaEV4ZWN1dGFibGUpLFxuICAgICAgc3NoQXJnczogb3B0aW9uYWxTdHJpbmcoZGF0YS5zc2hBcmdzKSxcbiAgICAgIHN0YXJ0Q29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5zdGFydENvbW1hbmQpLFxuICAgICAgYnVpbGRDb21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLmJ1aWxkQ29tbWFuZCksXG4gICAgICB0ZWFyZG93bkNvbW1hbmQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEudGVhcmRvd25Db21tYW5kKSxcbiAgICAgIGhlYWx0aENoZWNrOiB0aGlzLnJlYWRIZWFsdGhDaGVjayhkYXRhLmhlYWx0aENoZWNrLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5oZWFsdGhDaGVja1wiKSxcbiAgICAgIG1hbmFnZXI6IHRoaXMucmVhZFFlbXVNYW5hZ2VyQ29uZmlnKGRhdGEubWFuYWdlciksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFFlbXVNYW5hZ2VyQ29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbVFlbXVNYW5hZ2VyQ29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIHJldHVybiB7XG4gICAgICBlbmFibGVkOiBkYXRhLmVuYWJsZWQgIT09IGZhbHNlLFxuICAgICAgZXhlY3V0YWJsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5leGVjdXRhYmxlKSxcbiAgICAgIGFyZ3M6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYXJncyksXG4gICAgICBpbWFnZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5pbWFnZSksXG4gICAgICBpbWFnZUZvcm1hdDogb3B0aW9uYWxTdHJpbmcoZGF0YS5pbWFnZUZvcm1hdCksXG4gICAgICBwaWRGaWxlOiBvcHRpb25hbFN0cmluZyhkYXRhLnBpZEZpbGUpLFxuICAgICAgbG9nRmlsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5sb2dGaWxlKSxcbiAgICAgIHJlYWRpbmVzc1RpbWVvdXRNczogb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoZGF0YS5yZWFkaW5lc3NUaW1lb3V0TXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIucmVhZGluZXNzVGltZW91dE1zXCIpLFxuICAgICAgcmVhZGluZXNzSW50ZXJ2YWxNczogb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoZGF0YS5yZWFkaW5lc3NJbnRlcnZhbE1zLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyLnJlYWRpbmVzc0ludGVydmFsTXNcIiksXG4gICAgICBib290RGVsYXlNczogb3B0aW9uYWxOb25OZWdhdGl2ZUludGVnZXIoZGF0YS5ib290RGVsYXlNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5ib290RGVsYXlNc1wiKSxcbiAgICAgIHNodXRkb3duQ29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5zaHV0ZG93bkNvbW1hbmQpLFxuICAgICAgc2h1dGRvd25UaW1lb3V0TXM6IG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKGRhdGEuc2h1dGRvd25UaW1lb3V0TXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIuc2h1dGRvd25UaW1lb3V0TXNcIiksXG4gICAgICBraWxsU2lnbmFsOiBvcHRpb25hbFNpZ25hbChkYXRhLmtpbGxTaWduYWwsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIua2lsbFNpZ25hbFwiKSxcbiAgICAgIHBlcnNpc3Q6IHR5cGVvZiBkYXRhLnBlcnNpc3QgPT09IFwiYm9vbGVhblwiID8gZGF0YS5wZXJzaXN0IDogdW5kZWZpbmVkLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRDdXN0b21Db25maWcodmFsdWU6IHVua25vd24pOiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGN1c3RvbSBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAodHlwZW9mIGRhdGEuZXhlY3V0YWJsZSAhPT0gXCJzdHJpbmdcIiB8fCAhZGF0YS5leGVjdXRhYmxlLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBjdXN0b20uZXhlY3V0YWJsZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGV4ZWN1dGFibGU6IGRhdGEuZXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBvcHRpb25hbFN0cmluZyhkYXRhLmFyZ3MpLFxuICAgICAgYnVpbGQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYnVpbGQpLFxuICAgICAgY29tbWFuZFN0cnVjdHVyZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5jb21tYW5kU3RydWN0dXJlKSxcbiAgICAgIHRlYXJkb3duOiBvcHRpb25hbFN0cmluZyhkYXRhLnRlYXJkb3duKSxcbiAgICAgIGhlYWx0aENoZWNrOiB0aGlzLnJlYWRIZWFsdGhDaGVjayhkYXRhLmhlYWx0aENoZWNrLCBcIkNvbnRhaW5lciBjb25maWcgY3VzdG9tLmhlYWx0aENoZWNrXCIpLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRIZWFsdGhDaGVjayh2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IGxvb21Db21tYW5kRXhwZWN0YXRpb24gfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGFuIG9iamVjdC5gKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmICh0eXBlb2YgZGF0YS5jb21tYW5kICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLmNvbW1hbmQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9LmNvbW1hbmQgbXVzdCBiZSBhIHN0cmluZy5gKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbW1hbmQ6IGRhdGEuY29tbWFuZC50cmltKCksXG4gICAgICBwb3NpdGl2ZVJlc3BvbnNlOiBvcHRpb25hbFN0cmluZyhkYXRhLnBvc2l0aXZlUmVzcG9uc2UgPz8gZGF0YS5wb3NpdGl2ZV9yZXNwb25zZSA/PyBkYXRhW1wicG9zaXRpdmUgcmVzcG9uc2VcIl0gPz8gZGF0YS5wb3NzaXRpdmVSZXNwb25zZSksXG4gICAgICBuZWdhdGl2ZVJlc3BvbnNlOiBvcHRpb25hbFN0cmluZyhkYXRhLm5lZ2F0aXZlUmVzcG9uc2UgPz8gZGF0YS5uZWdhdGl2ZV9yZXNwb25zZSA/PyBkYXRhW1wibmVnYXRpdmUgcmVzcG9uc2VcIl0pLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyk6IGxvb21RZW11Q29uZmlnIHtcbiAgICBpZiAoIWNvbmZpZy5xZW11KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJRRU1VIHJ1bnRpbWUgcmVxdWlyZXMgYSBxZW11IGNvbmZpZyBvYmplY3QuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gY29uZmlnLnFlbXU7XG4gIH1cblxuICBwcml2YXRlIHJlcXVpcmVDdXN0b21Db25maWcoY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnKTogbG9vbUN1c3RvbVJ1bnRpbWVDb25maWcge1xuICAgIGlmICghY29uZmlnLmN1c3RvbSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ3VzdG9tIHJ1bnRpbWUgcmVxdWlyZXMgYSBjdXN0b20gY29uZmlnIG9iamVjdC5cIik7XG4gICAgfVxuICAgIHJldHVybiBjb25maWcuY3VzdG9tO1xuICB9XG5cbiAgcHJpdmF0ZSBydW50aW1lRXhlY3V0YWJsZShjb25maWc6IGxvb21Db250YWluZXJDb25maWcpOiBzdHJpbmcge1xuICAgIGlmIChjb25maWcuZXhlY3V0YWJsZT8udHJpbSgpKSB7XG4gICAgICByZXR1cm4gY29uZmlnLmV4ZWN1dGFibGUudHJpbSgpO1xuICAgIH1cbiAgICByZXR1cm4gY29uZmlnLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIgPyBcInBvZG1hblwiIDogXCJkb2NrZXJcIjtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuSGVhbHRoQ2hlY2soXG4gICAgaGVhbHRoQ2hlY2s6IGxvb21Db21tYW5kRXhwZWN0YXRpb24gfCB1bmRlZmluZWQsXG4gICAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICAgcnVubmVySWQ6IHN0cmluZyxcbiAgICBydW5uZXJOYW1lOiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaGVhbHRoQ2hlY2spIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkNvbW1hbmRMaW5lKGhlYWx0aENoZWNrLmNvbW1hbmQsIHdvcmtpbmdEaXJlY3RvcnksIHRpbWVvdXRNcywgc2lnbmFsLCBydW5uZXJJZCwgcnVubmVyTmFtZSk7XG4gICAgY29uc3QgY29tYmluZWRPdXRwdXQgPSBgJHtyZXN1bHQuc3Rkb3V0fVxcbiR7cmVzdWx0LnN0ZGVycn1gO1xuICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBmYWlsZWQ6ICR7cmVzdWx0LnN0ZGVyciB8fCByZXN1bHQuc3Rkb3V0IHx8IGBleGl0ICR7cmVzdWx0LmV4aXRDb2RlfWB9YCk7XG4gICAgfVxuICAgIGlmIChoZWFsdGhDaGVjay5uZWdhdGl2ZVJlc3BvbnNlICYmIGNvbWJpbmVkT3V0cHV0LmluY2x1ZGVzKGhlYWx0aENoZWNrLm5lZ2F0aXZlUmVzcG9uc2UpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gcmV0dXJuZWQgbmVnYXRpdmUgcmVzcG9uc2U6ICR7aGVhbHRoQ2hlY2submVnYXRpdmVSZXNwb25zZX1gKTtcbiAgICB9XG4gICAgaWYgKGhlYWx0aENoZWNrLnBvc2l0aXZlUmVzcG9uc2UgJiYgIWNvbWJpbmVkT3V0cHV0LmluY2x1ZGVzKGhlYWx0aENoZWNrLnBvc2l0aXZlUmVzcG9uc2UpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gZGlkIG5vdCByZXR1cm4gcG9zaXRpdmUgcmVzcG9uc2U6ICR7aGVhbHRoQ2hlY2sucG9zaXRpdmVSZXNwb25zZX1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bk9wdGlvbmFsQ29tbWFuZChcbiAgICBjb21tYW5kOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gICAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICAgcnVubmVySWQ6IHN0cmluZyxcbiAgICBydW5uZXJOYW1lOiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghY29tbWFuZD8udHJpbSgpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuQ29tbWFuZExpbmUoY29tbWFuZCwgd29ya2luZ0RpcmVjdG9yeSwgdGltZW91dE1zLCBzaWduYWwsIHJ1bm5lcklkLCBydW5uZXJOYW1lKTtcbiAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gZmFpbGVkOiAke3Jlc3VsdC5zdGRlcnIgfHwgcmVzdWx0LnN0ZG91dCB8fCBgZXhpdCAke3Jlc3VsdC5leGl0Q29kZX1gfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ29tbWFuZExpbmUoXG4gICAgY29tbWFuZDogc3RyaW5nLFxuICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICAgIHJ1bm5lcklkOiBzdHJpbmcsXG4gICAgcnVubmVyTmFtZTogc3RyaW5nLFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBwYXJ0cyA9IHNwbGl0Q29tbWFuZExpbmUoY29tbWFuZCk7XG4gICAgaWYgKCFwYXJ0cy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBjb21tYW5kIGlzIGVtcHR5LmApO1xuICAgIH1cbiAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBwYXJ0c1swXSxcbiAgICAgIGFyZ3M6IHBhcnRzLnNsaWNlKDEpLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlTWFuYWdlZFFlbXUoZ3JvdXBOYW1lOiBzdHJpbmcsIGdyb3VwUGF0aDogc3RyaW5nLCBxZW11OiBsb29tUWVtdUNvbmZpZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtYW5hZ2VyID0gcWVtdS5tYW5hZ2VyO1xuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBpZFBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5waWRGaWxlIHx8IFwiLmxvb20tcWVtdS5waWRcIik7XG4gICAgY29uc3QgZXhpc3RpbmdQaWQgPSBhd2FpdCB0aGlzLnJlYWRQaWRGaWxlKHBpZFBhdGgpO1xuICAgIGlmIChleGlzdGluZ1BpZCAmJiB0aGlzLmlzUHJvY2Vzc1J1bm5pbmcoZXhpc3RpbmdQaWQpKSB7XG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JNYW5hZ2VkUWVtdVJlYWRpbmVzcyhncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgdGltZW91dE1zLCBzaWduYWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChleGlzdGluZ1BpZCkge1xuICAgICAgYXdhaXQgcm0ocGlkUGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBleGVjdXRhYmxlID0gbWFuYWdlci5leGVjdXRhYmxlIHx8IFwicWVtdS1zeXN0ZW0teDg2XzY0XCI7XG4gICAgY29uc3QgYXJncyA9IHRoaXMuYnVpbGRNYW5hZ2VkUWVtdUFyZ3MoZ3JvdXBQYXRoLCBtYW5hZ2VyKTtcbiAgICBpZiAoIWFyZ3MubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFFFTVUgbWFuYWdlciBmb3IgJHtncm91cE5hbWV9IG5lZWRzIHFlbXUubWFuYWdlci5hcmdzIG9yIHFlbXUubWFuYWdlci5pbWFnZS5gKTtcbiAgICB9XG5cbiAgICBjb25zdCBsb2dQYXRoID0gbWFuYWdlci5sb2dGaWxlID8gdGhpcy5yZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGgsIG1hbmFnZXIubG9nRmlsZSkgOiBudWxsO1xuICAgIGNvbnN0IGxvZ0ZkID0gbG9nUGF0aCA/IG9wZW5TeW5jKGxvZ1BhdGgsIFwiYVwiKSA6IG51bGw7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNoaWxkID0gc3Bhd24oZXhlY3V0YWJsZSwgYXJncywge1xuICAgICAgICBjd2Q6IGdyb3VwUGF0aCxcbiAgICAgICAgZGV0YWNoZWQ6IHRydWUsXG4gICAgICAgIHN0ZGlvOiBbXCJpZ25vcmVcIiwgbG9nRmQgPz8gXCJpZ25vcmVcIiwgbG9nRmQgPz8gXCJpZ25vcmVcIl0sXG4gICAgICB9KTtcblxuICAgICAgY2hpbGQub24oXCJlcnJvclwiLCAoKSA9PiB1bmRlZmluZWQpO1xuICAgICAgY2hpbGQudW5yZWYoKTtcblxuICAgICAgaWYgKCFjaGlsZC5waWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRRU1VIG1hbmFnZXIgZm9yICR7Z3JvdXBOYW1lfSBkaWQgbm90IHJldHVybiBhIHByb2Nlc3MgaWQuYCk7XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHdyaXRlRmlsZShwaWRQYXRoLCBgJHtjaGlsZC5waWR9XFxuYCwgXCJ1dGY4XCIpO1xuICAgICAgYXdhaXQgdGhpcy53YWl0Rm9yTWFuYWdlZFFlbXVSZWFkaW5lc3MoZ3JvdXBOYW1lLCBncm91cFBhdGgsIHFlbXUsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKGxvZ0ZkICE9IG51bGwpIHtcbiAgICAgICAgY2xvc2VTeW5jKGxvZ0ZkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGJ1aWxkTWFuYWdlZFFlbXVBcmdzKGdyb3VwUGF0aDogc3RyaW5nLCBtYW5hZ2VyOiBsb29tUWVtdU1hbmFnZXJDb25maWcpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgYXJncyA9IHNwbGl0Q29tbWFuZExpbmUobWFuYWdlci5hcmdzIHx8IFwiXCIpO1xuICAgIGlmIChtYW5hZ2VyLmltYWdlKSB7XG4gICAgICBjb25zdCBpbWFnZVBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5pbWFnZSk7XG4gICAgICBhcmdzLnB1c2goXCItZHJpdmVcIiwgYGZpbGU9JHtpbWFnZVBhdGh9LGlmPXZpcnRpbyxmb3JtYXQ9JHttYW5hZ2VyLmltYWdlRm9ybWF0IHx8IFwicWNvdzJcIn1gKTtcbiAgICB9XG4gICAgcmV0dXJuIGFyZ3M7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdhaXRGb3JNYW5hZ2VkUWVtdVJlYWRpbmVzcyhcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBxZW11OiBsb29tUWVtdUNvbmZpZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtYW5hZ2VyID0gcWVtdS5tYW5hZ2VyO1xuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghcWVtdS5oZWFsdGhDaGVjaykge1xuICAgICAgYXdhaXQgc2xlZXBXaXRoU2lnbmFsKG1hbmFnZXIuYm9vdERlbGF5TXMgPz8gMCwgc2lnbmFsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB0aW1lb3V0ID0gTWF0aC5taW4obWFuYWdlci5yZWFkaW5lc3NUaW1lb3V0TXMgPz8gNjBfMDAwLCBNYXRoLm1heCh0aW1lb3V0TXMsIDEpKTtcbiAgICBjb25zdCBpbnRlcnZhbCA9IG1hbmFnZXIucmVhZGluZXNzSW50ZXJ2YWxNcyA/PyAxXzAwMDtcbiAgICBjb25zdCBzdGFydGVkQXQgPSBEYXRlLm5vdygpO1xuICAgIGxldCBsYXN0RXJyb3IgPSBcIlwiO1xuXG4gICAgd2hpbGUgKERhdGUubm93KCkgLSBzdGFydGVkQXQgPD0gdGltZW91dCkge1xuICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUUVNVSAke2dyb3VwTmFtZX0gcmVhZGluZXNzIHdhaXQgY2FuY2VsbGVkLmApO1xuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKHFlbXUuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgTWF0aC5taW4oaW50ZXJ2YWwsIHRpbWVvdXQpLCBzaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6cmVhZHlgLCBgUUVNVSAke2dyb3VwTmFtZX0gcmVhZGluZXNzIGNoZWNrYCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxhc3RFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgc2xlZXBXaXRoU2lnbmFsKGludGVydmFsLCBzaWduYWwpO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgUUVNVSAke2dyb3VwTmFtZX0gZGlkIG5vdCBiZWNvbWUgcmVhZHkgd2l0aGluICR7dGltZW91dH0gbXMke2xhc3RFcnJvciA/IGA6ICR7bGFzdEVycm9yfWAgOiBcIi5cIn1gKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc3RvcE1hbmFnZWRRZW11SWZOZWVkZWQoZ3JvdXBOYW1lOiBzdHJpbmcsIGdyb3VwUGF0aDogc3RyaW5nLCBxZW11OiBsb29tUWVtdUNvbmZpZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtYW5hZ2VyID0gcWVtdS5tYW5hZ2VyO1xuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCB8fCBtYW5hZ2VyLnBlcnNpc3QgIT09IGZhbHNlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcGlkUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLnBpZEZpbGUgfHwgXCIubG9vbS1xZW11LnBpZFwiKTtcbiAgICBjb25zdCBwaWQgPSBhd2FpdCB0aGlzLnJlYWRQaWRGaWxlKHBpZFBhdGgpO1xuICAgIGlmICghcGlkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKG1hbmFnZXIuc2h1dGRvd25Db21tYW5kKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bk9wdGlvbmFsQ29tbWFuZChcbiAgICAgICAgbWFuYWdlci5zaHV0ZG93bkNvbW1hbmQsXG4gICAgICAgIGdyb3VwUGF0aCxcbiAgICAgICAgTWF0aC5taW4obWFuYWdlci5zaHV0ZG93blRpbWVvdXRNcyA/PyB0aW1lb3V0TXMsIHRpbWVvdXRNcyksXG4gICAgICAgIHNpZ25hbCxcbiAgICAgICAgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpzaHV0ZG93bmAsXG4gICAgICAgIGBRRU1VICR7Z3JvdXBOYW1lfSBzaHV0ZG93bmAsXG4gICAgICApO1xuICAgIH0gZWxzZSBpZiAodGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkpIHtcbiAgICAgIHByb2Nlc3Mua2lsbChwaWQsIG1hbmFnZXIua2lsbFNpZ25hbCB8fCBcIlNJR1RFUk1cIik7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RvcHBlZCA9IGF3YWl0IHRoaXMud2FpdEZvclByb2Nlc3NFeGl0KHBpZCwgbWFuYWdlci5zaHV0ZG93blRpbWVvdXRNcyA/PyAxMF8wMDAsIHNpZ25hbCk7XG4gICAgaWYgKCFzdG9wcGVkICYmIHRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpKSB7XG4gICAgICBwcm9jZXNzLmtpbGwocGlkLCBcIlNJR0tJTExcIik7XG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JQcm9jZXNzRXhpdChwaWQsIDJfMDAwLCBzaWduYWwpO1xuICAgIH1cblxuICAgIGF3YWl0IHJtKHBpZFBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldE1hbmFnZWRRZW11U3RhdHVzKGdyb3VwUGF0aDogc3RyaW5nLCBtYW5hZ2VyOiBsb29tUWVtdU1hbmFnZXJDb25maWcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IHBpZFBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5waWRGaWxlIHx8IFwiLmxvb20tcWVtdS5waWRcIik7XG4gICAgY29uc3QgcGlkID0gYXdhaXQgdGhpcy5yZWFkUGlkRmlsZShwaWRQYXRoKTtcbiAgICBpZiAoIXBpZCkge1xuICAgICAgcmV0dXJuIFwic3RvcHBlZFwiO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkgPyBgcnVubmluZyBwaWQgJHtwaWR9YCA6IGBzdGFsZSBwaWQgJHtwaWR9YDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVhZFBpZEZpbGUocGlkUGF0aDogc3RyaW5nKTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gKGF3YWl0IHJlYWRGaWxlKHBpZFBhdGgsIFwidXRmOFwiKSkudHJpbSgpO1xuICAgICAgY29uc3QgcGlkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLCAxMCk7XG4gICAgICByZXR1cm4gTnVtYmVyLmlzSW50ZWdlcihwaWQpICYmIHBpZCA+IDAgPyBwaWQgOiBudWxsO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBpc1Byb2Nlc3NSdW5uaW5nKHBpZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gICAgdHJ5IHtcbiAgICAgIHByb2Nlc3Mua2lsbChwaWQsIDApO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3YWl0Rm9yUHJvY2Vzc0V4aXQocGlkOiBudW1iZXIsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3Qgc3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcbiAgICB3aGlsZSAoRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdCA8PSB0aW1lb3V0TXMpIHtcbiAgICAgIGlmIChzaWduYWwuYWJvcnRlZCkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBpZiAoIXRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgICAgYXdhaXQgc2xlZXBXaXRoU2lnbmFsKDI1MCwgc2lnbmFsKTtcbiAgICB9XG4gICAgcmV0dXJuICF0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ3VzdG9tV3JhcHBlcihcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgcmVxdWVzdDogbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0LFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGN1c3RvbSA9IHRoaXMucmVxdWlyZUN1c3RvbUNvbmZpZyhjb25maWcpO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2soY3VzdG9tLmhlYWx0aENoZWNrLCBncm91cFBhdGgsIHRpbWVvdXRNcywgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpjdXN0b206aGVhbHRoYCwgYEN1c3RvbSAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG5cbiAgICBjb25zdCByZXF1ZXN0RmlsZU5hbWUgPSBgcmVxdWVzdF8ke0RhdGUubm93KCl9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygxNikuc2xpY2UoMil9Lmpzb25gO1xuICAgIGNvbnN0IHJlcXVlc3RQYXRoID0gam9pbihncm91cFBhdGgsIHJlcXVlc3RGaWxlTmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHdyaXRlRmlsZShyZXF1ZXN0UGF0aCwgYCR7SlNPTi5zdHJpbmdpZnkocmVxdWVzdCwgbnVsbCwgMil9XFxuYCwgXCJ1dGY4XCIpO1xuICAgICAgY29uc3QgYXJncyA9IHNwbGl0Q29tbWFuZExpbmUoY3VzdG9tLmFyZ3MgfHwgXCJ7cmVxdWVzdH1cIikubWFwKChhcmcpID0+XG4gICAgICAgIGFyZ1xuICAgICAgICAgIC5yZXBsYWNlQWxsKFwie3JlcXVlc3R9XCIsIHJlcXVlc3RQYXRoKVxuICAgICAgICAgIC5yZXBsYWNlQWxsKFwie2dyb3VwfVwiLCBncm91cE5hbWUpXG4gICAgICAgICAgLnJlcGxhY2VBbGwoXCJ7Z3JvdXBQYXRofVwiLCBncm91cFBhdGgpLFxuICAgICAgKTtcbiAgICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OmN1c3RvbToke3JlcXVlc3QuYWN0aW9ufWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IGBDdXN0b20gJHtncm91cE5hbWV9ICR7cmVxdWVzdC5hY3Rpb259YCxcbiAgICAgICAgZXhlY3V0YWJsZTogY3VzdG9tLmV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3MsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgICAgdGltZW91dE1zLFxuICAgICAgICBzaWduYWwsXG4gICAgICB9KTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgcm0ocmVxdWVzdFBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVDdXN0b21SZXF1ZXN0KFxuICAgIGFjdGlvbjogbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0W1wiYWN0aW9uXCJdLFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBleHRyYTogUGFydGlhbDxsb29tQ3VzdG9tUnVudGltZVJlcXVlc3Q+ID0ge30sXG4gICk6IGxvb21DdXN0b21SdW50aW1lUmVxdWVzdCB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGlvbixcbiAgICAgIGdyb3VwTmFtZSxcbiAgICAgIGdyb3VwUGF0aCxcbiAgICAgIHJ1bnRpbWU6IGNvbmZpZy5ydW50aW1lLFxuICAgICAgaW1hZ2U6IGNvbmZpZy5pbWFnZSxcbiAgICAgIGJ1aWxkOiBjb25maWcuY3VzdG9tPy5idWlsZCxcbiAgICAgIGNvbW1hbmRTdHJ1Y3R1cmU6IGNvbmZpZy5jdXN0b20/LmNvbW1hbmRTdHJ1Y3R1cmUsXG4gICAgICB0ZWFyZG93bjogY29uZmlnLmN1c3RvbT8udGVhcmRvd24sXG4gICAgICB0aW1lb3V0TXMsXG4gICAgICBjb25maWc6IHtcbiAgICAgICAgZXhlY3V0YWJsZTogY29uZmlnLmV4ZWN1dGFibGUsXG4gICAgICAgIGN1c3RvbTogY29uZmlnLmN1c3RvbSxcbiAgICAgICAgcWVtdTogY29uZmlnLnFlbXUsXG4gICAgICAgIGhlYWx0aENoZWNrOiBjb25maWcuaGVhbHRoQ2hlY2ssXG4gICAgICB9LFxuICAgICAgLi4uZXh0cmEsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlU3ludGhldGljUmVzdWx0KHJ1bm5lcklkOiBzdHJpbmcsIHJ1bm5lck5hbWU6IHN0cmluZywgc3Rkb3V0OiBzdHJpbmcsIHN1Y2Nlc3MgPSB0cnVlKTogbG9vbVJ1blJlc3VsdCB7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIHJldHVybiB7XG4gICAgICBydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBzdGFydGVkQXQ6IG5vdyxcbiAgICAgIGZpbmlzaGVkQXQ6IG5vdyxcbiAgICAgIGR1cmF0aW9uTXM6IDAsXG4gICAgICBleGl0Q29kZTogc3VjY2VzcyA/IDAgOiAtMSxcbiAgICAgIHN0ZG91dCxcbiAgICAgIHN0ZGVycjogXCJcIixcbiAgICAgIHN1Y2Nlc3MsXG4gICAgICB0aW1lZE91dDogZmFsc2UsXG4gICAgICBjYW5jZWxsZWQ6IGZhbHNlLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGdldENvbnRhaW5lcnNQYXRoKCk6IHN0cmluZyB7XG4gICAgY29uc3QgYWRhcHRlckJhc2VQYXRoID0gKHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgYXMgeyBiYXNlUGF0aD86IHN0cmluZyB9KS5iYXNlUGF0aCA/PyBcIlwiO1xuICAgIHJldHVybiBub3JtYWxpemVGc1BhdGgoam9pbihhZGFwdGVyQmFzZVBhdGgsIHRoaXMucGx1Z2luRGlyLCBcImNvbnRhaW5lcnNcIikpO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlR3JvdXBQYXRoKGdyb3VwTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBzYWZlTmFtZSA9IGJhc2VuYW1lKGdyb3VwTmFtZSk7XG4gICAgaWYgKCFzYWZlTmFtZSB8fCBzYWZlTmFtZSAhPT0gZ3JvdXBOYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgY29udGFpbmVyIGdyb3VwIG5hbWU6ICR7Z3JvdXBOYW1lfWApO1xuICAgIH1cbiAgICByZXR1cm4gbm9ybWFsaXplRnNQYXRoKGpvaW4odGhpcy5nZXRDb250YWluZXJzUGF0aCgpLCBzYWZlTmFtZSkpO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGg6IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgc2FmZVBhdGggPSBub3JtYWxpemVGc1BhdGgoam9pbihncm91cFBhdGgsIGZpbGVQYXRoKSk7XG4gICAgY29uc3Qgbm9ybWFsaXplZEdyb3VwUGF0aCA9IG5vcm1hbGl6ZUZzUGF0aChncm91cFBhdGgpO1xuICAgIGNvbnN0IHBvc2l4U2FmZVBhdGggPSBzYWZlUGF0aC5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcbiAgICBjb25zdCBwb3NpeEdyb3VwUGF0aCA9IG5vcm1hbGl6ZWRHcm91cFBhdGgucmVwbGFjZSgvXFxcXC9nLCBcIi9cIik7XG4gICAgaWYgKHBvc2l4U2FmZVBhdGggIT09IHBvc2l4R3JvdXBQYXRoICYmICFwb3NpeFNhZmVQYXRoLnN0YXJ0c1dpdGgoYCR7cG9zaXhHcm91cFBhdGh9L2ApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgUUVNVSBtYW5hZ2VyIHBhdGggb3V0c2lkZSBjb250YWluZXIgZ3JvdXA6ICR7ZmlsZVBhdGh9YCk7XG4gICAgfVxuICAgIHJldHVybiBzYWZlUGF0aDtcbiAgfVxuXG4gIHByaXZhdGUgaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBgbG9vbS1jb250YWluZXItJHtncm91cE5hbWUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOV8uLV0vZywgXCItXCIpfWA7XG4gIH1cblxuICBwdWJsaWMgZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdJZDogc3RyaW5nLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnIHwgbnVsbCB7XG4gICAgaWYgKCFsYW5nSWQpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBsYW5nSWQudG9Mb3dlckNhc2UoKS50cmltKCk7XG5cbiAgICAvLyBDaGVjayBjdXN0b20gbGFuZ3VhZ2VzIGZpcnN0XG4gICAgY29uc3QgY3VzdG9tID0gc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmZpbmQoKGMpID0+IHtcbiAgICAgIGNvbnN0IG5hbWVzID0gW2MubmFtZSwgLi4uYy5hbGlhc2VzLnNwbGl0KFwiLFwiKS5tYXAoKHMpID0+IHMudHJpbSgpKV0ubWFwKChuKSA9PiBuLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgcmV0dXJuIG5hbWVzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpO1xuICAgIH0pO1xuICAgIGlmIChjdXN0b20pIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvbW1hbmQ6IGAke2N1c3RvbS5leGVjdXRhYmxlfSAke2N1c3RvbS5hcmdzfWAudHJpbSgpLFxuICAgICAgICBleHRlbnNpb246IGN1c3RvbS5leHRlbnNpb24gfHwgXCIudHh0XCIsXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIFN0YW5kYXJkIGJ1aWx0LWluc1xuICAgIHN3aXRjaCAobm9ybWFsaXplZCkge1xuICAgICAgY2FzZSBcInB5dGhvblwiOlxuICAgICAgY2FzZSBcInB5XCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCkgfHwgXCJweXRob24zXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5weVwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImphdmFzY3JpcHRcIjpcbiAgICAgIGNhc2UgXCJqc1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLm5vZGVFeGVjdXRhYmxlLnRyaW0oKSB8fCBcIm5vZGVcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmpzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwidHlwZXNjcmlwdFwiOlxuICAgICAgY2FzZSBcInRzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MudHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInRzLW5vZGVcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnRzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwic2hlbGxcIjpcbiAgICAgIGNhc2UgXCJzaFwiOlxuICAgICAgY2FzZSBcImJhc2hcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5zaGVsbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiYmFzaFwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuc2hcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJydWJ5XCI6XG4gICAgICBjYXNlIFwicmJcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5ydWJ5RXhlY3V0YWJsZS50cmltKCkgfHwgXCJydWJ5XCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5yYlwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInBlcmxcIjpcbiAgICAgIGNhc2UgXCJwbFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnBlcmxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInBlcmxcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnBsXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwibHVhXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MubHVhRXhlY3V0YWJsZS50cmltKCkgfHwgXCJsdWFcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmx1YVwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInBocFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnBocEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicGhwXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5waHBcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJnb1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmdvRXhlY3V0YWJsZS50cmltKCkgfHwgXCJnb1wifSBydW4ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmdvXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiaGFza2VsbFwiOlxuICAgICAgY2FzZSBcImhzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MuaGFza2VsbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicnVuZ2hjXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5oc1wiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcIm9jYW1sXCI6XG4gICAgICBjYXNlIFwibWxcIjpcbiAgICAgICAgaWYgKHNldHRpbmdzLm9jYW1sTW9kZSA9PT0gXCJkdW5lXCIpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImR1bmVcIn0gZXhlYyAtLSBvY2FtbCB7ZmlsZX1gLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHNldHRpbmdzLm9jYW1sTW9kZSA9PT0gXCJvY2FtbGNcIikge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYCR7c2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcIm9jYW1sY1wifSAtbyAvdG1wL2xvb20tb2NhbWwgXCIkMVwiICYmIC90bXAvbG9vbS1vY2FtbGApLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwib2NhbWxcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiY1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5jRXhlY3V0YWJsZS50cmltKCkgfHwgXCJnY2NcIn0gXCIkMVwiIC1vIC90bXAvbG9vbS1jICYmIC90bXAvbG9vbS1jYCksXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5jXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiY3BwXCI6XG4gICAgICBjYXNlIFwiYysrXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGAke3NldHRpbmdzLmNwcEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiZysrXCJ9IFwiJDFcIiAtbyAvdG1wL2xvb20tY3BwICYmIC90bXAvbG9vbS1jcHBgKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmNwcFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImVicGZcIjpcbiAgICAgIGNhc2UgXCJlYnBmLWNcIjpcbiAgICAgIGNhc2UgXCJicGZcIjpcbiAgICAgIGNhc2UgXCJicGYtY1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5lYnBmQ2xhbmdFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImNsYW5nXCJ9IC10YXJnZXQgYnBmIC1PMiAtZyAtV2FsbCBcIiQxXCIgLWMgLW8gL3RtcC9sb29tLWVicGYubyAmJiBwcmludGYgJ2NvbXBpbGVkIC90bXAvbG9vbS1lYnBmLm9cXFxcbidgKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmJwZi5jXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiYnBmdHJhY2VcIjpcbiAgICAgIGNhc2UgXCJidFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmJwZnRyYWNlRXhlY3V0YWJsZS50cmltKCkgfHwgXCJicGZ0cmFjZVwifSAtZCB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuYnRcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJydXN0XCI6XG4gICAgICBjYXNlIFwicnNcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYCR7c2V0dGluZ3MucnVzdEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicnVzdGNcIn0gXCIkMVwiIC1vIC90bXAvbG9vbS1ydXN0ICYmIC90bXAvbG9vbS1ydXN0YCksXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5yc1wiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImphdmFcIjoge1xuICAgICAgICBjb25zdCBjb21waWxlciA9IHNldHRpbmdzLmphdmFDb21waWxlckV4ZWN1dGFibGUudHJpbSgpIHx8IFwiamF2YWNcIjtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYHRtcD0vdG1wL2xvb20tamF2YS0kJCAmJiBta2RpciAtcCBcIiR0bXBcIiAmJiBjcCBcIiQxXCIgXCIkdG1wL01haW4uamF2YVwiICYmICR7Y29tcGlsZXJ9IFwiJHRtcC9NYWluLmphdmFcIiAmJiAke3NldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImphdmFcIn0gLWNwIFwiJHRtcFwiIE1haW5gKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmphdmFcIixcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGNhc2UgXCJsbHZtLWlyXCI6XG4gICAgICBjYXNlIFwibGx2bVwiOlxuICAgICAgY2FzZSBcImxsXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MubGx2bUludGVycHJldGVyRXhlY3V0YWJsZS50cmltKCkgfHwgXCJsbGlcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmxsXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwibGVhblwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmxlYW5FeGVjdXRhYmxlLnRyaW0oKSB8fCBcImxlYW5cIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmxlYW5cIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJjb3FcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5jb3FFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImNvcWNcIn0gLXEge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnZcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJzbXRsaWJcIjpcbiAgICAgIGNhc2UgXCJzbXRcIjpcbiAgICAgIGNhc2UgXCJzbXQtbGliXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3Muc210RXhlY3V0YWJsZS50cmltKCkgfHwgXCJ6M1wifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuc210MlwiLFxuICAgICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG5mdW5jdGlvbiBzaGVsbENvbW1hbmQoY29tbWFuZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGBzaCAtbGMgJHtxdW90ZUNvbW1hbmRBcmcoY29tbWFuZCl9IHNoIHtmaWxlfWA7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4dGVuc2lvbihleHRlbnNpb246IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBleHRlbnNpb24udHJpbSgpO1xuICByZXR1cm4gdHJpbW1lZC5zdGFydHNXaXRoKFwiLlwiKSA/IHRyaW1tZWQgOiBgLiR7dHJpbW1lZH1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2hvd0RvY2tlck5vdGljZShtZXNzYWdlOiBzdHJpbmcpOiB2b2lkIHtcbiAgbmV3IE5vdGljZShtZXNzYWdlLCA4MDAwKTtcbn1cblxuZnVuY3Rpb24gb3B0aW9uYWxTdHJpbmcodmFsdWU6IHVua25vd24pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLnRyaW0oKSA/IHZhbHVlLnRyaW0oKSA6IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIodmFsdWU6IHVua25vd24sIGxhYmVsOiBzdHJpbmcpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPD0gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0gbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXIuYCk7XG4gIH1cbiAgcmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbE5vbk5lZ2F0aXZlSW50ZWdlcih2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlci5gKTtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIG9wdGlvbmFsU2lnbmFsKHZhbHVlOiB1bmtub3duLCBsYWJlbDogc3RyaW5nKTogTm9kZUpTLlNpZ25hbHMgfCB1bmRlZmluZWQge1xuICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIiB8fCAhL15TSUdbQS1aMC05XSskLy50ZXN0KHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0gbXVzdCBiZSBhIHNpZ25hbCBuYW1lIGxpa2UgU0lHVEVSTS5gKTtcbiAgfVxuICByZXR1cm4gdmFsdWUgYXMgTm9kZUpTLlNpZ25hbHM7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNsZWVwV2l0aFNpZ25hbChkdXJhdGlvbk1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgaWYgKGR1cmF0aW9uTXMgPD0gMCB8fCBzaWduYWwuYWJvcnRlZCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiB7XG4gICAgY29uc3QgdGltZW91dCA9IHNldFRpbWVvdXQocmVzb2x2ZSwgZHVyYXRpb25Ncyk7XG4gICAgY29uc3QgYWJvcnQgPSAoKSA9PiB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICByZXNvbHZlKCk7XG4gICAgfTtcbiAgICBzaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0LCB7IG9uY2U6IHRydWUgfSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBydW50aW1lTGFiZWwocnVudGltZTogbG9vbUNvbnRhaW5lclJ1bnRpbWUpOiBzdHJpbmcge1xuICBzd2l0Y2ggKHJ1bnRpbWUpIHtcbiAgICBjYXNlIFwiZG9ja2VyXCI6XG4gICAgICByZXR1cm4gXCJEb2NrZXJcIjtcbiAgICBjYXNlIFwicG9kbWFuXCI6XG4gICAgICByZXR1cm4gXCJQb2RtYW5cIjtcbiAgICBjYXNlIFwicWVtdVwiOlxuICAgICAgcmV0dXJuIFwiUUVNVVwiO1xuICAgIGNhc2UgXCJjdXN0b21cIjpcbiAgICAgIHJldHVybiBcIkN1c3RvbVwiO1xuICAgIGNhc2UgXCJ3c2xcIjpcbiAgICAgIHJldHVybiBcIldTTFwiO1xuICB9XG59XG5cbmZ1bmN0aW9uIHNoZWxsUXVvdGUodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgJyR7dmFsdWUucmVwbGFjZUFsbChcIidcIiwgXCInXFxcXCcnXCIpfSdgO1xufVxuXG5mdW5jdGlvbiBxdW90ZUNvbW1hbmRBcmcodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgJyR7dmFsdWUucmVwbGFjZUFsbChcIidcIiwgXCInXFxcXCcnXCIpfSdgO1xufVxuIiwgImltcG9ydCB7IG1rZHRlbXAsIHJtLCB3cml0ZUZpbGUgfSBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IHRtcGRpciB9IGZyb20gXCJvc1wiO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBzcGF3biB9IGZyb20gXCJjaGlsZF9wcm9jZXNzXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21SdW5SZXN1bHQgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBsb29tUHJvY2Vzc1NwZWMge1xuICBydW5uZXJJZDogc3RyaW5nO1xuICBydW5uZXJOYW1lOiBzdHJpbmc7XG4gIGV4ZWN1dGFibGU6IHN0cmluZztcbiAgYXJnczogc3RyaW5nW107XG4gIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZztcbiAgdGltZW91dE1zOiBudW1iZXI7XG4gIHNpZ25hbDogQWJvcnRTaWduYWw7XG4gIHN0ZGluPzogc3RyaW5nO1xuICBlbnY/OiBOb2RlSlMuUHJvY2Vzc0Vudjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tVGVtcFNvdXJjZVNwZWMgZXh0ZW5kcyBsb29tUHJvY2Vzc1NwZWMge1xuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmc7XG4gIHNvdXJjZTogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21UZW1wU291cmNlSGFuZGxlIHtcbiAgdGVtcERpcjogc3RyaW5nO1xuICB0ZW1wRmlsZTogc3RyaW5nO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGU8VD4oXG4gIGZpbGVOYW1lOiBzdHJpbmcsXG4gIHNvdXJjZTogc3RyaW5nLFxuICBjYWxsYmFjazogKGhhbmRsZTogbG9vbVRlbXBTb3VyY2VIYW5kbGUpID0+IFByb21pc2U8VD4sXG4pOiBQcm9taXNlPFQ+IHtcbiAgY29uc3QgdGVtcERpciA9IGF3YWl0IG1rZHRlbXAoam9pbih0bXBkaXIoKSwgXCJsb29tLVwiKSk7XG4gIGNvbnN0IHRlbXBGaWxlID0gam9pbih0ZW1wRGlyLCBmaWxlTmFtZSk7XG5cbiAgdHJ5IHtcbiAgICBhd2FpdCB3cml0ZUZpbGUodGVtcEZpbGUsIG5vcm1hbGl6ZUV4ZWN1dGFibGVTb3VyY2Uoc291cmNlKSwgXCJ1dGY4XCIpO1xuICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pO1xuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IHJtKHRlbXBEaXIsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2l0aFRlbXBTb3VyY2VGaWxlPFQ+KFxuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmcsXG4gIHNvdXJjZTogc3RyaW5nLFxuICBjYWxsYmFjazogKGhhbmRsZTogbG9vbVRlbXBTb3VyY2VIYW5kbGUpID0+IFByb21pc2U8VD4sXG4pOiBQcm9taXNlPFQ+IHtcbiAgcmV0dXJuIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlKGBzbmlwcGV0JHtmaWxlRXh0ZW5zaW9ufWAsIHNvdXJjZSwgY2FsbGJhY2spO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFeGVjdXRhYmxlU291cmNlKHNvdXJjZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoXCJcXG5cIik7XG4gIGNvbnN0IG5vbkVtcHR5TGluZXMgPSBsaW5lcy5maWx0ZXIoKGxpbmUpID0+IGxpbmUudHJpbSgpLmxlbmd0aCA+IDApO1xuICBpZiAoIW5vbkVtcHR5TGluZXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIHNvdXJjZTtcbiAgfVxuXG4gIGxldCBzaGFyZWRJbmRlbnQgPSBnZXRMZWFkaW5nV2hpdGVzcGFjZShub25FbXB0eUxpbmVzWzBdKTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIG5vbkVtcHR5TGluZXMuc2xpY2UoMSkpIHtcbiAgICBzaGFyZWRJbmRlbnQgPSBzaGFyZWRXaGl0ZXNwYWNlUHJlZml4KHNoYXJlZEluZGVudCwgZ2V0TGVhZGluZ1doaXRlc3BhY2UobGluZSkpO1xuICAgIGlmICghc2hhcmVkSW5kZW50KSB7XG4gICAgICByZXR1cm4gc291cmNlO1xuICAgIH1cbiAgfVxuXG4gIGlmICghc2hhcmVkSW5kZW50KSB7XG4gICAgcmV0dXJuIHNvdXJjZTtcbiAgfVxuXG4gIHJldHVybiBsaW5lc1xuICAgIC5tYXAoKGxpbmUpID0+IChsaW5lLnRyaW0oKS5sZW5ndGggPT09IDAgPyBsaW5lIDogbGluZS5zdGFydHNXaXRoKHNoYXJlZEluZGVudCkgPyBsaW5lLnNsaWNlKHNoYXJlZEluZGVudC5sZW5ndGgpIDogbGluZSkpXG4gICAgLmpvaW4oXCJcXG5cIik7XG59XG5cbmZ1bmN0aW9uIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXltcXHQgXSovKTtcbiAgcmV0dXJuIG1hdGNoPy5bMF0gPz8gXCJcIjtcbn1cblxuZnVuY3Rpb24gc2hhcmVkV2hpdGVzcGFjZVByZWZpeChsZWZ0OiBzdHJpbmcsIHJpZ2h0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgaW5kZXggPSAwO1xuICB3aGlsZSAoaW5kZXggPCBsZWZ0Lmxlbmd0aCAmJiBpbmRleCA8IHJpZ2h0Lmxlbmd0aCAmJiBsZWZ0W2luZGV4XSA9PT0gcmlnaHRbaW5kZXhdKSB7XG4gICAgaW5kZXggKz0gMTtcbiAgfVxuICByZXR1cm4gbGVmdC5zbGljZSgwLCBpbmRleCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Qcm9jZXNzKHNwZWM6IGxvb21Qcm9jZXNzU3BlYyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICBjb25zdCBzdGFydGVkQXQgPSBuZXcgRGF0ZSgpO1xuICBsZXQgc3Rkb3V0ID0gXCJcIjtcbiAgbGV0IHN0ZGVyciA9IFwiXCI7XG4gIGxldCBleGl0Q29kZTogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIGxldCB0aW1lZE91dCA9IGZhbHNlO1xuICBsZXQgY2FuY2VsbGVkID0gZmFsc2U7XG4gIGxldCBjaGlsZDogUmV0dXJuVHlwZTx0eXBlb2Ygc3Bhd24+IHwgbnVsbCA9IG51bGw7XG4gIGxldCB0aW1lb3V0SGFuZGxlOiBOb2RlSlMuVGltZW91dCB8IG51bGwgPSBudWxsO1xuICBsZXQgYWJvcnRIYW5kbGVyOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICB0cnkge1xuICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNoaWxkID0gc3Bhd24oc3BlYy5leGVjdXRhYmxlLCBzcGVjLmFyZ3MsIHtcbiAgICAgICAgY3dkOiBzcGVjLndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHNoZWxsOiBmYWxzZSxcbiAgICAgICAgc3RkaW86IFtcInBpcGVcIiwgXCJwaXBlXCIsIFwicGlwZVwiXSxcbiAgICAgICAgZW52OiB7XG4gICAgICAgICAgLi4ucHJvY2Vzcy5lbnYsXG4gICAgICAgICAgLi4uc3BlYy5lbnYsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIGNoaWxkLnN0ZGluPy5lbmQoc3BlYy5zdGRpbiA/PyBcIlwiKTtcblxuICAgICAgY29uc3QgYWJvcnQgPSAoKSA9PiB7XG4gICAgICAgIGNhbmNlbGxlZCA9IHRydWU7XG4gICAgICAgIGNoaWxkPy5raWxsKFwiU0lHVEVSTVwiKTtcbiAgICAgIH07XG4gICAgICBhYm9ydEhhbmRsZXIgPSBhYm9ydDtcblxuICAgICAgaWYgKHNwZWMuc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgYWJvcnQoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNwZWMuc2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydCwgeyBvbmNlOiB0cnVlIH0pO1xuICAgICAgfVxuXG4gICAgICB0aW1lb3V0SGFuZGxlID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRpbWVkT3V0ID0gdHJ1ZTtcbiAgICAgICAgY2hpbGQ/LmtpbGwoXCJTSUdURVJNXCIpO1xuICAgICAgfSwgc3BlYy50aW1lb3V0TXMpO1xuXG4gICAgICBjaGlsZC5zdGRvdXQ/Lm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcbiAgICAgICAgc3Rkb3V0ICs9IGNodW5rLnRvU3RyaW5nKCk7XG4gICAgICB9KTtcblxuICAgICAgY2hpbGQuc3RkZXJyPy5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB7XG4gICAgICAgIHN0ZGVyciArPSBjaHVuay50b1N0cmluZygpO1xuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHJlamVjdChlcnJvcik7XG4gICAgICB9KTtcblxuICAgICAgY2hpbGQub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xuICAgICAgICBleGl0Q29kZSA9IGNvZGU7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHN0ZGVyciA9IHN0ZGVyciB8fCBmb3JtYXRQcm9jZXNzRXJyb3IoZXJyb3IsIHNwZWMuZXhlY3V0YWJsZSk7XG4gICAgZXhpdENvZGUgPSBleGl0Q29kZSA/PyAtMTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoYWJvcnRIYW5kbGVyKSB7XG4gICAgICBzcGVjLnNpZ25hbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnRIYW5kbGVyKTtcbiAgICB9XG4gICAgaWYgKHRpbWVvdXRIYW5kbGUpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0SGFuZGxlKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBmaW5pc2hlZEF0ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgZHVyYXRpb25NcyA9IGZpbmlzaGVkQXQuZ2V0VGltZSgpIC0gc3RhcnRlZEF0LmdldFRpbWUoKTtcbiAgY29uc3Qgc3VjY2VzcyA9ICF0aW1lZE91dCAmJiAhY2FuY2VsbGVkICYmIGV4aXRDb2RlID09PSAwO1xuXG4gIHJldHVybiB7XG4gICAgcnVubmVySWQ6IHNwZWMucnVubmVySWQsXG4gICAgcnVubmVyTmFtZTogc3BlYy5ydW5uZXJOYW1lLFxuICAgIHN0YXJ0ZWRBdDogc3RhcnRlZEF0LnRvSVNPU3RyaW5nKCksXG4gICAgZmluaXNoZWRBdDogZmluaXNoZWRBdC50b0lTT1N0cmluZygpLFxuICAgIGR1cmF0aW9uTXMsXG4gICAgZXhpdENvZGUsXG4gICAgc3Rkb3V0LFxuICAgIHN0ZGVycixcbiAgICBzdWNjZXNzLFxuICAgIHRpbWVkT3V0LFxuICAgIGNhbmNlbGxlZCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZm9ybWF0UHJvY2Vzc0Vycm9yKGVycm9yOiB1bmtub3duLCBleGVjdXRhYmxlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBcImNvZGVcIiBpbiBlcnJvciAmJiAoZXJyb3IgYXMgTm9kZUpTLkVycm5vRXhjZXB0aW9uKS5jb2RlID09PSBcIkVOT0VOVFwiKSB7XG4gICAgcmV0dXJuIGBFeGVjdXRhYmxlIG5vdCBmb3VuZDogJHtleGVjdXRhYmxlfWA7XG4gIH1cblxuICByZXR1cm4gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuVGVtcEZpbGVQcm9jZXNzKHNwZWM6IGxvb21UZW1wU291cmNlU3BlYyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKHNwZWMuZmlsZUV4dGVuc2lvbiwgc3BlYy5zb3VyY2UsIGFzeW5jICh7IHRlbXBGaWxlLCB0ZW1wRGlyIH0pID0+XG4gICAgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogc3BlYy5ydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWU6IHNwZWMucnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNwZWMuZXhlY3V0YWJsZSxcbiAgICAgIGFyZ3M6IHNwZWMuYXJncy5tYXAoKHZhbHVlKSA9PiB2YWx1ZS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlKS5yZXBsYWNlQWxsKFwie3RlbXBEaXJ9XCIsIHRlbXBEaXIpKSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHNwZWMud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogc3BlYy50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IHNwZWMuc2lnbmFsLFxuICAgICAgc3RkaW46IHNwZWMuc3RkaW4sXG4gICAgICBlbnY6IGV4cGFuZFRlbXBsYXRlZEVudihzcGVjLmVudiwgdGVtcEZpbGUsIHRlbXBEaXIpLFxuICAgIH0pLFxuICApO1xufVxuXG5mdW5jdGlvbiBleHBhbmRUZW1wbGF0ZWRFbnYoZW52OiBOb2RlSlMuUHJvY2Vzc0VudiB8IHVuZGVmaW5lZCwgdGVtcEZpbGU6IHN0cmluZywgdGVtcERpcjogc3RyaW5nKTogTm9kZUpTLlByb2Nlc3NFbnYgfCB1bmRlZmluZWQge1xuICBpZiAoIWVudikge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIE9iamVjdC5lbnRyaWVzKGVudikubWFwKChba2V5LCB2YWx1ZV0pID0+IFtcbiAgICAgIGtleSxcbiAgICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiA/IHZhbHVlLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGUpLnJlcGxhY2VBbGwoXCJ7dGVtcERpcn1cIiwgdGVtcERpcikgOiB2YWx1ZSxcbiAgICBdKSxcbiAgKTtcbn1cbiIsICJleHBvcnQgZnVuY3Rpb24gc3BsaXRDb21tYW5kTGluZShpbnB1dDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1cnJlbnQgPSBcIlwiO1xuICBsZXQgcXVvdGU6IFwiJ1wiIHwgXCJcXFwiXCIgfCBudWxsID0gbnVsbDtcbiAgbGV0IGVzY2FwaW5nID0gZmFsc2U7XG5cbiAgZm9yIChjb25zdCBjaGFyIG9mIGlucHV0LnRyaW0oKSkge1xuICAgIGlmIChlc2NhcGluZykge1xuICAgICAgY3VycmVudCArPSBjaGFyO1xuICAgICAgZXNjYXBpbmcgPSBmYWxzZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChjaGFyID09PSBcIlxcXFxcIikge1xuICAgICAgZXNjYXBpbmcgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKChjaGFyID09PSBcIidcIiB8fCBjaGFyID09PSBcIlxcXCJcIikgJiYgIXF1b3RlKSB7XG4gICAgICBxdW90ZSA9IGNoYXI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY2hhciA9PT0gcXVvdGUpIHtcbiAgICAgIHF1b3RlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmICgvXFxzLy50ZXN0KGNoYXIpICYmICFxdW90ZSkge1xuICAgICAgaWYgKGN1cnJlbnQpIHtcbiAgICAgICAgcGFydHMucHVzaChjdXJyZW50KTtcbiAgICAgICAgY3VycmVudCA9IFwiXCI7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjdXJyZW50ICs9IGNoYXI7XG4gIH1cblxuICBpZiAoY3VycmVudCkge1xuICAgIHBhcnRzLnB1c2goY3VycmVudCk7XG4gIH1cblxuICByZXR1cm4gcGFydHM7XG59XG4iLCAiaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBub3JtYWxpemVQYXRoLCB0eXBlIEFwcCwgdHlwZSBURmlsZSB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tRXhlY3V0aW9uQ29udGV4dE92ZXJyaWRlLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5pbnRlcmZhY2UgTm90ZUV4ZWN1dGlvbkNvbnRleHQge1xuICBjb250YWluZXJHcm91cD86IHN0cmluZztcbiAgZGlzYWJsZUNvbnRhaW5lcj86IGJvb2xlYW47XG4gIHdvcmtpbmdEaXJlY3Rvcnk/OiBzdHJpbmc7XG4gIHRpbWVvdXRNcz86IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVFeGVjdXRpb25Db250ZXh0KFxuICBhcHA6IEFwcCxcbiAgZmlsZTogVEZpbGUsXG4gIGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuICBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLFxuKTogbG9vbVJlc29sdmVkRXhlY3V0aW9uQ29udGV4dCB7XG4gIGNvbnN0IG5vdGUgPSByZWFkTm90ZUV4ZWN1dGlvbkNvbnRleHQoYXBwLCBmaWxlKTtcbiAgY29uc3QgZGVmYXVsdFdvcmtpbmdEaXJlY3RvcnkgPSByZXNvbHZlRGVmYXVsdFdvcmtpbmdEaXJlY3RvcnkoZmlsZSwgc2V0dGluZ3MpO1xuICBjb25zdCBub3RlV29ya2luZ0RpcmVjdG9yeSA9IG5vcm1hbGl6ZVdvcmtpbmdEaXJlY3Rvcnkobm90ZS53b3JraW5nRGlyZWN0b3J5KTtcbiAgY29uc3QgYmxvY2tXb3JraW5nRGlyZWN0b3J5ID0gbm9ybWFsaXplV29ya2luZ0RpcmVjdG9yeShibG9jay5leGVjdXRpb25Db250ZXh0LndvcmtpbmdEaXJlY3RvcnkpO1xuICBjb25zdCBub3RlVGltZW91dCA9IG5vdGUudGltZW91dE1zO1xuICBjb25zdCBibG9ja1RpbWVvdXQgPSBibG9jay5leGVjdXRpb25Db250ZXh0LnRpbWVvdXRNcztcblxuICByZXR1cm4ge1xuICAgIGNvbnRhaW5lckdyb3VwOiByZXNvbHZlQ29udGFpbmVyR3JvdXAoc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwLCBub3RlLCBibG9jay5leGVjdXRpb25Db250ZXh0KSxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiBibG9ja1dvcmtpbmdEaXJlY3RvcnkgPz8gbm90ZVdvcmtpbmdEaXJlY3RvcnkgPz8gZGVmYXVsdFdvcmtpbmdEaXJlY3RvcnksXG4gICAgdGltZW91dE1zOiBibG9ja1RpbWVvdXQgPz8gbm90ZVRpbWVvdXQgPz8gc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcyxcbiAgICBzb3VyY2U6IHtcbiAgICAgIGNvbnRhaW5lcjogcmVzb2x2ZUNvbnRhaW5lclNvdXJjZShzZXR0aW5ncy5kZWZhdWx0Q29udGFpbmVyR3JvdXAsIG5vdGUsIGJsb2NrLmV4ZWN1dGlvbkNvbnRleHQpLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogYmxvY2tXb3JraW5nRGlyZWN0b3J5ID8gXCJibG9ja1wiIDogbm90ZVdvcmtpbmdEaXJlY3RvcnkgPyBcIm5vdGVcIiA6IHNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkudHJpbSgpID8gXCJnbG9iYWxcIiA6IFwiZGVmYXVsdFwiLFxuICAgICAgdGltZW91dDogYmxvY2tUaW1lb3V0ID8gXCJibG9ja1wiIDogbm90ZVRpbWVvdXQgPyBcIm5vdGVcIiA6IFwiZ2xvYmFsXCIsXG4gICAgfSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUNvbnRhaW5lckdyb3VwKFxuICBnbG9iYWxDb250YWluZXI6IHN0cmluZyxcbiAgbm90ZTogTm90ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIGJsb2NrOiBsb29tRXhlY3V0aW9uQ29udGV4dE92ZXJyaWRlLFxuKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKGJsb2NrLmRpc2FibGVDb250YWluZXIpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmIChibG9jay5jb250YWluZXJHcm91cD8udHJpbSgpKSB7XG4gICAgcmV0dXJuIGJsb2NrLmNvbnRhaW5lckdyb3VwLnRyaW0oKTtcbiAgfVxuICBpZiAobm90ZS5kaXNhYmxlQ29udGFpbmVyKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAobm90ZS5jb250YWluZXJHcm91cD8udHJpbSgpKSB7XG4gICAgcmV0dXJuIG5vdGUuY29udGFpbmVyR3JvdXAudHJpbSgpO1xuICB9XG4gIHJldHVybiBnbG9iYWxDb250YWluZXIudHJpbSgpIHx8IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUNvbnRhaW5lclNvdXJjZShcbiAgZ2xvYmFsQ29udGFpbmVyOiBzdHJpbmcsXG4gIG5vdGU6IE5vdGVFeGVjdXRpb25Db250ZXh0LFxuICBibG9jazogbG9vbUV4ZWN1dGlvbkNvbnRleHRPdmVycmlkZSxcbik6IGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHRbXCJzb3VyY2VcIl1bXCJjb250YWluZXJcIl0ge1xuICBpZiAoYmxvY2suZGlzYWJsZUNvbnRhaW5lciB8fCBibG9jay5jb250YWluZXJHcm91cD8udHJpbSgpKSB7XG4gICAgcmV0dXJuIFwiYmxvY2tcIjtcbiAgfVxuICBpZiAobm90ZS5kaXNhYmxlQ29udGFpbmVyIHx8IG5vdGUuY29udGFpbmVyR3JvdXA/LnRyaW0oKSkge1xuICAgIHJldHVybiBcIm5vdGVcIjtcbiAgfVxuICBpZiAoZ2xvYmFsQ29udGFpbmVyLnRyaW0oKSkge1xuICAgIHJldHVybiBcImdsb2JhbFwiO1xuICB9XG4gIHJldHVybiBcIm5vbmVcIjtcbn1cblxuZnVuY3Rpb24gcmVhZE5vdGVFeGVjdXRpb25Db250ZXh0KGFwcDogQXBwLCBmaWxlOiBURmlsZSk6IE5vdGVFeGVjdXRpb25Db250ZXh0IHtcbiAgY29uc3QgZnJvbnRtYXR0ZXIgPSBhcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICBpZiAoIWZyb250bWF0dGVyKSB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG5cbiAgY29uc3QgY29udGFpbmVyID0gZnJvbnRtYXR0ZXJbXCJsb29tLWNvbnRhaW5lclwiXTtcbiAgY29uc3Qgd29ya2luZ0RpcmVjdG9yeSA9IGZyb250bWF0dGVyW1wibG9vbS1jd2RcIl0gPz8gZnJvbnRtYXR0ZXJbXCJsb29tLXdvcmtpbmctZGlyZWN0b3J5XCJdO1xuICBjb25zdCB0aW1lb3V0ID0gZnJvbnRtYXR0ZXJbXCJsb29tLXRpbWVvdXRcIl07XG5cbiAgcmV0dXJuIHtcbiAgICBjb250YWluZXJHcm91cDogdHlwZW9mIGNvbnRhaW5lciA9PT0gXCJzdHJpbmdcIiAmJiAhaXNEaXNhYmxlZFZhbHVlKGNvbnRhaW5lcikgPyBjb250YWluZXIudHJpbSgpIDogdW5kZWZpbmVkLFxuICAgIGRpc2FibGVDb250YWluZXI6IHR5cGVvZiBjb250YWluZXIgPT09IFwic3RyaW5nXCIgPyBpc0Rpc2FibGVkVmFsdWUoY29udGFpbmVyKSA6IHVuZGVmaW5lZCxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiB0eXBlb2Ygd29ya2luZ0RpcmVjdG9yeSA9PT0gXCJzdHJpbmdcIiA/IHdvcmtpbmdEaXJlY3RvcnkgOiB1bmRlZmluZWQsXG4gICAgdGltZW91dE1zOiB0eXBlb2YgdGltZW91dCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodGltZW91dCkgJiYgdGltZW91dCA+IDBcbiAgICAgID8gTWF0aC50cnVuYyh0aW1lb3V0KVxuICAgICAgOiB0eXBlb2YgdGltZW91dCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICA/IHBhcnNlUG9zaXRpdmVJbnRlZ2VyKHRpbWVvdXQpXG4gICAgICAgIDogdW5kZWZpbmVkLFxuICB9O1xufVxuXG5mdW5jdGlvbiByZXNvbHZlRGVmYXVsdFdvcmtpbmdEaXJlY3RvcnkoZmlsZTogVEZpbGUsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBzdHJpbmcge1xuICBpZiAoc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeS50cmltKCkpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplUGF0aChzZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5LnRyaW0oKSk7XG4gIH1cblxuICBjb25zdCBhZGFwdGVyQmFzZVBhdGggPSAoZmlsZS52YXVsdC5hZGFwdGVyIGFzIHsgYmFzZVBhdGg/OiBzdHJpbmcgfSkuYmFzZVBhdGggPz8gXCJcIjtcbiAgY29uc3QgZmlsZUZvbGRlciA9IGRpcm5hbWUoZmlsZS5wYXRoKTtcbiAgY29uc3QgcmVzb2x2ZWQgPSBmaWxlRm9sZGVyID09PSBcIi5cIiA/IGFkYXB0ZXJCYXNlUGF0aCA6IGAke2FkYXB0ZXJCYXNlUGF0aH0vJHtmaWxlRm9sZGVyfWA7XG4gIHJldHVybiByZXNvbHZlZCB8fCBwcm9jZXNzLmN3ZCgpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVXb3JraW5nRGlyZWN0b3J5KHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gdmFsdWU/LnRyaW0oKSA/IG5vcm1hbGl6ZVBhdGgodmFsdWUudHJpbSgpKSA6IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gcGFyc2VQb3NpdGl2ZUludGVnZXIodmFsdWU6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHBhcnNlZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZS50cmltKCksIDEwKTtcbiAgcmV0dXJuIE51bWJlci5pc0ludGVnZXIocGFyc2VkKSAmJiBwYXJzZWQgPiAwID8gcGFyc2VkIDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBpc0Rpc2FibGVkVmFsdWUodmFsdWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gW1wiMFwiLCBcImZhbHNlXCIsIFwibm9cIiwgXCJvZmZcIiwgXCJub25lXCIsIFwibmF0aXZlXCJdLmluY2x1ZGVzKHZhbHVlLnRyaW0oKS50b0xvd2VyQ2FzZSgpKTtcbn1cbiIsICJpbXBvcnQgeyBEZWNvcmF0aW9uLCB0eXBlIEVkaXRvclZpZXcgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xuaW1wb3J0IHR5cGUgeyBSYW5nZVNldEJ1aWxkZXIgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivc3RhdGVcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jayB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmludGVyZmFjZSBMbHZtVG9rZW4ge1xuICBmcm9tOiBudW1iZXI7XG4gIHRvOiBudW1iZXI7XG4gIGNsYXNzTmFtZTogc3RyaW5nO1xufVxuXG5jb25zdCBMTFZNX0tFWVdPUkRTID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oW1xuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWNvbnRyb2xcIiwgW1xuICAgIFwicmV0XCIsIFwiYnJcIiwgXCJzd2l0Y2hcIiwgXCJpbmRpcmVjdGJyXCIsIFwiaW52b2tlXCIsIFwiY2FsbGJyXCIsIFwicmVzdW1lXCIsIFwidW5yZWFjaGFibGVcIiwgXCJjbGVhbnVwcmV0XCIsIFwiY2F0Y2hyZXRcIiwgXCJjYXRjaHN3aXRjaFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1kZWNsYXJhdGlvblwiLCBbXG4gICAgXCJkZWZpbmVcIiwgXCJkZWNsYXJlXCIsIFwidHlwZVwiLCBcImdsb2JhbFwiLCBcImNvbnN0YW50XCIsIFwiYWxpYXNcIiwgXCJpZnVuY1wiLCBcImNvbWRhdFwiLCBcImF0dHJpYnV0ZXNcIiwgXCJzZWN0aW9uXCIsIFwiZ2NcIiwgXCJwcmVmaXhcIiwgXCJwcm9sb2d1ZVwiLFxuICAgIFwicGVyc29uYWxpdHlcIiwgXCJ1c2VsaXN0b3JkZXJcIiwgXCJ1c2VsaXN0b3JkZXJfYmJcIiwgXCJtb2R1bGVcIiwgXCJhc21cIiwgXCJzb3VyY2VfZmlsZW5hbWVcIiwgXCJ0YXJnZXRcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtbWVtb3J5XCIsIFtcbiAgICBcImFsbG9jYVwiLCBcImxvYWRcIiwgXCJzdG9yZVwiLCBcImdldGVsZW1lbnRwdHJcIiwgXCJmZW5jZVwiLCBcImNtcHhjaGdcIiwgXCJhdG9taWNybXdcIiwgXCJleHRyYWN0dmFsdWVcIiwgXCJpbnNlcnR2YWx1ZVwiLCBcImV4dHJhY3RlbGVtZW50XCIsXG4gICAgXCJpbnNlcnRlbGVtZW50XCIsIFwic2h1ZmZsZXZlY3RvclwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1hcml0aG1ldGljXCIsIFtcbiAgICBcImFkZFwiLCBcInN1YlwiLCBcIm11bFwiLCBcInVkaXZcIiwgXCJzZGl2XCIsIFwidXJlbVwiLCBcInNyZW1cIiwgXCJzaGxcIiwgXCJsc2hyXCIsIFwiYXNoclwiLCBcImFuZFwiLCBcIm9yXCIsIFwieG9yXCIsIFwiZm5lZ1wiLCBcImZhZGRcIiwgXCJmc3ViXCIsIFwiZm11bFwiLFxuICAgIFwiZmRpdlwiLCBcImZyZW1cIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY29tcGFyaXNvblwiLCBbXCJpY21wXCIsIFwiZmNtcFwiXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY2FzdFwiLCBbXG4gICAgXCJ0cnVuY1wiLCBcInpleHRcIiwgXCJzZXh0XCIsIFwiZnB0cnVuY1wiLCBcImZwZXh0XCIsIFwiZnB0b3VpXCIsIFwiZnB0b3NpXCIsIFwidWl0b2ZwXCIsIFwic2l0b2ZwXCIsIFwicHRydG9pbnRcIiwgXCJpbnR0b3B0clwiLCBcImJpdGNhc3RcIiwgXCJhZGRyc3BhY2VjYXN0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLW90aGVyXCIsIFtcInBoaVwiLCBcInNlbGVjdFwiLCBcImZyZWV6ZVwiLCBcImNhbGxcIiwgXCJsYW5kaW5ncGFkXCIsIFwiY2F0Y2hwYWRcIiwgXCJjbGVhbnVwcGFkXCIsIFwidmFfYXJnXCJdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1tb2RpZmllclwiLCBbXG4gICAgXCJwcml2YXRlXCIsIFwiaW50ZXJuYWxcIiwgXCJhdmFpbGFibGVfZXh0ZXJuYWxseVwiLCBcImxpbmtvbmNlXCIsIFwid2Vha1wiLCBcImNvbW1vblwiLCBcImFwcGVuZGluZ1wiLCBcImV4dGVybl93ZWFrXCIsIFwibGlua29uY2Vfb2RyXCIsIFwid2Vha19vZHJcIixcbiAgICBcImV4dGVybmFsXCIsIFwiZGVmYXVsdFwiLCBcImhpZGRlblwiLCBcInByb3RlY3RlZFwiLCBcImRsbGltcG9ydFwiLCBcImRsbGV4cG9ydFwiLCBcImRzb19sb2NhbFwiLCBcImRzb19wcmVlbXB0YWJsZVwiLCBcImV4dGVybmFsbHlfaW5pdGlhbGl6ZWRcIixcbiAgICBcInRocmVhZF9sb2NhbFwiLCBcImxvY2FsZHluYW1pY1wiLCBcImluaXRpYWxleGVjXCIsIFwibG9jYWxleGVjXCIsIFwidW5uYW1lZF9hZGRyXCIsIFwibG9jYWxfdW5uYW1lZF9hZGRyXCIsIFwiYXRvbWljXCIsIFwidW5vcmRlcmVkXCIsIFwibW9ub3RvbmljXCIsXG4gICAgXCJhY3F1aXJlXCIsIFwicmVsZWFzZVwiLCBcImFjcV9yZWxcIiwgXCJzZXFfY3N0XCIsIFwic3luY3Njb3BlXCIsIFwidm9sYXRpbGVcIiwgXCJzaW5nbGV0aHJlYWRcIiwgXCJjY2NcIiwgXCJmYXN0Y2NcIiwgXCJjb2xkY2NcIiwgXCJ3ZWJraXRfanNjY1wiLFxuICAgIFwiYW55cmVnY2NcIiwgXCJwcmVzZXJ2ZV9tb3N0Y2NcIiwgXCJwcmVzZXJ2ZV9hbGxjY1wiLCBcImN4eF9mYXN0X3Rsc2NjXCIsIFwic3dpZnRjY1wiLCBcInRhaWxjY1wiLCBcImNmZ3VhcmRfY2hlY2tjY1wiLCBcInRhaWxcIiwgXCJtdXN0dGFpbFwiLCBcIm5vdGFpbFwiLFxuICAgIFwiZmFzdFwiLCBcIm5uYW5cIiwgXCJuaW5mXCIsIFwibnN6XCIsIFwiYXJjcFwiLCBcImNvbnRyYWN0XCIsIFwiYWZuXCIsIFwicmVhc3NvY1wiLCBcIm51d1wiLCBcIm5zd1wiLCBcImV4YWN0XCIsIFwiaW5ib3VuZHNcIiwgXCJ0b1wiLCBcInhcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLXByZWRpY2F0ZVwiLCBbXG4gICAgXCJlcVwiLCBcIm5lXCIsIFwidWd0XCIsIFwidWdlXCIsIFwidWx0XCIsIFwidWxlXCIsIFwic2d0XCIsIFwic2dlXCIsIFwic2x0XCIsIFwic2xlXCIsIFwib2VxXCIsIFwib2d0XCIsIFwib2dlXCIsIFwib2x0XCIsIFwib2xlXCIsIFwib25lXCIsIFwib3JkXCIsIFwidWVxXCIsIFwidW5lXCIsXG4gICAgXCJ1bm9cIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWF0dHJpYnV0ZVwiLCBbXG4gICAgXCJhbHdheXNpbmxpbmVcIiwgXCJhcmdtZW1vbmx5XCIsIFwiYnVpbHRpblwiLCBcImJ5cmVmXCIsIFwiYnl2YWxcIiwgXCJjb2xkXCIsIFwiY29udmVyZ2VudFwiLCBcImRlcmVmZXJlbmNlYWJsZVwiLCBcImRlcmVmZXJlbmNlYWJsZV9vcl9udWxsXCIsIFwiZGlzdGluY3RcIixcbiAgICBcImltbWFyZ1wiLCBcImluYWxsb2NhXCIsIFwiaW5yZWdcIiwgXCJtdXN0cHJvZ3Jlc3NcIiwgXCJuZXN0XCIsIFwibm9hbGlhc1wiLCBcIm5vY2FsbGJhY2tcIiwgXCJub2NhcHR1cmVcIiwgXCJub2ZyZWVcIiwgXCJub2lubGluZVwiLCBcIm5vbmxhenliaW5kXCIsXG4gICAgXCJub25udWxsXCIsIFwibm9yZWN1cnNlXCIsIFwibm9yZWR6b25lXCIsIFwibm9yZXR1cm5cIiwgXCJub3N5bmNcIiwgXCJub3Vud2luZFwiLCBcIm51bGxfcG9pbnRlcl9pc192YWxpZFwiLCBcIm9wYXF1ZVwiLCBcIm9wdG5vbmVcIiwgXCJvcHRzaXplXCIsXG4gICAgXCJwcmVhbGxvY2F0ZWRcIiwgXCJyZWFkbm9uZVwiLCBcInJlYWRvbmx5XCIsIFwicmV0dXJuZWRcIiwgXCJyZXR1cm5zX3R3aWNlXCIsIFwic2FuaXRpemVfYWRkcmVzc1wiLCBcInNhbml0aXplX2h3YWRkcmVzc1wiLCBcInNhbml0aXplX21lbW9yeVwiLFxuICAgIFwic2FuaXRpemVfdGhyZWFkXCIsIFwic2lnbmV4dFwiLCBcInNwZWN1bGF0YWJsZVwiLCBcInNyZXRcIiwgXCJzc3BcIiwgXCJzc3ByZXFcIiwgXCJzc3BzdHJvbmdcIiwgXCJzd2lmdGFzeW5jXCIsIFwic3dpZnRzZWxmXCIsIFwic3dpZnRlcnJvclwiLCBcInV3dGFibGVcIixcbiAgICBcIndpbGxyZXR1cm5cIiwgXCJ3cml0ZW9ubHlcIiwgXCJ6ZXJvZXh0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1jb25zdGFudFwiLCBbXCJ0cnVlXCIsIFwiZmFsc2VcIiwgXCJudWxsXCIsIFwibm9uZVwiLCBcInVuZGVmXCIsIFwicG9pc29uXCIsIFwiemVyb2luaXRpYWxpemVyXCJdKSxcbl0pO1xuXG5jb25zdCBMTFZNX1BSSU1JVElWRV9UWVBFUyA9IG5ldyBTZXQoW1xuICBcInZvaWRcIiwgXCJsYWJlbFwiLCBcInRva2VuXCIsIFwibWV0YWRhdGFcIiwgXCJ4ODZfbW14XCIsIFwieDg2X2FteFwiLCBcImhhbGZcIiwgXCJiZmxvYXRcIiwgXCJmbG9hdFwiLCBcImRvdWJsZVwiLCBcImZwMTI4XCIsIFwieDg2X2ZwODBcIiwgXCJwcGNfZnAxMjhcIiwgXCJwdHJcIixcbl0pO1xuXG5jb25zdCBQVU5DVFVBVElPTl9DTEFTUyA9IFwibG9vbS1sbHZtLXB1bmN0dWF0aW9uXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBoaWdobGlnaHRMbHZtRWxlbWVudChjb2RlRWxlbWVudDogSFRNTEVsZW1lbnQsIHNvdXJjZTogc3RyaW5nKTogdm9pZCB7XG4gIGNvZGVFbGVtZW50LmVtcHR5KCk7XG4gIGNvZGVFbGVtZW50LmFkZENsYXNzKFwibG9vbS1sbHZtLWNvZGVcIik7XG5cbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoXCJcXG5cIik7XG4gIGxpbmVzLmZvckVhY2goKGxpbmUsIGluZGV4KSA9PiB7XG4gICAgYXBwZW5kSGlnaGxpZ2h0ZWRMaW5lKGNvZGVFbGVtZW50LCBsaW5lKTtcbiAgICBpZiAoaW5kZXggPCBsaW5lcy5sZW5ndGggLSAxKSB7XG4gICAgICBjb2RlRWxlbWVudC5hcHBlbmRUZXh0KFwiXFxuXCIpO1xuICAgIH1cbiAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRMbHZtRGVjb3JhdGlvbnMoXG4gIGJ1aWxkZXI6IFJhbmdlU2V0QnVpbGRlcjxEZWNvcmF0aW9uPixcbiAgdmlldzogRWRpdG9yVmlldyxcbiAgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4pOiB2b2lkIHtcbiAgY29uc3QgY29udGVudExpbmVDb3VudCA9IGdldENvbnRlbnRMaW5lQ291bnQoYmxvY2spO1xuICBpZiAoIWNvbnRlbnRMaW5lQ291bnQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBsaW5lcyA9IGJsb2NrLmNvbnRlbnQuc3BsaXQoXCJcXG5cIik7XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBjb250ZW50TGluZUNvdW50OyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XSA/PyBcIlwiO1xuICAgIGNvbnN0IHRva2VucyA9IHRva2VuaXplTGx2bUxpbmUobGluZSk7XG4gICAgaWYgKCF0b2tlbnMubGVuZ3RoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBkb2NMaW5lID0gdmlldy5zdGF0ZS5kb2MubGluZShibG9jay5zdGFydExpbmUgKyAyICsgaW5kZXgpO1xuICAgIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5zKSB7XG4gICAgICBpZiAodG9rZW4uZnJvbSA9PT0gdG9rZW4udG8pIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBidWlsZGVyLmFkZChcbiAgICAgICAgZG9jTGluZS5mcm9tICsgdG9rZW4uZnJvbSxcbiAgICAgICAgZG9jTGluZS5mcm9tICsgdG9rZW4udG8sXG4gICAgICAgIERlY29yYXRpb24ubWFyayh7IGNsYXNzOiB0b2tlbi5jbGFzc05hbWUgfSksXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBlbmRIaWdobGlnaHRlZExpbmUoY29udGFpbmVyOiBIVE1MRWxlbWVudCwgbGluZTogc3RyaW5nKTogdm9pZCB7XG4gIGxldCBjdXJzb3IgPSAwO1xuXG4gIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5pemVMbHZtTGluZShsaW5lKSkge1xuICAgIGlmICh0b2tlbi5mcm9tID4gY3Vyc29yKSB7XG4gICAgICBjb250YWluZXIuYXBwZW5kVGV4dChsaW5lLnNsaWNlKGN1cnNvciwgdG9rZW4uZnJvbSkpO1xuICAgIH1cblxuICAgIGNvbnN0IHNwYW4gPSBjb250YWluZXIuY3JlYXRlU3Bhbih7IGNsczogdG9rZW4uY2xhc3NOYW1lIH0pO1xuICAgIHNwYW4uc2V0VGV4dChsaW5lLnNsaWNlKHRva2VuLmZyb20sIHRva2VuLnRvKSk7XG4gICAgY3Vyc29yID0gdG9rZW4udG87XG4gIH1cblxuICBpZiAoY3Vyc29yIDwgbGluZS5sZW5ndGgpIHtcbiAgICBjb250YWluZXIuYXBwZW5kVGV4dChsaW5lLnNsaWNlKGN1cnNvcikpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRva2VuaXplTGx2bUxpbmUobGluZTogc3RyaW5nKTogTGx2bVRva2VuW10ge1xuICBjb25zdCB0b2tlbnM6IExsdm1Ub2tlbltdID0gW107XG4gIGxldCBpbmRleCA9IDA7XG5cbiAgYWRkTGFiZWxUb2tlbihsaW5lLCB0b2tlbnMpO1xuXG4gIHdoaWxlIChpbmRleCA8IGxpbmUubGVuZ3RoKSB7XG4gICAgY29uc3QgY3VycmVudCA9IGxpbmVbaW5kZXhdO1xuICAgIGlmIChjdXJyZW50ID09PSBcIjtcIikge1xuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IGxpbmUubGVuZ3RoLCBjbGFzc05hbWU6IFwibG9vbS1sbHZtLWNvbW1lbnRcIiB9KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIGlmICgvXFxzLy50ZXN0KGN1cnJlbnQpKSB7XG4gICAgICBpbmRleCArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RyaW5nVG9rZW4gPSByZWFkU3RyaW5nVG9rZW4obGluZSwgaW5kZXgpO1xuICAgIGlmIChzdHJpbmdUb2tlbikge1xuICAgICAgaWYgKHN0cmluZ1Rva2VuLnByZWZpeEVuZCA+IGluZGV4KSB7XG4gICAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiBzdHJpbmdUb2tlbi5wcmVmaXhFbmQsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tc3RyaW5nLXByZWZpeFwiIH0pO1xuICAgICAgfVxuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBzdHJpbmdUb2tlbi52YWx1ZVN0YXJ0LCB0bzogc3RyaW5nVG9rZW4udmFsdWVFbmQsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tc3RyaW5nXCIgfSk7XG4gICAgICBpbmRleCA9IHN0cmluZ1Rva2VuLnZhbHVlRW5kO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbWF0Y2hlZCA9XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9AbGx2bVxcLltBLVphLXokLl8wLTldKy95LCBcImxvb20tbGx2bS1pbnRyaW5zaWNcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvQFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8QFxcZCtcXGIveSwgXCJsb29tLWxsdm0tZ2xvYmFsXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyVbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCVcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWxvY2FsXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyFbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCFcXGQrXFxiL3ksIFwibG9vbS1sbHZtLW1ldGFkYXRhXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1xcJFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSoveSwgXCJsb29tLWxsdm0tY29tZGF0XCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyNcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWF0dHJpYnV0ZS1ncm91cFwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9cXGJhZGRyc3BhY2VcXHMqXFwoXFxzKlxcZCtcXHMqXFwpL3ksIFwibG9vbS1sbHZtLXR5cGVcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8weFswLTlBLUZhLWZdK1xcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8oPzpcXGQrXFwuXFxkKnxcXC5cXGQrfFxcZCspKD86W2VFXVstK10/XFxkKylcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/KD86XFxkK1xcLlxcZCp8XFwuXFxkKylcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/XFxkK1xcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvXFwuXFwuXFwuL3ksIFwibG9vbS1sbHZtLXB1bmN0dWF0aW9uXCIsIHRva2Vucyk7XG5cbiAgICBpZiAobWF0Y2hlZCkge1xuICAgICAgaW5kZXggPSBtYXRjaGVkO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgd29yZCA9IHJlYWRXb3JkKGxpbmUsIGluZGV4KTtcbiAgICBpZiAod29yZCkge1xuICAgICAgdG9rZW5zLnB1c2goe1xuICAgICAgICBmcm9tOiBpbmRleCxcbiAgICAgICAgdG86IHdvcmQuZW5kLFxuICAgICAgICBjbGFzc05hbWU6IGNsYXNzaWZ5V29yZCh3b3JkLnZhbHVlKSxcbiAgICAgIH0pO1xuICAgICAgaW5kZXggPSB3b3JkLmVuZDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChcIigpW117fTw+LDo9KlwiLmluY2x1ZGVzKGN1cnJlbnQpKSB7XG4gICAgICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogaW5kZXggKyAxLCBjbGFzc05hbWU6IFBVTkNUVUFUSU9OX0NMQVNTIH0pO1xuICAgICAgaW5kZXggKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGluZGV4ICs9IDE7XG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplVG9rZW5zKHRva2Vucyk7XG59XG5cbmZ1bmN0aW9uIGFkZExhYmVsVG9rZW4obGluZTogc3RyaW5nLCB0b2tlbnM6IExsdm1Ub2tlbltdKTogdm9pZCB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXihcXHMqKSg/OihbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfFxcZCspfCglW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnwlXFxkKykpKDopLyk7XG4gIGlmICghbWF0Y2ggfHwgbWF0Y2guaW5kZXggPT0gbnVsbCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGxhYmVsU3RhcnQgPSBtYXRjaFsxXS5sZW5ndGg7XG4gIGNvbnN0IGxhYmVsVGV4dCA9IG1hdGNoWzJdID8/IG1hdGNoWzNdO1xuICBpZiAoIWxhYmVsVGV4dCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRva2Vucy5wdXNoKHtcbiAgICBmcm9tOiBsYWJlbFN0YXJ0LFxuICAgIHRvOiBsYWJlbFN0YXJ0ICsgbGFiZWxUZXh0Lmxlbmd0aCxcbiAgICBjbGFzc05hbWU6IFwibG9vbS1sbHZtLWxhYmVsXCIsXG4gIH0pO1xuICB0b2tlbnMucHVzaCh7XG4gICAgZnJvbTogbGFiZWxTdGFydCArIGxhYmVsVGV4dC5sZW5ndGgsXG4gICAgdG86IGxhYmVsU3RhcnQgKyBsYWJlbFRleHQubGVuZ3RoICsgMSxcbiAgICBjbGFzc05hbWU6IFBVTkNUVUFUSU9OX0NMQVNTLFxuICB9KTtcbn1cblxuZnVuY3Rpb24gY2xhc3NpZnlXb3JkKHdvcmQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICgvXmlcXGQrJC8udGVzdCh3b3JkKSB8fCBMTFZNX1BSSU1JVElWRV9UWVBFUy5oYXMod29yZCkpIHtcbiAgICByZXR1cm4gXCJsb29tLWxsdm0tdHlwZVwiO1xuICB9XG5cbiAgcmV0dXJuIExMVk1fS0VZV09SRFMuZ2V0KHdvcmQpID8/IFwibG9vbS1sbHZtLXBsYWluXCI7XG59XG5cbmZ1bmN0aW9uIHJlYWRXb3JkKGxpbmU6IHN0cmluZywgaW5kZXg6IG51bWJlcik6IHsgdmFsdWU6IHN0cmluZzsgZW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBjb25zdCBtYXRjaCA9IC9bQS1aYS16X11bQS1aYS16MC05Xy4tXSoveTtcbiAgbWF0Y2gubGFzdEluZGV4ID0gaW5kZXg7XG4gIGNvbnN0IHJlc3VsdCA9IG1hdGNoLmV4ZWMobGluZSk7XG4gIGlmICghcmVzdWx0KSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHZhbHVlOiByZXN1bHRbMF0sXG4gICAgZW5kOiBtYXRjaC5sYXN0SW5kZXgsXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlYWRTdHJpbmdUb2tlbihsaW5lOiBzdHJpbmcsIGluZGV4OiBudW1iZXIpOiB7IHByZWZpeEVuZDogbnVtYmVyOyB2YWx1ZVN0YXJ0OiBudW1iZXI7IHZhbHVlRW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBsZXQgY3Vyc29yID0gaW5kZXg7XG4gIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiY1wiICYmIGxpbmVbY3Vyc29yICsgMV0gPT09IFwiXFxcIlwiKSB7XG4gICAgY3Vyc29yICs9IDE7XG4gIH1cblxuICBpZiAobGluZVtjdXJzb3JdICE9PSBcIlxcXCJcIikge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgdmFsdWVTdGFydCA9IGN1cnNvcjtcbiAgY3Vyc29yICs9IDE7XG4gIHdoaWxlIChjdXJzb3IgPCBsaW5lLmxlbmd0aCkge1xuICAgIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiXFxcXFwiKSB7XG4gICAgICBjdXJzb3IgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZVtjdXJzb3JdID09PSBcIlxcXCJcIikge1xuICAgICAgY3Vyc29yICs9IDE7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY3Vyc29yICs9IDE7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHByZWZpeEVuZDogdmFsdWVTdGFydCxcbiAgICB2YWx1ZVN0YXJ0LFxuICAgIHZhbHVlRW5kOiBjdXJzb3IsXG4gIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoUmVnZXhUb2tlbihcbiAgbGluZTogc3RyaW5nLFxuICBpbmRleDogbnVtYmVyLFxuICByZWdleDogUmVnRXhwLFxuICBjbGFzc05hbWU6IHN0cmluZyxcbiAgdG9rZW5zOiBMbHZtVG9rZW5bXSxcbik6IG51bWJlciB8IG51bGwge1xuICByZWdleC5sYXN0SW5kZXggPSBpbmRleDtcbiAgY29uc3QgbWF0Y2ggPSByZWdleC5leGVjKGxpbmUpO1xuICBpZiAoIW1hdGNoKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogcmVnZXgubGFzdEluZGV4LCBjbGFzc05hbWUgfSk7XG4gIHJldHVybiByZWdleC5sYXN0SW5kZXg7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVRva2Vucyh0b2tlbnM6IExsdm1Ub2tlbltdKTogTGx2bVRva2VuW10ge1xuICB0b2tlbnMuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuZnJvbSAtIHJpZ2h0LmZyb20gfHwgbGVmdC50byAtIHJpZ2h0LnRvKTtcbiAgY29uc3Qgbm9ybWFsaXplZDogTGx2bVRva2VuW10gPSBbXTtcbiAgbGV0IGN1cnNvciA9IDA7XG5cbiAgZm9yIChjb25zdCB0b2tlbiBvZiB0b2tlbnMpIHtcbiAgICBpZiAodG9rZW4udG8gPD0gY3Vyc29yKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBmcm9tID0gTWF0aC5tYXgodG9rZW4uZnJvbSwgY3Vyc29yKTtcbiAgICBub3JtYWxpemVkLnB1c2goeyAuLi50b2tlbiwgZnJvbSB9KTtcbiAgICBjdXJzb3IgPSB0b2tlbi50bztcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkO1xufVxuXG5mdW5jdGlvbiBnZXRDb250ZW50TGluZUNvdW50KGJsb2NrOiBsb29tQ29kZUJsb2NrKTogbnVtYmVyIHtcbiAgaWYgKGJsb2NrLmVuZExpbmUgPT09IGJsb2NrLnN0YXJ0TGluZSkge1xuICAgIHJldHVybiAwO1xuICB9XG5cbiAgaWYgKGJsb2NrLmNvbnRlbnQubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIGJsb2NrLmVuZExpbmUgPiBibG9jay5zdGFydExpbmUgKyAxID8gMSA6IDA7XG4gIH1cblxuICByZXR1cm4gYmxvY2suY29udGVudC5zcGxpdChcIlxcblwiKS5sZW5ndGg7XG59XG5cbmZ1bmN0aW9uIG1hcFdvcmRzKGNsYXNzTmFtZTogc3RyaW5nLCB3b3Jkczogc3RyaW5nW10pOiBBcnJheTxbc3RyaW5nLCBzdHJpbmddPiB7XG4gIHJldHVybiB3b3Jkcy5tYXAoKHdvcmQpID0+IFt3b3JkLCBjbGFzc05hbWVdKTtcbn1cbiIsICJpbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSBcImNyeXB0b1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gc2hvcnRIYXNoKGlucHV0OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUoaW5wdXQpLmRpZ2VzdChcImhleFwiKS5zbGljZSgwLCAxNik7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21MYW5ndWFnZURlZmluaXRpb24ge1xuICBpZDogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZTtcbiAgZGlzcGxheU5hbWU6IHN0cmluZztcbiAgYWxpYXNlczogc3RyaW5nW107XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbUxhbmd1YWdlUGFja2FnZSB7XG4gIGlkOiBzdHJpbmc7XG4gIGRpc3BsYXlOYW1lOiBzdHJpbmc7XG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG4gIGxhbmd1YWdlczogbG9vbUxhbmd1YWdlRGVmaW5pdGlvbltdO1xufVxuXG5leHBvcnQgY29uc3QgQlVJTFRfSU5fTEFOR1VBR0VfUEFDS0FHRVM6IGxvb21MYW5ndWFnZVBhY2thZ2VbXSA9IFtcbiAge1xuICAgIGlkOiBcImludGVycHJldGVkXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiSW50ZXJwcmV0ZWRcIixcbiAgICBkZXNjcmlwdGlvbjogXCJTY3JpcHQgYW5kIFJFUEwtb3JpZW50ZWQgbGFuZ3VhZ2VzIGZvciBvcGVyYXRpb25hbCBub3RlcyBhbmQgcXVpY2sgZXhwZXJpbWVudHMuXCIsXG4gICAgbGFuZ3VhZ2VzOiBbXG4gICAgICB7IGlkOiBcInB5dGhvblwiLCBkaXNwbGF5TmFtZTogXCJQeXRob25cIiwgYWxpYXNlczogW1wicHl0aG9uXCIsIFwicHlcIl0gfSxcbiAgICAgIHsgaWQ6IFwiamF2YXNjcmlwdFwiLCBkaXNwbGF5TmFtZTogXCJKYXZhU2NyaXB0XCIsIGFsaWFzZXM6IFtcImphdmFzY3JpcHRcIiwgXCJqc1wiXSB9LFxuICAgICAgeyBpZDogXCJ0eXBlc2NyaXB0XCIsIGRpc3BsYXlOYW1lOiBcIlR5cGVTY3JpcHRcIiwgYWxpYXNlczogW1widHlwZXNjcmlwdFwiLCBcInRzXCJdIH0sXG4gICAgICB7IGlkOiBcInNoZWxsXCIsIGRpc3BsYXlOYW1lOiBcIlNoZWxsXCIsIGFsaWFzZXM6IFtcInNoZWxsXCIsIFwic2hcIiwgXCJiYXNoXCIsIFwienNoXCJdIH0sXG4gICAgICB7IGlkOiBcInJ1YnlcIiwgZGlzcGxheU5hbWU6IFwiUnVieVwiLCBhbGlhc2VzOiBbXCJydWJ5XCIsIFwicmJcIl0gfSxcbiAgICAgIHsgaWQ6IFwicGVybFwiLCBkaXNwbGF5TmFtZTogXCJQZXJsXCIsIGFsaWFzZXM6IFtcInBlcmxcIiwgXCJwbFwiXSB9LFxuICAgICAgeyBpZDogXCJsdWFcIiwgZGlzcGxheU5hbWU6IFwiTHVhXCIsIGFsaWFzZXM6IFtcImx1YVwiXSB9LFxuICAgICAgeyBpZDogXCJwaHBcIiwgZGlzcGxheU5hbWU6IFwiUEhQXCIsIGFsaWFzZXM6IFtcInBocFwiXSB9LFxuICAgICAgeyBpZDogXCJnb1wiLCBkaXNwbGF5TmFtZTogXCJHb1wiLCBhbGlhc2VzOiBbXCJnb1wiLCBcImdvbGFuZ1wiXSB9LFxuICAgICAgeyBpZDogXCJoYXNrZWxsXCIsIGRpc3BsYXlOYW1lOiBcIkhhc2tlbGxcIiwgYWxpYXNlczogW1wiaGFza2VsbFwiLCBcImhzXCJdIH0sXG4gICAgICB7IGlkOiBcIm9jYW1sXCIsIGRpc3BsYXlOYW1lOiBcIk9DYW1sXCIsIGFsaWFzZXM6IFtcIm9jYW1sXCIsIFwibWxcIl0gfSxcbiAgICBdLFxuICB9LFxuICB7XG4gICAgaWQ6IFwibmF0aXZlLWNvbXBpbGVkXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiTmF0aXZlIENvbXBpbGVkXCIsXG4gICAgZGVzY3JpcHRpb246IFwiTGFuZ3VhZ2VzIGNvbXBpbGVkIGludG8gbmF0aXZlIGJpbmFyaWVzIGJ5IGxvY2FsIHRvb2xjaGFpbnMuXCIsXG4gICAgbGFuZ3VhZ2VzOiBbXG4gICAgICB7IGlkOiBcImNcIiwgZGlzcGxheU5hbWU6IFwiQ1wiLCBhbGlhc2VzOiBbXCJjXCIsIFwiaFwiXSB9LFxuICAgICAgeyBpZDogXCJjcHBcIiwgZGlzcGxheU5hbWU6IFwiQysrXCIsIGFsaWFzZXM6IFtcImNwcFwiLCBcImN4eFwiLCBcImNjXCIsIFwiYysrXCJdIH0sXG4gICAgXSxcbiAgfSxcbiAge1xuICAgIGlkOiBcIm1hbmFnZWQtY29tcGlsZWRcIixcbiAgICBkaXNwbGF5TmFtZTogXCJNYW5hZ2VkIENvbXBpbGVkXCIsXG4gICAgZGVzY3JpcHRpb246IFwiQ29tcGlsZWQgbGFuZ3VhZ2VzIHdpdGggbWFuYWdlZCBydW50aW1lcyBvciBzdHJ1Y3R1cmVkIGJ1aWxkL3J1biBwaGFzZXMuXCIsXG4gICAgbGFuZ3VhZ2VzOiBbXG4gICAgICB7IGlkOiBcInJ1c3RcIiwgZGlzcGxheU5hbWU6IFwiUnVzdFwiLCBhbGlhc2VzOiBbXCJydXN0XCIsIFwicnNcIl0gfSxcbiAgICAgIHsgaWQ6IFwiamF2YVwiLCBkaXNwbGF5TmFtZTogXCJKYXZhXCIsIGFsaWFzZXM6IFtcImphdmFcIl0gfSxcbiAgICBdLFxuICB9LFxuICB7XG4gICAgaWQ6IFwicHJvb2ZzXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiUHJvb2ZzXCIsXG4gICAgZGVzY3JpcHRpb246IFwiUHJvb2YgYXNzaXN0YW50cyBhbmQgc29sdmVyLW9yaWVudGVkIGxhbmd1YWdlcy5cIixcbiAgICBsYW5ndWFnZXM6IFtcbiAgICAgIHsgaWQ6IFwibGVhblwiLCBkaXNwbGF5TmFtZTogXCJMZWFuXCIsIGFsaWFzZXM6IFtcImxlYW5cIiwgXCJsZWFuNFwiXSB9LFxuICAgICAgeyBpZDogXCJjb3FcIiwgZGlzcGxheU5hbWU6IFwiQ29xXCIsIGFsaWFzZXM6IFtcImNvcVwiLCBcInZcIl0gfSxcbiAgICAgIHsgaWQ6IFwic210bGliXCIsIGRpc3BsYXlOYW1lOiBcIlNNVC1MSUJcIiwgYWxpYXNlczogW1wic210XCIsIFwic210MlwiLCBcInNtdGxpYlwiLCBcInNtdC1saWJcIiwgXCJ6M1wiXSB9LFxuICAgIF0sXG4gIH0sXG4gIHtcbiAgICBpZDogXCJsbHZtXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiTExWTVwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkxMVk0gSVIgdG9vbGluZyBmb3IgY29tcGlsZXIgYW5kIFBMIHJlc2VhcmNoIHZhdWx0cy5cIixcbiAgICBsYW5ndWFnZXM6IFtcbiAgICAgIHsgaWQ6IFwibGx2bS1pclwiLCBkaXNwbGF5TmFtZTogXCJMTFZNIElSXCIsIGFsaWFzZXM6IFtcImxsdm1cIiwgXCJsbHZtaXJcIiwgXCJsbHZtLWlyXCIsIFwibGxcIl0gfSxcbiAgICBdLFxuICB9LFxuICB7XG4gICAgaWQ6IFwiZWJwZlwiLFxuICAgIGRpc3BsYXlOYW1lOiBcImVCUEZcIixcbiAgICBkZXNjcmlwdGlvbjogXCJLZXJuZWwgaW5zdHJ1bWVudGF0aW9uIGxhbmd1YWdlcyBmb3IgQlBGIG9iamVjdCBjb21waWxhdGlvbiwgdmVyaWZpZXIgY2hlY2tzLCBhbmQgYnBmdHJhY2Ugc2NyaXB0cy5cIixcbiAgICBsYW5ndWFnZXM6IFtcbiAgICAgIHsgaWQ6IFwiZWJwZi1jXCIsIGRpc3BsYXlOYW1lOiBcImVCUEYgQ1wiLCBhbGlhc2VzOiBbXCJlYnBmXCIsIFwiZWJwZi1jXCIsIFwiYnBmLWNcIiwgXCJicGZcIl0gfSxcbiAgICAgIHsgaWQ6IFwiYnBmdHJhY2VcIiwgZGlzcGxheU5hbWU6IFwiYnBmdHJhY2VcIiwgYWxpYXNlczogW1wiYnBmdHJhY2VcIiwgXCJidFwiXSB9LFxuICAgIF0sXG4gIH0sXG5dO1xuXG5leHBvcnQgY29uc3QgQ1VTVE9NX0xBTkdVQUdFX1BBQ0tBR0VfSUQgPSBcImN1c3RvbVwiO1xuZXhwb3J0IGNvbnN0IExBTkdVQUdFX0NPTkZJR1VSQVRJT05fVkVSU0lPTiA9IDI7XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXREZWZhdWx0TGFuZ3VhZ2VQYWNrSWRzKCk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIFsuLi5CVUlMVF9JTl9MQU5HVUFHRV9QQUNLQUdFUy5tYXAoKHBhY2spID0+IHBhY2suaWQpLCBDVVNUT01fTEFOR1VBR0VfUEFDS0FHRV9JRF07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXREZWZhdWx0TGFuZ3VhZ2VJZHMoKTogc3RyaW5nW10ge1xuICByZXR1cm4gQlVJTFRfSU5fTEFOR1VBR0VfUEFDS0FHRVMuZmxhdE1hcCgocGFjaykgPT4gcGFjay5sYW5ndWFnZXMubWFwKChsYW5ndWFnZSkgPT4gbGFuZ3VhZ2UuaWQpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUxhbmd1YWdlQ29uZmlndXJhdGlvbihzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogdm9pZCB7XG4gIGlmICghQXJyYXkuaXNBcnJheShzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcykgfHwgIXNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLmxlbmd0aCkge1xuICAgIHNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzID0gZ2V0RGVmYXVsdExhbmd1YWdlUGFja0lkcygpO1xuICB9XG4gIGlmICghQXJyYXkuaXNBcnJheShzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VzKSB8fCAhc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcy5sZW5ndGgpIHtcbiAgICBzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VzID0gZ2V0RGVmYXVsdExhbmd1YWdlSWRzKCk7XG4gIH1cbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoc2V0dGluZ3MubGFuZ3VhZ2VDb25maWd1cmF0aW9uVmVyc2lvbikpIHtcbiAgICBzZXR0aW5ncy5sYW5ndWFnZUNvbmZpZ3VyYXRpb25WZXJzaW9uID0gMTtcbiAgfVxuICBpZiAoc2V0dGluZ3MubGFuZ3VhZ2VDb25maWd1cmF0aW9uVmVyc2lvbiA8IDIpIHtcbiAgICBlbmFibGVMYW5ndWFnZVBhY2thZ2Uoc2V0dGluZ3MsIFwiZWJwZlwiKTtcbiAgICBzZXR0aW5ncy5sYW5ndWFnZUNvbmZpZ3VyYXRpb25WZXJzaW9uID0gTEFOR1VBR0VfQ09ORklHVVJBVElPTl9WRVJTSU9OO1xuICB9XG59XG5cbmZ1bmN0aW9uIGVuYWJsZUxhbmd1YWdlUGFja2FnZShzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLCBwYWNrYWdlSWQ6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCBwYWNrID0gQlVJTFRfSU5fTEFOR1VBR0VfUEFDS0FHRVMuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuaWQgPT09IHBhY2thZ2VJZCk7XG4gIGlmICghcGFjaykge1xuICAgIHJldHVybjtcbiAgfVxuICBhcHBlbmRVbmlxdWUoc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MsIHBhY2suaWQpO1xuICBmb3IgKGNvbnN0IGxhbmd1YWdlIG9mIHBhY2subGFuZ3VhZ2VzKSB7XG4gICAgYXBwZW5kVW5pcXVlKHNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMsIGxhbmd1YWdlLmlkKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBlbmRVbmlxdWUodmFsdWVzOiBzdHJpbmdbXSwgdmFsdWU6IHN0cmluZyk6IHZvaWQge1xuICBpZiAoIXZhbHVlcy5pbmNsdWRlcyh2YWx1ZSkpIHtcbiAgICB2YWx1ZXMucHVzaCh2YWx1ZSk7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEVuYWJsZWRMYW5ndWFnZURlZmluaXRpb25zKHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tTGFuZ3VhZ2VEZWZpbml0aW9uW10ge1xuICBub3JtYWxpemVMYW5ndWFnZUNvbmZpZ3VyYXRpb24oc2V0dGluZ3MpO1xuICBjb25zdCBlbmFibGVkUGFja3MgPSBuZXcgU2V0KHNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzKTtcbiAgY29uc3QgZW5hYmxlZExhbmd1YWdlcyA9IG5ldyBTZXQoc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcyk7XG5cbiAgcmV0dXJuIEJVSUxUX0lOX0xBTkdVQUdFX1BBQ0tBR0VTXG4gICAgLmZpbHRlcigocGFjaykgPT4gZW5hYmxlZFBhY2tzLmhhcyhwYWNrLmlkKSlcbiAgICAuZmxhdE1hcCgocGFjaykgPT4gcGFjay5sYW5ndWFnZXMpXG4gICAgLmZpbHRlcigobGFuZ3VhZ2UpID0+IGVuYWJsZWRMYW5ndWFnZXMuaGFzKGxhbmd1YWdlLmlkKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRFbmFibGVkTGFuZ3VhZ2VBbGlhc01hcChzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUmVjb3JkPHN0cmluZywgbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZT4ge1xuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIGdldEVuYWJsZWRMYW5ndWFnZURlZmluaXRpb25zKHNldHRpbmdzKS5mbGF0TWFwKChsYW5ndWFnZSkgPT5cbiAgICAgIGxhbmd1YWdlLmFsaWFzZXMubWFwKChhbGlhcykgPT4gW2FsaWFzLnRvTG93ZXJDYXNlKCksIGxhbmd1YWdlLmlkXSBhcyBjb25zdCksXG4gICAgKSxcbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzTGFuZ3VhZ2VFbmFibGVkKGxhbmd1YWdlSWQ6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uKHNldHRpbmdzKTtcbiAgcmV0dXJuIGdldEVuYWJsZWRMYW5ndWFnZURlZmluaXRpb25zKHNldHRpbmdzKS5zb21lKChsYW5ndWFnZSkgPT4gbGFuZ3VhZ2UuaWQgPT09IGxhbmd1YWdlSWQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXJlQ3VzdG9tTGFuZ3VhZ2VzRW5hYmxlZChzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gIG5vcm1hbGl6ZUxhbmd1YWdlQ29uZmlndXJhdGlvbihzZXR0aW5ncyk7XG4gIHJldHVybiBzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcy5pbmNsdWRlcyhDVVNUT01fTEFOR1VBR0VfUEFDS0FHRV9JRCk7XG59XG4iLCAiaW1wb3J0IHsgc2hvcnRIYXNoIH0gZnJvbSBcIi4vdXRpbHMvaGFzaFwiO1xuaW1wb3J0IHsgYXJlQ3VzdG9tTGFuZ3VhZ2VzRW5hYmxlZCwgZ2V0RW5hYmxlZExhbmd1YWdlQWxpYXNNYXAgfSBmcm9tIFwiLi9sYW5ndWFnZVBhY2thZ2VzXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVNvdXJjZVJlZmVyZW5jZSB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmNvbnN0IE9VVFBVVF9TVEFSVCA9IC9ePCEtLVxccypsb29tOm91dHB1dDpzdGFydFxccytpZD0oW2EtZjAtOV0rKVxccyotLT4kL2k7XG5jb25zdCBPVVRQVVRfRU5EID0gL148IS0tXFxzKmxvb206b3V0cHV0OmVuZFxccyotLT4kL2k7XG5jb25zdCBGRU5DRV9TVEFSVCA9IC9eKGBgYCt8fn5+KylcXHMqKFteXFxzYF0qKT8oLiopJC87XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVMYW5ndWFnZShyYXdMYW5ndWFnZTogc3RyaW5nLCBzZXR0aW5ncz86IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UgfCBudWxsIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IHJhd0xhbmd1YWdlLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuXG4gIGlmICghc2V0dGluZ3MpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGlmIChhcmVDdXN0b21MYW5ndWFnZXNFbmFibGVkKHNldHRpbmdzKSkge1xuICAgIGZvciAoY29uc3QgbGFuZ3VhZ2Ugb2Ygc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzID8/IFtdKSB7XG4gICAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGFsaWFzZXMgPSBwYXJzZUFsaWFzTGlzdChsYW5ndWFnZS5hbGlhc2VzKTtcbiAgICAgIGlmIChuYW1lICYmIChuYW1lID09PSBub3JtYWxpemVkIHx8IGFsaWFzZXMuaW5jbHVkZXMobm9ybWFsaXplZCkpKSB7XG4gICAgICAgIHJldHVybiBsYW5ndWFnZS5uYW1lLnRyaW0oKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb25zdCBhbGlhc2VzID0gZ2V0RW5hYmxlZExhbmd1YWdlQWxpYXNNYXAoc2V0dGluZ3MpO1xuICByZXR1cm4gYWxpYXNlc1tub3JtYWxpemVkXSA/PyBudWxsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0U3VwcG9ydGVkTGFuZ3VhZ2VBbGlhc2VzKHNldHRpbmdzPzogbG9vbVBsdWdpblNldHRpbmdzKTogc3RyaW5nW10ge1xuICBpZiAoIXNldHRpbmdzKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgY29uc3QgY3VzdG9tQWxpYXNlcyA9IGFyZUN1c3RvbUxhbmd1YWdlc0VuYWJsZWQoc2V0dGluZ3MpXG4gICAgPyAoc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzID8/IFtdKS5mbGF0TWFwKChsYW5ndWFnZSkgPT4ge1xuICAgIGNvbnN0IG5hbWUgPSBsYW5ndWFnZS5uYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgcmV0dXJuIFtuYW1lLCAuLi5wYXJzZUFsaWFzTGlzdChsYW5ndWFnZS5hbGlhc2VzKV07XG4gICAgfSlcbiAgICA6IFtdO1xuXG4gIHJldHVybiBbXG4gICAgLi4uT2JqZWN0LmtleXMoZ2V0RW5hYmxlZExhbmd1YWdlQWxpYXNNYXAoc2V0dGluZ3MpKSxcbiAgICAuLi5jdXN0b21BbGlhc2VzLFxuICBdLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRvTG93ZXJDYXNlKCkpLmZpbHRlcihCb29sZWFuKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGVQYXRoOiBzdHJpbmcsIHNvdXJjZTogc3RyaW5nLCBzZXR0aW5ncz86IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21Db2RlQmxvY2tbXSB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KC9cXHI/XFxuLyk7XG4gIGNvbnN0IGJsb2NrczogbG9vbUNvZGVCbG9ja1tdID0gW107XG4gIGxldCBvcmRpbmFsID0gMDtcbiAgbGV0IGluc2lkZU1hbmFnZWRPdXRwdXQgPSBmYWxzZTtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2ldO1xuXG4gICAgaWYgKGluc2lkZU1hbmFnZWRPdXRwdXQpIHtcbiAgICAgIGlmIChPVVRQVVRfRU5ELnRlc3QobGluZS50cmltKCkpKSB7XG4gICAgICAgIGluc2lkZU1hbmFnZWRPdXRwdXQgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChPVVRQVVRfU1RBUlQudGVzdChsaW5lLnRyaW0oKSkpIHtcbiAgICAgIGluc2lkZU1hbmFnZWRPdXRwdXQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZmVuY2VNYXRjaCA9IGxpbmUubWF0Y2goRkVOQ0VfU1RBUlQpO1xuICAgIGlmICghZmVuY2VNYXRjaCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RhcnRMaW5lID0gaTtcbiAgICBjb25zdCBmZW5jZUluZGVudCA9IGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmUpO1xuICAgIGNvbnN0IGZlbmNlVG9rZW4gPSBmZW5jZU1hdGNoWzFdO1xuICAgIGNvbnN0IHNvdXJjZUxhbmd1YWdlID0gKGZlbmNlTWF0Y2hbMl0gPz8gXCJcIikudHJpbSgpO1xuICAgIGNvbnN0IGluZm9BdHRyaWJ1dGVzID0gcGFyc2VJbmZvQXR0cmlidXRlcyhmZW5jZU1hdGNoWzNdID8/IFwiXCIpO1xuICAgIGNvbnN0IHNvdXJjZVJlZmVyZW5jZSA9IHBhcnNlU291cmNlUmVmZXJlbmNlKGluZm9BdHRyaWJ1dGVzKTtcbiAgICBjb25zdCBleGVjdXRpb25Db250ZXh0ID0gcGFyc2VFeGVjdXRpb25Db250ZXh0KGluZm9BdHRyaWJ1dGVzKTtcbiAgICBjb25zdCBsYW5ndWFnZSA9IG5vcm1hbGl6ZUxhbmd1YWdlKHNvdXJjZUxhbmd1YWdlLCBzZXR0aW5ncyk7XG5cbiAgICBsZXQgZW5kTGluZSA9IGk7XG4gICAgY29uc3QgY29udGVudExpbmVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgZm9yIChsZXQgaiA9IGkgKyAxOyBqIDwgbGluZXMubGVuZ3RoOyBqICs9IDEpIHtcbiAgICAgIGNvbnN0IGlubmVyTGluZSA9IGxpbmVzW2pdO1xuICAgICAgY29uc3QgdHJpbW1lZCA9IGlubmVyTGluZS50cmltKCk7XG5cbiAgICAgIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoZmVuY2VUb2tlbikgJiYgL14oYGBgK3x+fn4rKVxccyokLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgICAgIGVuZExpbmUgPSBqO1xuICAgICAgICBpID0gajtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNvbnRlbnRMaW5lcy5wdXNoKHN0cmlwRmVuY2VJbmRlbnQoaW5uZXJMaW5lLCBmZW5jZUluZGVudCkpO1xuICAgICAgZW5kTGluZSA9IGo7XG4gICAgfVxuXG4gICAgaWYgKCFsYW5ndWFnZSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgb3JkaW5hbCArPSAxO1xuICAgIGNvbnN0IGNvbnRlbnQgPSBjb250ZW50TGluZXMuam9pbihcIlxcblwiKTtcbiAgICBjb25zdCByZWZlcmVuY2VIYXNoID0gc291cmNlUmVmZXJlbmNlID8gYDoke0pTT04uc3RyaW5naWZ5KHNvdXJjZVJlZmVyZW5jZSl9YCA6IFwiXCI7XG4gICAgY29uc3QgZXhlY3V0aW9uSGFzaCA9IGV4ZWN1dGlvbkNvbnRleHRIYXNWYWx1ZXMoZXhlY3V0aW9uQ29udGV4dCkgPyBgOiR7SlNPTi5zdHJpbmdpZnkoZXhlY3V0aW9uQ29udGV4dCl9YCA6IFwiXCI7XG4gICAgY29uc3QgYXR0cmlidXRlSGFzaCA9IE9iamVjdC5rZXlzKGluZm9BdHRyaWJ1dGVzKS5sZW5ndGggPyBgOiR7SlNPTi5zdHJpbmdpZnkoaW5mb0F0dHJpYnV0ZXMpfWAgOiBcIlwiO1xuICAgIGNvbnN0IGNvbnRlbnRIYXNoID0gc2hvcnRIYXNoKGAke2NvbnRlbnR9JHtyZWZlcmVuY2VIYXNofSR7ZXhlY3V0aW9uSGFzaH0ke2F0dHJpYnV0ZUhhc2h9YCk7XG4gICAgY29uc3QgaWQgPSBzaG9ydEhhc2goYCR7ZmlsZVBhdGh9OiR7b3JkaW5hbH06JHtsYW5ndWFnZX06JHtjb250ZW50SGFzaH1gKTtcblxuICAgIGJsb2Nrcy5wdXNoKHtcbiAgICAgIGlkLFxuICAgICAgb3JkaW5hbCxcbiAgICAgIGZpbGVQYXRoLFxuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBsYW5ndWFnZUFsaWFzOiBzb3VyY2VMYW5ndWFnZS50b0xvd2VyQ2FzZSgpLFxuICAgICAgc291cmNlTGFuZ3VhZ2UsXG4gICAgICBjb250ZW50LFxuICAgICAgYXR0cmlidXRlczogaW5mb0F0dHJpYnV0ZXMsXG4gICAgICBzb3VyY2VSZWZlcmVuY2UsXG4gICAgICBleGVjdXRpb25Db250ZXh0LFxuICAgICAgc3RhcnRMaW5lLFxuICAgICAgZW5kTGluZSxcbiAgICAgIGZlbmNlU3RhcnQ6IDAsXG4gICAgICBmZW5jZUVuZDogMCxcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBibG9ja3M7XG59XG5cbmZ1bmN0aW9uIGV4ZWN1dGlvbkNvbnRleHRIYXNWYWx1ZXMoY29udGV4dDogUmV0dXJuVHlwZTx0eXBlb2YgcGFyc2VFeGVjdXRpb25Db250ZXh0Pik6IGJvb2xlYW4ge1xuICByZXR1cm4gQm9vbGVhbihjb250ZXh0LmNvbnRhaW5lckdyb3VwIHx8IGNvbnRleHQuZGlzYWJsZUNvbnRhaW5lciB8fCBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnkgfHwgY29udGV4dC50aW1lb3V0TXMpO1xufVxuXG5mdW5jdGlvbiBwYXJzZUFsaWFzTGlzdCh2YWx1ZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gdmFsdWVcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG59XG5cbmZ1bmN0aW9uIHBhcnNlU291cmNlUmVmZXJlbmNlKGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogbG9vbVNvdXJjZVJlZmVyZW5jZSB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IGZpbGVQYXRoID0gYXR0cnNbXCJsb29tLWZpbGVcIl0gPz8gYXR0cnMuZmlsZSA/PyBhdHRycy5zcmMgPz8gYXR0cnMuc291cmNlO1xuICBpZiAoIWZpbGVQYXRoKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGNvbnN0IGxpbmVzID0gYXR0cnNbXCJsb29tLWxpbmVzXCJdID8/IGF0dHJzLmxpbmVzID8/IGF0dHJzLmxpbmU7XG4gIGNvbnN0IGxpbmVSYW5nZSA9IGxpbmVzID8gcGFyc2VMaW5lUmFuZ2UobGluZXMpIDogbnVsbDtcbiAgY29uc3Qgc3ltYm9sTmFtZSA9IGF0dHJzW1wibG9vbS1zeW1ib2xcIl0gPz8gYXR0cnMuc3ltYm9sID8/IGF0dHJzLmZuID8/IGF0dHJzLmZ1bmN0aW9uO1xuICBjb25zdCB0cmFjZVZhbHVlID0gYXR0cnNbXCJsb29tLWRlcHNcIl0gPz8gYXR0cnMuZGVwcyA/PyBhdHRycy50cmFjZTtcbiAgY29uc3QgY2FsbEV4cHJlc3Npb24gPSBhdHRyc1tcImxvb20tY2FsbFwiXSA/PyBhdHRycy5jYWxsO1xuICBjb25zdCBjYWxsQXJncyA9IGF0dHJzW1wibG9vbS1hcmdzXCJdID8/IGF0dHJzLmFyZ3M7XG4gIGNvbnN0IHByaW50VmFsdWUgPSBhdHRyc1tcImxvb20tcHJpbnRcIl0gPz8gYXR0cnMucHJpbnQ7XG4gIGNvbnN0IGNhbGwgPSBjYWxsRXhwcmVzc2lvbiAhPSBudWxsIHx8IGNhbGxBcmdzICE9IG51bGxcbiAgICA/IHtcbiAgICAgIGV4cHJlc3Npb246IG5vcm1hbGl6ZUJvb2xlYW5BdHRyaWJ1dGUoY2FsbEV4cHJlc3Npb24pID09PSBcInRydWVcIiA/IHVuZGVmaW5lZCA6IGNhbGxFeHByZXNzaW9uLFxuICAgICAgYXJnczogY2FsbEFyZ3MsXG4gICAgICBwcmludDogcHJpbnRWYWx1ZSA9PSBudWxsID8gdHJ1ZSA6ICFbXCIwXCIsIFwiZmFsc2VcIiwgXCJub1wiLCBcIm9mZlwiXS5pbmNsdWRlcyhwcmludFZhbHVlLnRvTG93ZXJDYXNlKCkpLFxuICAgIH1cbiAgICA6IHVuZGVmaW5lZDtcblxuICByZXR1cm4ge1xuICAgIGZpbGVQYXRoLFxuICAgIGxpbmVTdGFydDogbGluZVJhbmdlPy5zdGFydCxcbiAgICBsaW5lRW5kOiBsaW5lUmFuZ2U/LmVuZCxcbiAgICBzeW1ib2xOYW1lLFxuICAgIHRyYWNlRGVwZW5kZW5jaWVzOiB0cmFjZVZhbHVlID09IG51bGwgPyB0cnVlIDogIVtcIjBcIiwgXCJmYWxzZVwiLCBcIm5vXCIsIFwib2ZmXCJdLmluY2x1ZGVzKHRyYWNlVmFsdWUudG9Mb3dlckNhc2UoKSksXG4gICAgY2FsbCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcGFyc2VFeGVjdXRpb25Db250ZXh0KGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KSB7XG4gIGNvbnN0IGNvbnRhaW5lciA9IGF0dHJzW1wibG9vbS1jb250YWluZXJcIl0gPz8gYXR0cnMuY29udGFpbmVyO1xuICBjb25zdCB0aW1lb3V0ID0gYXR0cnNbXCJsb29tLXRpbWVvdXRcIl0gPz8gYXR0cnMudGltZW91dDtcbiAgY29uc3Qgd29ya2luZ0RpcmVjdG9yeSA9IGF0dHJzW1wibG9vbS1jd2RcIl0gPz8gYXR0cnMuY3dkID8/IGF0dHJzW1wid29ya2luZy1kaXJlY3RvcnlcIl07XG4gIGNvbnN0IHRpbWVvdXRNcyA9IHRpbWVvdXQgPyBwYXJzZVBvc2l0aXZlSW50ZWdlcih0aW1lb3V0KSA6IHVuZGVmaW5lZDtcblxuICByZXR1cm4ge1xuICAgIGNvbnRhaW5lckdyb3VwOiBjb250YWluZXIgJiYgIWlzRGlzYWJsZWRWYWx1ZShjb250YWluZXIpID8gY29udGFpbmVyIDogdW5kZWZpbmVkLFxuICAgIGRpc2FibGVDb250YWluZXI6IGNvbnRhaW5lciA/IGlzRGlzYWJsZWRWYWx1ZShjb250YWluZXIpIDogdW5kZWZpbmVkLFxuICAgIHdvcmtpbmdEaXJlY3RvcnksXG4gICAgdGltZW91dE1zLFxuICB9O1xufVxuXG5mdW5jdGlvbiBwYXJzZVBvc2l0aXZlSW50ZWdlcih2YWx1ZTogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgcGFyc2VkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLnRyaW0oKSwgMTApO1xuICByZXR1cm4gTnVtYmVyLmlzSW50ZWdlcihwYXJzZWQpICYmIHBhcnNlZCA+IDAgPyBwYXJzZWQgOiB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGlzRGlzYWJsZWRWYWx1ZSh2YWx1ZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBbXCIwXCIsIFwiZmFsc2VcIiwgXCJub1wiLCBcIm9mZlwiLCBcIm5vbmVcIiwgXCJuYXRpdmVcIl0uaW5jbHVkZXModmFsdWUudHJpbSgpLnRvTG93ZXJDYXNlKCkpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVCb29sZWFuQXR0cmlidXRlKHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gdmFsdWUgPT0gbnVsbCA/IHVuZGVmaW5lZCA6IHZhbHVlLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xufVxuXG5mdW5jdGlvbiBwYXJzZUluZm9BdHRyaWJ1dGVzKGlucHV0OiBzdHJpbmcpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgY29uc3QgYXR0cnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgY29uc3QgcGF0dGVybiA9IC8oW0EtWmEtejAtOV8tXSspXFxzKj1cXHMqKD86XCIoW15cIl0qKVwifCcoW14nXSopJ3woW15cXHNdKykpL2c7XG4gIGxldCBtYXRjaDogUmVnRXhwRXhlY0FycmF5IHwgbnVsbDtcbiAgd2hpbGUgKChtYXRjaCA9IHBhdHRlcm4uZXhlYyhpbnB1dCkpICE9IG51bGwpIHtcbiAgICBhdHRyc1ttYXRjaFsxXS50b0xvd2VyQ2FzZSgpXSA9IG1hdGNoWzJdID8/IG1hdGNoWzNdID8/IG1hdGNoWzRdID8/IFwiXCI7XG4gIH1cbiAgcmV0dXJuIGF0dHJzO1xufVxuXG5mdW5jdGlvbiBwYXJzZUxpbmVSYW5nZSh2YWx1ZTogc3RyaW5nKTogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIGNvbnN0IG1hdGNoID0gdmFsdWUudHJpbSgpLm1hdGNoKC9eTD8oXFxkKykoPzpcXHMqWy06XVxccypMPyhcXGQrKSk/JC9pKTtcbiAgaWYgKCFtYXRjaCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGNvbnN0IHN0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KG1hdGNoWzFdLCAxMCk7XG4gIGNvbnN0IGVuZCA9IE51bWJlci5wYXJzZUludChtYXRjaFsyXSA/PyBtYXRjaFsxXSwgMTApO1xuICBpZiAoIU51bWJlci5pc0ludGVnZXIoc3RhcnQpIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKGVuZCkgfHwgc3RhcnQgPD0gMCB8fCBlbmQgPCBzdGFydCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiB7IHN0YXJ0LCBlbmQgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZpbmRCbG9ja0F0TGluZShibG9ja3M6IGxvb21Db2RlQmxvY2tbXSwgbGluZTogbnVtYmVyKTogbG9vbUNvZGVCbG9jayB8IG51bGwge1xuICByZXR1cm4gYmxvY2tzLmZpbmQoKGJsb2NrKSA9PiBsaW5lID49IGJsb2NrLnN0YXJ0TGluZSAmJiBsaW5lIDw9IGJsb2NrLmVuZExpbmUpID8/IG51bGw7XG59XG5cbmZ1bmN0aW9uIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXltcXHQgXSovKTtcbiAgcmV0dXJuIG1hdGNoPy5bMF0gPz8gXCJcIjtcbn1cblxuZnVuY3Rpb24gc3RyaXBGZW5jZUluZGVudChsaW5lOiBzdHJpbmcsIGZlbmNlSW5kZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIWZlbmNlSW5kZW50KSB7XG4gICAgcmV0dXJuIGxpbmU7XG4gIH1cblxuICBsZXQgaW5kZXggPSAwO1xuICB3aGlsZSAoaW5kZXggPCBmZW5jZUluZGVudC5sZW5ndGggJiYgaW5kZXggPCBsaW5lLmxlbmd0aCAmJiBsaW5lW2luZGV4XSA9PT0gZmVuY2VJbmRlbnRbaW5kZXhdKSB7XG4gICAgaW5kZXggKz0gMTtcbiAgfVxuXG4gIHJldHVybiBsaW5lLnNsaWNlKGluZGV4KTtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21MYW5ndWFnZUNhcGFiaWxpdHkge1xuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZTtcbiAgc3ltYm9sRXh0cmFjdGlvbjogXCJhc3RcIiB8IFwidG9wLWxldmVsXCIgfCBcImdlbmVyaWNcIiB8IFwiZXh0ZXJuYWxcIjtcbiAgZGVwZW5kZW5jeVRyYWNpbmc6IFwiYXN0XCIgfCBcInRvcC1sZXZlbFwiIHwgXCJnZW5lcmljXCIgfCBcImV4dGVybmFsXCI7XG4gIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIgfCBcInJhd1wiIHwgXCJleHRlcm5hbFwiO1xuICBzb3VyY2VQcmV2aWV3OiBib29sZWFuO1xufVxuXG5jb25zdCBCVUlMVF9JTl9DQVBBQklMSVRJRVM6IFJlY29yZDxzdHJpbmcsIGxvb21MYW5ndWFnZUNhcGFiaWxpdHk+ID0ge1xuICBweXRob246IHtcbiAgICBsYW5ndWFnZTogXCJweXRob25cIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcImFzdFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcImFzdFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgamF2YXNjcmlwdDoge1xuICAgIGxhbmd1YWdlOiBcImphdmFzY3JpcHRcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgdHlwZXNjcmlwdDoge1xuICAgIGxhbmd1YWdlOiBcInR5cGVzY3JpcHRcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgYzoge1xuICAgIGxhbmd1YWdlOiBcImNcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgY3BwOiB7XG4gICAgbGFuZ3VhZ2U6IFwiY3BwXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIFwibGx2bS1pclwiOiB7XG4gICAgbGFuZ3VhZ2U6IFwibGx2bS1pclwiLFxuICAgIHN5bWJvbEV4dHJhY3Rpb246IFwidG9wLWxldmVsXCIsXG4gICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwidG9wLWxldmVsXCIsXG4gICAgY2FsbEhhcm5lc3M6IFwicmF3XCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgaGFza2VsbDoge1xuICAgIGxhbmd1YWdlOiBcImhhc2tlbGxcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIG9jYW1sOiB7XG4gICAgbGFuZ3VhZ2U6IFwib2NhbWxcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgamF2YToge1xuICAgIGxhbmd1YWdlOiBcImphdmFcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIFwiZWJwZi1jXCI6IHtcbiAgICBsYW5ndWFnZTogXCJlYnBmLWNcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGJwZnRyYWNlOiB7XG4gICAgbGFuZ3VhZ2U6IFwiYnBmdHJhY2VcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcImdlbmVyaWNcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJnZW5lcmljXCIsXG4gICAgY2FsbEhhcm5lc3M6IFwicmF3XCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRMYW5ndWFnZUNhcGFiaWxpdHkobGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGhhc0V4dGVybmFsRXh0cmFjdG9yID0gZmFsc2UpOiBsb29tTGFuZ3VhZ2VDYXBhYmlsaXR5IHtcbiAgaWYgKGhhc0V4dGVybmFsRXh0cmFjdG9yKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgc3ltYm9sRXh0cmFjdGlvbjogXCJleHRlcm5hbFwiLFxuICAgICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwiZXh0ZXJuYWxcIixcbiAgICAgIGNhbGxIYXJuZXNzOiBcImV4dGVybmFsXCIsXG4gICAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICAgIH07XG4gIH1cblxuICByZXR1cm4gQlVJTFRfSU5fQ0FQQUJJTElUSUVTW2xhbmd1YWdlXSA/PyB7XG4gICAgbGFuZ3VhZ2UsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJnZW5lcmljXCIsXG4gICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwiZ2VuZXJpY1wiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRCdWlsdEluTGFuZ3VhZ2VDYXBhYmlsaXRpZXMoKTogbG9vbUxhbmd1YWdlQ2FwYWJpbGl0eVtdIHtcbiAgcmV0dXJuIE9iamVjdC52YWx1ZXMoQlVJTFRfSU5fQ0FQQUJJTElUSUVTKTtcbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTm9kZVJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibm9kZVwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTm9kZS5qc1wiO1xuICBsYW5ndWFnZXMgPSBbXCJqYXZhc2NyaXB0XCIsIFwidHlwZXNjcmlwdFwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YXNjcmlwdFwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5ub2RlRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhc2NyaXB0XCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogdGhpcy5pZCxcbiAgICAgICAgcnVubmVyTmFtZTogdGhpcy5kaXNwbGF5TmFtZSxcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3Mubm9kZUV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLmpzXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBzZXR0aW5ncy50eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGUudHJpbSgpO1xuICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBzZXR0aW5ncy50eXBlc2NyaXB0TW9kZSA9PT0gXCJ0c3hcIiA/IFwiVHlwZVNjcmlwdCAodHN4KVwiIDogXCJUeXBlU2NyaXB0ICh0cy1ub2RlKVwiO1xuXG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtzZXR0aW5ncy50eXBlc2NyaXB0TW9kZX1gLFxuICAgICAgcnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGUsXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBcIi50c1wiLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuLi91dGlscy9jb21tYW5kXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21DdXN0b21MYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgQ3VzdG9tTGFuZ3VhZ2VSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcImN1c3RvbVwiO1xuICBkaXNwbGF5TmFtZSA9IFwiQ3VzdG9tIGxhbmd1YWdlXCI7XG4gIGxhbmd1YWdlcyA9IFtdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBCb29sZWFuKHRoaXMuZ2V0Q3VzdG9tTGFuZ3VhZ2UoYmxvY2ssIHNldHRpbmdzKT8uZXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGxhbmd1YWdlID0gdGhpcy5nZXRDdXN0b21MYW5ndWFnZShibG9jaywgc2V0dGluZ3MpO1xuICAgIGlmICghbGFuZ3VhZ2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgY3VzdG9tIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICAgIH1cblxuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7bGFuZ3VhZ2UubmFtZX1gLFxuICAgICAgcnVubmVyTmFtZTogbGFuZ3VhZ2UubmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IGxhbmd1YWdlLmV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogc3BsaXRDb21tYW5kTGluZShsYW5ndWFnZS5hcmdzIHx8IFwie2ZpbGV9XCIpLFxuICAgICAgZmlsZUV4dGVuc2lvbjogbm9ybWFsaXplRXh0ZW5zaW9uKGxhbmd1YWdlLmV4dGVuc2lvbiwgbGFuZ3VhZ2UubmFtZSksXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRDdXN0b21MYW5ndWFnZShibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21DdXN0b21MYW5ndWFnZSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGJsb2NrLmxhbmd1YWdlLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgIHJldHVybiBzZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuZmluZCgobGFuZ3VhZ2UpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSBsYW5ndWFnZS5uYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgYWxpYXNlcyA9IGxhbmd1YWdlLmFsaWFzZXNcbiAgICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgICAubWFwKChhbGlhcykgPT4gYWxpYXMudHJpbSgpLnRvTG93ZXJDYXNlKCkpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgICByZXR1cm4gbmFtZSA9PT0gbm9ybWFsaXplZCB8fCBhbGlhc2VzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4dGVuc2lvbihleHRlbnNpb246IHN0cmluZywgbmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IGV4dGVuc2lvbi50cmltKCk7XG4gIGlmICghdHJpbW1lZCkge1xuICAgIHJldHVybiBgLiR7bmFtZX1gO1xuICB9XG4gIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIuXCIpID8gdHJpbW1lZCA6IGAuJHt0cmltbWVkfWA7XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuaW50ZXJmYWNlIEludGVycHJldGVkU3BlYyB7XG4gIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlO1xuICBkaXNwbGF5TmFtZTogc3RyaW5nO1xuICBleGVjdXRhYmxlOiAoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncykgPT4gc3RyaW5nO1xuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmc7XG4gIGFyZ3M/OiBzdHJpbmdbXTtcbiAgZW52PzogTm9kZUpTLlByb2Nlc3NFbnY7XG4gIG1pbmltdW1UaW1lb3V0TXM/OiBudW1iZXI7XG59XG5cbmNvbnN0IElOVEVSUFJFVEVEX1NQRUNTOiBJbnRlcnByZXRlZFNwZWNbXSA9IFtcbiAge1xuICAgIGxhbmd1YWdlOiBcInNoZWxsXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiU2hlbGxcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnNoZWxsRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5zaFwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwicnVieVwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlJ1YnlcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnJ1YnlFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnJiXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJwZXJsXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiUGVybFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MucGVybEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIucGxcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcImx1YVwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkx1YVwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MubHVhRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5sdWFcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcInBocFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlBIUFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MucGhwRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5waHBcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcImdvXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiR29cIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLmdvRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5nb1wiLFxuICAgIGFyZ3M6IFtcInJ1blwiLCBcIntmaWxlfVwiXSxcbiAgICBlbnY6IHtcbiAgICAgIEdPQ0FDSEU6IFwie3RlbXBEaXJ9L2dvY2FjaGVcIixcbiAgICB9LFxuICAgIG1pbmltdW1UaW1lb3V0TXM6IDMwXzAwMCxcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcImhhc2tlbGxcIixcbiAgICBkaXNwbGF5TmFtZTogXCJIYXNrZWxsXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5oYXNrZWxsRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5oc1wiLFxuICAgIG1pbmltdW1UaW1lb3V0TXM6IDMwXzAwMCxcbiAgfSxcbl07XG5cbmV4cG9ydCBjbGFzcyBJbnRlcnByZXRlZFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwiaW50ZXJwcmV0ZWRcIjtcbiAgZGlzcGxheU5hbWUgPSBcIkludGVycHJldGVkXCI7XG4gIGxhbmd1YWdlcyA9IElOVEVSUFJFVEVEX1NQRUNTLm1hcCgoc3BlYykgPT4gc3BlYy5sYW5ndWFnZSk7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgY29uc3Qgc3BlYyA9IHRoaXMuZ2V0U3BlYyhibG9jay5sYW5ndWFnZSk7XG4gICAgcmV0dXJuIEJvb2xlYW4oc3BlYz8uZXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpKTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBzcGVjID0gdGhpcy5nZXRTcGVjKGJsb2NrLmxhbmd1YWdlKTtcbiAgICBpZiAoIXNwZWMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtibG9jay5sYW5ndWFnZX1gLFxuICAgICAgcnVubmVyTmFtZTogc3BlYy5kaXNwbGF5TmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNwZWMuZXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpLFxuICAgICAgYXJnczogc3BlYy5hcmdzID8/IFtcIntmaWxlfVwiXSxcbiAgICAgIGZpbGVFeHRlbnNpb246IHNwZWMuZmlsZUV4dGVuc2lvbixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIHNwZWMubWluaW11bVRpbWVvdXRNcyA/PyAwKSxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIGVudjogc3BlYy5lbnYsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGdldFNwZWMobGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UpOiBJbnRlcnByZXRlZFNwZWMgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBJTlRFUlBSRVRFRF9TUEVDUy5maW5kKChzcGVjKSA9PiBzcGVjLmxhbmd1YWdlID09PSBsYW5ndWFnZSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuLi91dGlscy9jb21tYW5kXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxudHlwZSBFYnBmQ01vZGUgPSBcImNvbXBpbGVcIiB8IFwibG9hZFwiO1xudHlwZSBCcGZ0cmFjZU1vZGUgPSBcImNoZWNrXCIgfCBcInJ1blwiO1xuXG5leHBvcnQgY2xhc3MgRWJwZlJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwiZWJwZlwiO1xuICBkaXNwbGF5TmFtZSA9IFwiZUJQRlwiO1xuICBsYW5ndWFnZXMgPSBbXCJlYnBmLWNcIiwgXCJicGZ0cmFjZVwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiZWJwZi1jXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmVicGZDbGFuZ0V4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImJwZnRyYWNlXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmJwZnRyYWNlRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImVicGYtY1wiKSB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5FYnBmQyhibG9jaywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIH1cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiYnBmdHJhY2VcIikge1xuICAgICAgcmV0dXJuIHRoaXMucnVuQnBmdHJhY2UoYmxvY2ssIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBlQlBGIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5FYnBmQyhibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBtb2RlID0gcmVhZEVicGZDTW9kZShibG9jayk7XG4gICAgY29uc3QgY2ZsYWdzID0gcmVhZExpc3RBdHRyaWJ1dGUoYmxvY2ssIFwibG9vbS1lYnBmLWNmbGFnc1wiLCBcImVicGYtY2ZsYWdzXCIpLmZsYXRNYXAoc3BsaXRDb21tYW5kTGluZSk7XG4gICAgY29uc3QgaW5jbHVkZVBhdGhzID0gW1xuICAgICAgLi4uc3BsaXRDc3Yoc2V0dGluZ3MuZWJwZkluY2x1ZGVQYXRocyksXG4gICAgICAuLi5yZWFkTGlzdEF0dHJpYnV0ZShibG9jaywgXCJsb29tLWVicGYtaW5jbHVkZXNcIiwgXCJlYnBmLWluY2x1ZGVzXCIpLFxuICAgIF07XG5cbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKFwiLmJwZi5jXCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGNvbnN0IG9iamVjdFBhdGggPSBqb2luKHRlbXBEaXIsIFwic25pcHBldC5icGYub1wiKTtcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmNsYW5nYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJlQlBGIGNsYW5nXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmVicGZDbGFuZ0V4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXG4gICAgICAgICAgXCItdGFyZ2V0XCIsXG4gICAgICAgICAgXCJicGZcIixcbiAgICAgICAgICBcIi1PMlwiLFxuICAgICAgICAgIFwiLWdcIixcbiAgICAgICAgICBcIi1XYWxsXCIsXG4gICAgICAgICAgLi4uaW5jbHVkZVBhdGhzLmZsYXRNYXAoKGluY2x1ZGVQYXRoKSA9PiBbXCItSVwiLCBpbmNsdWRlUGF0aF0pLFxuICAgICAgICAgIC4uLmNmbGFncyxcbiAgICAgICAgICBcIi1jXCIsXG4gICAgICAgICAgdGVtcEZpbGUsXG4gICAgICAgICAgXCItb1wiLFxuICAgICAgICAgIG9iamVjdFBhdGgsXG4gICAgICAgIF0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgY29tcGlsZVJlc3VsdC5zdGRvdXQgPSBhcHBlbmRTZWN0aW9uKGNvbXBpbGVSZXN1bHQuc3Rkb3V0LCBcIkNvbXBpbGVcIiwgYGVCUEYgb2JqZWN0IGNvbXBpbGVkIHN1Y2Nlc3NmdWxseTogJHtvYmplY3RQYXRofWApO1xuICAgICAgYXdhaXQgdGhpcy5hcHBlbmRPYmplY3RJbnNwZWN0aW9uKGNvbXBpbGVSZXN1bHQsIG9iamVjdFBhdGgsIGNvbnRleHQsIHNldHRpbmdzKTtcblxuICAgICAgaWYgKG1vZGUgPT09IFwiY29tcGlsZVwiKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGhpcy5sb2FkRWJwZk9iamVjdChibG9jaywgb2JqZWN0UGF0aCwgY29udGV4dCwgc2V0dGluZ3MsIGNvbXBpbGVSZXN1bHQpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBhcHBlbmRPYmplY3RJbnNwZWN0aW9uKHJlc3VsdDogbG9vbVJ1blJlc3VsdCwgb2JqZWN0UGF0aDogc3RyaW5nLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG9iamR1bXAgPSBzZXR0aW5ncy5lYnBmTGx2bU9iamR1bXBFeGVjdXRhYmxlLnRyaW0oKTtcbiAgICBpZiAoIW9iamR1bXApIHtcbiAgICAgIHJlc3VsdC53YXJuaW5nID0gYXBwZW5kTGluZShyZXN1bHQud2FybmluZywgXCJlQlBGIG9iamVjdCBpbnNwZWN0aW9uIHNraXBwZWQgYmVjYXVzZSBubyBvYmplY3QgaW5zcGVjdG9yIGlzIGNvbmZpZ3VyZWQuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGluc3BlY3QgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvYmpkdW1wYCxcbiAgICAgIHJ1bm5lck5hbWU6IFwiZUJQRiBvYmplY3QgaW5zcGVjdGlvblwiLFxuICAgICAgZXhlY3V0YWJsZTogb2JqZHVtcCxcbiAgICAgIGFyZ3M6IFtcIi1oXCIsIG9iamVjdFBhdGhdLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG5cbiAgICBpZiAoaW5zcGVjdC5zdWNjZXNzKSB7XG4gICAgICByZXN1bHQuc3Rkb3V0ID0gYXBwZW5kU2VjdGlvbihyZXN1bHQuc3Rkb3V0LCBcIk9iamVjdCBzZWN0aW9uc1wiLCBpbnNwZWN0LnN0ZG91dC50cmltKCkgfHwgXCIobm8gc2VjdGlvbnMgcmVwb3J0ZWQpXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHQud2FybmluZyA9IGFwcGVuZExpbmUocmVzdWx0Lndhcm5pbmcsIGBlQlBGIG9iamVjdCBpbnNwZWN0aW9uIGZhaWxlZDogJHtpbnNwZWN0LnN0ZGVyciB8fCBpbnNwZWN0LnN0ZG91dCB8fCBgZXhpdCAke2luc3BlY3QuZXhpdENvZGV9YH1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGxvYWRFYnBmT2JqZWN0KFxuICAgIGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuICAgIG9iamVjdFBhdGg6IHN0cmluZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgICBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLFxuICAgIGNvbXBpbGVSZXN1bHQ6IGxvb21SdW5SZXN1bHQsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmICghc2V0dGluZ3MuZWJwZkFsbG93S2VybmVsTG9hZCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uY29tcGlsZVJlc3VsdCxcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGV4aXRDb2RlOiAtMSxcbiAgICAgICAgc3RkZXJyOiBhcHBlbmRMaW5lKGNvbXBpbGVSZXN1bHQuc3RkZXJyLCBcImVCUEYga2VybmVsIGxvYWRpbmcgaXMgZGlzYWJsZWQuIEVuYWJsZSBBbGxvdyBlQlBGIGtlcm5lbCBsb2FkIGluIHNldHRpbmdzIGJlZm9yZSB1c2luZyBsb29tLWVicGYtbW9kZT1sb2FkLlwiKSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY29uc3QgcGluUGF0aCA9IHJlYWRTdHJpbmdBdHRyaWJ1dGUoYmxvY2ssIFwibG9vbS1lYnBmLXBpblwiLCBcImVicGYtcGluXCIpO1xuICAgIGlmICghcGluUGF0aCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uY29tcGlsZVJlc3VsdCxcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGV4aXRDb2RlOiAtMSxcbiAgICAgICAgc3RkZXJyOiBhcHBlbmRMaW5lKGNvbXBpbGVSZXN1bHQuc3RkZXJyLCBcImxvb20tZWJwZi1tb2RlPWxvYWQgcmVxdWlyZXMgbG9vbS1lYnBmLXBpbj0vc3lzL2ZzL2JwZi88cGF0aD4uXCIpLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjb25zdCBsb2FkID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06YnBmdG9vbDpsb2FkYCxcbiAgICAgIHJ1bm5lck5hbWU6IFwiYnBmdG9vbCBlQlBGIGxvYWRcIixcbiAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmVicGZCcGZ0b29sRXhlY3V0YWJsZS50cmltKCkgfHwgXCJicGZ0b29sXCIsXG4gICAgICBhcmdzOiBbXCItZFwiLCBcInByb2dcIiwgXCJsb2FkYWxsXCIsIG9iamVjdFBhdGgsIHBpblBhdGhdLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG5cbiAgICBsb2FkLnN0ZG91dCA9IGFwcGVuZFNlY3Rpb24oY29tcGlsZVJlc3VsdC5zdGRvdXQsIFwiYnBmdG9vbCBzdGRvdXRcIiwgbG9hZC5zdGRvdXQudHJpbSgpKTtcbiAgICBsb2FkLnN0ZGVyciA9IGFwcGVuZFNlY3Rpb24oY29tcGlsZVJlc3VsdC5zdGRlcnIsIFwiYnBmdG9vbCBzdGRlcnJcIiwgbG9hZC5zdGRlcnIudHJpbSgpKTtcbiAgICBsb2FkLndhcm5pbmcgPSBhcHBlbmRMaW5lKGNvbXBpbGVSZXN1bHQud2FybmluZywgYGVCUEYgb2JqZWN0IGxvYWQgcmVxdWVzdGVkIHdpdGggcGluIHBhdGggJHtwaW5QYXRofS5gKTtcbiAgICByZXR1cm4gbG9hZDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQnBmdHJhY2UoYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgbW9kZSA9IHJlYWRCcGZ0cmFjZU1vZGUoYmxvY2spO1xuICAgIGNvbnN0IGV4dHJhQXJncyA9IHJlYWRMaXN0QXR0cmlidXRlKGJsb2NrLCBcImxvb20tYnBmdHJhY2UtYXJnc1wiLCBcImJwZnRyYWNlLWFyZ3NcIikuZmxhdE1hcChzcGxpdENvbW1hbmRMaW5lKTtcbiAgICBjb25zdCBhcmdzID0gbW9kZSA9PT0gXCJjaGVja1wiXG4gICAgICA/IFtcIi1kXCIsIC4uLmV4dHJhQXJncywgXCJ7ZmlsZX1cIl1cbiAgICAgIDogWy4uLmV4dHJhQXJncywgXCJ7ZmlsZX1cIl07XG5cbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKFwiLmJ0XCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBGaWxlIH0pID0+XG4gICAgICBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmJwZnRyYWNlOiR7bW9kZX1gLFxuICAgICAgICBydW5uZXJOYW1lOiBtb2RlID09PSBcImNoZWNrXCIgPyBcImJwZnRyYWNlIGNoZWNrXCIgOiBcImJwZnRyYWNlXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmJwZnRyYWNlRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IGFyZ3MubWFwKChhcmcpID0+IGFyZy5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlKSksXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgc3RkaW46IG1vZGUgPT09IFwicnVuXCIgPyBjb250ZXh0LnN0ZGluIDogdW5kZWZpbmVkLFxuICAgICAgfSksXG4gICAgKTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWFkRWJwZkNNb2RlKGJsb2NrOiBsb29tQ29kZUJsb2NrKTogRWJwZkNNb2RlIHtcbiAgY29uc3QgdmFsdWUgPSByZWFkU3RyaW5nQXR0cmlidXRlKGJsb2NrLCBcImxvb20tZWJwZi1tb2RlXCIsIFwiZWJwZi1tb2RlXCIpIHx8IFwiY29tcGlsZVwiO1xuICBpZiAodmFsdWUgPT09IFwiY29tcGlsZVwiIHx8IHZhbHVlID09PSBcImxvYWRcIikge1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGVCUEYgbW9kZTogJHt2YWx1ZX0uIFVzZSBjb21waWxlIG9yIGxvYWQuYCk7XG59XG5cbmZ1bmN0aW9uIHJlYWRCcGZ0cmFjZU1vZGUoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBCcGZ0cmFjZU1vZGUge1xuICBjb25zdCB2YWx1ZSA9IHJlYWRTdHJpbmdBdHRyaWJ1dGUoYmxvY2ssIFwibG9vbS1icGZ0cmFjZS1tb2RlXCIsIFwiYnBmdHJhY2UtbW9kZVwiKSB8fCBcImNoZWNrXCI7XG4gIGlmICh2YWx1ZSA9PT0gXCJjaGVja1wiIHx8IHZhbHVlID09PSBcInJ1blwiKSB7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgYnBmdHJhY2UgbW9kZTogJHt2YWx1ZX0uIFVzZSBjaGVjayBvciBydW4uYCk7XG59XG5cbmZ1bmN0aW9uIHJlYWRTdHJpbmdBdHRyaWJ1dGUoYmxvY2s6IGxvb21Db2RlQmxvY2ssIHByaW1hcnk6IHN0cmluZywgZmFsbGJhY2s6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBibG9jay5hdHRyaWJ1dGVzW3ByaW1hcnldPy50cmltKCkgfHwgYmxvY2suYXR0cmlidXRlc1tmYWxsYmFja10/LnRyaW0oKSB8fCB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIHJlYWRMaXN0QXR0cmlidXRlKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBwcmltYXJ5OiBzdHJpbmcsIGZhbGxiYWNrOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBzcGxpdENzdihyZWFkU3RyaW5nQXR0cmlidXRlKGJsb2NrLCBwcmltYXJ5LCBmYWxsYmFjaykgfHwgXCJcIik7XG59XG5cbmZ1bmN0aW9uIHNwbGl0Q3N2KHZhbHVlOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiB2YWx1ZVxuICAgIC5zcGxpdChcIixcIilcbiAgICAubWFwKChpdGVtKSA9PiBpdGVtLnRyaW0oKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pO1xufVxuXG5mdW5jdGlvbiBhcHBlbmRMaW5lKGV4aXN0aW5nOiBzdHJpbmcgfCB1bmRlZmluZWQsIGxpbmU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBbZXhpc3RpbmcsIGxpbmVdLmZpbHRlcigocGFydCkgPT4gcGFydD8udHJpbSgpKS5qb2luKFwiXFxuXCIpO1xufVxuXG5mdW5jdGlvbiBhcHBlbmRTZWN0aW9uKGV4aXN0aW5nOiBzdHJpbmcsIHRpdGxlOiBzdHJpbmcsIGJvZHk6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGNvbnRlbnQgPSBib2R5LnRyaW0oKTtcbiAgaWYgKCFjb250ZW50KSB7XG4gICAgcmV0dXJuIGV4aXN0aW5nO1xuICB9XG4gIHJldHVybiBbZXhpc3RpbmcudHJpbSgpLCBgJHt0aXRsZX06XFxuJHtjb250ZW50fWBdLmZpbHRlcihCb29sZWFuKS5qb2luKFwiXFxuXFxuXCIpO1xufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBMbHZtUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJsbHZtLWlyXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJMTFZNIElSXCI7XG4gIGxhbmd1YWdlcyA9IFtcImxsdm0taXJcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGJsb2NrLmxhbmd1YWdlID09PSBcImxsdm0taXJcIiAmJiBCb29sZWFuKHNldHRpbmdzLmxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IHRoaXMuaWQsXG4gICAgICBydW5uZXJOYW1lOiB0aGlzLmRpc3BsYXlOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MubGx2bUludGVycHJldGVyRXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5sbFwiLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICB9KTtcblxuICAgIGlmICghcmVzdWx0LnRpbWVkT3V0ICYmICFyZXN1bHQuY2FuY2VsbGVkICYmIHJlc3VsdC5leGl0Q29kZSAhPSBudWxsICYmICFyZXN1bHQuc3RkZXJyLnRyaW0oKSkge1xuICAgICAgaWYgKHJlc3VsdC5leGl0Q29kZSAhPT0gMCkge1xuICAgICAgICByZXN1bHQuc3VjY2VzcyA9IHRydWU7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gYFByb2dyYW0gcmV0dXJuZWQgaTMyICR7cmVzdWx0LmV4aXRDb2RlfS4gVW5kZXIgbGxpLCB0aGF0IGJlY29tZXMgdGhlIHByb2Nlc3MgZXhpdCBzdGF0dXMuYDtcbiAgICAgIH1cblxuICAgICAgaWYgKCFyZXN1bHQuc3Rkb3V0LnRyaW0oKSkge1xuICAgICAgICByZXN1bHQuc3Rkb3V0ID0gcmVzdWx0LmV4aXRDb2RlID09PSAwXG4gICAgICAgICAgPyBcIkxMVk0gcHJvZ3JhbSBleGl0ZWQgd2l0aCBjb2RlIDAuXCJcbiAgICAgICAgICA6IGBMTFZNIHByb2dyYW0gcmV0dXJuZWQgaTMyICR7cmVzdWx0LmV4aXRDb2RlfS5cXG5Vc2Ugc3Rkb3V0IGluIHRoZSBJUiBpdHNlbGYgaWYgeW91IHdhbnQgcHJpbnRhYmxlIHByb2dyYW0gb3V0cHV0LmA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxufVxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuUHJvY2Vzcywgd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGUsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm1hbmFnZWQtY29tcGlsZWRcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk1hbmFnZWQgY29tcGlsZXJcIjtcbiAgbGFuZ3VhZ2VzID0gW1wicnVzdFwiLCBcImphdmFcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInJ1c3RcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MucnVzdEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YVwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5qYXZhRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwicnVzdFwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5SdXN0KGJsb2NrLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFcIikge1xuICAgICAgcmV0dXJuIHRoaXMucnVuSmF2YShibG9jaywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1blJ1c3QoYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShcIi5yc1wiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBjb25zdCBiaW5hcnlQYXRoID0gam9pbih0ZW1wRGlyLCBcInNuaXBwZXQub3V0XCIpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06cnVzdDpjb21waWxlYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJSdXN0XCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLnJ1c3RFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW3RlbXBGaWxlLCBcIi1vXCIsIGJpbmFyeVBhdGhdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpydXN0OnJ1bmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiUnVzdFwiLFxuICAgICAgICBleGVjdXRhYmxlOiBiaW5hcnlQYXRoLFxuICAgICAgICBhcmdzOiBbXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkphdmEoYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgcmV0dXJuIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlKFwiTWFpbi5qYXZhXCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGlmICghc2V0dGluZ3MuamF2YUNvbXBpbGVyRXhlY3V0YWJsZS50cmltKCkpIHtcbiAgICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpqYXZhOnNvdXJjZWAsXG4gICAgICAgICAgcnVubmVyTmFtZTogXCJKYXZhXCIsXG4gICAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICAgIGFyZ3M6IFt0ZW1wRmlsZV0sXG4gICAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmphdmE6Y29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiSmF2YVwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5qYXZhQ29tcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW3RlbXBGaWxlXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogdGVtcERpcixcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06amF2YTpydW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkphdmFcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCItY3BcIiwgdGVtcERpciwgXCJNYWluXCJdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBOYXRpdmVDb21waWxlZFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibmF0aXZlLWNvbXBpbGVkXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJOYXRpdmUgY29tcGlsZXJcIjtcbiAgbGFuZ3VhZ2VzID0gW1wiY1wiLCBcImNwcFwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5jRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjcHBcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuY3BwRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBleGVjdXRhYmxlID0gYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiID8gc2V0dGluZ3MuY0V4ZWN1dGFibGUudHJpbSgpIDogc2V0dGluZ3MuY3BwRXhlY3V0YWJsZS50cmltKCk7XG4gICAgY29uc3QgZmlsZUV4dGVuc2lvbiA9IGJsb2NrLmxhbmd1YWdlID09PSBcImNcIiA/IFwiLmNcIiA6IFwiLmNwcFwiO1xuICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIgPyBcIkMgKEdDQylcIiA6IFwiQysrIChHKyspXCI7XG5cbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKGZpbGVFeHRlbnNpb24sIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGNvbnN0IGJpbmFyeVBhdGggPSBqb2luKHRlbXBEaXIsIFwic25pcHBldC5vdXRcIik7XG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2Jsb2NrLmxhbmd1YWdlfTpjb21waWxlYCxcbiAgICAgICAgcnVubmVyTmFtZSxcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW3RlbXBGaWxlLCBcIi1vXCIsIGJpbmFyeVBhdGhdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2Jsb2NrLmxhbmd1YWdlfTpydW5gLFxuICAgICAgICBydW5uZXJOYW1lLFxuICAgICAgICBleGVjdXRhYmxlOiBiaW5hcnlQYXRoLFxuICAgICAgICBhcmdzOiBbXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHJ1blRlbXBGaWxlUHJvY2Vzcywgd2l0aFRlbXBTb3VyY2VGaWxlIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIE9jYW1sUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJvY2FtbFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiT0NhbWxcIjtcbiAgbGFuZ3VhZ2VzID0gW1wib2NhbWxcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGJsb2NrLmxhbmd1YWdlID09PSBcIm9jYW1sXCIgJiYgQm9vbGVhbihzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBtb2RlID0gc2V0dGluZ3Mub2NhbWxNb2RlO1xuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpO1xuXG4gICAgaWYgKG1vZGUgPT09IFwib2NhbWxcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvY2FtbGAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiT0NhbWxcIixcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAobW9kZSA9PT0gXCJkdW5lXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06ZHVuZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiRHVuZSAvIE9DYW1sXCIsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFtcImV4ZWNcIiwgXCItLVwiLCBcIm9jYW1sXCIsIFwie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKFwiLm1sXCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGNvbnN0IGJpbmFyeVBhdGggPSBqb2luKHRlbXBEaXIsIFwic25pcHBldC5vdXRcIik7XG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvY2FtbGMtY29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiT0NhbWxjXCIsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFtcIi1vXCIsIGJpbmFyeVBhdGgsIHRlbXBGaWxlXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06b2NhbWxjLXJ1bmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiT0NhbWxjXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IGJpbmFyeVBhdGgsXG4gICAgICAgIGFyZ3M6IFtdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBQeXRob25SdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcInB5dGhvblwiO1xuICBkaXNwbGF5TmFtZSA9IFwiUHl0aG9uXCI7XG4gIGxhbmd1YWdlcyA9IFtcInB5dGhvblwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICByZXR1cm4gYmxvY2subGFuZ3VhZ2UgPT09IFwicHl0aG9uXCIgJiYgQm9vbGVhbihzZXR0aW5ncy5weXRob25FeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogdGhpcy5pZCxcbiAgICAgIHJ1bm5lck5hbWU6IHRoaXMuZGlzcGxheU5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5weXRob25FeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgIGZpbGVFeHRlbnNpb246IFwiLnB5XCIsXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgZXhpc3RzU3luYyB9IGZyb20gXCJmc1wiO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgUHJvb2ZSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcInByb29mXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJQcm9vZiBjaGVja2VyXCI7XG4gIGxhbmd1YWdlcyA9IFtcImxlYW5cIiwgXCJjb3FcIiwgXCJzbXRsaWJcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxlYW5cIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MubGVhbkV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY29xXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHJlc29sdmVDb3FFeGVjdXRhYmxlKHNldHRpbmdzKS50cmltKCkpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJzbXRsaWJcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3Muc210RXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGVhblwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmxlYW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkxlYW5cIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MubGVhbkV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLmxlYW5cIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNvcVwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmNvcWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiQ29xXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHJlc29sdmVDb3FFeGVjdXRhYmxlKHNldHRpbmdzKSxcbiAgICAgICAgYXJnczogW1wiLXFcIiwgXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLnZcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInNtdGxpYlwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OnNtdGxpYmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiU01ULUxJQiAoWjMpXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLnNtdEV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLnNtdDJcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBwcm9vZiBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZXNvbHZlQ29xRXhlY3V0YWJsZShzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogc3RyaW5nIHtcbiAgY29uc3QgY29uZmlndXJlZCA9IHNldHRpbmdzLmNvcUV4ZWN1dGFibGUudHJpbSgpO1xuICBpZiAoY29uZmlndXJlZCAmJiBjb25maWd1cmVkICE9PSBcImNvcWNcIikge1xuICAgIHJldHVybiBjb25maWd1cmVkO1xuICB9XG5cbiAgY29uc3Qgb3BhbUNvcWMgPSBqb2luKHByb2Nlc3MuZW52LkhPTUUgPz8gXCJcIiwgXCIub3BhbVwiLCBcImRlZmF1bHRcIiwgXCJiaW5cIiwgXCJjb3FjXCIpO1xuICByZXR1cm4gZXhpc3RzU3luYyhvcGFtQ29xYykgPyBvcGFtQ29xYyA6IGNvbmZpZ3VyZWQgfHwgXCJjb3FjXCI7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcbmltcG9ydCB7IGFyZUN1c3RvbUxhbmd1YWdlc0VuYWJsZWQsIGlzTGFuZ3VhZ2VFbmFibGVkIH0gZnJvbSBcIi4uL2xhbmd1YWdlUGFja2FnZXNcIjtcblxuZXhwb3J0IGNsYXNzIGxvb21SdW5uZXJSZWdpc3RyeSB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgcnVubmVyczogbG9vbVJ1bm5lcltdKSB7fVxuXG4gIGdldFJ1bm5lckZvckJsb2NrKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbVJ1bm5lciB8IG51bGwge1xuICAgIGlmICghdGhpcy5pc0Jsb2NrTGFuZ3VhZ2VFbmFibGVkKGJsb2NrLCBzZXR0aW5ncykpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5ydW5uZXJzLmZpbmQoKHJ1bm5lcikgPT4gKCFydW5uZXIubGFuZ3VhZ2VzLmxlbmd0aCB8fCBydW5uZXIubGFuZ3VhZ2VzLmluY2x1ZGVzKGJsb2NrLmxhbmd1YWdlKSkgJiYgcnVubmVyLmNhblJ1bihibG9jaywgc2V0dGluZ3MpKSA/PyBudWxsO1xuICB9XG5cbiAgZ2V0U3VwcG9ydGVkTGFuZ3VhZ2VzKCk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gWy4uLm5ldyBTZXQodGhpcy5ydW5uZXJzLmZsYXRNYXAoKHJ1bm5lcikgPT4gcnVubmVyLmxhbmd1YWdlcykpXTtcbiAgfVxuXG4gIHByaXZhdGUgaXNCbG9ja0xhbmd1YWdlRW5hYmxlZChibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChpc0xhbmd1YWdlRW5hYmxlZChibG9jay5sYW5ndWFnZSwgc2V0dGluZ3MpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGFyZUN1c3RvbUxhbmd1YWdlc0VuYWJsZWQoc2V0dGluZ3MpICYmIHNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5zb21lKChsYW5ndWFnZSkgPT4ge1xuICAgICAgY29uc3QgbmFtZSA9IGxhbmd1YWdlLm5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCBhbGlhc2VzID0gbGFuZ3VhZ2UuYWxpYXNlc1xuICAgICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAgIC5tYXAoKGFsaWFzKSA9PiBhbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICAgIHJldHVybiBuYW1lID09PSBibG9jay5sYW5ndWFnZS50cmltKCkudG9Mb3dlckNhc2UoKSB8fCBhbGlhc2VzLmluY2x1ZGVzKGJsb2NrLmxhbmd1YWdlQWxpYXMudHJpbSgpLnRvTG93ZXJDYXNlKCkpO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgZ2V0RGVmYXVsdExhbmd1YWdlSWRzLCBnZXREZWZhdWx0TGFuZ3VhZ2VQYWNrSWRzIH0gZnJvbSBcIi4vbGFuZ3VhZ2VQYWNrYWdlc1wiO1xuaW1wb3J0IHR5cGUgeyBsb29tUGx1Z2luU2V0dGluZ3MgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgY29uc3QgREVGQVVMVF9TRVRUSU5HUzogbG9vbVBsdWdpblNldHRpbmdzID0ge1xuICBlbmFibGVMb2NhbEV4ZWN1dGlvbjogZmFsc2UsXG4gIGhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2s6IGZhbHNlLFxuICBwcmVzZXJ2ZVNvdXJjZU1vZGU6IHRydWUsXG4gIGRlZmF1bHRUaW1lb3V0TXM6IDgwMDAsXG4gIHdvcmtpbmdEaXJlY3Rvcnk6IFwiXCIsXG4gIHB5dGhvbkV4ZWN1dGFibGU6IFwicHl0aG9uM1wiLFxuICBub2RlRXhlY3V0YWJsZTogXCJub2RlXCIsXG4gIHR5cGVzY3JpcHRNb2RlOiBcInRzLW5vZGVcIixcbiAgdHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlOiBcInRzLW5vZGVcIixcbiAgb2NhbWxNb2RlOiBcIm9jYW1sXCIsXG4gIG9jYW1sRXhlY3V0YWJsZTogXCJvY2FtbFwiLFxuICBjRXhlY3V0YWJsZTogXCJnY2NcIixcbiAgY3BwRXhlY3V0YWJsZTogXCJnKytcIixcbiAgc2hlbGxFeGVjdXRhYmxlOiBcImJhc2hcIixcbiAgcnVieUV4ZWN1dGFibGU6IFwicnVieVwiLFxuICBwZXJsRXhlY3V0YWJsZTogXCJwZXJsXCIsXG4gIGx1YUV4ZWN1dGFibGU6IFwibHVhXCIsXG4gIHBocEV4ZWN1dGFibGU6IFwicGhwXCIsXG4gIGdvRXhlY3V0YWJsZTogXCJnb1wiLFxuICBydXN0RXhlY3V0YWJsZTogXCJydXN0Y1wiLFxuICBoYXNrZWxsRXhlY3V0YWJsZTogXCJydW5naGNcIixcbiAgamF2YUNvbXBpbGVyRXhlY3V0YWJsZTogXCJcIixcbiAgamF2YUV4ZWN1dGFibGU6IFwiamF2YVwiLFxuICBsbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlOiBcImxsaVwiLFxuICBlYnBmQ2xhbmdFeGVjdXRhYmxlOiBcImNsYW5nXCIsXG4gIGVicGZCcGZ0b29sRXhlY3V0YWJsZTogXCJicGZ0b29sXCIsXG4gIGVicGZMbHZtT2JqZHVtcEV4ZWN1dGFibGU6IFwibGx2bS1vYmpkdW1wXCIsXG4gIGVicGZJbmNsdWRlUGF0aHM6IFwiXCIsXG4gIGVicGZBbGxvd0tlcm5lbExvYWQ6IGZhbHNlLFxuICBicGZ0cmFjZUV4ZWN1dGFibGU6IFwiYnBmdHJhY2VcIixcbiAgbGVhbkV4ZWN1dGFibGU6IFwibGVhblwiLFxuICBjb3FFeGVjdXRhYmxlOiBcImNvcWNcIixcbiAgc210RXhlY3V0YWJsZTogXCJ6M1wiLFxuICB3cml0ZU91dHB1dFRvTm90ZTogZmFsc2UsXG4gIG91dHB1dFZpc2libGVMaW5lczogMCxcbiAgYXV0b1J1bk9uRmlsZU9wZW46IGZhbHNlLFxuICBleHRyYWN0ZWRTb3VyY2VQcmV2aWV3TW9kZTogXCJjb2xsYXBzZWRcIixcbiAgc2hvd0xhbmd1YWdlQ2FwYWJpbGl0eU1ldGFkYXRhOiB0cnVlLFxuICBsYW5ndWFnZUNvbmZpZ3VyYXRpb25WZXJzaW9uOiAyLFxuICBlbmFibGVkTGFuZ3VhZ2VQYWNrczogZ2V0RGVmYXVsdExhbmd1YWdlUGFja0lkcygpLFxuICBlbmFibGVkTGFuZ3VhZ2VzOiBnZXREZWZhdWx0TGFuZ3VhZ2VJZHMoKSxcbiAgY3VzdG9tTGFuZ3VhZ2VzOiBbXSxcbiAgcGRmRXhwb3J0TW9kZTogXCJib3RoXCIsXG4gIGRlZmF1bHRDb250YWluZXJHcm91cDogXCJcIixcbn07XG4iLCAiaW1wb3J0IHsgQXBwLCBNb2RhbCwgTm90aWNlLCBQbHVnaW5TZXR0aW5nVGFiLCBTZXR0aW5nLCBub3JtYWxpemVQYXRoIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgdHlwZSBsb29tUGx1Z2luIGZyb20gXCIuL21haW5cIjtcbmltcG9ydCB7IEJVSUxUX0lOX0xBTkdVQUdFX1BBQ0tBR0VTLCBDVVNUT01fTEFOR1VBR0VfUEFDS0FHRV9JRCwgZ2V0RGVmYXVsdExhbmd1YWdlSWRzLCBnZXREZWZhdWx0TGFuZ3VhZ2VQYWNrSWRzLCBpc0xhbmd1YWdlRW5hYmxlZCwgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uIH0gZnJvbSBcIi4vbGFuZ3VhZ2VQYWNrYWdlc1wiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ3VzdG9tTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncyB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmV4cG9ydCB7IERFRkFVTFRfU0VUVElOR1MgfSBmcm9tIFwiLi9kZWZhdWx0U2V0dGluZ3NcIjtcblxuZXhwb3J0IGNsYXNzIGxvb21TZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgbG9vbVBsdWdpbjogbG9vbVBsdWdpbikge1xuICAgIHN1cGVyKGxvb21QbHVnaW4uYXBwLCBsb29tUGx1Z2luKTtcbiAgfVxuXG4gIGRpc3BsYXkoKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcImxvb21cIiB9KTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0OiBcIlJ1biBzdXBwb3J0ZWQgY29kZSBmZW5jZXMgZGlyZWN0bHkgZnJvbSBub3RlcyB3aGlsZSBwcmVzZXJ2aW5nIG5hdGl2ZSBzeW50YXggaGlnaGxpZ2h0aW5nLlwiIH0pO1xuXG4gICAgdGhpcy5yZW5kZXJHZW5lcmFsU2V0dGluZ3ModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkdlbmVyYWwgU2V0dGluZ3NcIiwgdHJ1ZSkpO1xuICAgIHRoaXMucmVuZGVyTGFuZ3VhZ2VQYWNrYWdlcyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiTGFuZ3VhZ2UgUGFja2FnZXNcIikpO1xuICAgIHRoaXMucmVuZGVyQnVpbHRJblJ1bnRpbWVzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJCdWlsdC1pbiBSdW50aW1lc1wiKSk7XG4gICAgdGhpcy5yZW5kZXJDdXN0b21MYW5ndWFnZXModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkN1c3RvbSBMYW5ndWFnZXNcIikpO1xuICAgIHZvaWQgdGhpcy5yZW5kZXJDb250YWluZXJHcm91cHModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkNvbnRhaW5lcml6YXRpb24gR3JvdXBzXCIpKTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlU2VjdGlvbihjb250YWluZXJFbDogSFRNTEVsZW1lbnQsIHRpdGxlOiBzdHJpbmcsIG9wZW4gPSBmYWxzZSk6IEhUTUxFbGVtZW50IHtcbiAgICBjb25zdCBkZXRhaWxzID0gY29udGFpbmVyRWwuY3JlYXRlRWwoXCJkZXRhaWxzXCIsIHsgY2xzOiBcImxvb20tc2V0dGluZ3Mtc2VjdGlvblwiIH0pO1xuICAgIGRldGFpbHMub3BlbiA9IG9wZW47XG4gICAgZGV0YWlscy5jcmVhdGVFbChcInN1bW1hcnlcIiwgeyB0ZXh0OiB0aXRsZSwgY2xzOiBcImxvb20tc2V0dGluZ3Mtc3VtbWFyeVwiIH0pO1xuICAgIHJldHVybiBkZXRhaWxzLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXNldHRpbmdzLXNlY3Rpb24tYm9keVwiIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJHZW5lcmFsU2V0dGluZ3MoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkVuYWJsZSBsb2NhbCBleGVjdXRpb25cIilcbiAgICAgIC5zZXREZXNjKFwiRGlzYWJsZWQgYnkgZGVmYXVsdC4gbG9vbSBydW5zIGNvZGUgb24geW91ciBsb2NhbCBtYWNoaW5lIGFuZCBkb2VzIG5vdCBwcm92aWRlIHNhbmRib3hpbmcuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24pLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbiA9IHZhbHVlO1xuICAgICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2sgPSB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJLZWVwIGxvb20gbm90ZXMgaW4gc291cmNlIG1vZGVcIilcbiAgICAgIC5zZXREZXNjKFwiUHJlc2VydmUgcmF3IGZlbmNlZCBjb2RlIGluIHRoZSBlZGl0b3IgaW5zdGVhZCBvZiBsZXR0aW5nIGxpdmUgcHJldmlldyBjb2xsYXBzZSByZXNlYXJjaCBzbmlwcGV0cy5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wcmVzZXJ2ZVNvdXJjZU1vZGUpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wcmVzZXJ2ZVNvdXJjZU1vZGUgPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgICB2b2lkIHRoaXMubG9vbVBsdWdpbi5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdm9pZCB0aGlzLmxvb21QbHVnaW4uZGlzYWJsZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiRGVmYXVsdCB0aW1lb3V0XCIpXG4gICAgICAuc2V0RGVzYyhcIk1heGltdW0gZXhlY3V0aW9uIHRpbWUgaW4gbWlsbGlzZWNvbmRzIGJlZm9yZSBsb29tIHRlcm1pbmF0ZXMgdGhlIHByb2Nlc3MuXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRQbGFjZWhvbGRlcihcIjgwMDBcIikuc2V0VmFsdWUoU3RyaW5nKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgY29uc3QgcGFyc2VkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLCAxMCk7XG4gICAgICAgICAgaWYgKCFOdW1iZXIuaXNOYU4ocGFyc2VkKSAmJiBwYXJzZWQgPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcyA9IHBhcnNlZDtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJXb3JraW5nIGRpcmVjdG9yeVwiKVxuICAgICAgLnNldERlc2MoXCJPcHRpb25hbC4gRW1wdHkgdXNlcyB0aGUgY3VycmVudCBub3RlIGZvbGRlciB3aGVuIHBvc3NpYmxlLCBvdGhlcndpc2UgdGhlIHZhdWx0IHJvb3QuXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRQbGFjZWhvbGRlcihcIlZhdWx0IHJvb3RcIikuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5ID0gdmFsdWUudHJpbSgpID8gbm9ybWFsaXplUGF0aCh2YWx1ZS50cmltKCkpIDogXCJcIjtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJXcml0ZSBvdXRwdXQgYmFjayB0byBub3RlXCIpXG4gICAgICAuc2V0RGVzYyhcIkluc2VydCBtYW5hZ2VkIGxvb20gb3V0cHV0IHNlY3Rpb25zIGJlbmVhdGggY29kZSBibG9ja3MgaW5zdGVhZCBvZiBrZWVwaW5nIHJlc3VsdHMgcHVyZWx5IGluIHRoZSBVSS5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53cml0ZU91dHB1dFRvTm90ZSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndyaXRlT3V0cHV0VG9Ob3RlID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiVmlzaWJsZSBvdXRwdXQgbGluZXNcIilcbiAgICAgIC5zZXREZXNjKFwiTGltaXQgZWFjaCBzdGRvdXQsIHN0ZGVyciwgYW5kIHdhcm5pbmcgcGFuZWwgdG8gdGhpcyBtYW55IHZpc2libGUgbGluZXMuIFVzZSAwIGZvciB1bmxpbWl0ZWQgb3V0cHV0LlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0UGxhY2Vob2xkZXIoXCIwXCIpLnNldFZhbHVlKFN0cmluZyh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mub3V0cHV0VmlzaWJsZUxpbmVzID8/IDApKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIucGFyc2VJbnQodmFsdWUudHJpbSgpLCAxMCk7XG4gICAgICAgICAgaWYgKCFOdW1iZXIuaXNOYU4ocGFyc2VkKSAmJiBwYXJzZWQgPj0gMCkge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLm91dHB1dFZpc2libGVMaW5lcyA9IE1hdGgubWluKHBhcnNlZCwgMjAwMCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiQXV0by1ydW4gb24gZmlsZSBvcGVuXCIpXG4gICAgICAuc2V0RGVzYyhcIlJ1biBhbGwgc3VwcG9ydGVkIGJsb2NrcyBpbiB0aGUgYWN0aXZlIG5vdGUgd2hlbiBpdCBvcGVucy4gRGlzYWJsZWQgYnkgZGVmYXVsdC5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5hdXRvUnVuT25GaWxlT3Blbikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmF1dG9SdW5PbkZpbGVPcGVuID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiRXh0cmFjdGVkIHNvdXJjZSBwcmV2aWV3XCIpXG4gICAgICAuc2V0RGVzYyhcIkNob29zZSBob3cgbG9vbSBzaG93cyB0aGUgbWF0ZXJpYWxpemVkIHNvdXJjZSBmb3IgYmxvY2tzIHRoYXQgdXNlIGxvb20tZmlsZS5cIilcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbihcImNvbGxhcHNlZFwiLCBcIkNvbGxhcHNlZFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJleHBhbmRlZFwiLCBcIkV4cGFuZGVkXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImhpZGRlblwiLCBcIkhpZGRlblwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZXh0cmFjdGVkU291cmNlUHJldmlld01vZGUgfHwgXCJjb2xsYXBzZWRcIilcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZXh0cmFjdGVkU291cmNlUHJldmlld01vZGUgPSB2YWx1ZSBhcyBcImNvbGxhcHNlZFwiIHwgXCJleHBhbmRlZFwiIHwgXCJoaWRkZW5cIjtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiU2hvdyBjYXBhYmlsaXR5IG1ldGFkYXRhXCIpXG4gICAgICAuc2V0RGVzYyhcIlNob3cgc3ltYm9sLCBkZXBlbmRlbmN5LCBhbmQgaGFybmVzcyBjYXBhYmlsaXR5IG1ldGFkYXRhIGluIGV4dHJhY3RlZCBzb3VyY2UgcHJldmlldyBoZWFkZXJzLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnNob3dMYW5ndWFnZUNhcGFiaWxpdHlNZXRhZGF0YSA/PyB0cnVlKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Muc2hvd0xhbmd1YWdlQ2FwYWJpbGl0eU1ldGFkYXRhID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiUERGIGV4cG9ydCBtb2RlXCIpXG4gICAgICAuc2V0RGVzYyhcIkNob29zZSB3aGF0IHRvIGluY2x1ZGUgd2hlbiBleHBvcnRpbmcgbm90ZXMgY29udGFpbmluZyBsb29tIGNvZGUgYmxvY2tzIHRvIFBERi5cIilcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbihcImJvdGhcIiwgXCJCb3RoIENvZGUgYW5kIE91dHB1dFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJjb2RlXCIsIFwiQ29kZSBCbG9jayBPbmx5XCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcIm91dHB1dFwiLCBcIk91dHB1dCBPbmx5XCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlIHx8IFwiYm90aFwiKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID0gdmFsdWUgYXMgXCJib3RoXCIgfCBcImNvZGVcIiB8IFwib3V0cHV0XCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJCdWlsdEluUnVudGltZXMoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgaWYgKHRoaXMuaXNSdW50aW1lTGFuZ3VhZ2VFbmFibGVkKFwicHl0aG9uXCIpKSB7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlB5dGhvbiBleGVjdXRhYmxlXCIsIFwiUGF0aCBvciBjb21tYW5kIG5hbWUgZm9yIFB5dGhvbi5cIiwgXCJweXRob25FeGVjdXRhYmxlXCIpO1xuICAgIH1cbiAgICBpZiAodGhpcy5pc1J1bnRpbWVMYW5ndWFnZUVuYWJsZWQoXCJqYXZhc2NyaXB0XCIpKSB7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIk5vZGUgZXhlY3V0YWJsZVwiLCBcIlBhdGggb3IgY29tbWFuZCBuYW1lIGZvciBKYXZhU2NyaXB0IGV4ZWN1dGlvbi5cIiwgXCJub2RlRXhlY3V0YWJsZVwiKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5pc1J1bnRpbWVMYW5ndWFnZUVuYWJsZWQoXCJ0eXBlc2NyaXB0XCIpKSB7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJUeXBlU2NyaXB0IHJ1bm5lciBtb2RlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiVXNlIHRzLW5vZGUgb3IgdHN4IGZvciBUeXBlU2NyaXB0IGJsb2Nrcy5cIilcbiAgICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgICBkcm9wZG93blxuICAgICAgICAgICAgLmFkZE9wdGlvbihcInRzLW5vZGVcIiwgXCJ0cy1ub2RlXCIpXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwidHN4XCIsIFwidHN4XCIpXG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnR5cGVzY3JpcHRNb2RlKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MudHlwZXNjcmlwdE1vZGUgPSB2YWx1ZSBhcyBcInRzLW5vZGVcIiB8IFwidHN4XCI7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlR5cGVTY3JpcHQgdHJhbnNwaWxlciBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciB0cy1ub2RlIG9yIHRzeC5cIiwgXCJ0eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGVcIik7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaXNSdW50aW1lTGFuZ3VhZ2VFbmFibGVkKFwib2NhbWxcIikpIHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIk9DYW1sIG1vZGVcIilcbiAgICAgICAgLnNldERlc2MoXCJDaG9vc2UgYmV0d2VlbiB0aGUgT0NhbWwgdG9wbGV2ZWwsIG9jYW1sYyBjb21waWxhdGlvbiwgb3IgZHVuZSBleGVjLlwiKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwib2NhbWxcIiwgXCJvY2FtbFwiKVxuICAgICAgICAgICAgLmFkZE9wdGlvbihcIm9jYW1sY1wiLCBcIm9jYW1sY1wiKVxuICAgICAgICAgICAgLmFkZE9wdGlvbihcImR1bmVcIiwgXCJkdW5lXCIpXG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLm9jYW1sTW9kZSlcbiAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLm9jYW1sTW9kZSA9IHZhbHVlIGFzIFwib2NhbWxcIiB8IFwib2NhbWxjXCIgfCBcImR1bmVcIjtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfSksXG4gICAgICAgICk7XG5cbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiT0NhbWwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3Igb2NhbWwsIG9jYW1sYywgb3IgZHVuZSBkZXBlbmRpbmcgb24gdGhlIHNlbGVjdGVkIG1vZGUuXCIsIFwib2NhbWxFeGVjdXRhYmxlXCIpO1xuICAgIH1cblxuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJjXCJdLCBcIkMgY29tcGlsZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNvbXBpbGluZyBDIGJsb2Nrcy5cIiwgXCJjRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wiY3BwXCJdLCBcIkMrKyBjb21waWxlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY29tcGlsaW5nIEMrKyBibG9ja3MuXCIsIFwiY3BwRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wic2hlbGxcIl0sIFwiU2hlbGwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgU2hlbGwsIEJhc2gsIGFuZCBzaCBibG9ja3MuXCIsIFwic2hlbGxFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJydWJ5XCJdLCBcIlJ1YnkgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgUnVieSBibG9ja3MuXCIsIFwicnVieUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcInBlcmxcIl0sIFwiUGVybCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBQZXJsIGJsb2Nrcy5cIiwgXCJwZXJsRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wibHVhXCJdLCBcIkx1YSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBMdWEgYmxvY2tzLlwiLCBcImx1YUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcInBocFwiXSwgXCJQSFAgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgUEhQIGJsb2Nrcy5cIiwgXCJwaHBFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJnb1wiXSwgXCJHbyBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBHbyBibG9ja3MuXCIsIFwiZ29FeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJydXN0XCJdLCBcIlJ1c3QgY29tcGlsZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNvbXBpbGluZyBSdXN0IGJsb2Nrcy5cIiwgXCJydXN0RXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wiaGFza2VsbFwiXSwgXCJIYXNrZWxsIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIEhhc2tlbGwgYmxvY2tzLiBEZWZhdWx0cyB0byBydW5naGMuXCIsIFwiaGFza2VsbEV4ZWN1dGFibGVcIik7XG4gICAgaWYgKHRoaXMuaXNSdW50aW1lTGFuZ3VhZ2VFbmFibGVkKFwiamF2YVwiKSkge1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJKYXZhIGNvbXBpbGVyXCIsIFwiT3B0aW9uYWwgY29tbWFuZCBvciBwYXRoIGZvciBqYXZhYy4gTGVhdmUgZW1wdHkgdG8gdXNlIEphdmEgc291cmNlLWZpbGUgbW9kZS5cIiwgXCJqYXZhQ29tcGlsZXJFeGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJKYXZhIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIHJ1bm5pbmcgY29tcGlsZWQgSmF2YSBibG9ja3MuXCIsIFwiamF2YUV4ZWN1dGFibGVcIik7XG4gICAgfVxuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJsbHZtLWlyXCJdLCBcIkxMVk0gSVIgaW50ZXJwcmV0ZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIHJ1bm5pbmcgTExWTSBJUiBibG9ja3Mgd2l0aCBsbGkuXCIsIFwibGx2bUludGVycHJldGVyRXhlY3V0YWJsZVwiKTtcbiAgICBpZiAodGhpcy5pc1J1bnRpbWVMYW5ndWFnZUVuYWJsZWQoXCJlYnBmLWNcIikpIHtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiZUJQRiBjbGFuZyBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjbGFuZyB3aXRoIEJQRiB0YXJnZXQgc3VwcG9ydC5cIiwgXCJlYnBmQ2xhbmdFeGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJlQlBGIGJwZnRvb2wgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgYnBmdG9vbCB2ZXJpZmllciBhbmQgbG9hZCBvcGVyYXRpb25zLlwiLCBcImVicGZCcGZ0b29sRXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiZUJQRiBvYmplY3QgaW5zcGVjdG9yXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBsbHZtLW9iamR1bXAuIExlYXZlIGVtcHR5IHRvIHNraXAgb2JqZWN0IHNlY3Rpb24gaW5zcGVjdGlvbi5cIiwgXCJlYnBmTGx2bU9iamR1bXBFeGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJlQlBGIGluY2x1ZGUgcGF0aHNcIiwgXCJDb21tYS1zZXBhcmF0ZWQgaW5jbHVkZSBkaXJlY3RvcmllcyBwYXNzZWQgdG8gY2xhbmcgd2l0aCAtSS5cIiwgXCJlYnBmSW5jbHVkZVBhdGhzXCIpO1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiQWxsb3cgZUJQRiBrZXJuZWwgbG9hZFwiKVxuICAgICAgICAuc2V0RGVzYyhcIlJlcXVpcmVkIGJlZm9yZSBhbnkgYmxvY2sgY2FuIHVzZSBsb29tLWVicGYtbW9kZT1sb2FkLiBDb21waWxlLW9ubHkgbW9kZSBzdGF5cyBhdmFpbGFibGUgd2l0aG91dCB0aGlzLlwiKVxuICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lYnBmQWxsb3dLZXJuZWxMb2FkKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lYnBmQWxsb3dLZXJuZWxMb2FkID0gdmFsdWU7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgfVxuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJicGZ0cmFjZVwiXSwgXCJicGZ0cmFjZSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBicGZ0cmFjZSBzY3JpcHRzLlwiLCBcImJwZnRyYWNlRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wibGVhblwiXSwgXCJMZWFuIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNoZWNraW5nIExlYW4gYmxvY2tzLlwiLCBcImxlYW5FeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJjb3FcIl0sIFwiQ29xIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNoZWNraW5nIENvcSBibG9ja3Mgd2l0aCBjb3FjLlwiLCBcImNvcUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcInNtdGxpYlwiXSwgXCJTTVQgc29sdmVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBTTVQtTElCIGJsb2Nrcy4gRGVmYXVsdHMgdG8gejMuXCIsIFwic210RXhlY3V0YWJsZVwiKTtcbiAgfVxuXG4gIHByaXZhdGUgYWRkUnVudGltZVRleHRTZXR0aW5nPEsgZXh0ZW5kcyBrZXlvZiBsb29tUGx1Z2luU2V0dGluZ3M+KGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCwgbGFuZ3VhZ2VJZHM6IHN0cmluZ1tdLCBuYW1lOiBzdHJpbmcsIGRlc2NyaXB0aW9uOiBzdHJpbmcsIGtleTogSyk6IHZvaWQge1xuICAgIGlmIChsYW5ndWFnZUlkcy5zb21lKChsYW5ndWFnZUlkKSA9PiB0aGlzLmlzUnVudGltZUxhbmd1YWdlRW5hYmxlZChsYW5ndWFnZUlkKSkpIHtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIG5hbWUsIGRlc2NyaXB0aW9uLCBrZXkpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgaXNSdW50aW1lTGFuZ3VhZ2VFbmFibGVkKGxhbmd1YWdlSWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBpc0xhbmd1YWdlRW5hYmxlZChsYW5ndWFnZUlkLCB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJMYW5ndWFnZVBhY2thZ2VzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIG5vcm1hbGl6ZUxhbmd1YWdlQ29uZmlndXJhdGlvbih0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MpO1xuXG4gICAgZm9yIChjb25zdCBwYWNrIG9mIEJVSUxUX0lOX0xBTkdVQUdFX1BBQ0tBR0VTKSB7XG4gICAgICBjb25zdCBwYWNrRWwgPSBjb250YWluZXJFbC5jcmVhdGVFbChcImRldGFpbHNcIiwgeyBjbHM6IFwibG9vbS1sYW5ndWFnZS1wYWNrYWdlXCIgfSk7XG4gICAgICBwYWNrRWwub3BlbiA9IHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcy5pbmNsdWRlcyhwYWNrLmlkKTtcbiAgICAgIHBhY2tFbC5jcmVhdGVFbChcInN1bW1hcnlcIiwgeyB0ZXh0OiBwYWNrLmRpc3BsYXlOYW1lIH0pO1xuICAgICAgcGFja0VsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQ6IHBhY2suZGVzY3JpcHRpb24sIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIiB9KTtcblxuICAgICAgbmV3IFNldHRpbmcocGFja0VsKVxuICAgICAgICAuc2V0TmFtZShcIkVuYWJsZSBwYWNrYWdlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiRGlzYWJsZSB0aGlzIHRvIHJlbW92ZSB0aGUgcGFja2FnZSBsYW5ndWFnZXMgZnJvbSBwYXJzaW5nLCBjb21tYW5kIG1lbnVzLCBhbmQgcnVubmVycyBmb3IgdGhpcyB2YXVsdC5cIilcbiAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MuaW5jbHVkZXMocGFjay5pZCkpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5zZXRFbmFibGVkVmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLCBwYWNrLmlkLCB2YWx1ZSk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGxhbmd1YWdlIG9mIHBhY2subGFuZ3VhZ2VzKSB7XG4gICAgICAgICAgICAgIHRoaXMuc2V0RW5hYmxlZFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VzLCBsYW5ndWFnZS5pZCwgdmFsdWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG5cbiAgICAgIGNvbnN0IHBhY2thZ2VFbmFibGVkID0gdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLmluY2x1ZGVzKHBhY2suaWQpO1xuICAgICAgZm9yIChjb25zdCBsYW5ndWFnZSBvZiBwYWNrLmxhbmd1YWdlcykge1xuICAgICAgICBuZXcgU2V0dGluZyhwYWNrRWwpXG4gICAgICAgICAgLnNldE5hbWUobGFuZ3VhZ2UuZGlzcGxheU5hbWUpXG4gICAgICAgICAgLnNldERlc2MoYEFsaWFzZXM6ICR7bGFuZ3VhZ2UuYWxpYXNlcy5qb2luKFwiLCBcIil9YClcbiAgICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgICB0b2dnbGVcbiAgICAgICAgICAgICAgLnNldERpc2FibGVkKCFwYWNrYWdlRW5hYmxlZClcbiAgICAgICAgICAgICAgLnNldFZhbHVlKHBhY2thZ2VFbmFibGVkICYmIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VzLmluY2x1ZGVzKGxhbmd1YWdlLmlkKSlcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuc2V0RW5hYmxlZFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VzLCBsYW5ndWFnZS5pZCwgdmFsdWUpO1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiQ3VzdG9tIGxhbmd1YWdlc1wiKVxuICAgICAgLnNldERlc2MoXCJFbmFibGUgdXNlci1kZWZpbmVkIGxhbmd1YWdlcyBmcm9tIHRoZSBDdXN0b20gTGFuZ3VhZ2VzIHNlY3Rpb24uXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MuaW5jbHVkZXMoQ1VTVE9NX0xBTkdVQUdFX1BBQ0tBR0VfSUQpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLnNldEVuYWJsZWRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MsIENVU1RPTV9MQU5HVUFHRV9QQUNLQUdFX0lELCB2YWx1ZSk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiUmVzZXQgbGFuZ3VhZ2UgcGFja2FnZXNcIilcbiAgICAgIC5zZXREZXNjKFwiUmUtZW5hYmxlIGV2ZXJ5IGJ1aWx0LWluIHBhY2thZ2UgYW5kIGV2ZXJ5IGJ1aWx0LWluIGxhbmd1YWdlLlwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIlJlc2V0XCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcyA9IGdldERlZmF1bHRMYW5ndWFnZVBhY2tJZHMoKTtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcyA9IGdldERlZmF1bHRMYW5ndWFnZUlkcygpO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXRFbmFibGVkVmFsdWUodmFsdWVzOiBzdHJpbmdbXSwgaWQ6IHN0cmluZywgZW5hYmxlZDogYm9vbGVhbik6IHZvaWQge1xuICAgIGNvbnN0IGluZGV4ID0gdmFsdWVzLmluZGV4T2YoaWQpO1xuICAgIGlmIChlbmFibGVkICYmIGluZGV4IDwgMCkge1xuICAgICAgdmFsdWVzLnB1c2goaWQpO1xuICAgIH0gZWxzZSBpZiAoIWVuYWJsZWQgJiYgaW5kZXggPj0gMCkge1xuICAgICAgdmFsdWVzLnNwbGljZShpbmRleCwgMSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJDdXN0b21MYW5ndWFnZXMoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29uc3QgbGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tY3VzdG9tLWxhbmd1YWdlLWxpc3RcIiB9KTtcbiAgICB0aGlzLnJlbmRlckN1c3RvbUxhbmd1YWdlTGlzdChsaXN0RWwpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkFkZCBjdXN0b20gbGFuZ3VhZ2VcIilcbiAgICAgIC5zZXREZXNjKFwiQ3JlYXRlIGEgbmV3IGxvY2FsIGNvbW1hbmQtYmFja2VkIGxhbmd1YWdlLlwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIitcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5wdXNoKHtcbiAgICAgICAgICAgIG5hbWU6IFwiY3VzdG9tLWxhbmd1YWdlXCIsXG4gICAgICAgICAgICBhbGlhc2VzOiBcIlwiLFxuICAgICAgICAgICAgZXhlY3V0YWJsZTogXCJcIixcbiAgICAgICAgICAgIGFyZ3M6IFwie2ZpbGV9XCIsXG4gICAgICAgICAgICBleHRlbnNpb246IFwiLnR4dFwiLFxuICAgICAgICAgICAgZXh0cmFjdG9yTW9kZTogXCJjb21tYW5kXCIsXG4gICAgICAgICAgICBleHRyYWN0b3JFeGVjdXRhYmxlOiBcIlwiLFxuICAgICAgICAgICAgZXh0cmFjdG9yQXJnczogXCJ7cmVxdWVzdH1cIixcbiAgICAgICAgICAgIHRyYW5zcGlsZUV4ZWN1dGFibGU6IFwiXCIsXG4gICAgICAgICAgICB0cmFuc3BpbGVBcmdzOiBcIntyZXF1ZXN0fVwiLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJDdXN0b21MYW5ndWFnZUxpc3QoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcblxuICAgIGlmICghdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5sZW5ndGgpIHtcbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IFwiTm8gY3VzdG9tIGxhbmd1YWdlcyBjb25maWd1cmVkLlwiLFxuICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmZvckVhY2goKGxhbmd1YWdlLCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgZGV0YWlscyA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJsb29tLWN1c3RvbS1sYW5ndWFnZVwiIH0pO1xuICAgICAgZGV0YWlscy5vcGVuID0gdHJ1ZTtcbiAgICAgIGRldGFpbHMuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgdGV4dDogbGFuZ3VhZ2UubmFtZSB8fCBgQ3VzdG9tIGxhbmd1YWdlICR7aW5kZXggKyAxfWAgfSk7XG4gICAgICBjb25zdCBib2R5ID0gZGV0YWlscy5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1jdXN0b20tbGFuZ3VhZ2UtYm9keVwiIH0pO1xuXG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiTmFtZVwiLCBcIk5vcm1hbGl6ZWQgbGFuZ3VhZ2UgaWQgdXNlZCBieSBsb29tLlwiLCBcIm5hbWVcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiQWxpYXNlc1wiLCBcIkNvbW1hLXNlcGFyYXRlZCBmZW5jZSBhbGlhc2VzLlwiLCBcImFsaWFzZXNcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiRXhlY3V0YWJsZVwiLCBcIkxvY2FsIGNvbW1hbmQgb3IgYWJzb2x1dGUgZXhlY3V0YWJsZSBwYXRoLlwiLCBcImV4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiQXJndW1lbnRzXCIsIFwiU3BhY2Utc2VwYXJhdGVkIGFyZ3VtZW50cy4gVXNlIHtmaWxlfSBmb3IgdGhlIHRlbXAgc291cmNlIGZpbGUuXCIsIFwiYXJnc1wiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJFeHRlbnNpb25cIiwgXCJUZW1wIHNvdXJjZSBmaWxlIGV4dGVuc2lvbiwgZm9yIGV4YW1wbGUgLnB5LlwiLCBcImV4dGVuc2lvblwiKTtcblxuICAgICAgbmV3IFNldHRpbmcoYm9keSlcbiAgICAgICAgLnNldE5hbWUoXCJQYXJ0aWFsIGV4dHJhY3Rpb24gc3RyYXRlZ3lcIilcbiAgICAgICAgLnNldERlc2MoXCJDaG9vc2UgaG93IHRoaXMgY3VzdG9tIGxhbmd1YWdlIHN1cHBvcnRzIHBhcnRpYWwgcnVubmFibGUgc291cmNlLlwiKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwiY29tbWFuZFwiLCBcIkV4dHJhY3RvciBjb21tYW5kXCIpXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwidHJhbnNwaWxlLWNcIiwgXCJUcmFuc3BpbGUgdG8gQ1wiKVxuICAgICAgICAgICAgLnNldFZhbHVlKGxhbmd1YWdlLmV4dHJhY3Rvck1vZGUgfHwgXCJjb21tYW5kXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIGxhbmd1YWdlLmV4dHJhY3Rvck1vZGUgPSB2YWx1ZSBhcyBcImNvbW1hbmRcIiB8IFwidHJhbnNwaWxlLWNcIjtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfSksXG4gICAgICAgICk7XG5cbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJFeHRyYWN0b3IgZXhlY3V0YWJsZVwiLCBcIk9wdGlvbmFsIGNvbW1hbmQgZm9yIHBhcnRpYWwgc291cmNlIGV4dHJhY3Rpb24uIExlYXZlIGVtcHR5IHRvIHVzZSBnZW5lcmljIGxpbmUgYW5kIHN5bWJvbCBleHRyYWN0aW9uLlwiLCBcImV4dHJhY3RvckV4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiRXh0cmFjdG9yIGFyZ3VtZW50c1wiLCBcIkFyZ3VtZW50cyBmb3IgdGhlIGV4dHJhY3Rvci4gVXNlIHtyZXF1ZXN0fSwge3NvdXJjZX0sIHtoYXJuZXNzfSwge3N5bWJvbH0sIHtsaW5lU3RhcnR9LCB7bGluZUVuZH0sIHtkZXBzfSwgYW5kIHtsYW5ndWFnZX0uXCIsIFwiZXh0cmFjdG9yQXJnc1wiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJUcmFuc3BpbGUgdG8gQyBleGVjdXRhYmxlXCIsIFwiT3B0aW9uYWwgY29tbWFuZCB0aGF0IGVtaXRzIGdlbmVyYXRlZCBDIGFuZCBhIHN5bWJvbCBtYXAgYXMgSlNPTi5cIiwgXCJ0cmFuc3BpbGVFeGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIlRyYW5zcGlsZSB0byBDIGFyZ3VtZW50c1wiLCBcIkFyZ3VtZW50cyBmb3IgdGhlIHRyYW5zcGlsZXIuIFVzZSB0aGUgc2FtZSBwbGFjZWhvbGRlcnMgYXMgZXh0cmFjdG9yIGFyZ3VtZW50cy5cIiwgXCJ0cmFuc3BpbGVBcmdzXCIpO1xuXG4gICAgICBuZXcgU2V0dGluZyhib2R5KVxuICAgICAgICAuc2V0TmFtZShcIkRlbGV0ZSBsYW5ndWFnZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIlJlbW92ZSB0aGlzIGN1c3RvbSBsYW5ndWFnZS5cIilcbiAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiRGVsZXRlXCIpLnNldFdhcm5pbmcoKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZW5kZXJDb250YWluZXJHcm91cHMoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGdyb3VwcyA9IGF3YWl0IHRoaXMubG9vbVBsdWdpbi5nZXRDb250YWluZXJHcm91cFN1bW1hcmllcygpO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJEZWZhdWx0IGNvbnRhaW5lcml6YXRpb24gZ3JvdXBcIilcbiAgICAgICAgLnNldERlc2MoXCJUaGUgY29udGFpbmVyIGdyb3VwIHRvIHJ1biBjb2RlIGJsb2NrcyBpbiBieSBkZWZhdWx0IGlmIHRoZSBub3RlIGRvZXMgbm90IHNwZWNpZnkgb25lLlwiKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XG4gICAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKFwiXCIsIFwiTm9uZVwiKTtcbiAgICAgICAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKGdyb3VwLm5hbWUsIGdyb3VwLm5hbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBkcm9wZG93bi5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwIHx8IFwiXCIpO1xuICAgICAgICAgIGRyb3Bkb3duLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRDb250YWluZXJHcm91cCA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiQWRkIG5ldyBjb250YWluZXJpemF0aW9uIGdyb3VwXCIpXG4gICAgICAgIC5zZXREZXNjKFwiQ3JlYXRlIGEgbmV3IGNvbnRhaW5lcml6YXRpb24gZ3JvdXAgY29uZmlndXJhdGlvbiBmb2xkZXIuXCIpXG4gICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIitcIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICBuZXcgQ29udGFpbmVyR3JvdXBOYW1lTW9kYWwodGhpcy5hcHAsIGFzeW5jIChncm91cE5hbWUpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgY2xlYW5OYW1lID0gZ3JvdXBOYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1teYS16MC05Xy1dL2csIFwiLVwiKTtcbiAgICAgICAgICAgICAgaWYgKCFjbGVhbk5hbWUpIHtcbiAgICAgICAgICAgICAgICBuZXcgTm90aWNlKFwiSW52YWxpZCBncm91cCBuYW1lLlwiKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjb25zdCBwbHVnaW5EaXIgPSB0aGlzLmxvb21QbHVnaW4ubWFuaWZlc3QuZGlyID8/IFwiLm9ic2lkaWFuL3BsdWdpbnMvbG9vbVwiO1xuICAgICAgICAgICAgICBjb25zdCBncm91cFJlbGF0aXZlUGF0aCA9IGAke3BsdWdpbkRpcn0vY29udGFpbmVycy8ke2NsZWFuTmFtZX1gO1xuICAgICAgICAgICAgICBjb25zdCBjb25maWdQYXRoID0gYCR7Z3JvdXBSZWxhdGl2ZVBhdGh9L2NvbmZpZy5qc29uYDtcblxuICAgICAgICAgICAgICBjb25zdCBhZGFwdGVyID0gdGhpcy5hcHAudmF1bHQuYWRhcHRlcjtcbiAgICAgICAgICAgICAgaWYgKGF3YWl0IGFkYXB0ZXIuZXhpc3RzKGdyb3VwUmVsYXRpdmVQYXRoKSkge1xuICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJDb250YWluZXIgZ3JvdXAgZm9sZGVyIGFscmVhZHkgZXhpc3RzLlwiKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBhd2FpdCBhZGFwdGVyLm1rZGlyKGdyb3VwUmVsYXRpdmVQYXRoKTtcbiAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICBydW50aW1lOiBcImRvY2tlclwiLFxuICAgICAgICAgICAgICAgIGltYWdlOiBcInVidW50dTpsYXRlc3RcIixcbiAgICAgICAgICAgICAgICBsYW5ndWFnZXM6IHtcbiAgICAgICAgICAgICAgICAgIHB5dGhvbjoge1xuICAgICAgICAgICAgICAgICAgICBjb21tYW5kOiBcInB5dGhvbjMge2ZpbGV9XCIsXG4gICAgICAgICAgICAgICAgICAgIGV4dGVuc2lvbjogXCIucHlcIlxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgYXdhaXQgYWRhcHRlci53cml0ZShjb25maWdQYXRoLCBKU09OLnN0cmluZ2lmeShkZWZhdWx0Q29uZmlnLCBudWxsLCAyKSk7XG4gICAgICAgICAgICAgIG5ldyBOb3RpY2UoYENvbnRhaW5lciBncm91cCBcIiR7Y2xlYW5OYW1lfVwiIGNyZWF0ZWQuYCk7XG4gICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgICAgfSkub3BlbigpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICBjb25zdCBsaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1jb250YWluZXItZ3JvdXAtbGlzdFwiIH0pO1xuICAgICAgaWYgKCFncm91cHMubGVuZ3RoKSB7XG4gICAgICAgIGxpc3RFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICAgIHRleHQ6IFwiTm8gY29udGFpbmVyIGdyb3VwcyBmb3VuZCBpbiAub2JzaWRpYW4vcGx1Z2lucy9sb29tL2NvbnRhaW5lcnMuXCIsXG4gICAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgICBuZXcgU2V0dGluZyhsaXN0RWwpXG4gICAgICAgICAgLnNldE5hbWUoZ3JvdXAubmFtZSlcbiAgICAgICAgICAuc2V0RGVzYyhncm91cC5zdGF0dXMpXG4gICAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJCdWlsZCAvIHJlYnVpbGRcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5idWlsZENvbnRhaW5lckdyb3VwKGdyb3VwLm5hbWUpO1xuICAgICAgICAgICAgfSksXG4gICAgICAgICAgKVxuICAgICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiRWRpdFwiKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcGx1Z2luRGlyID0gdGhpcy5sb29tUGx1Z2luLm1hbmlmZXN0LmRpciA/PyBcIi5vYnNpZGlhbi9wbHVnaW5zL2xvb21cIjtcbiAgICAgICAgICAgICAgbmV3IEVkaXRDb250YWluZXJHcm91cE1vZGFsKHRoaXMubG9vbVBsdWdpbiwgZ3JvdXAubmFtZSwgcGx1Z2luRGlyLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgICAgICAgIH0pLm9wZW4oKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBgRXJyb3IgbG9hZGluZyBjb250YWluZXIgZ3JvdXBzOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgICBjbHM6IFwibG9vbS1zZXR0aW5ncy1lcnJvclwiLFxuICAgICAgICBhdHRyOiB7IHN0eWxlOiBcImNvbG9yOiB2YXIoLS10ZXh0LWVycm9yKTsgZm9udC13ZWlnaHQ6IGJvbGQ7IG1hcmdpbjogMWVtIDA7XCIgfVxuICAgICAgfSk7XG4gICAgICBjb25zb2xlLmVycm9yKFwibG9vbTogZmFpbGVkIHRvIHJlbmRlciBjb250YWluZXIgZ3JvdXBzOlwiLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhZGRUZXh0U2V0dGluZzxLIGV4dGVuZHMga2V5b2YgbG9vbVBsdWdpblNldHRpbmdzPihjb250YWluZXJFbDogSFRNTEVsZW1lbnQsIG5hbWU6IHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZywga2V5OiBLKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShuYW1lKVxuICAgICAgLnNldERlc2MoZGVzY3JpcHRpb24pXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRWYWx1ZShTdHJpbmcodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzW2tleV0gPz8gXCJcIikpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Nba2V5XSBhcyBzdHJpbmcpID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nPEsgZXh0ZW5kcyBrZXlvZiBsb29tQ3VzdG9tTGFuZ3VhZ2U+KFxuICAgIGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCxcbiAgICBsYW5ndWFnZTogbG9vbUN1c3RvbUxhbmd1YWdlLFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICBkZXNjcmlwdGlvbjogc3RyaW5nLFxuICAgIGtleTogSyxcbiAgKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShuYW1lKVxuICAgICAgLnNldERlc2MoZGVzY3JpcHRpb24pXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRWYWx1ZShTdHJpbmcobGFuZ3VhZ2Vba2V5XSA/PyBcIlwiKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgKGxhbmd1YWdlW2tleV0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkKSA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2hvd0V4ZWN1dGlvbkRpc2FibGVkTm90aWNlKCk6IHZvaWQge1xuICBuZXcgTm90aWNlKFwibG9vbSBsb2NhbCBleGVjdXRpb24gaXMgZGlzYWJsZWQuIEVuYWJsZSBpdCBpbiBzZXR0aW5ncyBvciBjb25maXJtIHRoZSBleGVjdXRpb24gd2FybmluZyBmaXJzdC5cIik7XG59XG5cbmNsYXNzIENvbnRhaW5lckdyb3VwTmFtZU1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwcml2YXRlIG5hbWUgPSBcIlwiO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGFwcDogQXBwLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb25TdWJtaXQ6IChuYW1lOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD4sXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcIk5ldyBDb250YWluZXIgR3JvdXAgTmFtZVwiIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJHcm91cCBOYW1lXCIpXG4gICAgICAuc2V0RGVzYyhcIlVzZSBsb3dlcmNhc2UgbGV0dGVycywgbnVtYmVycywgaHlwaGVucywgYW5kIHVuZGVyc2NvcmVzLlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5uYW1lID0gdmFsdWU7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJDcmVhdGVcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLm9uU3VibWl0KHRoaXMubmFtZSk7XG4gICAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuICB9XG59XG5cbmNsYXNzIEVkaXRDb250YWluZXJHcm91cE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwcml2YXRlIGFjdGl2ZVRhYjogXCJnZW5lcmFsXCIgfCBcImxhbmd1YWdlc1wiIHwgXCJkb2NrZXJmaWxlXCIgfCBcInJhd1wiID0gXCJnZW5lcmFsXCI7XG4gIHByaXZhdGUgY29uZmlnT2JqOiBhbnkgPSB7fTtcbiAgcHJpdmF0ZSByYXdKc29uVGV4dCA9IFwiXCI7XG4gIHByaXZhdGUgZG9ja2VyZmlsZVRleHQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIG5ld0xhbmd1YWdlTmFtZSA9IFwiXCI7XG4gIHByaXZhdGUgdGFiSGVhZGVyRWwhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSB0YWJDb250ZW50RWwhOiBIVE1MRWxlbWVudDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGxvb21QbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBncm91cE5hbWU6IHN0cmluZyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbkRpcjogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb25TYXZlOiAoKSA9PiB2b2lkXG4gICkge1xuICAgIHN1cGVyKGxvb21QbHVnaW4uYXBwKTtcbiAgfVxuXG4gIGFzeW5jIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IGBFZGl0IENvbmZpZzogJHt0aGlzLmdyb3VwTmFtZX1gIH0pO1xuXG4gICAgY29uc3QgY29uZmlnUGF0aCA9IGAke3RoaXMucGx1Z2luRGlyfS9jb250YWluZXJzLyR7dGhpcy5ncm91cE5hbWV9L2NvbmZpZy5qc29uYDtcbiAgICBjb25zdCBkb2NrZXJmaWxlUGF0aCA9IGAke3RoaXMucGx1Z2luRGlyfS9jb250YWluZXJzLyR7dGhpcy5ncm91cE5hbWV9L0RvY2tlcmZpbGVgO1xuICAgIGNvbnN0IGFkYXB0ZXIgPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJhd0NvbmZpZyA9IGF3YWl0IGFkYXB0ZXIucmVhZChjb25maWdQYXRoKTtcbiAgICAgIHRoaXMuY29uZmlnT2JqID0gSlNPTi5wYXJzZShyYXdDb25maWcpO1xuICAgICAgdGhpcy5yYXdKc29uVGV4dCA9IHJhd0NvbmZpZztcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBuZXcgTm90aWNlKFwiQ291bGQgbm90IHJlYWQgY29uZmlndXJhdGlvbiBmaWxlLlwiKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgaWYgKGF3YWl0IGFkYXB0ZXIuZXhpc3RzKGRvY2tlcmZpbGVQYXRoKSkge1xuICAgICAgICB0aGlzLmRvY2tlcmZpbGVUZXh0ID0gYXdhaXQgYWRhcHRlci5yZWFkKGRvY2tlcmZpbGVQYXRoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBudWxsO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbnRhaW5lciA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS10YWItY29udGFpbmVyXCIgfSk7XG5cbiAgICAvLyBSZW5kZXIgVGFiIEhlYWRlclxuICAgIHRoaXMudGFiSGVhZGVyRWwgPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tdGFiLWhlYWRlclwiIH0pO1xuICAgIHRoaXMucmVuZGVyVGFicygpO1xuXG4gICAgLy8gUmVuZGVyIFRhYiBDb250ZW50IEFyZWFcbiAgICB0aGlzLnRhYkNvbnRlbnRFbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS10YWItY29udGVudFwiIH0pO1xuXG4gICAgLy8gUmVuZGVyIEFjdGlvbnMgRm9vdGVyXG4gICAgY29uc3QgYWN0aW9ucyA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1tb2RhbC1hY3Rpb25zXCIgfSk7XG4gICAgYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQ2FuY2VsXCIgfSkuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XG4gICAgY29uc3Qgc2F2ZUJ0biA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlNhdmVcIiwgY2xzOiBcIm1vZC1jdGFcIiB9KTtcbiAgICBzYXZlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLnNhdmVBbmRDbG9zZSgpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgfVxuXG4gIHJlbmRlclRhYnMoKSB7XG4gICAgdGhpcy50YWJIZWFkZXJFbC5lbXB0eSgpO1xuICAgIGNvbnN0IHRhYnM6IEFycmF5PHsgaWQ6IFwiZ2VuZXJhbFwiIHwgXCJsYW5ndWFnZXNcIiB8IFwiZG9ja2VyZmlsZVwiIHwgXCJyYXdcIjsgbGFiZWw6IHN0cmluZyB9PiA9IFtcbiAgICAgIHsgaWQ6IFwiZ2VuZXJhbFwiLCBsYWJlbDogXCJHZW5lcmFsXCIgfSxcbiAgICAgIHsgaWQ6IFwibGFuZ3VhZ2VzXCIsIGxhYmVsOiBcIkxhbmd1YWdlc1wiIH0sXG4gICAgICB7IGlkOiBcImRvY2tlcmZpbGVcIiwgbGFiZWw6IFwiRG9ja2VyZmlsZVwiIH0sXG4gICAgICB7IGlkOiBcInJhd1wiLCBsYWJlbDogXCJSYXcgSlNPTlwiIH0sXG4gICAgXTtcblxuICAgIGZvciAoY29uc3QgdGFiIG9mIHRhYnMpIHtcbiAgICAgIGNvbnN0IGJ0biA9IHRoaXMudGFiSGVhZGVyRWwuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgICB0ZXh0OiB0YWIubGFiZWwsXG4gICAgICAgIGNsczogXCJsb29tLXRhYi1idG5cIiArICh0aGlzLmFjdGl2ZVRhYiA9PT0gdGFiLmlkID8gXCIgaXMtYWN0aXZlXCIgOiBcIlwiKSxcbiAgICAgIH0pO1xuICAgICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy5zd2l0Y2hUYWIodGFiLmlkKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHN3aXRjaFRhYih0YWI6IFwiZ2VuZXJhbFwiIHwgXCJsYW5ndWFnZXNcIiB8IFwiZG9ja2VyZmlsZVwiIHwgXCJyYXdcIikge1xuICAgIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJyYXdcIikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5jb25maWdPYmogPSBKU09OLnBhcnNlKHRoaXMucmF3SnNvblRleHQpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBuZXcgTm90aWNlKFwiSW52YWxpZCBKU09OIHN5bnRheCBpbiBSYXcgSlNPTiB0YWIuIFBsZWFzZSBmaXggaXQgYmVmb3JlIHN3aXRjaGluZy5cIik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5hY3RpdmVUYWIgPSB0YWI7XG4gICAgdGhpcy5yZW5kZXJUYWJzKCk7XG4gICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgfVxuXG4gIHJlbmRlckFjdGl2ZVRhYigpIHtcbiAgICB0aGlzLnRhYkNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJnZW5lcmFsXCIpIHtcbiAgICAgIHRoaXMucmVuZGVyR2VuZXJhbFRhYih0aGlzLnRhYkNvbnRlbnRFbCk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJsYW5ndWFnZXNcIikge1xuICAgICAgdGhpcy5yZW5kZXJMYW5ndWFnZXNUYWIodGhpcy50YWJDb250ZW50RWwpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwiZG9ja2VyZmlsZVwiKSB7XG4gICAgICB0aGlzLnJlbmRlckRvY2tlcmZpbGVUYWIodGhpcy50YWJDb250ZW50RWwpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwicmF3XCIpIHtcbiAgICAgIHRoaXMucmVuZGVyUmF3VGFiKHRoaXMudGFiQ29udGVudEVsKTtcbiAgICB9XG4gIH1cblxuICByZW5kZXJHZW5lcmFsVGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xuICAgIC8vIFJ1bnRpbWUgc2VsZWN0IGRyb3Bkb3duXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlJ1bnRpbWVcIilcbiAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIHRoZSBjb250YWluZXIvZW52aXJvbm1lbnQgbWFuYWdlciBydW50aW1lLlwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJkb2NrZXJcIiwgXCJEb2NrZXJcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwicG9kbWFuXCIsIFwiUG9kbWFuXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcIndzbFwiLCBcIldTTFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJxZW11XCIsIFwiUUVNVVwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJjdXN0b21cIiwgXCJDdXN0b21cIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucnVudGltZSB8fCBcImRvY2tlclwiKVxuICAgICAgICAgIC5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPSB2YWx1ZTtcbiAgICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgIC8vIENvbmRpdGlvbmFsIGltYWdlL2Rpc3RybyBuYW1lXG4gICAgaWYgKFxuICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJkb2NrZXJcIiB8fFxuICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJwb2RtYW5cIiB8fFxuICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJ3c2xcIlxuICAgICkge1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwid3NsXCIgPyBcIldTTCBEaXN0cm9cIiA6IFwiQmFzZSBJbWFnZVwiKVxuICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcIndzbFwiXG4gICAgICAgICAgICA/IFwiT3B0aW9uYWwuIFRoZSB0YXJnZXQgV1NMIGRpc3RybyBuYW1lIChsZWF2ZSBlbXB0eSBmb3IgZGVmYXVsdCBkaXN0cm8pLlwiXG4gICAgICAgICAgICA6IFwiRmFsbGJhY2sgRG9ja2VyL1BvZG1hbiBpbWFnZSBpZiBubyBEb2NrZXJmaWxlIGlzIHByZXNlbnQuXCJcbiAgICAgICAgKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5pbWFnZSB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmouaW1hZ2UgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcIndzbFwiKSB7XG4gICAgICBpZiAoIXRoaXMuY29uZmlnT2JqLndzbCkge1xuICAgICAgICB0aGlzLmNvbmZpZ09iai53c2wgPSB7fTtcbiAgICAgIH1cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlVzZSBJbnRlcmFjdGl2ZSBTaGVsbFwiKVxuICAgICAgICAuc2V0RGVzYyhcIlVzZSBpbnRlcmFjdGl2ZSBsb2dpbiBzaGVsbCBmbGFncyAoLWkgLWwpIHRvIGVuc3VyZSB+Ly5iYXNocmMgaW5pdGlhbGl6YXRpb24gd29ya3MgKGUuZy4sIGZvciBOVk0pLlwiKVxuICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+IHtcbiAgICAgICAgICB0b2dnbGVcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai53c2wuaW50ZXJhY3RpdmUgPz8gZmFsc2UpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai53c2wuaW50ZXJhY3RpdmUgPSB2YWw7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQ29uZGl0aW9uYWwgUUVNVSBTZXR0aW5nc1xuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcInFlbXVcIikge1xuICAgICAgaWYgKCF0aGlzLmNvbmZpZ09iai5xZW11KSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqLnFlbXUgPSB7IHNzaFRhcmdldDogXCJcIiwgcmVtb3RlV29ya3NwYWNlOiBcIlwiIH07XG4gICAgICB9XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlNTSCBUYXJnZXRcIilcbiAgICAgICAgLnNldERlc2MoXCJTU0ggdGFyZ2V0IGFkZHJlc3MgKGUuZy4gdXNlckBob3N0bmFtZSBvciBsb2NhbGhvc3QgLXAgMjIyMikuXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoVGFyZ2V0IHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11LnNzaFRhcmdldCA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlJlbW90ZSBXb3Jrc3BhY2VcIilcbiAgICAgICAgLnNldERlc2MoXCJSZW1vdGUgZm9sZGVyIHBhdGggdG8gY29weSBjb2RlIHNuaXBwZXRzIGFuZCBydW4gY29tbWFuZHMgKGUuZy4sIC9ob21lL3VzZXIvd29ya3NwYWNlKS5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucWVtdS5yZW1vdGVXb3Jrc3BhY2UgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnFlbXUucmVtb3RlV29ya3NwYWNlID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiU1NIIEV4ZWN1dGFibGVcIilcbiAgICAgICAgLnNldERlc2MoXCJPcHRpb25hbC4gUGF0aCB0byBTU0ggY2xpZW50IGV4ZWN1dGFibGUgKGRlZmF1bHRzIHRvIHNzaCkuXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoRXhlY3V0YWJsZSB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5zc2hFeGVjdXRhYmxlID0gdmFsLnRyaW0oKSB8fCB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlNTSCBBcmd1bWVudHNcIilcbiAgICAgICAgLnNldERlc2MoXCJPcHRpb25hbC4gQWRkaXRpb25hbCBTU0ggQ0xJIGZsYWdzLlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5xZW11LnNzaEFyZ3MgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoQXJncyA9IHZhbC50cmltKCkgfHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIENvbmRpdGlvbmFsIEN1c3RvbSBTZXR0aW5nc1xuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcImN1c3RvbVwiKSB7XG4gICAgICBpZiAoIXRoaXMuY29uZmlnT2JqLmN1c3RvbSkge1xuICAgICAgICB0aGlzLmNvbmZpZ09iai5jdXN0b20gPSB7IGV4ZWN1dGFibGU6IFwiXCIgfTtcbiAgICAgIH1cblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiQ3VzdG9tIEV4ZWN1dGFibGVcIilcbiAgICAgICAgLnNldERlc2MoXCJQYXRoIHRvIGN1c3RvbSBydW50aW1lIHdyYXBwZXIgZXhlY3V0YWJsZSBvciBzY3JpcHQuXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLmN1c3RvbS5leGVjdXRhYmxlIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5jdXN0b20uZXhlY3V0YWJsZSA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkN1c3RvbSBBcmd1bWVudHNcIilcbiAgICAgICAgLnNldERlc2MoXCJPcHRpb25hbC4gQ29tbWFuZCBhcmd1bWVudHMuIFVzZSB7cmVxdWVzdH0gZm9yIEpTT04gY29uZmlnIHBhdGguXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLmN1c3RvbS5hcmdzIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5jdXN0b20uYXJncyA9IHZhbC50cmltKCkgfHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJlbmRlckxhbmd1YWdlc1RhYihjb250YWluZXJFbDogSFRNTEVsZW1lbnQpIHtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogXCJDb25maWd1cmVkIExhbmd1YWdlc1wiIH0pO1xuXG4gICAgaWYgKCF0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXMpIHtcbiAgICAgIHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlcyA9IHt9O1xuICAgIH1cblxuICAgIGNvbnN0IGxhbmdzTGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tbGFuZ3VhZ2VzLWxpc3RcIiB9KTtcbiAgICBjb25zdCBsYW5ndWFnZXMgPSBPYmplY3QuZW50cmllcyh0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXMgYXMgUmVjb3JkPHN0cmluZywgeyBjb21tYW5kPzogc3RyaW5nOyBleHRlbnNpb24/OiBzdHJpbmc7IHVzZURlZmF1bHQ/OiBib29sZWFuIH0+KTtcblxuICAgIGlmIChsYW5ndWFnZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICBsYW5nc0xpc3RFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0OiBcIk5vIGxhbmd1YWdlcyBjb25maWd1cmVkIGZvciB0aGlzIGdyb3VwLlwiLCBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGZvciAoY29uc3QgW2xhbmdOYW1lLCBsYW5nQ29uZmlnXSBvZiBsYW5ndWFnZXMpIHtcbiAgICAgICAgY29uc3QgY2FyZCA9IGxhbmdzTGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWxhbmd1YWdlLWNhcmRcIiB9KTtcbiAgICAgICAgY2FyZC5jcmVhdGVFbChcInN0cm9uZ1wiLCB7IHRleHQ6IGxhbmdOYW1lLCBhdHRyOiB7IHN0eWxlOiBcImRpc3BsYXk6IGJsb2NrOyBtYXJnaW4tYm90dG9tOiAwLjVyZW07IGZvbnQtc2l6ZTogMS4xZW07XCIgfSB9KTtcblxuICAgICAgICBjb25zdCBpc0RlZmF1bHQgPSAobGFuZ0NvbmZpZyBhcyBhbnkpLnVzZURlZmF1bHQgPT09IHRydWU7XG5cbiAgICAgICAgbmV3IFNldHRpbmcoY2FyZClcbiAgICAgICAgICAuc2V0TmFtZShcIlVzZSBkZWZhdWx0IGNvbmZpZ3VyYXRpb25cIilcbiAgICAgICAgICAuc2V0RGVzYyhcIklmIGNoZWNrZWQsIExvb20gd2lsbCBydW4gdGhpcyBsYW5ndWFnZSB1c2luZyBpdHMgYnVpbHQtaW4gY29tbWFuZHMvZXh0ZW5zaW9ucy5cIilcbiAgICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+IHtcbiAgICAgICAgICAgIHRvZ2dsZVxuICAgICAgICAgICAgICAuc2V0VmFsdWUoaXNEZWZhdWx0KVxuICAgICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICh2YWwpIHtcbiAgICAgICAgICAgICAgICAgIChsYW5nQ29uZmlnIGFzIGFueSkudXNlRGVmYXVsdCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICBkZWxldGUgbGFuZ0NvbmZpZy5jb21tYW5kO1xuICAgICAgICAgICAgICAgICAgZGVsZXRlIGxhbmdDb25maWcuZXh0ZW5zaW9uO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICBkZWxldGUgKGxhbmdDb25maWcgYXMgYW55KS51c2VEZWZhdWx0O1xuICAgICAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdHMgPSB0aGlzLmxvb21QbHVnaW4uY29udGFpbmVyUnVubmVyLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhsYW5nTmFtZSwgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzKTtcbiAgICAgICAgICAgICAgICAgIGxhbmdDb25maWcuY29tbWFuZCA9IGRlZmF1bHRzPy5jb21tYW5kIHx8IFwiXCI7XG4gICAgICAgICAgICAgICAgICBsYW5nQ29uZmlnLmV4dGVuc2lvbiA9IGRlZmF1bHRzPy5leHRlbnNpb24gfHwgXCJcIjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgbmV3IFNldHRpbmcoY2FyZClcbiAgICAgICAgICAuc2V0TmFtZShcIkNvbW1hbmRcIilcbiAgICAgICAgICAuc2V0RGVzYyhcIkV4ZWN1dGlvbiBjb21tYW5kLiBVc2Uge2ZpbGV9IGZvciB0aGUgY29kZSBzbmlwcGV0IGZpbGVuYW1lLlwiKVxuICAgICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0cyA9IHRoaXMubG9vbVBsdWdpbi5jb250YWluZXJSdW5uZXIuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdOYW1lLCB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgICAgdGV4dFxuICAgICAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoZGVmYXVsdHM/LmNvbW1hbmQgfHwgXCJcIilcbiAgICAgICAgICAgICAgLnNldFZhbHVlKGxhbmdDb25maWcuY29tbWFuZCB8fCBcIlwiKVxuICAgICAgICAgICAgICAuc2V0RGlzYWJsZWQoaXNEZWZhdWx0KVxuICAgICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICAgIGxhbmdDb25maWcuY29tbWFuZCA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgIG5ldyBTZXR0aW5nKGNhcmQpXG4gICAgICAgICAgLnNldE5hbWUoXCJFeHRlbnNpb25cIilcbiAgICAgICAgICAuc2V0RGVzYyhcIlNvdXJjZSBmaWxlIGV4dGVuc2lvbiAoZS5nLiAucHksIC5qcykuXCIpXG4gICAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRzID0gdGhpcy5sb29tUGx1Z2luLmNvbnRhaW5lclJ1bm5lci5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcobGFuZ05hbWUsIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncyk7XG4gICAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihkZWZhdWx0cz8uZXh0ZW5zaW9uIHx8IFwiXCIpXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShsYW5nQ29uZmlnLmV4dGVuc2lvbiB8fCBcIlwiKVxuICAgICAgICAgICAgICAuc2V0RGlzYWJsZWQoaXNEZWZhdWx0KVxuICAgICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICAgIGxhbmdDb25maWcuZXh0ZW5zaW9uID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgbmV3IFNldHRpbmcoY2FyZClcbiAgICAgICAgICAuYWRkQnV0dG9uKChidG4pID0+IHtcbiAgICAgICAgICAgIGJ0blxuICAgICAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIlJlbW92ZSBMYW5ndWFnZVwiKVxuICAgICAgICAgICAgICAuc2V0V2FybmluZygpXG4gICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzW2xhbmdOYW1lXTtcbiAgICAgICAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBBZGQgTGFuZ3VhZ2UgU2VjdGlvblxuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcIkFkZCBMYW5ndWFnZSBNYXBwaW5nXCIsIGF0dHI6IHsgc3R5bGU6IFwibWFyZ2luLXRvcDogMS41cmVtO1wiIH0gfSk7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkxhbmd1YWdlIElEXCIpXG4gICAgICAuc2V0RGVzYyhcImUuZy4gcHl0aG9uLCBqYXZhc2NyaXB0LCBub2RlLCBzaFwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgdGV4dC5zZXRWYWx1ZSh0aGlzLm5ld0xhbmd1YWdlTmFtZSkub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgIHRoaXMubmV3TGFuZ3VhZ2VOYW1lID0gdmFsLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+IHtcbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCIrIEFkZFwiKS5zZXRDdGEoKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICBpZiAoIXRoaXMubmV3TGFuZ3VhZ2VOYW1lKSB7XG4gICAgICAgICAgICBuZXcgTm90aWNlKFwiUGxlYXNlIGVudGVyIGEgbGFuZ3VhZ2UgbmFtZS5cIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXNbdGhpcy5uZXdMYW5ndWFnZU5hbWVdKSB7XG4gICAgICAgICAgICBuZXcgTm90aWNlKFwiTGFuZ3VhZ2UgYWxyZWFkeSBjb25maWd1cmVkLlwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzW3RoaXMubmV3TGFuZ3VhZ2VOYW1lXSA9IHtcbiAgICAgICAgICAgIGNvbW1hbmQ6IGAke3RoaXMubmV3TGFuZ3VhZ2VOYW1lfSB7ZmlsZX1gLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBgLiR7dGhpcy5uZXdMYW5ndWFnZU5hbWV9YCxcbiAgICAgICAgICB9O1xuICAgICAgICAgIHRoaXMubmV3TGFuZ3VhZ2VOYW1lID0gXCJcIjtcbiAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICB9XG5cbiAgcmVuZGVyRG9ja2VyZmlsZVRhYihjb250YWluZXJFbDogSFRNTEVsZW1lbnQpIHtcbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSAhPT0gXCJkb2NrZXJcIiAmJiB0aGlzLmNvbmZpZ09iai5ydW50aW1lICE9PSBcInBvZG1hblwiKSB7XG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBgRG9ja2VyZmlsZSBlZGl0aW5nIGlzIG9ubHkgYXZhaWxhYmxlIGZvciBEb2NrZXIgYW5kIFBvZG1hbiBydW50aW1lcy4gQ3VycmVudGx5IHVzaW5nOiAke3RoaXMuY29uZmlnT2JqLnJ1bnRpbWV9YCxcbiAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuZG9ja2VyZmlsZVRleHQgPT09IG51bGwpIHtcbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IFwiTm8gRG9ja2VyZmlsZSBleGlzdHMgaW4gdGhpcyBjb250YWluZXIgZ3JvdXAgZGlyZWN0b3J5LlwiLFxuICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT4ge1xuICAgICAgICAgIGJ0blxuICAgICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJDcmVhdGUgRG9ja2VyZmlsZVwiKVxuICAgICAgICAgICAgLnNldEN0YSgpXG4gICAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBbXG4gICAgICAgICAgICAgICAgXCJGUk9NIHVidW50dTpsYXRlc3RcIixcbiAgICAgICAgICAgICAgICBcIlwiLFxuICAgICAgICAgICAgICAgIFwiIyBJbnN0YWxsIHBhY2thZ2VzXCIsXG4gICAgICAgICAgICAgICAgXCJSVU4gYXB0LWdldCB1cGRhdGUgJiYgYXB0LWdldCBpbnN0YWxsIC15IFxcXFxcIixcbiAgICAgICAgICAgICAgICBcIiAgICBweXRob24zIFxcXFxcIixcbiAgICAgICAgICAgICAgICBcIiAgICBub2RlanMgXFxcXFwiLFxuICAgICAgICAgICAgICAgIFwiICAgICYmIHJtIC1yZiAvdmFyL2xpYi9hcHQvbGlzdHMvKlwiLFxuICAgICAgICAgICAgICAgIFwiXCIsXG4gICAgICAgICAgICAgIF0uam9pbihcIlxcblwiKTtcbiAgICAgICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiRG9ja2VyZmlsZSBDb250ZW50XCIpXG4gICAgICAgIC5zZXREZXNjKFwiRGVmaW5lIHRoZSBidWlsZCBzdGVwcyBmb3IgeW91ciBlbnZpcm9ubWVudCBjb250YWluZXIuXCIpXG4gICAgICAgIC5hZGRUZXh0QXJlYSgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHQuaW5wdXRFbC5yb3dzID0gMTU7XG4gICAgICAgICAgdGV4dC5pbnB1dEVsLnN0eWxlLmZvbnRGYW1pbHkgPSBcIm1vbm9zcGFjZVwiO1xuICAgICAgICAgIHRleHQuaW5wdXRFbC5zdHlsZS53aWR0aCA9IFwiMTAwJVwiO1xuICAgICAgICAgIHRleHQuc2V0VmFsdWUodGhpcy5kb2NrZXJmaWxlVGV4dCB8fCBcIlwiKTtcbiAgICAgICAgICB0ZXh0Lm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSB2YWw7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJlbmRlclJhd1RhYihjb250YWluZXJFbDogSFRNTEVsZW1lbnQpIHtcbiAgICB0aGlzLnJhd0pzb25UZXh0ID0gSlNPTi5zdHJpbmdpZnkodGhpcy5jb25maWdPYmosIG51bGwsIDIpO1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJDb25maWd1cmF0aW9uIEpTT05cIilcbiAgICAgIC5hZGRUZXh0QXJlYSgodGV4dCkgPT4ge1xuICAgICAgICB0ZXh0LmlucHV0RWwucm93cyA9IDE1O1xuICAgICAgICB0ZXh0LmlucHV0RWwuc3R5bGUuZm9udEZhbWlseSA9IFwibW9ub3NwYWNlXCI7XG4gICAgICAgIHRleHQuaW5wdXRFbC5zdHlsZS53aWR0aCA9IFwiMTAwJVwiO1xuICAgICAgICB0ZXh0LnNldFZhbHVlKHRoaXMucmF3SnNvblRleHQpO1xuICAgICAgICB0ZXh0Lm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICB0aGlzLnJhd0pzb25UZXh0ID0gdmFsO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgc2F2ZUFuZENsb3NlKCkge1xuICAgIC8vIElmIHRoZSBhY3RpdmUgdGFiIGlzIHJhdyBKU09OLCBwYXJzZSBpdCBmaXJzdCB0byBlbnN1cmUgd2UgY2FwdHVyZSBlZGl0c1xuICAgIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJyYXdcIikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5jb25maWdPYmogPSBKU09OLnBhcnNlKHRoaXMucmF3SnNvblRleHQpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBuZXcgTm90aWNlKFwiSW52YWxpZCBKU09OIHN5bnRheCBpbiBSYXcgSlNPTiB0YWIuIFBsZWFzZSBmaXggaXQgYmVmb3JlIHNhdmluZy5cIik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBCYXNpYyBWYWxpZGF0aW9uXG4gICAgaWYgKCF0aGlzLmNvbmZpZ09iai5ydW50aW1lKSB7XG4gICAgICBuZXcgTm90aWNlKFwiUnVudGltZSBpcyByZXF1aXJlZC5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcInFlbXVcIiAmJiAoIXRoaXMuY29uZmlnT2JqLnFlbXU/LnNzaFRhcmdldCB8fCAhdGhpcy5jb25maWdPYmoucWVtdT8ucmVtb3RlV29ya3NwYWNlKSkge1xuICAgICAgbmV3IE5vdGljZShcIlFFTVUgcnVudGltZSByZXF1aXJlcyBTU0ggVGFyZ2V0IGFuZCBSZW1vdGUgV29ya3NwYWNlLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwiY3VzdG9tXCIgJiYgIXRoaXMuY29uZmlnT2JqLmN1c3RvbT8uZXhlY3V0YWJsZSkge1xuICAgICAgbmV3IE5vdGljZShcIkN1c3RvbSBydW50aW1lIHJlcXVpcmVzIEN1c3RvbSBFeGVjdXRhYmxlLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBhZGFwdGVyID0gdGhpcy5hcHAudmF1bHQuYWRhcHRlcjtcbiAgICBjb25zdCBjb25maWdQYXRoID0gYCR7dGhpcy5wbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHt0aGlzLmdyb3VwTmFtZX0vY29uZmlnLmpzb25gO1xuICAgIGNvbnN0IGRvY2tlcmZpbGVQYXRoID0gYCR7dGhpcy5wbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHt0aGlzLmdyb3VwTmFtZX0vRG9ja2VyZmlsZWA7XG5cbiAgICB0cnkge1xuICAgICAgLy8gU2F2ZSBjb25maWcuanNvblxuICAgICAgY29uc3QgY29uZmlnU3RyID0gSlNPTi5zdHJpbmdpZnkodGhpcy5jb25maWdPYmosIG51bGwsIDIpO1xuICAgICAgYXdhaXQgYWRhcHRlci53cml0ZShjb25maWdQYXRoLCBjb25maWdTdHIpO1xuXG4gICAgICAvLyBTYXZlIERvY2tlcmZpbGVcbiAgICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcImRvY2tlclwiIHx8IHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIpIHtcbiAgICAgICAgaWYgKHRoaXMuZG9ja2VyZmlsZVRleHQgIT09IG51bGwpIHtcbiAgICAgICAgICBhd2FpdCBhZGFwdGVyLndyaXRlKGRvY2tlcmZpbGVQYXRoLCB0aGlzLmRvY2tlcmZpbGVUZXh0KTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBuZXcgTm90aWNlKFwiQ29udGFpbmVyIGdyb3VwIGNvbmZpZ3VyYXRpb25zIHNhdmVkLlwiKTtcbiAgICAgIHRoaXMub25TYXZlKCk7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIG5ldyBOb3RpY2UoYFNhdmUgZmFpbGVkOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcbiAgICB9XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBzcGF3biB9IGZyb20gXCJjaGlsZF9wcm9jZXNzXCI7XG5pbXBvcnQgeyBta2R0ZW1wLCBybSwgd3JpdGVGaWxlIH0gZnJvbSBcImZzL3Byb21pc2VzXCI7XG5pbXBvcnQgeyB0bXBkaXIgfSBmcm9tIFwib3NcIjtcbmltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBsb29tU291cmNlUmVmZXJlbmNlIH0gZnJvbSBcIi4vdHlwZXNcIjtcbmltcG9ydCB7IHNwbGl0Q29tbWFuZExpbmUgfSBmcm9tIFwiLi91dGlscy9jb21tYW5kXCI7XG5cbmludGVyZmFjZSBTb3VyY2VSYW5nZSB7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgU291cmNlRGVmaW5pdGlvbiBleHRlbmRzIFNvdXJjZVJhbmdlIHtcbiAgbmFtZTogc3RyaW5nO1xuICBuYW1lcz86IHN0cmluZ1tdO1xufVxuXG5pbnRlcmZhY2UgUHl0aG9uQWxpYXMge1xuICBuYW1lOiBzdHJpbmc7XG4gIGFzbmFtZTogc3RyaW5nIHwgbnVsbDtcbn1cblxuaW50ZXJmYWNlIFB5dGhvbkltcG9ydCBleHRlbmRzIFNvdXJjZVJhbmdlIHtcbiAga2luZDogXCJpbXBvcnRcIiB8IFwiZnJvbVwiO1xuICBtb2R1bGU6IHN0cmluZztcbiAgbGV2ZWw6IG51bWJlcjtcbiAgbmFtZXM6IFB5dGhvbkFsaWFzW107XG59XG5cbmludGVyZmFjZSBQeXRob25Nb2R1bGVJbmZvIHtcbiAgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXTtcbiAgaW1wb3J0czogUHl0aG9uSW1wb3J0W107XG59XG5cbmludGVyZmFjZSBQeXRob25Vc2FnZSB7XG4gIG5hbWVzOiBzdHJpbmdbXTtcbiAgYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+O1xufVxuXG5pbnRlcmZhY2UgUHl0aG9uRGVwZW5kZW5jeVN0YXRlIHtcbiAgcmVhZG9ubHkgaW5jbHVkZWRSYW5nZXM6IFNldDxzdHJpbmc+O1xuICByZWFkb25seSBpbmNsdWRlZEltcG9ydHM6IFNldDxzdHJpbmc+O1xuICByZWFkb25seSBhbGlhc2VzOiBTZXQ8c3RyaW5nPjtcbiAgcmVhZG9ubHkgbmFtZXNwYWNlQmluZGluZ3M6IE1hcDxzdHJpbmcsIFNldDxzdHJpbmc+PjtcbiAgcmVhZG9ubHkgdmlzaXRpbmdTeW1ib2xzOiBTZXQ8c3RyaW5nPjtcbiAgbmVlZHNOYW1lc3BhY2VSdW50aW1lOiBib29sZWFuO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCB7XG4gIHB5dGhvbkV4ZWN1dGFibGU/OiBzdHJpbmc7XG4gIGV4dGVybmFsRXh0cmFjdG9yPzogbG9vbUV4dGVybmFsU291cmNlRXh0cmFjdG9yO1xuICByZWFkRmlsZShmaWxlUGF0aDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPjtcbiAgcmVzb2x2ZVB5dGhvbkltcG9ydChmcm9tRmlsZVBhdGg6IHN0cmluZywgbW9kdWxlTmFtZTogc3RyaW5nLCBsZXZlbDogbnVtYmVyKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tRXh0ZXJuYWxTb3VyY2VFeHRyYWN0b3Ige1xuICBtb2RlOiBcImNvbW1hbmRcIiB8IFwidHJhbnNwaWxlLWNcIjtcbiAgbGFuZ3VhZ2U6IHN0cmluZztcbiAgZXhlY3V0YWJsZTogc3RyaW5nO1xuICBhcmdzOiBzdHJpbmdbXTtcbiAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nO1xuICB0aW1lb3V0TXM6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIEV4dGVybmFsRXh0cmFjdG9yUmVzdWx0IHtcbiAgY29udGVudD86IHN0cmluZztcbiAgc2VsZWN0ZWQ/OiBzdHJpbmc7XG4gIGRlcGVuZGVuY2llcz86IHN0cmluZ1tdO1xuICBpbXBvcnRzPzogc3RyaW5nW107XG4gIGRlc2NyaXB0aW9uPzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgVHJhbnNwaWxlVG9DUmVzdWx0IHtcbiAgZ2VuZXJhdGVkU291cmNlOiBzdHJpbmc7XG4gIHN5bWJvbHM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBoYXJuZXNzPzogc3RyaW5nO1xuICBsYW5ndWFnZT86IFwiY1wiIHwgXCJjcHBcIjtcbiAgZGVzY3JpcHRpb24/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVJlc29sdmVkU291cmNlIHtcbiAgY29udGVudDogc3RyaW5nO1xuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2UoXG4gIHNvdXJjZTogc3RyaW5nLFxuICByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UsXG4gIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLFxuICBoYXJuZXNzOiBzdHJpbmcsXG4gIGhvc3Q/OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4pOiBQcm9taXNlPGxvb21SZXNvbHZlZFNvdXJjZT4ge1xuICBpZiAoaG9zdD8uZXh0ZXJuYWxFeHRyYWN0b3I/LmV4ZWN1dGFibGUudHJpbSgpKSB7XG4gICAgcmV0dXJuIGhvc3QuZXh0ZXJuYWxFeHRyYWN0b3IubW9kZSA9PT0gXCJ0cmFuc3BpbGUtY1wiXG4gICAgICA/IHJlc29sdmVUcmFuc3BpbGVUb0NSZWZlcmVuY2VkU291cmNlKHNvdXJjZSwgcmVmZXJlbmNlLCBsYW5ndWFnZSwgaGFybmVzcywgaG9zdC5leHRlcm5hbEV4dHJhY3RvcilcbiAgICAgIDogcmVzb2x2ZUV4dGVybmFsUmVmZXJlbmNlZFNvdXJjZShzb3VyY2UsIHJlZmVyZW5jZSwgbGFuZ3VhZ2UsIGhhcm5lc3MsIGhvc3QuZXh0ZXJuYWxFeHRyYWN0b3IpO1xuICB9XG5cbiAgaWYgKGxhbmd1YWdlID09PSBcInB5dGhvblwiICYmIGhvc3QpIHtcbiAgICByZXR1cm4gcmVzb2x2ZVB5dGhvblJlZmVyZW5jZWRTb3VyY2Uoc291cmNlLCByZWZlcmVuY2UsIGhhcm5lc3MsIGhvc3QpO1xuICB9XG5cbiAgcmV0dXJuIHJlc29sdmVSZWZlcmVuY2VkU291cmNlRmFsbGJhY2soc291cmNlLCByZWZlcmVuY2UsIGxhbmd1YWdlLCBoYXJuZXNzKTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2VGYWxsYmFjayhcbiAgc291cmNlOiBzdHJpbmcsXG4gIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSxcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsXG4gIGhhcm5lc3M6IHN0cmluZyxcbik6IGxvb21SZXNvbHZlZFNvdXJjZSB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KC9cXHI/XFxuLyk7XG4gIGNvbnN0IHNlbGVjdGVkUmFuZ2UgPSByZWZlcmVuY2Uuc3ltYm9sTmFtZVxuICAgID8gZmluZFN5bWJvbFJhbmdlKGxpbmVzLCBsYW5ndWFnZSwgcmVmZXJlbmNlLnN5bWJvbE5hbWUpXG4gICAgOiBmaW5kTGluZVJhbmdlKGxpbmVzLCByZWZlcmVuY2UpO1xuXG4gIGlmICghc2VsZWN0ZWRSYW5nZSkge1xuICAgIGNvbnN0IHRhcmdldCA9IHJlZmVyZW5jZS5zeW1ib2xOYW1lID8gYHN5bWJvbCAke3JlZmVyZW5jZS5zeW1ib2xOYW1lfWAgOiBcImxpbmUgcmFuZ2VcIjtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBleHRyYWN0ICR7dGFyZ2V0fSBmcm9tICR7cmVmZXJlbmNlLmZpbGVQYXRofS5gKTtcbiAgfVxuXG4gIGNvbnN0IHNlbGVjdGVkID0gcmVuZGVyUmFuZ2UobGluZXMsIHNlbGVjdGVkUmFuZ2UpO1xuICBjb25zdCBkZXBlbmRlbmNpZXMgPSByZWZlcmVuY2UudHJhY2VEZXBlbmRlbmNpZXNcbiAgICA/IGNvbGxlY3REZXBlbmRlbmN5U291cmNlKGxpbmVzLCBsYW5ndWFnZSwgc2VsZWN0ZWRSYW5nZSwgc2VsZWN0ZWQpXG4gICAgOiBcIlwiO1xuICBjb25zdCBjb250ZW50ID0gW2RlcGVuZGVuY2llcywgc2VsZWN0ZWQsIGhhcm5lc3MudHJpbSgpID8gaGFybmVzcyA6IFwiXCJdXG4gICAgLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpXG4gICAgLmpvaW4oXCJcXG5cXG5cIik7XG5cbiAgcmV0dXJuIHtcbiAgICBjb250ZW50LFxuICAgIGRlc2NyaXB0aW9uOiBmb3JtYXRTb3VyY2VEZXNjcmlwdGlvbihyZWZlcmVuY2UsIHNlbGVjdGVkUmFuZ2UpLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlRXh0ZXJuYWxSZWZlcmVuY2VkU291cmNlKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlLFxuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSxcbiAgaGFybmVzczogc3RyaW5nLFxuICBleHRyYWN0b3I6IGxvb21FeHRlcm5hbFNvdXJjZUV4dHJhY3Rvcixcbik6IFByb21pc2U8bG9vbVJlc29sdmVkU291cmNlPiB7XG4gIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCBta2R0ZW1wKGpvaW4odG1wZGlyKCksIFwibG9vbS1leHRyYWN0LVwiKSk7XG4gIGNvbnN0IHNvdXJjZUZpbGUgPSBqb2luKHRlbXBEaXIsIFwic291cmNlLnR4dFwiKTtcbiAgY29uc3QgaGFybmVzc0ZpbGUgPSBqb2luKHRlbXBEaXIsIFwiaGFybmVzcy50eHRcIik7XG4gIGNvbnN0IHJlcXVlc3RGaWxlID0gam9pbih0ZW1wRGlyLCBcInJlcXVlc3QuanNvblwiKTtcblxuICB0cnkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSB7XG4gICAgICBsYW5ndWFnZSxcbiAgICAgIGZpbGVQYXRoOiByZWZlcmVuY2UuZmlsZVBhdGgsXG4gICAgICBzeW1ib2xOYW1lOiByZWZlcmVuY2Uuc3ltYm9sTmFtZSA/PyBudWxsLFxuICAgICAgbGluZVN0YXJ0OiByZWZlcmVuY2UubGluZVN0YXJ0ID8/IG51bGwsXG4gICAgICBsaW5lRW5kOiByZWZlcmVuY2UubGluZUVuZCA/PyBudWxsLFxuICAgICAgdHJhY2VEZXBlbmRlbmNpZXM6IHJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llcyxcbiAgICAgIHNvdXJjZUZpbGUsXG4gICAgICBoYXJuZXNzRmlsZSxcbiAgICB9O1xuICAgIGF3YWl0IHdyaXRlRmlsZShzb3VyY2VGaWxlLCBzb3VyY2UsIFwidXRmOFwiKTtcbiAgICBhd2FpdCB3cml0ZUZpbGUoaGFybmVzc0ZpbGUsIGhhcm5lc3MsIFwidXRmOFwiKTtcbiAgICBhd2FpdCB3cml0ZUZpbGUocmVxdWVzdEZpbGUsIEpTT04uc3RyaW5naWZ5KHJlcXVlc3QsIG51bGwsIDIpLCBcInV0ZjhcIik7XG5cbiAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5FeHRlcm5hbEV4dHJhY3RvcihleHRyYWN0b3IsIHtcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgc291cmNlRmlsZSxcbiAgICAgIGhhcm5lc3NGaWxlLFxuICAgICAgcmVxdWVzdEZpbGUsXG4gICAgICByZWZlcmVuY2UsXG4gICAgfSk7XG4gICAgY29uc3QgcmVzdWx0ID0gcGFyc2VFeHRlcm5hbEV4dHJhY3RvclJlc3VsdChvdXRwdXQpO1xuICAgIGNvbnN0IGNvbnRlbnQgPSByZXN1bHQuY29udGVudCA/PyBbXG4gICAgICAuLi4ocmVzdWx0LmltcG9ydHMgPz8gW10pLFxuICAgICAgLi4uKHJlc3VsdC5kZXBlbmRlbmNpZXMgPz8gW10pLFxuICAgICAgcmVzdWx0LnNlbGVjdGVkID8/IFwiXCIsXG4gICAgICBoYXJuZXNzLnRyaW0oKSA/IGhhcm5lc3MgOiBcIlwiLFxuICAgIF0uZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSkuam9pbihcIlxcblxcblwiKTtcblxuICAgIGlmICghY29udGVudC50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkN1c3RvbSBzb3VyY2UgZXh0cmFjdG9yIHJldHVybmVkIG5vIGNvbnRlbnQuXCIpO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBjb250ZW50LFxuICAgICAgZGVzY3JpcHRpb246IHJlc3VsdC5kZXNjcmlwdGlvbj8udHJpbSgpIHx8IGZvcm1hdFNvdXJjZURlc2NyaXB0aW9uKHJlZmVyZW5jZSwgbnVsbCksXG4gICAgfTtcbiAgfSBmaW5hbGx5IHtcbiAgICBhd2FpdCBybSh0ZW1wRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVRyYW5zcGlsZVRvQ1JlZmVyZW5jZWRTb3VyY2UoXG4gIHNvdXJjZTogc3RyaW5nLFxuICByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UsXG4gIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLFxuICBoYXJuZXNzOiBzdHJpbmcsXG4gIGV4dHJhY3RvcjogbG9vbUV4dGVybmFsU291cmNlRXh0cmFjdG9yLFxuKTogUHJvbWlzZTxsb29tUmVzb2x2ZWRTb3VyY2U+IHtcbiAgY29uc3QgdGVtcERpciA9IGF3YWl0IG1rZHRlbXAoam9pbih0bXBkaXIoKSwgXCJsb29tLWV4dHJhY3QtXCIpKTtcbiAgY29uc3Qgc291cmNlRmlsZSA9IGpvaW4odGVtcERpciwgXCJzb3VyY2UudHh0XCIpO1xuICBjb25zdCBoYXJuZXNzRmlsZSA9IGpvaW4odGVtcERpciwgXCJoYXJuZXNzLnR4dFwiKTtcbiAgY29uc3QgcmVxdWVzdEZpbGUgPSBqb2luKHRlbXBEaXIsIFwicmVxdWVzdC5qc29uXCIpO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcmVxdWVzdCA9IHtcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgZmlsZVBhdGg6IHJlZmVyZW5jZS5maWxlUGF0aCxcbiAgICAgIHN5bWJvbE5hbWU6IHJlZmVyZW5jZS5zeW1ib2xOYW1lID8/IG51bGwsXG4gICAgICBsaW5lU3RhcnQ6IHJlZmVyZW5jZS5saW5lU3RhcnQgPz8gbnVsbCxcbiAgICAgIGxpbmVFbmQ6IHJlZmVyZW5jZS5saW5lRW5kID8/IG51bGwsXG4gICAgICB0cmFjZURlcGVuZGVuY2llczogcmVmZXJlbmNlLnRyYWNlRGVwZW5kZW5jaWVzLFxuICAgICAgc291cmNlRmlsZSxcbiAgICAgIGhhcm5lc3NGaWxlLFxuICAgICAgdGFyZ2V0TGFuZ3VhZ2U6IFwiY1wiLFxuICAgIH07XG4gICAgYXdhaXQgd3JpdGVGaWxlKHNvdXJjZUZpbGUsIHNvdXJjZSwgXCJ1dGY4XCIpO1xuICAgIGF3YWl0IHdyaXRlRmlsZShoYXJuZXNzRmlsZSwgaGFybmVzcywgXCJ1dGY4XCIpO1xuICAgIGF3YWl0IHdyaXRlRmlsZShyZXF1ZXN0RmlsZSwgSlNPTi5zdHJpbmdpZnkocmVxdWVzdCwgbnVsbCwgMiksIFwidXRmOFwiKTtcblxuICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJ1bkV4dGVybmFsRXh0cmFjdG9yKGV4dHJhY3Rvciwge1xuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBzb3VyY2VGaWxlLFxuICAgICAgaGFybmVzc0ZpbGUsXG4gICAgICByZXF1ZXN0RmlsZSxcbiAgICAgIHJlZmVyZW5jZSxcbiAgICB9KTtcbiAgICBjb25zdCByZXN1bHQgPSBwYXJzZVRyYW5zcGlsZVRvQ1Jlc3VsdChvdXRwdXQpO1xuICAgIGNvbnN0IGdlbmVyYXRlZExhbmd1YWdlID0gcmVzdWx0Lmxhbmd1YWdlID09PSBcImNwcFwiID8gXCJjcHBcIiA6IFwiY1wiO1xuICAgIGNvbnN0IG1hcHBlZFN5bWJvbCA9IHJlZmVyZW5jZS5zeW1ib2xOYW1lID8gcmVzdWx0LnN5bWJvbHM/LltyZWZlcmVuY2Uuc3ltYm9sTmFtZV0gPz8gcmVmZXJlbmNlLnN5bWJvbE5hbWUgOiB1bmRlZmluZWQ7XG4gICAgY29uc3QgZ2VuZXJhdGVkUmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlID0ge1xuICAgICAgLi4ucmVmZXJlbmNlLFxuICAgICAgZmlsZVBhdGg6IGAke3JlZmVyZW5jZS5maWxlUGF0aH06Z2VuZXJhdGVkLiR7Z2VuZXJhdGVkTGFuZ3VhZ2UgPT09IFwiY3BwXCIgPyBcImNwcFwiIDogXCJjXCJ9YCxcbiAgICAgIHN5bWJvbE5hbWU6IG1hcHBlZFN5bWJvbCxcbiAgICB9O1xuICAgIGNvbnN0IHJlc29sdmVkID0gcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2VGYWxsYmFjayhyZXN1bHQuZ2VuZXJhdGVkU291cmNlLCBnZW5lcmF0ZWRSZWZlcmVuY2UsIGdlbmVyYXRlZExhbmd1YWdlLCByZXN1bHQuaGFybmVzcyA/PyBoYXJuZXNzKTtcblxuICAgIHJldHVybiB7XG4gICAgICBjb250ZW50OiByZXNvbHZlZC5jb250ZW50LFxuICAgICAgZGVzY3JpcHRpb246IHJlc3VsdC5kZXNjcmlwdGlvbj8udHJpbSgpIHx8IGAke3JlZmVyZW5jZS5maWxlUGF0aH0jJHtyZWZlcmVuY2Uuc3ltYm9sTmFtZSA/PyBcImdlbmVyYXRlZC1jXCJ9YCxcbiAgICB9O1xuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IHJtKHRlbXBEaXIsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBydW5FeHRlcm5hbEV4dHJhY3RvcihcbiAgZXh0cmFjdG9yOiBsb29tRXh0ZXJuYWxTb3VyY2VFeHRyYWN0b3IsXG4gIHZhbHVlczoge1xuICAgIGxhbmd1YWdlOiBzdHJpbmc7XG4gICAgc291cmNlRmlsZTogc3RyaW5nO1xuICAgIGhhcm5lc3NGaWxlOiBzdHJpbmc7XG4gICAgcmVxdWVzdEZpbGU6IHN0cmluZztcbiAgICByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2U7XG4gIH0sXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBhcmdzID0gZXh0cmFjdG9yLmFyZ3MubWFwKChhcmcpID0+IGFyZ1xuICAgIC5yZXBsYWNlQWxsKFwie3JlcXVlc3R9XCIsIHZhbHVlcy5yZXF1ZXN0RmlsZSlcbiAgICAucmVwbGFjZUFsbChcIntzb3VyY2V9XCIsIHZhbHVlcy5zb3VyY2VGaWxlKVxuICAgIC5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHZhbHVlcy5zb3VyY2VGaWxlKVxuICAgIC5yZXBsYWNlQWxsKFwie2hhcm5lc3N9XCIsIHZhbHVlcy5oYXJuZXNzRmlsZSlcbiAgICAucmVwbGFjZUFsbChcIntzeW1ib2x9XCIsIHZhbHVlcy5yZWZlcmVuY2Uuc3ltYm9sTmFtZSA/PyBcIlwiKVxuICAgIC5yZXBsYWNlQWxsKFwie2xpbmVTdGFydH1cIiwgdmFsdWVzLnJlZmVyZW5jZS5saW5lU3RhcnQgPT0gbnVsbCA/IFwiXCIgOiBTdHJpbmcodmFsdWVzLnJlZmVyZW5jZS5saW5lU3RhcnQpKVxuICAgIC5yZXBsYWNlQWxsKFwie2xpbmVFbmR9XCIsIHZhbHVlcy5yZWZlcmVuY2UubGluZUVuZCA9PSBudWxsID8gXCJcIiA6IFN0cmluZyh2YWx1ZXMucmVmZXJlbmNlLmxpbmVFbmQpKVxuICAgIC5yZXBsYWNlQWxsKFwie2RlcHN9XCIsIHZhbHVlcy5yZWZlcmVuY2UudHJhY2VEZXBlbmRlbmNpZXMgPyBcInRydWVcIiA6IFwiZmFsc2VcIilcbiAgICAucmVwbGFjZUFsbChcIntsYW5ndWFnZX1cIiwgdmFsdWVzLmxhbmd1YWdlKSk7XG5cbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCBjaGlsZCA9IHNwYXduKGV4dHJhY3Rvci5leGVjdXRhYmxlLCBhcmdzLCB7XG4gICAgICBjd2Q6IGV4dHJhY3Rvci53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgc3RkaW86IFtcInBpcGVcIiwgXCJwaXBlXCIsIFwicGlwZVwiXSxcbiAgICB9KTtcbiAgICBsZXQgc3Rkb3V0ID0gXCJcIjtcbiAgICBsZXQgc3RkZXJyID0gXCJcIjtcbiAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBjaGlsZC5raWxsKFwiU0lHVEVSTVwiKTtcbiAgICAgIHJlamVjdChuZXcgRXJyb3IoYEN1c3RvbSBzb3VyY2UgZXh0cmFjdG9yIHRpbWVkIG91dCBhZnRlciAke2V4dHJhY3Rvci50aW1lb3V0TXN9IG1zLmApKTtcbiAgICB9LCBleHRyYWN0b3IudGltZW91dE1zKTtcblxuICAgIGNoaWxkLnN0ZG91dC5zZXRFbmNvZGluZyhcInV0ZjhcIik7XG4gICAgY2hpbGQuc3RkZXJyLnNldEVuY29kaW5nKFwidXRmOFwiKTtcbiAgICBjaGlsZC5zdGRvdXQub24oXCJkYXRhXCIsIChjaHVuazogc3RyaW5nKSA9PiB7XG4gICAgICBzdGRvdXQgKz0gY2h1bms7XG4gICAgfSk7XG4gICAgY2hpbGQuc3RkZXJyLm9uKFwiZGF0YVwiLCAoY2h1bms6IHN0cmluZykgPT4ge1xuICAgICAgc3RkZXJyICs9IGNodW5rO1xuICAgIH0pO1xuICAgIGNoaWxkLm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICByZWplY3QoZXJyb3IpO1xuICAgIH0pO1xuICAgIGNoaWxkLm9uKFwiY2xvc2VcIiwgKGNvZGUpID0+IHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgIGlmIChjb2RlICE9PSAwKSB7XG4gICAgICAgIHJlamVjdChuZXcgRXJyb3IoKHN0ZGVyciB8fCBzdGRvdXQgfHwgYEN1c3RvbSBzb3VyY2UgZXh0cmFjdG9yIGV4aXRlZCB3aXRoIGNvZGUgJHtjb2RlfS5gKS50cmltKCkpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgcmVzb2x2ZShzdGRvdXQpO1xuICAgIH0pO1xuXG4gICAgY2hpbGQuc3RkaW4uZW5kKEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIHJlcXVlc3RGaWxlOiB2YWx1ZXMucmVxdWVzdEZpbGUsXG4gICAgICBzb3VyY2VGaWxlOiB2YWx1ZXMuc291cmNlRmlsZSxcbiAgICAgIGhhcm5lc3NGaWxlOiB2YWx1ZXMuaGFybmVzc0ZpbGUsXG4gICAgICBsYW5ndWFnZTogdmFsdWVzLmxhbmd1YWdlLFxuICAgICAgZmlsZVBhdGg6IHZhbHVlcy5yZWZlcmVuY2UuZmlsZVBhdGgsXG4gICAgICBzeW1ib2xOYW1lOiB2YWx1ZXMucmVmZXJlbmNlLnN5bWJvbE5hbWUgPz8gbnVsbCxcbiAgICAgIGxpbmVTdGFydDogdmFsdWVzLnJlZmVyZW5jZS5saW5lU3RhcnQgPz8gbnVsbCxcbiAgICAgIGxpbmVFbmQ6IHZhbHVlcy5yZWZlcmVuY2UubGluZUVuZCA/PyBudWxsLFxuICAgICAgdHJhY2VEZXBlbmRlbmNpZXM6IHZhbHVlcy5yZWZlcmVuY2UudHJhY2VEZXBlbmRlbmNpZXMsXG4gICAgfSkpO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gcGFyc2VFeHRlcm5hbEV4dHJhY3RvclJlc3VsdChvdXRwdXQ6IHN0cmluZyk6IEV4dGVybmFsRXh0cmFjdG9yUmVzdWx0IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKG91dHB1dCkgYXMgRXh0ZXJuYWxFeHRyYWN0b3JSZXN1bHQ7XG4gICAgaWYgKHR5cGVvZiBwYXJzZWQgIT09IFwib2JqZWN0XCIgfHwgcGFyc2VkID09IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkN1c3RvbSBzb3VyY2UgZXh0cmFjdG9yIG11c3QgcmV0dXJuIGEgSlNPTiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gcGFyc2VkO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgQ3VzdG9tIHNvdXJjZSBleHRyYWN0b3IgcmV0dXJuZWQgaW52YWxpZCBKU09OOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZVRyYW5zcGlsZVRvQ1Jlc3VsdChvdXRwdXQ6IHN0cmluZyk6IFRyYW5zcGlsZVRvQ1Jlc3VsdCB7XG4gIHRyeSB7XG4gICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShvdXRwdXQpIGFzIFRyYW5zcGlsZVRvQ1Jlc3VsdDtcbiAgICBpZiAodHlwZW9mIHBhcnNlZCAhPT0gXCJvYmplY3RcIiB8fCBwYXJzZWQgPT0gbnVsbCB8fCB0eXBlb2YgcGFyc2VkLmdlbmVyYXRlZFNvdXJjZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNwaWxlIHRvIEMgZXh0cmFjdG9yIG11c3QgcmV0dXJuIGdlbmVyYXRlZFNvdXJjZS5cIik7XG4gICAgfVxuICAgIGlmIChwYXJzZWQubGFuZ3VhZ2UgIT0gbnVsbCAmJiBwYXJzZWQubGFuZ3VhZ2UgIT09IFwiY1wiICYmIHBhcnNlZC5sYW5ndWFnZSAhPT0gXCJjcHBcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNwaWxlIHRvIEMgbGFuZ3VhZ2UgbXVzdCBiZSBjIG9yIGNwcC5cIik7XG4gICAgfVxuICAgIGlmIChwYXJzZWQuc3ltYm9scyAhPSBudWxsICYmICh0eXBlb2YgcGFyc2VkLnN5bWJvbHMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShwYXJzZWQuc3ltYm9scykpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc3BpbGUgdG8gQyBzeW1ib2xzIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIHBhcnNlZDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFRyYW5zcGlsZSB0byBDIGV4dHJhY3RvciByZXR1cm5lZCBpbnZhbGlkIEpTT046ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVQeXRob25SZWZlcmVuY2VkU291cmNlKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlLFxuICBoYXJuZXNzOiBzdHJpbmcsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbik6IFByb21pc2U8bG9vbVJlc29sdmVkU291cmNlPiB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KC9cXHI/XFxuLyk7XG4gIGNvbnN0IG1vZHVsZUluZm8gPSBhd2FpdCBpbnNwZWN0UHl0aG9uTW9kdWxlKHNvdXJjZSwgaG9zdCk7XG4gIGNvbnN0IHNlbGVjdGVkUmFuZ2UgPSByZWZlcmVuY2Uuc3ltYm9sTmFtZVxuICAgID8gZmluZFB5dGhvblN5bWJvbFJhbmdlKG1vZHVsZUluZm8sIHJlZmVyZW5jZS5zeW1ib2xOYW1lKVxuICAgIDogZmluZExpbmVSYW5nZShsaW5lcywgcmVmZXJlbmNlKTtcblxuICBpZiAoIXNlbGVjdGVkUmFuZ2UpIHtcbiAgICBjb25zdCB0YXJnZXQgPSByZWZlcmVuY2Uuc3ltYm9sTmFtZSA/IGBzeW1ib2wgJHtyZWZlcmVuY2Uuc3ltYm9sTmFtZX1gIDogXCJsaW5lIHJhbmdlXCI7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZXh0cmFjdCAke3RhcmdldH0gZnJvbSAke3JlZmVyZW5jZS5maWxlUGF0aH0uYCk7XG4gIH1cblxuICBjb25zdCBzZWxlY3RlZCA9IHJlbmRlclJhbmdlKGxpbmVzLCBzZWxlY3RlZFJhbmdlKTtcbiAgY29uc3Qgc3RhdGUgPSBjcmVhdGVQeXRob25EZXBlbmRlbmN5U3RhdGUoKTtcbiAgY29uc3QgZGVwZW5kZW5jaWVzID0gcmVmZXJlbmNlLnRyYWNlRGVwZW5kZW5jaWVzXG4gICAgPyBhd2FpdCBjb2xsZWN0UHl0aG9uRGVwZW5kZW5jeVNvdXJjZShzb3VyY2UsIHJlZmVyZW5jZS5maWxlUGF0aCwgc2VsZWN0ZWRSYW5nZSwgc2VsZWN0ZWQsIGhhcm5lc3MsIGhvc3QsIHN0YXRlKVxuICAgIDogXCJcIjtcbiAgY29uc3QgY29udGVudCA9IFtkZXBlbmRlbmNpZXMsIHNlbGVjdGVkLCBoYXJuZXNzLnRyaW0oKSA/IGhhcm5lc3MgOiBcIlwiXVxuICAgIC5maWx0ZXIoKHBhcnQpID0+IHBhcnQudHJpbSgpKVxuICAgIC5qb2luKFwiXFxuXFxuXCIpO1xuXG4gIHJldHVybiB7XG4gICAgY29udGVudCxcbiAgICBkZXNjcmlwdGlvbjogZm9ybWF0U291cmNlRGVzY3JpcHRpb24ocmVmZXJlbmNlLCBzZWxlY3RlZFJhbmdlKSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlUHl0aG9uRGVwZW5kZW5jeVN0YXRlKCk6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSB7XG4gIHJldHVybiB7XG4gICAgaW5jbHVkZWRSYW5nZXM6IG5ldyBTZXQoKSxcbiAgICBpbmNsdWRlZEltcG9ydHM6IG5ldyBTZXQoKSxcbiAgICBhbGlhc2VzOiBuZXcgU2V0KCksXG4gICAgbmFtZXNwYWNlQmluZGluZ3M6IG5ldyBNYXAoKSxcbiAgICB2aXNpdGluZ1N5bWJvbHM6IG5ldyBTZXQoKSxcbiAgICBuZWVkc05hbWVzcGFjZVJ1bnRpbWU6IGZhbHNlLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBjb2xsZWN0UHl0aG9uRGVwZW5kZW5jeVNvdXJjZShcbiAgc291cmNlOiBzdHJpbmcsXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHNlbGVjdGVkUmFuZ2U6IFNvdXJjZVJhbmdlLFxuICBzZWxlY3RlZDogc3RyaW5nLFxuICBoYXJuZXNzOiBzdHJpbmcsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHBhcnRzOiBzdHJpbmdbXSA9IFtdO1xuICBhd2FpdCBjb2xsZWN0UHl0aG9uRGVwZW5kZW5jaWVzKHNvdXJjZSwgZmlsZVBhdGgsIHNlbGVjdGVkUmFuZ2UsIGAke3NlbGVjdGVkfVxcbiR7aGFybmVzc31gLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICBjb25zdCBuYW1lc3BhY2UgPSByZW5kZXJQeXRob25OYW1lc3BhY2VCaW5kaW5ncyhzdGF0ZSk7XG4gIHJldHVybiBbLi4uc3RhdGUuaW5jbHVkZWRJbXBvcnRzLCAuLi5wYXJ0cywgbmFtZXNwYWNlXVxuICAgIC5maWx0ZXIoKHBhcnQpID0+IHBhcnQudHJpbSgpKVxuICAgIC5qb2luKFwiXFxuXFxuXCIpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBjb2xsZWN0UHl0aG9uRGVwZW5kZW5jaWVzKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgc2VsZWN0ZWRSYW5nZTogU291cmNlUmFuZ2UsXG4gIHNlZWQ6IHN0cmluZyxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuICBwYXJ0czogc3RyaW5nW10sXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xuICBjb25zdCBtb2R1bGVJbmZvID0gYXdhaXQgaW5zcGVjdFB5dGhvbk1vZHVsZShzb3VyY2UsIGhvc3QpO1xuICBsZXQgaGF5c3RhY2sgPSBzZWVkO1xuICBsZXQgY29sbGVjdGVkID0gXCJcIjtcbiAgbGV0IGNoYW5nZWQgPSB0cnVlO1xuXG4gIHdoaWxlIChjaGFuZ2VkKSB7XG4gICAgY2hhbmdlZCA9IGZhbHNlO1xuICAgIGNvbnN0IHVzYWdlID0gYXdhaXQgaW5zcGVjdFB5dGhvblVzYWdlKGhheXN0YWNrLCBob3N0KTtcblxuICAgIGZvciAoY29uc3QgZGVmaW5pdGlvbiBvZiBtb2R1bGVJbmZvLmRlZmluaXRpb25zKSB7XG4gICAgICBpZiAocmFuZ2VzT3ZlcmxhcChkZWZpbml0aW9uLCBzZWxlY3RlZFJhbmdlKSB8fCAhcHl0aG9uRGVmaW5pdGlvbklzVXNlZChkZWZpbml0aW9uLCB1c2FnZSkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCB0ZXh0ID0gYWRkUHl0aG9uUmFuZ2UobGluZXMsIGZpbGVQYXRoLCBkZWZpbml0aW9uLCBzdGF0ZSwgcGFydHMpO1xuICAgICAgaWYgKHRleHQpIHtcbiAgICAgICAgY29uc3QgbmVzdGVkID0gYXdhaXQgY29sbGVjdFB5dGhvbkRlcGVuZGVuY2llcyhzb3VyY2UsIGZpbGVQYXRoLCBkZWZpbml0aW9uLCB0ZXh0LCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgICAgICBoYXlzdGFjayArPSBgXFxuJHt0ZXh0fVxcbmA7XG4gICAgICAgIGlmIChuZXN0ZWQpIHtcbiAgICAgICAgICBoYXlzdGFjayArPSBgXFxuJHtuZXN0ZWR9XFxuYDtcbiAgICAgICAgfVxuICAgICAgICBjb2xsZWN0ZWQgKz0gYCR7bmVzdGVkfVxcbiR7dGV4dH1cXG5gO1xuICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGltcG9ydE5vZGUgb2YgbW9kdWxlSW5mby5pbXBvcnRzKSB7XG4gICAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzb2x2ZVB5dGhvbkltcG9ydERlcGVuZGVuY3koaW1wb3J0Tm9kZSwgbGluZXMsIGZpbGVQYXRoLCB1c2FnZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICAgIGlmICh0ZXh0KSB7XG4gICAgICAgIGhheXN0YWNrICs9IGBcXG4ke3RleHR9XFxuYDtcbiAgICAgICAgY29sbGVjdGVkICs9IGAke3RleHR9XFxuYDtcbiAgICAgICAgY2hhbmdlZCA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGNvbGxlY3RlZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVB5dGhvbkltcG9ydERlcGVuZGVuY3koXG4gIGltcG9ydE5vZGU6IFB5dGhvbkltcG9ydCxcbiAgbGluZXM6IHN0cmluZ1tdLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICB1c2FnZTogUHl0aG9uVXNhZ2UsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbiAgcGFydHM6IHN0cmluZ1tdLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgaWYgKGltcG9ydE5vZGUua2luZCA9PT0gXCJmcm9tXCIpIHtcbiAgICByZXR1cm4gcmVzb2x2ZVB5dGhvbkZyb21JbXBvcnREZXBlbmRlbmN5KGltcG9ydE5vZGUsIGxpbmVzLCBmaWxlUGF0aCwgdXNhZ2UsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gIH1cblxuICByZXR1cm4gcmVzb2x2ZVB5dGhvblBsYWluSW1wb3J0RGVwZW5kZW5jeShpbXBvcnROb2RlLCBsaW5lcywgZmlsZVBhdGgsIHVzYWdlLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlUHl0aG9uRnJvbUltcG9ydERlcGVuZGVuY3koXG4gIGltcG9ydE5vZGU6IFB5dGhvbkltcG9ydCxcbiAgbGluZXM6IHN0cmluZ1tdLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICB1c2FnZTogUHl0aG9uVXNhZ2UsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbiAgcGFydHM6IHN0cmluZ1tdLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgbG9jYWxNb2R1bGVQYXRoID0gYXdhaXQgaG9zdC5yZXNvbHZlUHl0aG9uSW1wb3J0KGZpbGVQYXRoLCBpbXBvcnROb2RlLm1vZHVsZSwgaW1wb3J0Tm9kZS5sZXZlbCk7XG4gIGxldCBhZGRlZCA9IFwiXCI7XG5cbiAgZm9yIChjb25zdCBhbGlhcyBvZiBpbXBvcnROb2RlLm5hbWVzKSB7XG4gICAgaWYgKGFsaWFzLm5hbWUgPT09IFwiKlwiKSB7XG4gICAgICBpZiAoIWxvY2FsTW9kdWxlUGF0aCkge1xuICAgICAgICBpZiAodXNlc1Vua25vd25JbXBvcnRlZE5hbWVzKHVzYWdlKSAmJiBhZGRQeXRob25JbXBvcnRMaW5lKGxpbmVzLCBpbXBvcnROb2RlLCBzdGF0ZSkpIHtcbiAgICAgICAgICBhZGRlZCArPSBgJHtyZW5kZXJSYW5nZShsaW5lcywgaW1wb3J0Tm9kZSl9XFxuYDtcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc291cmNlID0gYXdhaXQgaG9zdC5yZWFkRmlsZShsb2NhbE1vZHVsZVBhdGgpO1xuICAgICAgaWYgKCFzb3VyY2UpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBtb2R1bGVJbmZvID0gYXdhaXQgaW5zcGVjdFB5dGhvbk1vZHVsZShzb3VyY2UsIGhvc3QpO1xuICAgICAgZm9yIChjb25zdCBkZWZpbml0aW9uIG9mIG1vZHVsZUluZm8uZGVmaW5pdGlvbnMpIHtcbiAgICAgICAgaWYgKCFweXRob25EZWZpbml0aW9uSXNVc2VkKGRlZmluaXRpb24sIHVzYWdlKSkge1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGFkZGVkICs9IGF3YWl0IGV4dHJhY3RQeXRob25TeW1ib2xGcm9tRmlsZShsb2NhbE1vZHVsZVBhdGgsIGRlZmluaXRpb24ubmFtZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGV4cG9zZWROYW1lID0gYWxpYXMuYXNuYW1lID8/IGFsaWFzLm5hbWU7XG4gICAgaWYgKCF1c2FnZS5uYW1lcy5pbmNsdWRlcyhleHBvc2VkTmFtZSkpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHN1Ym1vZHVsZVBhdGggPSBhd2FpdCBob3N0LnJlc29sdmVQeXRob25JbXBvcnQoZmlsZVBhdGgsIGpvaW5QeXRob25Nb2R1bGUoaW1wb3J0Tm9kZS5tb2R1bGUsIGFsaWFzLm5hbWUpLCBpbXBvcnROb2RlLmxldmVsKTtcbiAgICBjb25zdCBpbXBvcnRUYXJnZXRQYXRoID0gbG9jYWxNb2R1bGVQYXRoID8/IHN1Ym1vZHVsZVBhdGg7XG4gICAgaWYgKCFpbXBvcnRUYXJnZXRQYXRoKSB7XG4gICAgICBpZiAoYWRkUHl0aG9uSW1wb3J0TGluZShsaW5lcywgaW1wb3J0Tm9kZSwgc3RhdGUpKSB7XG4gICAgICAgIGFkZGVkICs9IGAke3JlbmRlclJhbmdlKGxpbmVzLCBpbXBvcnROb2RlKX1cXG5gO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZXh0cmFjdGVkID0gYXdhaXQgZXh0cmFjdFB5dGhvblN5bWJvbEZyb21GaWxlKGltcG9ydFRhcmdldFBhdGgsIGFsaWFzLm5hbWUsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgaWYgKGV4dHJhY3RlZCkge1xuICAgICAgYWRkZWQgKz0gZXh0cmFjdGVkO1xuICAgICAgaWYgKGFsaWFzLmFzbmFtZSAmJiBhbGlhcy5hc25hbWUgIT09IGFsaWFzLm5hbWUpIHtcbiAgICAgICAgYWRkZWQgKz0gYWRkUHl0aG9uQWxpYXMoYWxpYXMubmFtZSwgYWxpYXMuYXNuYW1lLCBzdGF0ZSwgcGFydHMpO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbW9kdWxlQmluZGluZyA9IGFsaWFzLmFzbmFtZSA/PyBhbGlhcy5uYW1lO1xuICAgIGNvbnN0IG1vZHVsZUF0dHJpYnV0ZXMgPSB1c2FnZS5hdHRyaWJ1dGVzW21vZHVsZUJpbmRpbmddID8/IFtdO1xuICAgIGlmIChzdWJtb2R1bGVQYXRoICYmIG1vZHVsZUF0dHJpYnV0ZXMubGVuZ3RoKSB7XG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZSBvZiBtb2R1bGVBdHRyaWJ1dGVzKSB7XG4gICAgICAgIGFkZGVkICs9IGF3YWl0IGV4dHJhY3RQeXRob25TeW1ib2xGcm9tRmlsZShzdWJtb2R1bGVQYXRoLCBhdHRyaWJ1dGUsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICAgIGFkZFB5dGhvbk5hbWVzcGFjZUJpbmRpbmcobW9kdWxlQmluZGluZywgYXR0cmlidXRlLCBzdGF0ZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGFkZGVkO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlUHl0aG9uUGxhaW5JbXBvcnREZXBlbmRlbmN5KFxuICBpbXBvcnROb2RlOiBQeXRob25JbXBvcnQsXG4gIGxpbmVzOiBzdHJpbmdbXSxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgdXNhZ2U6IFB5dGhvblVzYWdlLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4gIHBhcnRzOiBzdHJpbmdbXSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGxldCBhZGRlZCA9IFwiXCI7XG5cbiAgZm9yIChjb25zdCBhbGlhcyBvZiBpbXBvcnROb2RlLm5hbWVzKSB7XG4gICAgY29uc3QgYmluZGluZyA9IGFsaWFzLmFzbmFtZSA/PyBhbGlhcy5uYW1lLnNwbGl0KFwiLlwiKVswXTtcbiAgICBjb25zdCB1c2VkQXR0cmlidXRlcyA9IHVzYWdlLmF0dHJpYnV0ZXNbYmluZGluZ10gPz8gW107XG4gICAgY29uc3QgYmluZGluZ0lzVXNlZCA9IHVzYWdlLm5hbWVzLmluY2x1ZGVzKGJpbmRpbmcpIHx8IHVzZWRBdHRyaWJ1dGVzLmxlbmd0aCA+IDA7XG4gICAgaWYgKCFiaW5kaW5nSXNVc2VkKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBsb2NhbE1vZHVsZVBhdGggPSBhd2FpdCBob3N0LnJlc29sdmVQeXRob25JbXBvcnQoZmlsZVBhdGgsIGFsaWFzLm5hbWUsIDApO1xuICAgIGlmICghbG9jYWxNb2R1bGVQYXRoKSB7XG4gICAgICBpZiAoYWRkUHl0aG9uSW1wb3J0TGluZShsaW5lcywgaW1wb3J0Tm9kZSwgc3RhdGUpKSB7XG4gICAgICAgIGFkZGVkICs9IGAke3JlbmRlclJhbmdlKGxpbmVzLCBpbXBvcnROb2RlKX1cXG5gO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGUgb2YgdXNlZEF0dHJpYnV0ZXMpIHtcbiAgICAgIGFkZGVkICs9IGF3YWl0IGV4dHJhY3RQeXRob25TeW1ib2xGcm9tRmlsZShsb2NhbE1vZHVsZVBhdGgsIGF0dHJpYnV0ZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICAgIGFkZFB5dGhvbk5hbWVzcGFjZUJpbmRpbmcoYmluZGluZywgYXR0cmlidXRlLCBzdGF0ZSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGFkZGVkO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHRyYWN0UHl0aG9uU3ltYm9sRnJvbUZpbGUoXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHN5bWJvbE5hbWU6IHN0cmluZyxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuICBwYXJ0czogc3RyaW5nW10sXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCB2aXNpdEtleSA9IGAke2ZpbGVQYXRofSMke3N5bWJvbE5hbWV9YDtcbiAgaWYgKHN0YXRlLnZpc2l0aW5nU3ltYm9scy5oYXModmlzaXRLZXkpKSB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cblxuICBjb25zdCBzb3VyY2UgPSBhd2FpdCBob3N0LnJlYWRGaWxlKGZpbGVQYXRoKTtcbiAgaWYgKCFzb3VyY2UpIHtcbiAgICByZXR1cm4gXCJcIjtcbiAgfVxuXG4gIHN0YXRlLnZpc2l0aW5nU3ltYm9scy5hZGQodmlzaXRLZXkpO1xuICB0cnkge1xuICAgIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgY29uc3QgbW9kdWxlSW5mbyA9IGF3YWl0IGluc3BlY3RQeXRob25Nb2R1bGUoc291cmNlLCBob3N0KTtcbiAgICBjb25zdCBkZWZpbml0aW9uID0gbW9kdWxlSW5mby5kZWZpbml0aW9ucy5maW5kKChjYW5kaWRhdGUpID0+IChjYW5kaWRhdGUubmFtZXMgPz8gW2NhbmRpZGF0ZS5uYW1lXSkuaW5jbHVkZXMoc3ltYm9sTmFtZSkpO1xuICAgIGlmICghZGVmaW5pdGlvbikge1xuICAgICAgcmV0dXJuIFwiXCI7XG4gICAgfVxuXG4gICAgY29uc3QgdGV4dCA9IHJlbmRlclJhbmdlKGxpbmVzLCBkZWZpbml0aW9uKTtcbiAgICBjb25zdCBkZXBlbmRlbmN5VGV4dCA9IGF3YWl0IGNvbGxlY3RQeXRob25EZXBlbmRlbmNpZXMoc291cmNlLCBmaWxlUGF0aCwgZGVmaW5pdGlvbiwgdGV4dCwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICBjb25zdCBhZGRlZCA9IGFkZFB5dGhvblJhbmdlKGxpbmVzLCBmaWxlUGF0aCwgZGVmaW5pdGlvbiwgc3RhdGUsIHBhcnRzKTtcbiAgICByZXR1cm4gW2RlcGVuZGVuY3lUZXh0LCBhZGRlZF0uZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSkuam9pbihcIlxcblwiKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBzdGF0ZS52aXNpdGluZ1N5bWJvbHMuZGVsZXRlKHZpc2l0S2V5KTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhZGRQeXRob25SYW5nZShcbiAgbGluZXM6IHN0cmluZ1tdLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICByYW5nZTogU291cmNlUmFuZ2UsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4gIHBhcnRzOiBzdHJpbmdbXSxcbik6IHN0cmluZyB7XG4gIGNvbnN0IGtleSA9IGAke2ZpbGVQYXRofTpMJHtyYW5nZS5zdGFydCArIDF9LUwke3JhbmdlLmVuZCArIDF9YDtcbiAgaWYgKHN0YXRlLmluY2x1ZGVkUmFuZ2VzLmhhcyhrZXkpKSB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cbiAgc3RhdGUuaW5jbHVkZWRSYW5nZXMuYWRkKGtleSk7XG4gIGNvbnN0IHRleHQgPSByZW5kZXJSYW5nZShsaW5lcywgcmFuZ2UpO1xuICBwYXJ0cy5wdXNoKHRleHQpO1xuICByZXR1cm4gdGV4dDtcbn1cblxuZnVuY3Rpb24gYWRkUHl0aG9uSW1wb3J0TGluZShsaW5lczogc3RyaW5nW10sIHJhbmdlOiBTb3VyY2VSYW5nZSwgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSk6IGJvb2xlYW4ge1xuICBjb25zdCB0ZXh0ID0gcmVuZGVyUmFuZ2UobGluZXMsIHJhbmdlKTtcbiAgaWYgKHN0YXRlLmluY2x1ZGVkSW1wb3J0cy5oYXModGV4dCkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgc3RhdGUuaW5jbHVkZWRJbXBvcnRzLmFkZCh0ZXh0KTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmZ1bmN0aW9uIGFkZFB5dGhvbkFsaWFzKG5hbWU6IHN0cmluZywgYXNuYW1lOiBzdHJpbmcsIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsIHBhcnRzOiBzdHJpbmdbXSk6IHN0cmluZyB7XG4gIGNvbnN0IGtleSA9IGAke2FzbmFtZX09JHtuYW1lfWA7XG4gIGlmIChzdGF0ZS5hbGlhc2VzLmhhcyhrZXkpKSB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cbiAgc3RhdGUuYWxpYXNlcy5hZGQoa2V5KTtcbiAgY29uc3QgdGV4dCA9IGAke2FzbmFtZX0gPSAke25hbWV9YDtcbiAgcGFydHMucHVzaCh0ZXh0KTtcbiAgcmV0dXJuIGAke3RleHR9XFxuYDtcbn1cblxuZnVuY3Rpb24gYWRkUHl0aG9uTmFtZXNwYWNlQmluZGluZyhiaW5kaW5nOiBzdHJpbmcsIGF0dHJpYnV0ZTogc3RyaW5nLCBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlKTogdm9pZCB7XG4gIHN0YXRlLm5lZWRzTmFtZXNwYWNlUnVudGltZSA9IHRydWU7XG4gIGNvbnN0IGF0dHJpYnV0ZXMgPSBzdGF0ZS5uYW1lc3BhY2VCaW5kaW5ncy5nZXQoYmluZGluZykgPz8gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGF0dHJpYnV0ZXMuYWRkKGF0dHJpYnV0ZSk7XG4gIHN0YXRlLm5hbWVzcGFjZUJpbmRpbmdzLnNldChiaW5kaW5nLCBhdHRyaWJ1dGVzKTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyUHl0aG9uTmFtZXNwYWNlQmluZGluZ3Moc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSk6IHN0cmluZyB7XG4gIGlmICghc3RhdGUubmFtZXNwYWNlQmluZGluZ3Muc2l6ZSkge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG5cbiAgY29uc3QgbGluZXMgPSBzdGF0ZS5uZWVkc05hbWVzcGFjZVJ1bnRpbWUgPyBbXCJpbXBvcnQgdHlwZXMgYXMgX2xvb21fdHlwZXNcIl0gOiBbXTtcbiAgZm9yIChjb25zdCBbYmluZGluZywgYXR0cmlidXRlc10gb2Ygc3RhdGUubmFtZXNwYWNlQmluZGluZ3MpIHtcbiAgICBsaW5lcy5wdXNoKGAke2JpbmRpbmd9ID0gX2xvb21fdHlwZXMuU2ltcGxlTmFtZXNwYWNlKClgKTtcbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZSBvZiBhdHRyaWJ1dGVzKSB7XG4gICAgICBsaW5lcy5wdXNoKGAke2JpbmRpbmd9LiR7YXR0cmlidXRlfSA9ICR7YXR0cmlidXRlfWApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbn1cblxuZnVuY3Rpb24gZmluZFB5dGhvblN5bWJvbFJhbmdlKG1vZHVsZUluZm86IFB5dGhvbk1vZHVsZUluZm8sIHN5bWJvbE5hbWU6IHN0cmluZyk6IFNvdXJjZVJhbmdlIHwgbnVsbCB7XG4gIGNvbnN0IGV4YWN0ID0gbW9kdWxlSW5mby5kZWZpbml0aW9ucy5maW5kKChkZWZpbml0aW9uKSA9PiAoZGVmaW5pdGlvbi5uYW1lcyA/PyBbZGVmaW5pdGlvbi5uYW1lXSkuaW5jbHVkZXMoc3ltYm9sTmFtZSkpO1xuICByZXR1cm4gZXhhY3QgPyB7IHN0YXJ0OiBleGFjdC5zdGFydCwgZW5kOiBleGFjdC5lbmQgfSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIHB5dGhvbkRlZmluaXRpb25Jc1VzZWQoZGVmaW5pdGlvbjogU291cmNlRGVmaW5pdGlvbiwgdXNhZ2U6IFB5dGhvblVzYWdlKTogYm9vbGVhbiB7XG4gIHJldHVybiAoZGVmaW5pdGlvbi5uYW1lcyA/PyBbZGVmaW5pdGlvbi5uYW1lXSkuc29tZSgobmFtZSkgPT4gdXNhZ2UubmFtZXMuaW5jbHVkZXMobmFtZSkpO1xufVxuXG5mdW5jdGlvbiB1c2VzVW5rbm93bkltcG9ydGVkTmFtZXModXNhZ2U6IFB5dGhvblVzYWdlKTogYm9vbGVhbiB7XG4gIHJldHVybiB1c2FnZS5uYW1lcy5sZW5ndGggPiAwO1xufVxuXG5mdW5jdGlvbiBqb2luUHl0aG9uTW9kdWxlKG1vZHVsZU5hbWU6IHN0cmluZywgbmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG1vZHVsZU5hbWUgPyBgJHttb2R1bGVOYW1lfS4ke25hbWV9YCA6IG5hbWU7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGluc3BlY3RQeXRob25Nb2R1bGUoc291cmNlOiBzdHJpbmcsIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCk6IFByb21pc2U8UHl0aG9uTW9kdWxlSW5mbz4ge1xuICByZXR1cm4gcnVuUHl0aG9uQXN0PFB5dGhvbk1vZHVsZUluZm8+KHNvdXJjZSwgXCJtb2R1bGVcIiwgaG9zdCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGluc3BlY3RQeXRob25Vc2FnZShzb3VyY2U6IHN0cmluZywgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0KTogUHJvbWlzZTxQeXRob25Vc2FnZT4ge1xuICByZXR1cm4gcnVuUHl0aG9uQXN0PFB5dGhvblVzYWdlPihzb3VyY2UsIFwidXNhZ2VcIiwgaG9zdCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJ1blB5dGhvbkFzdDxUPihzb3VyY2U6IHN0cmluZywgbW9kZTogXCJtb2R1bGVcIiB8IFwidXNhZ2VcIiwgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0KTogUHJvbWlzZTxUPiB7XG4gIGNvbnN0IGNvbW1hbmQgPSBzcGxpdENvbW1hbmRMaW5lKGhvc3QucHl0aG9uRXhlY3V0YWJsZT8udHJpbSgpIHx8IFwicHl0aG9uM1wiKTtcbiAgY29uc3QgZXhlY3V0YWJsZSA9IGNvbW1hbmRbMF0gPz8gXCJweXRob24zXCI7XG4gIGNvbnN0IGFyZ3MgPSBbLi4uY29tbWFuZC5zbGljZSgxKSwgXCItY1wiLCBQWVRIT05fQVNUX0hFTFBFUl07XG5cbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCBjaGlsZCA9IHNwYXduKGV4ZWN1dGFibGUsIGFyZ3MsIHsgc3RkaW86IFtcInBpcGVcIiwgXCJwaXBlXCIsIFwicGlwZVwiXSB9KTtcbiAgICBsZXQgc3Rkb3V0ID0gXCJcIjtcbiAgICBsZXQgc3RkZXJyID0gXCJcIjtcblxuICAgIGNoaWxkLnN0ZG91dC5zZXRFbmNvZGluZyhcInV0ZjhcIik7XG4gICAgY2hpbGQuc3RkZXJyLnNldEVuY29kaW5nKFwidXRmOFwiKTtcbiAgICBjaGlsZC5zdGRvdXQub24oXCJkYXRhXCIsIChjaHVuazogc3RyaW5nKSA9PiB7XG4gICAgICBzdGRvdXQgKz0gY2h1bms7XG4gICAgfSk7XG4gICAgY2hpbGQuc3RkZXJyLm9uKFwiZGF0YVwiLCAoY2h1bms6IHN0cmluZykgPT4ge1xuICAgICAgc3RkZXJyICs9IGNodW5rO1xuICAgIH0pO1xuICAgIGNoaWxkLm9uKFwiZXJyb3JcIiwgcmVqZWN0KTtcbiAgICBjaGlsZC5vbihcImNsb3NlXCIsIChjb2RlKSA9PiB7XG4gICAgICBpZiAoY29kZSAhPT0gMCkge1xuICAgICAgICByZWplY3QobmV3IEVycm9yKChzdGRlcnIgfHwgc3Rkb3V0IHx8IGBQeXRob24gQVNUIGhlbHBlciBleGl0ZWQgd2l0aCBjb2RlICR7Y29kZX0uYCkudHJpbSgpKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRyeSB7XG4gICAgICAgIHJlc29sdmUoSlNPTi5wYXJzZShzdGRvdXQpIGFzIFQpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNoaWxkLnN0ZGluLmVuZChKU09OLnN0cmluZ2lmeSh7IG1vZGUsIHNvdXJjZSB9KSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBmaW5kTGluZVJhbmdlKGxpbmVzOiBzdHJpbmdbXSwgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlKTogU291cmNlUmFuZ2UgfCBudWxsIHtcbiAgY29uc3Qgc3RhcnQgPSBNYXRoLm1heCgocmVmZXJlbmNlLmxpbmVTdGFydCA/PyAxKSAtIDEsIDApO1xuICBjb25zdCBlbmQgPSBNYXRoLm1pbigocmVmZXJlbmNlLmxpbmVFbmQgPz8gcmVmZXJlbmNlLmxpbmVTdGFydCA/PyBsaW5lcy5sZW5ndGgpIC0gMSwgbGluZXMubGVuZ3RoIC0gMSk7XG4gIGlmIChzdGFydCA+IGVuZCB8fCBzdGFydCA+PSBsaW5lcy5sZW5ndGgpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4geyBzdGFydCwgZW5kIH07XG59XG5cbmZ1bmN0aW9uIGZpbmRTeW1ib2xSYW5nZShsaW5lczogc3RyaW5nW10sIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBzeW1ib2xOYW1lOiBzdHJpbmcpOiBTb3VyY2VSYW5nZSB8IG51bGwge1xuICBjb25zdCBkZWZpbml0aW9ucyA9IGNvbGxlY3REZWZpbml0aW9ucyhsaW5lcywgbGFuZ3VhZ2UpO1xuICBjb25zdCBleGFjdCA9IGRlZmluaXRpb25zLmZpbmQoKGRlZmluaXRpb24pID0+IGRlZmluaXRpb25OYW1lcyhkZWZpbml0aW9uKS5pbmNsdWRlcyhzeW1ib2xOYW1lKSk7XG4gIGlmIChleGFjdCkge1xuICAgIHJldHVybiB7IHN0YXJ0OiBleGFjdC5zdGFydCwgZW5kOiBleGFjdC5lbmQgfTtcbiAgfVxuXG4gIGNvbnN0IHN5bWJvbFBhdHRlcm4gPSBuZXcgUmVnRXhwKGBcXFxcYiR7ZXNjYXBlUmVnZXgoc3ltYm9sTmFtZSl9XFxcXGJgKTtcbiAgY29uc3QgbGluZSA9IGxpbmVzLmZpbmRJbmRleCgoY2FuZGlkYXRlKSA9PiBzeW1ib2xQYXR0ZXJuLnRlc3QoY2FuZGlkYXRlKSk7XG4gIGlmIChsaW5lIDwgMCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiBsaW5lc1tsaW5lXS5pbmNsdWRlcyhcIntcIikgPyB7IHN0YXJ0OiBsaW5lLCBlbmQ6IGZpbmRCcmFjZVJhbmdlRW5kKGxpbmVzLCBsaW5lKSB9IDogeyBzdGFydDogbGluZSwgZW5kOiBsaW5lIH07XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3REZXBlbmRlbmN5U291cmNlKGxpbmVzOiBzdHJpbmdbXSwgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIHNlbGVjdGVkUmFuZ2U6IFNvdXJjZVJhbmdlLCBzZWxlY3RlZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgcHJvbG9ndWUgPSBjb2xsZWN0UHJvbG9ndWUobGluZXMsIGxhbmd1YWdlLCBzZWxlY3RlZFJhbmdlLnN0YXJ0KTtcbiAgY29uc3QgZGVmaW5pdGlvbnMgPSBjb2xsZWN0RGVmaW5pdGlvbnMobGluZXMsIGxhbmd1YWdlKVxuICAgIC5maWx0ZXIoKGRlZmluaXRpb24pID0+ICFyYW5nZXNPdmVybGFwKGRlZmluaXRpb24sIHNlbGVjdGVkUmFuZ2UpKTtcbiAgY29uc3Qgc2VsZWN0ZWREZWZpbml0aW9ucyA9IHRyYWNlRGVmaW5pdGlvbnMoc2VsZWN0ZWQsIGRlZmluaXRpb25zLCBsaW5lcyk7XG4gIHJldHVybiBbLi4ucHJvbG9ndWUsIC4uLnNlbGVjdGVkRGVmaW5pdGlvbnMubWFwKChkZWZpbml0aW9uKSA9PiByZW5kZXJSYW5nZShsaW5lcywgZGVmaW5pdGlvbikpXVxuICAgIC5maWx0ZXIoKHBhcnQpID0+IHBhcnQudHJpbSgpKVxuICAgIC5qb2luKFwiXFxuXFxuXCIpO1xufVxuXG5mdW5jdGlvbiB0cmFjZURlZmluaXRpb25zKHNlZWQ6IHN0cmluZywgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSwgbGluZXM6IHN0cmluZ1tdKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3Qgc2VsZWN0ZWQ6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBjb25zdCBzZWxlY3RlZEtleXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgbGV0IGhheXN0YWNrID0gc2VlZDtcbiAgbGV0IGNoYW5nZWQgPSB0cnVlO1xuXG4gIHdoaWxlIChjaGFuZ2VkKSB7XG4gICAgY2hhbmdlZCA9IGZhbHNlO1xuICAgIGZvciAoY29uc3QgZGVmaW5pdGlvbiBvZiBkZWZpbml0aW9ucykge1xuICAgICAgY29uc3Qga2V5ID0gYCR7ZGVmaW5pdGlvbi5zdGFydH06JHtkZWZpbml0aW9uLmVuZH06JHtkZWZpbml0aW9uLm5hbWV9YDtcbiAgICAgIGlmIChzZWxlY3RlZEtleXMuaGFzKGtleSkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoIWRlZmluaXRpb25OYW1lcyhkZWZpbml0aW9uKS5zb21lKChuYW1lKSA9PiBzb3VyY2VVc2VzTmFtZShoYXlzdGFjaywgbmFtZSkpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgc2VsZWN0ZWRLZXlzLmFkZChrZXkpO1xuICAgICAgc2VsZWN0ZWQucHVzaChkZWZpbml0aW9uKTtcbiAgICAgIGhheXN0YWNrICs9IGBcXG4ke3JlbmRlclJhbmdlKGxpbmVzLCBkZWZpbml0aW9uKX1cXG5gO1xuICAgICAgY2hhbmdlZCA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHNlbGVjdGVkLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0LnN0YXJ0IC0gcmlnaHQuc3RhcnQpO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0UHJvbG9ndWUobGluZXM6IHN0cmluZ1tdLCBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgYmVmb3JlTGluZTogbnVtYmVyKTogc3RyaW5nW10ge1xuICBjb25zdCBwcm9sb2d1ZTogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgbWF4ID0gTWF0aC5tYXgoYmVmb3JlTGluZSwgMCk7XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBtYXg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaW5kZXhdO1xuICAgIGlmIChpc1Byb2xvZ3VlTGluZShsaW5lLCBsYW5ndWFnZSkpIHtcbiAgICAgIHByb2xvZ3VlLnB1c2gobGluZSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBwcm9sb2d1ZS5sZW5ndGggPyBbcHJvbG9ndWUuam9pbihcIlxcblwiKV0gOiBbXTtcbn1cblxuZnVuY3Rpb24gaXNQcm9sb2d1ZUxpbmUobGluZTogc3RyaW5nLCBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSk6IGJvb2xlYW4ge1xuICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gIGlmICghdHJpbW1lZCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBzd2l0Y2ggKGxhbmd1YWdlKSB7XG4gICAgY2FzZSBcInB5dGhvblwiOlxuICAgICAgcmV0dXJuIC9eKGZyb21cXHMrXFxTK1xccytpbXBvcnRcXHMrfGltcG9ydFxccyspLy50ZXN0KHRyaW1tZWQpO1xuICAgIGNhc2UgXCJqYXZhc2NyaXB0XCI6XG4gICAgY2FzZSBcInR5cGVzY3JpcHRcIjpcbiAgICAgIHJldHVybiAvXihpbXBvcnRcXHMrfGV4cG9ydFxccysuKlxccytmcm9tXFxzK3woPzpjb25zdHxsZXR8dmFyKVxccytcXHcrXFxzKj1cXHMqcmVxdWlyZVxccypcXCgpLy50ZXN0KHRyaW1tZWQpO1xuICAgIGNhc2UgXCJjXCI6XG4gICAgY2FzZSBcImNwcFwiOlxuICAgIGNhc2UgXCJsbHZtLWlyXCI6XG4gICAgICByZXR1cm4gdHJpbW1lZC5zdGFydHNXaXRoKFwiI1wiKSB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoXCJ0YXJnZXQgXCIpIHx8IHRyaW1tZWQuc3RhcnRzV2l0aChcInNvdXJjZV9maWxlbmFtZVwiKTtcbiAgICBjYXNlIFwiaGFza2VsbFwiOlxuICAgICAgcmV0dXJuIC9eKG1vZHVsZVxccyt8aW1wb3J0XFxzKykvLnRlc3QodHJpbW1lZCk7XG4gICAgY2FzZSBcIm9jYW1sXCI6XG4gICAgICByZXR1cm4gL14ob3Blblxccyt8aW5jbHVkZVxccyt8I3VzZVxccyspLy50ZXN0KHRyaW1tZWQpO1xuICAgIGNhc2UgXCJqYXZhXCI6XG4gICAgICByZXR1cm4gL14ocGFja2FnZVxccyt8aW1wb3J0XFxzKykvLnRlc3QodHJpbW1lZCk7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjb2xsZWN0RGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdLCBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIHN3aXRjaCAobGFuZ3VhZ2UpIHtcbiAgICBjYXNlIFwicHl0aG9uXCI6XG4gICAgICByZXR1cm4gY29sbGVjdFB5dGhvbkRlZmluaXRpb25zKGxpbmVzKTtcbiAgICBjYXNlIFwiamF2YXNjcmlwdFwiOlxuICAgIGNhc2UgXCJ0eXBlc2NyaXB0XCI6XG4gICAgICByZXR1cm4gY29sbGVjdEJyYWNlRGVmaW5pdGlvbnMobGluZXMsIC9eKD86ZXhwb3J0XFxzKyk/KD86YXN5bmNcXHMrKT9mdW5jdGlvblxccysoW0EtWmEtel8kXVtcXHckXSopXFxifF4oPzpleHBvcnRcXHMrKT9jbGFzc1xccysoW0EtWmEtel8kXVtcXHckXSopXFxifF4oPzpleHBvcnRcXHMrKT8oPzpjb25zdHxsZXR8dmFyKVxccysoW0EtWmEtel8kXVtcXHckXSopXFxzKj0vKTtcbiAgICBjYXNlIFwiY1wiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RDRGVmaW5pdGlvbnMobGluZXMsIGZhbHNlKTtcbiAgICBjYXNlIFwiY3BwXCI6XG4gICAgICByZXR1cm4gY29sbGVjdENEZWZpbml0aW9ucyhsaW5lcywgdHJ1ZSk7XG4gICAgY2FzZSBcImhhc2tlbGxcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0SGFza2VsbERlZmluaXRpb25zKGxpbmVzKTtcbiAgICBjYXNlIFwib2NhbWxcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0T2NhbWxEZWZpbml0aW9ucyhsaW5lcyk7XG4gICAgY2FzZSBcImphdmFcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0QnJhY2VEZWZpbml0aW9ucyhsaW5lcywgL15cXHMqKD86cHVibGljfHByaXZhdGV8cHJvdGVjdGVkfHN0YXRpY3xmaW5hbHxhYnN0cmFjdHxcXHMpKlxccyooPzpjbGFzc3xpbnRlcmZhY2V8ZW51bXxyZWNvcmQpXFxzKyhbQS1aYS16X11cXHcqKVxcYnxeXFxzKig/OnB1YmxpY3xwcml2YXRlfHByb3RlY3RlZHxzdGF0aWN8ZmluYWx8c3luY2hyb25pemVkfG5hdGl2ZXxcXHMpK1tcXHc8PlxcW1xcXSwuP10rXFxzKyhbQS1aYS16X11cXHcqKVxccypcXChbXjtdKlxcKVxccypcXHsvKTtcbiAgICBjYXNlIFwibGx2bS1pclwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RMbHZtRGVmaW5pdGlvbnMobGluZXMpO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gW107XG4gIH1cbn1cblxuZnVuY3Rpb24gY29sbGVjdFB5dGhvbkRlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGFzc2lnbm1lbnQgPSBsaW5lc1tpbmRleF0ubWF0Y2goL14oW0EtWmEtel9dXFx3KilcXHMqWzo9XS8pO1xuICAgIGlmIChhc3NpZ25tZW50KSB7XG4gICAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogYXNzaWdubWVudFsxXSwgc3RhcnQ6IGluZGV4LCBlbmQ6IGluZGV4IH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lc1tpbmRleF0ubWF0Y2goL14oXFxzKikoPzphc3luY1xccyspPyg/OmRlZnxjbGFzcylcXHMrKFtBLVphLXpfXVxcdyopXFxiLyk7XG4gICAgaWYgKCFtYXRjaCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGluZGVudCA9IG1hdGNoWzFdLmxlbmd0aDtcbiAgICBsZXQgc3RhcnQgPSBpbmRleDtcbiAgICB3aGlsZSAoc3RhcnQgPiAwICYmIGxpbmVzW3N0YXJ0IC0gMV0udHJpbSgpLnN0YXJ0c1dpdGgoXCJAXCIpICYmIGdldEluZGVudChsaW5lc1tzdGFydCAtIDFdKSA9PT0gaW5kZW50KSB7XG4gICAgICBzdGFydCAtPSAxO1xuICAgIH1cbiAgICBsZXQgZW5kID0gaW5kZXg7XG4gICAgZm9yIChsZXQgY3Vyc29yID0gaW5kZXggKyAxOyBjdXJzb3IgPCBsaW5lcy5sZW5ndGg7IGN1cnNvciArPSAxKSB7XG4gICAgICBpZiAobGluZXNbY3Vyc29yXS50cmltKCkgJiYgZ2V0SW5kZW50KGxpbmVzW2N1cnNvcl0pIDw9IGluZGVudCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGVuZCA9IGN1cnNvcjtcbiAgICB9XG4gICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IG1hdGNoWzJdLCBzdGFydCwgZW5kIH0pO1xuICB9XG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gY29sbGVjdENEZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10sIGlzQ3BwOiBib29sZWFuKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBsZXQgZGVwdGggPSAwO1xuXG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaW5kZXhdO1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBjb25zdCB0b3BMZXZlbCA9IGRlcHRoID09PSAwO1xuXG4gICAgaWYgKHRvcExldmVsICYmIHRyaW1tZWQpIHtcbiAgICAgIGNvbnN0IG1hY3JvID0gdHJpbW1lZC5tYXRjaCgvXiNcXHMqZGVmaW5lXFxzKyhbQS1aYS16X11cXHcqKVxcYi8pO1xuICAgICAgaWYgKG1hY3JvKSB7XG4gICAgICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBtYWNyb1sxXSwgc3RhcnQ6IGluZGV4LCBlbmQ6IGluZGV4IH0pO1xuICAgICAgfSBlbHNlIGlmICghdHJpbW1lZC5zdGFydHNXaXRoKFwiI1wiKSAmJiAhaXNDQ29tbWVudExpbmUodHJpbW1lZCkpIHtcbiAgICAgICAgY29uc3QgdHlwZURlZmluaXRpb24gPSBtYXRjaENUeXBlRGVmaW5pdGlvbihsaW5lcywgaW5kZXgsIGlzQ3BwKTtcbiAgICAgICAgaWYgKHR5cGVEZWZpbml0aW9uKSB7XG4gICAgICAgICAgZGVmaW5pdGlvbnMucHVzaCh0eXBlRGVmaW5pdGlvbik7XG4gICAgICAgICAgaW5kZXggPSBNYXRoLm1heChpbmRleCwgdHlwZURlZmluaXRpb24uZW5kKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCBmdW5jdGlvbkRlZmluaXRpb24gPSBtYXRjaENGdW5jdGlvbkRlZmluaXRpb24obGluZXMsIGluZGV4KTtcbiAgICAgICAgICBpZiAoZnVuY3Rpb25EZWZpbml0aW9uKSB7XG4gICAgICAgICAgICBkZWZpbml0aW9ucy5wdXNoKGZ1bmN0aW9uRGVmaW5pdGlvbik7XG4gICAgICAgICAgICBpbmRleCA9IE1hdGgubWF4KGluZGV4LCBmdW5jdGlvbkRlZmluaXRpb24uZW5kKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3QgZ2xvYmFsRGVmaW5pdGlvbiA9IG1hdGNoQ0dsb2JhbERlZmluaXRpb24obGluZSwgaW5kZXgpO1xuICAgICAgICAgICAgaWYgKGdsb2JhbERlZmluaXRpb24pIHtcbiAgICAgICAgICAgICAgZGVmaW5pdGlvbnMucHVzaChnbG9iYWxEZWZpbml0aW9uKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBkZXB0aCArPSBicmFjZURlbHRhKGxpbmUpO1xuICAgIGlmIChkZXB0aCA8IDApIHtcbiAgICAgIGRlcHRoID0gMDtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZGVmaW5pdGlvbnM7XG59XG5cbmZ1bmN0aW9uIG1hdGNoQ1R5cGVEZWZpbml0aW9uKGxpbmVzOiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlciwgaXNDcHA6IGJvb2xlYW4pOiBTb3VyY2VEZWZpbml0aW9uIHwgbnVsbCB7XG4gIGNvbnN0IGhlYWRlciA9IGxpbmVzLnNsaWNlKHN0YXJ0LCBNYXRoLm1pbihsaW5lcy5sZW5ndGgsIHN0YXJ0ICsgOCkpLmpvaW4oXCIgXCIpO1xuICBjb25zdCBrZXl3b3JkUGF0dGVybiA9IGlzQ3BwID8gXCIoPzp0eXBlZGVmXFxcXHMrKT8oPzpzdHJ1Y3R8Y2xhc3N8ZW51bXx1bmlvbilcIiA6IFwiKD86dHlwZWRlZlxcXFxzKyk/KD86c3RydWN0fGVudW18dW5pb24pXCI7XG4gIGNvbnN0IG5hbWVkID0gaGVhZGVyLm1hdGNoKG5ldyBSZWdFeHAoYF5cXFxccyoke2tleXdvcmRQYXR0ZXJufVxcXFxzKyhbQS1aYS16X11cXFxcdyopXFxcXGJgKSk7XG4gIGNvbnN0IGFub255bW91c1R5cGVkZWYgPSBoZWFkZXIubWF0Y2goL15cXHMqdHlwZWRlZlxccysoPzpzdHJ1Y3R8ZW51bXx1bmlvbilcXGJbXFxzXFxTXSo/XFx9XFxzKihbQS1aYS16X11cXHcqKVxccyo7Lyk7XG4gIGNvbnN0IG5hbWUgPSBuYW1lZD8uWzFdID8/IGFub255bW91c1R5cGVkZWY/LlsxXTtcbiAgaWYgKCFuYW1lKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBlbmQgPSBmaW5kQ0RlY2xhcmF0aW9uRW5kKGxpbmVzLCBzdGFydCk7XG4gIHJldHVybiB7IG5hbWUsIG5hbWVzOiBbbmFtZV0sIHN0YXJ0LCBlbmQgfTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hDRnVuY3Rpb25EZWZpbml0aW9uKGxpbmVzOiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlcik6IFNvdXJjZURlZmluaXRpb24gfCBudWxsIHtcbiAgY29uc3QgaGVhZGVyTGluZXMgPSBsaW5lcy5zbGljZShzdGFydCwgTWF0aC5taW4obGluZXMubGVuZ3RoLCBzdGFydCArIDEyKSk7XG4gIGNvbnN0IGpvaW5lZCA9IGhlYWRlckxpbmVzLmpvaW4oXCIgXCIpO1xuICBjb25zdCBicmFjZU9mZnNldCA9IGhlYWRlckxpbmVzLmZpbmRJbmRleCgobGluZSkgPT4gbGluZS5pbmNsdWRlcyhcIntcIikpO1xuICBpZiAoYnJhY2VPZmZzZXQgPCAwIHx8IGpvaW5lZC5pbmRleE9mKFwiO1wiKSA+PSAwICYmIGpvaW5lZC5pbmRleE9mKFwiO1wiKSA8IGpvaW5lZC5pbmRleE9mKFwie1wiKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgbWF0Y2hlcyA9IFsuLi5qb2luZWQubWF0Y2hBbGwoLyhbQS1aYS16X11cXHcqKD86OjpbQS1aYS16X11cXHcqKT98b3BlcmF0b3JcXHMqW15cXHMoXSspXFxzKlxcKFteO3t9XSpcXClcXHMqKD86Y29uc3RcXGJbXnt9XSopPyg/Om5vZXhjZXB0XFxiW157fV0qKT8oPzotPlxccypbXnt9XSspP1xcey9nKV07XG4gIGNvbnN0IG5hbWUgPSBtYXRjaGVzWzBdPy5bMV0/LnJlcGxhY2UoL1xccysvZywgXCJcIik7XG4gIGlmICghbmFtZSB8fCBpc0NDb250cm9sS2V5d29yZChuYW1lKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgYnJhY2VMaW5lID0gc3RhcnQgKyBicmFjZU9mZnNldDtcbiAgY29uc3Qgc2hvcnROYW1lID0gbmFtZS5pbmNsdWRlcyhcIjo6XCIpID8gbmFtZS5zcGxpdChcIjo6XCIpLnBvcCgpID8/IG5hbWUgOiBuYW1lO1xuICByZXR1cm4ge1xuICAgIG5hbWU6IHNob3J0TmFtZSxcbiAgICBuYW1lczogWy4uLm5ldyBTZXQoW3Nob3J0TmFtZSwgbmFtZV0pXSxcbiAgICBzdGFydCxcbiAgICBlbmQ6IGZpbmRCcmFjZVJhbmdlRW5kKGxpbmVzLCBicmFjZUxpbmUpLFxuICB9O1xufVxuXG5mdW5jdGlvbiBtYXRjaENHbG9iYWxEZWZpbml0aW9uKGxpbmU6IHN0cmluZywgaW5kZXg6IG51bWJlcik6IFNvdXJjZURlZmluaXRpb24gfCBudWxsIHtcbiAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICBpZiAoIXRyaW1tZWQuZW5kc1dpdGgoXCI7XCIpIHx8IHRyaW1tZWQuaW5jbHVkZXMoXCIoXCIpIHx8IC9eKHJldHVybnx1c2luZ3xuYW1lc3BhY2V8dGVtcGxhdGUpXFxiLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCB3aXRob3V0SW5pdGlhbGl6ZXIgPSB0cmltbWVkLnNwbGl0KFwiPVwiKVswXS5yZXBsYWNlKC9cXFtbXlxcXV0qXS9nLCBcIlwiKTtcbiAgY29uc3QgbWF0Y2ggPSB3aXRob3V0SW5pdGlhbGl6ZXIubWF0Y2goLyhbQS1aYS16X11cXHcqKVxccyooPzpbLDtdfCQpL2cpPy5wb3AoKT8ubWF0Y2goLyhbQS1aYS16X11cXHcqKS8pO1xuICBjb25zdCBuYW1lID0gbWF0Y2g/LlsxXTtcbiAgaWYgKCFuYW1lIHx8IC9eKGNvbnN0fHN0YXRpY3xleHRlcm58dm9sYXRpbGV8dW5zaWduZWR8c2lnbmVkfGxvbmd8c2hvcnR8aW50fGNoYXJ8ZmxvYXR8ZG91YmxlfHZvaWR8YXV0bykkLy50ZXN0KG5hbWUpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4geyBuYW1lLCBzdGFydDogaW5kZXgsIGVuZDogaW5kZXggfTtcbn1cblxuZnVuY3Rpb24gY29sbGVjdExsdm1EZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaW5kZXhdO1xuICAgIGNvbnN0IHN5bWJvbCA9IGxpbmUubWF0Y2goL15cXHMqKD86ZGVmaW5lfGRlY2xhcmUpXFxiLipAKFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSopXFxzKlxcKC8pO1xuICAgIGlmIChzeW1ib2wpIHtcbiAgICAgIGNvbnN0IGVuZCA9IGxpbmUudHJpbVN0YXJ0KCkuc3RhcnRzV2l0aChcImRlZmluZVwiKSA/IGZpbmRCcmFjZVJhbmdlRW5kKGxpbmVzLCBpbmRleCkgOiBpbmRleDtcbiAgICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBzeW1ib2xbMV0sIG5hbWVzOiBbc3ltYm9sWzFdLCBgQCR7c3ltYm9sWzFdfWBdLCBzdGFydDogaW5kZXgsIGVuZCB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGdsb2JhbCA9IGxpbmUubWF0Y2goL15cXHMqQChbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qKVxccyo9Lyk7XG4gICAgaWYgKGdsb2JhbCkge1xuICAgICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IGdsb2JhbFsxXSwgbmFtZXM6IFtnbG9iYWxbMV0sIGBAJHtnbG9iYWxbMV19YF0sIHN0YXJ0OiBpbmRleCwgZW5kOiBpbmRleCB9KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGRlZmluaXRpb25zO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0SGFza2VsbERlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lc1tpbmRleF0udHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCB8fCBnZXRJbmRlbnQobGluZXNbaW5kZXhdKSA+IDAgfHwgL14obW9kdWxlfGltcG9ydClcXGIvLnRlc3QodHJpbW1lZCkpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG5hbWVzID0gZ2V0SGFza2VsbERlZmluaXRpb25OYW1lcyh0cmltbWVkKTtcbiAgICBpZiAoIW5hbWVzLmxlbmd0aCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZW5kID0gZmluZEhhc2tlbGxSYW5nZUVuZChsaW5lcywgaW5kZXgsIG5hbWVzWzBdKTtcbiAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogbmFtZXNbMF0sIG5hbWVzLCBzdGFydDogaW5kZXgsIGVuZCB9KTtcbiAgICBpbmRleCA9IGVuZDtcbiAgfVxuICByZXR1cm4gZGVmaW5pdGlvbnM7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RPY2FtbERlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lc1tpbmRleF0udHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCB8fCBnZXRJbmRlbnQobGluZXNbaW5kZXhdKSA+IDAgfHwgL14ob3BlbnxpbmNsdWRlfCN1c2UpXFxiLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBuYW1lcyA9IGdldE9jYW1sRGVmaW5pdGlvbk5hbWVzKHRyaW1tZWQpO1xuICAgIGlmICghbmFtZXMubGVuZ3RoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBlbmQgPSBmaW5kTGF5b3V0UmFuZ2VFbmQobGluZXMsIGluZGV4LCBpc09jYW1sVG9wTGV2ZWxTdGFydCk7XG4gICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IG5hbWVzWzBdLCBuYW1lcywgc3RhcnQ6IGluZGV4LCBlbmQgfSk7XG4gICAgaW5kZXggPSBlbmQ7XG4gIH1cbiAgcmV0dXJuIGRlZmluaXRpb25zO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0QnJhY2VEZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10sIHBhdHRlcm46IFJlZ0V4cCk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IG1hdGNoID0gbGluZXNbaW5kZXhdLm1hdGNoKHBhdHRlcm4pO1xuICAgIGNvbnN0IG5hbWUgPSBtYXRjaD8uc2xpY2UoMSkuZmluZChCb29sZWFuKTtcbiAgICBpZiAoIW5hbWUpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZSwgc3RhcnQ6IGluZGV4LCBlbmQ6IGZpbmRCcmFjZVJhbmdlRW5kKGxpbmVzLCBpbmRleCkgfSk7XG4gIH1cbiAgcmV0dXJuIGRlZmluaXRpb25zO1xufVxuXG5mdW5jdGlvbiBmaW5kQnJhY2VSYW5nZUVuZChsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAoIWxpbmVzW3N0YXJ0XS5pbmNsdWRlcyhcIntcIikpIHtcbiAgICByZXR1cm4gc3RhcnQ7XG4gIH1cblxuICBsZXQgZGVwdGggPSAwO1xuICBsZXQgc2F3QnJhY2UgPSBmYWxzZTtcbiAgZm9yIChsZXQgaW5kZXggPSBzdGFydDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBmb3IgKGNvbnN0IGNoYXIgb2YgbGluZXNbaW5kZXhdKSB7XG4gICAgICBpZiAoY2hhciA9PT0gXCJ7XCIpIHtcbiAgICAgICAgZGVwdGggKz0gMTtcbiAgICAgICAgc2F3QnJhY2UgPSB0cnVlO1xuICAgICAgfSBlbHNlIGlmIChjaGFyID09PSBcIn1cIikge1xuICAgICAgICBkZXB0aCAtPSAxO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoc2F3QnJhY2UgJiYgZGVwdGggPD0gMCkge1xuICAgICAgcmV0dXJuIGluZGV4O1xuICAgIH1cbiAgfVxuICByZXR1cm4gc3RhcnQ7XG59XG5cbmZ1bmN0aW9uIGZpbmRDRGVjbGFyYXRpb25FbmQobGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyKTogbnVtYmVyIHtcbiAgbGV0IHNhd0JyYWNlID0gZmFsc2U7XG4gIGxldCBkZXB0aCA9IDA7XG4gIGZvciAobGV0IGluZGV4ID0gc3RhcnQ7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgZm9yIChjb25zdCBjaGFyIG9mIGxpbmVzW2luZGV4XSkge1xuICAgICAgaWYgKGNoYXIgPT09IFwie1wiKSB7XG4gICAgICAgIGRlcHRoICs9IDE7XG4gICAgICAgIHNhd0JyYWNlID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSBpZiAoY2hhciA9PT0gXCJ9XCIpIHtcbiAgICAgICAgZGVwdGggLT0gMTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoKCFzYXdCcmFjZSB8fCBkZXB0aCA8PSAwKSAmJiBsaW5lc1tpbmRleF0uaW5jbHVkZXMoXCI7XCIpKSB7XG4gICAgICByZXR1cm4gaW5kZXg7XG4gICAgfVxuICB9XG4gIHJldHVybiBzdGFydDtcbn1cblxuZnVuY3Rpb24gYnJhY2VEZWx0YShsaW5lOiBzdHJpbmcpOiBudW1iZXIge1xuICBsZXQgZGVsdGEgPSAwO1xuICBmb3IgKGNvbnN0IGNoYXIgb2YgbGluZSkge1xuICAgIGlmIChjaGFyID09PSBcIntcIikge1xuICAgICAgZGVsdGEgKz0gMTtcbiAgICB9IGVsc2UgaWYgKGNoYXIgPT09IFwifVwiKSB7XG4gICAgICBkZWx0YSAtPSAxO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZGVsdGE7XG59XG5cbmZ1bmN0aW9uIGlzQ0NvbW1lbnRMaW5lKHRyaW1tZWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gdHJpbW1lZC5zdGFydHNXaXRoKFwiLy9cIikgfHwgdHJpbW1lZC5zdGFydHNXaXRoKFwiLypcIikgfHwgdHJpbW1lZC5zdGFydHNXaXRoKFwiKlwiKTtcbn1cblxuZnVuY3Rpb24gaXNDQ29udHJvbEtleXdvcmQobmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBbXCJpZlwiLCBcImZvclwiLCBcIndoaWxlXCIsIFwic3dpdGNoXCIsIFwiY2F0Y2hcIl0uaW5jbHVkZXMobmFtZSk7XG59XG5cbmZ1bmN0aW9uIGdldEhhc2tlbGxEZWZpbml0aW9uTmFtZXModHJpbW1lZDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBzaWduYXR1cmUgPSB0cmltbWVkLm1hdGNoKC9eKFthLXpfXVtcXHcnXSopXFxzKjo6Lyk7XG4gIGlmIChzaWduYXR1cmUpIHtcbiAgICByZXR1cm4gW3NpZ25hdHVyZVsxXV07XG4gIH1cblxuICBjb25zdCBiaW5kaW5nID0gdHJpbW1lZC5tYXRjaCgvXihbYS16X11bXFx3J10qKVxcYi4qPS8pO1xuICBpZiAoYmluZGluZykge1xuICAgIHJldHVybiBbYmluZGluZ1sxXV07XG4gIH1cblxuICBjb25zdCB0eXBlTGlrZSA9IHRyaW1tZWQubWF0Y2goL14oPzpkYXRhfG5ld3R5cGV8dHlwZXxjbGFzcylcXHMrKFtBLVpdW1xcdyddKilcXGIvKTtcbiAgaWYgKHR5cGVMaWtlKSB7XG4gICAgcmV0dXJuIFt0eXBlTGlrZVsxXV07XG4gIH1cblxuICBjb25zdCBpbnN0YW5jZSA9IHRyaW1tZWQubWF0Y2goL15pbnN0YW5jZVxcYi4qP1xcYihbQS1aXVtcXHcnXSopXFxiLyk7XG4gIHJldHVybiBpbnN0YW5jZSA/IFtpbnN0YW5jZVsxXV0gOiBbXTtcbn1cblxuZnVuY3Rpb24gZ2V0T2NhbWxEZWZpbml0aW9uTmFtZXModHJpbW1lZDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBsZXRCaW5kaW5nID0gdHJpbW1lZC5tYXRjaCgvXmxldFxccysoPzpyZWNcXHMrKT8oPzpcXCgoW14pXSspXFwpfChbYS16X11bXFx3J10qKSkvKTtcbiAgaWYgKGxldEJpbmRpbmcpIHtcbiAgICByZXR1cm4gW2xldEJpbmRpbmdbMV0gPz8gbGV0QmluZGluZ1syXV07XG4gIH1cblxuICBjb25zdCB0eXBlQmluZGluZyA9IHRyaW1tZWQubWF0Y2goL150eXBlXFxzKyhbYS16X11bXFx3J10qKS8pO1xuICBpZiAodHlwZUJpbmRpbmcpIHtcbiAgICByZXR1cm4gW3R5cGVCaW5kaW5nWzFdXTtcbiAgfVxuXG4gIGNvbnN0IG1vZHVsZUJpbmRpbmcgPSB0cmltbWVkLm1hdGNoKC9ebW9kdWxlXFxzKyhbQS1aXVtcXHcnXSopLyk7XG4gIGlmIChtb2R1bGVCaW5kaW5nKSB7XG4gICAgcmV0dXJuIFttb2R1bGVCaW5kaW5nWzFdXTtcbiAgfVxuXG4gIHJldHVybiBbXTtcbn1cblxuZnVuY3Rpb24gZmluZExheW91dFJhbmdlRW5kKGxpbmVzOiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlciwgaXNUb3BMZXZlbFN0YXJ0OiAobGluZTogc3RyaW5nKSA9PiBib29sZWFuKTogbnVtYmVyIHtcbiAgbGV0IGVuZCA9IHN0YXJ0O1xuICBmb3IgKGxldCBpbmRleCA9IHN0YXJ0ICsgMTsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaW5kZXhdO1xuICAgIGlmIChsaW5lLnRyaW0oKSAmJiBnZXRJbmRlbnQobGluZSkgPT09IDAgJiYgaXNUb3BMZXZlbFN0YXJ0KGxpbmUudHJpbSgpKSkge1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGVuZCA9IGluZGV4O1xuICB9XG4gIHJldHVybiBlbmQ7XG59XG5cbmZ1bmN0aW9uIGZpbmRIYXNrZWxsUmFuZ2VFbmQobGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyLCBuYW1lOiBzdHJpbmcpOiBudW1iZXIge1xuICBsZXQgZW5kID0gc3RhcnQ7XG4gIGxldCBhbGxvd01hdGNoaW5nRXF1YXRpb24gPSBsaW5lc1tzdGFydF0udHJpbSgpLnN0YXJ0c1dpdGgoYCR7bmFtZX0gOjpgKTtcbiAgZm9yIChsZXQgaW5kZXggPSBzdGFydCArIDE7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XTtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKHRyaW1tZWQgJiYgZ2V0SW5kZW50KGxpbmUpID09PSAwICYmIGlzSGFza2VsbFRvcExldmVsU3RhcnQodHJpbW1lZCkpIHtcbiAgICAgIGlmIChhbGxvd01hdGNoaW5nRXF1YXRpb24gJiYgdHJpbW1lZC5zdGFydHNXaXRoKGAke25hbWV9IGApICYmIHRyaW1tZWQuaW5jbHVkZXMoXCI9XCIpKSB7XG4gICAgICAgIGFsbG93TWF0Y2hpbmdFcXVhdGlvbiA9IGZhbHNlO1xuICAgICAgICBlbmQgPSBpbmRleDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgZW5kID0gaW5kZXg7XG4gIH1cbiAgcmV0dXJuIGVuZDtcbn1cblxuZnVuY3Rpb24gaXNIYXNrZWxsVG9wTGV2ZWxTdGFydCh0cmltbWVkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC9eKG1vZHVsZXxpbXBvcnR8ZGF0YXxuZXd0eXBlfHR5cGV8Y2xhc3N8aW5zdGFuY2UpXFxiLy50ZXN0KHRyaW1tZWQpXG4gICAgfHwgL15bYS16X11bXFx3J10qXFxzKig/Ojo6fC4qPSkvLnRlc3QodHJpbW1lZCk7XG59XG5cbmZ1bmN0aW9uIGlzT2NhbWxUb3BMZXZlbFN0YXJ0KHRyaW1tZWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gL14ob3BlbnxpbmNsdWRlfCN1c2V8bGV0fHR5cGV8bW9kdWxlKVxcYi8udGVzdCh0cmltbWVkKTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyUmFuZ2UobGluZXM6IHN0cmluZ1tdLCByYW5nZTogU291cmNlUmFuZ2UpOiBzdHJpbmcge1xuICByZXR1cm4gbGluZXMuc2xpY2UocmFuZ2Uuc3RhcnQsIHJhbmdlLmVuZCArIDEpLmpvaW4oXCJcXG5cIik7XG59XG5cbmZ1bmN0aW9uIHJhbmdlc092ZXJsYXAobGVmdDogU291cmNlUmFuZ2UsIHJpZ2h0OiBTb3VyY2VSYW5nZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gbGVmdC5zdGFydCA8PSByaWdodC5lbmQgJiYgcmlnaHQuc3RhcnQgPD0gbGVmdC5lbmQ7XG59XG5cbmZ1bmN0aW9uIGdldEluZGVudChsaW5lOiBzdHJpbmcpOiBudW1iZXIge1xuICByZXR1cm4gbGluZS5tYXRjaCgvXlxccyovKT8uWzBdLmxlbmd0aCA/PyAwO1xufVxuXG5mdW5jdGlvbiBlc2NhcGVSZWdleCh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHZhbHVlLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCBcIlxcXFwkJlwiKTtcbn1cblxuZnVuY3Rpb24gZGVmaW5pdGlvbk5hbWVzKGRlZmluaXRpb246IFNvdXJjZURlZmluaXRpb24pOiBzdHJpbmdbXSB7XG4gIHJldHVybiBkZWZpbml0aW9uLm5hbWVzPy5sZW5ndGggPyBkZWZpbml0aW9uLm5hbWVzIDogW2RlZmluaXRpb24ubmFtZV07XG59XG5cbmZ1bmN0aW9uIHNvdXJjZVVzZXNOYW1lKHNvdXJjZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgaWYgKG5hbWUuc3RhcnRzV2l0aChcIkBcIikpIHtcbiAgICByZXR1cm4gbmV3IFJlZ0V4cChgJHtlc2NhcGVSZWdleChuYW1lKX1cXFxcYmApLnRlc3Qoc291cmNlKTtcbiAgfVxuICByZXR1cm4gbmV3IFJlZ0V4cChgXFxcXGIke2VzY2FwZVJlZ2V4KG5hbWUpfVxcXFxiYCkudGVzdChzb3VyY2UpO1xufVxuXG5mdW5jdGlvbiBmb3JtYXRTb3VyY2VEZXNjcmlwdGlvbihyZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UsIHJhbmdlOiBTb3VyY2VSYW5nZSB8IG51bGwpOiBzdHJpbmcge1xuICBpZiAocmVmZXJlbmNlLnN5bWJvbE5hbWUpIHtcbiAgICByZXR1cm4gYCR7cmVmZXJlbmNlLmZpbGVQYXRofSMke3JlZmVyZW5jZS5zeW1ib2xOYW1lfWA7XG4gIH1cbiAgaWYgKHJhbmdlKSB7XG4gICAgcmV0dXJuIGAke3JlZmVyZW5jZS5maWxlUGF0aH06TCR7cmFuZ2Uuc3RhcnQgKyAxfS1MJHtyYW5nZS5lbmQgKyAxfWA7XG4gIH1cbiAgcmV0dXJuIHJlZmVyZW5jZS5maWxlUGF0aDtcbn1cblxuY29uc3QgUFlUSE9OX0FTVF9IRUxQRVIgPSBTdHJpbmcucmF3YFxuaW1wb3J0IGFzdFxuaW1wb3J0IGpzb25cbmltcG9ydCBzeXNcblxucGF5bG9hZCA9IGpzb24ubG9hZHMoc3lzLnN0ZGluLnJlYWQoKSlcbnNvdXJjZSA9IHBheWxvYWQuZ2V0KFwic291cmNlXCIsIFwiXCIpXG5tb2RlID0gcGF5bG9hZC5nZXQoXCJtb2RlXCIsIFwibW9kdWxlXCIpXG5cbmRlZiByYW5nZV9zdGFydChub2RlKTpcbiAgICBsaW5lbm8gPSBnZXRhdHRyKG5vZGUsIFwibGluZW5vXCIsIDEpXG4gICAgZGVjb3JhdG9ycyA9IGdldGF0dHIobm9kZSwgXCJkZWNvcmF0b3JfbGlzdFwiLCBOb25lKSBvciBbXVxuICAgIGlmIGRlY29yYXRvcnM6XG4gICAgICAgIGxpbmVubyA9IG1pbihsaW5lbm8sICooZ2V0YXR0cihkZWNvcmF0b3IsIFwibGluZW5vXCIsIGxpbmVubykgZm9yIGRlY29yYXRvciBpbiBkZWNvcmF0b3JzKSlcbiAgICByZXR1cm4gbGluZW5vIC0gMVxuXG5kZWYgcmFuZ2VfZW5kKG5vZGUpOlxuICAgIHJldHVybiBnZXRhdHRyKG5vZGUsIFwiZW5kX2xpbmVub1wiLCBnZXRhdHRyKG5vZGUsIFwibGluZW5vXCIsIDEpKSAtIDFcblxuZGVmIHRhcmdldF9uYW1lcyh0YXJnZXQpOlxuICAgIGlmIGlzaW5zdGFuY2UodGFyZ2V0LCBhc3QuTmFtZSk6XG4gICAgICAgIHJldHVybiBbdGFyZ2V0LmlkXVxuICAgIGlmIGlzaW5zdGFuY2UodGFyZ2V0LCAoYXN0LlR1cGxlLCBhc3QuTGlzdCkpOlxuICAgICAgICBuYW1lcyA9IFtdXG4gICAgICAgIGZvciBpdGVtIGluIHRhcmdldC5lbHRzOlxuICAgICAgICAgICAgbmFtZXMuZXh0ZW5kKHRhcmdldF9uYW1lcyhpdGVtKSlcbiAgICAgICAgcmV0dXJuIG5hbWVzXG4gICAgcmV0dXJuIFtdXG5cbmRlZiBkZWZpbml0aW9uX25hbWVzKG5vZGUpOlxuICAgIGlmIGlzaW5zdGFuY2Uobm9kZSwgKGFzdC5GdW5jdGlvbkRlZiwgYXN0LkFzeW5jRnVuY3Rpb25EZWYsIGFzdC5DbGFzc0RlZikpOlxuICAgICAgICByZXR1cm4gW25vZGUubmFtZV1cbiAgICBpZiBpc2luc3RhbmNlKG5vZGUsIGFzdC5Bc3NpZ24pOlxuICAgICAgICBuYW1lcyA9IFtdXG4gICAgICAgIGZvciB0YXJnZXQgaW4gbm9kZS50YXJnZXRzOlxuICAgICAgICAgICAgbmFtZXMuZXh0ZW5kKHRhcmdldF9uYW1lcyh0YXJnZXQpKVxuICAgICAgICByZXR1cm4gbmFtZXNcbiAgICBpZiBpc2luc3RhbmNlKG5vZGUsIChhc3QuQW5uQXNzaWduLCBhc3QuQXVnQXNzaWduKSk6XG4gICAgICAgIHJldHVybiB0YXJnZXRfbmFtZXMobm9kZS50YXJnZXQpXG4gICAgcmV0dXJuIFtdXG5cbmRlZiBpbnNwZWN0X21vZHVsZSh0cmVlKTpcbiAgICBkZWZpbml0aW9ucyA9IFtdXG4gICAgaW1wb3J0cyA9IFtdXG4gICAgZm9yIG5vZGUgaW4gdHJlZS5ib2R5OlxuICAgICAgICBuYW1lcyA9IGRlZmluaXRpb25fbmFtZXMobm9kZSlcbiAgICAgICAgaWYgbmFtZXM6XG4gICAgICAgICAgICBkZWZpbml0aW9ucy5hcHBlbmQoe1xuICAgICAgICAgICAgICAgIFwibmFtZVwiOiBuYW1lc1swXSxcbiAgICAgICAgICAgICAgICBcIm5hbWVzXCI6IG5hbWVzLFxuICAgICAgICAgICAgICAgIFwic3RhcnRcIjogcmFuZ2Vfc3RhcnQobm9kZSksXG4gICAgICAgICAgICAgICAgXCJlbmRcIjogcmFuZ2VfZW5kKG5vZGUpLFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIGlmIGlzaW5zdGFuY2Uobm9kZSwgYXN0LkltcG9ydCk6XG4gICAgICAgICAgICBpbXBvcnRzLmFwcGVuZCh7XG4gICAgICAgICAgICAgICAgXCJraW5kXCI6IFwiaW1wb3J0XCIsXG4gICAgICAgICAgICAgICAgXCJtb2R1bGVcIjogXCJcIixcbiAgICAgICAgICAgICAgICBcImxldmVsXCI6IDAsXG4gICAgICAgICAgICAgICAgXCJuYW1lc1wiOiBbe1wibmFtZVwiOiBpdGVtLm5hbWUsIFwiYXNuYW1lXCI6IGl0ZW0uYXNuYW1lfSBmb3IgaXRlbSBpbiBub2RlLm5hbWVzXSxcbiAgICAgICAgICAgICAgICBcInN0YXJ0XCI6IHJhbmdlX3N0YXJ0KG5vZGUpLFxuICAgICAgICAgICAgICAgIFwiZW5kXCI6IHJhbmdlX2VuZChub2RlKSxcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBjb250aW51ZVxuICAgICAgICBpZiBpc2luc3RhbmNlKG5vZGUsIGFzdC5JbXBvcnRGcm9tKTpcbiAgICAgICAgICAgIGltcG9ydHMuYXBwZW5kKHtcbiAgICAgICAgICAgICAgICBcImtpbmRcIjogXCJmcm9tXCIsXG4gICAgICAgICAgICAgICAgXCJtb2R1bGVcIjogbm9kZS5tb2R1bGUgb3IgXCJcIixcbiAgICAgICAgICAgICAgICBcImxldmVsXCI6IG5vZGUubGV2ZWwsXG4gICAgICAgICAgICAgICAgXCJuYW1lc1wiOiBbe1wibmFtZVwiOiBpdGVtLm5hbWUsIFwiYXNuYW1lXCI6IGl0ZW0uYXNuYW1lfSBmb3IgaXRlbSBpbiBub2RlLm5hbWVzXSxcbiAgICAgICAgICAgICAgICBcInN0YXJ0XCI6IHJhbmdlX3N0YXJ0KG5vZGUpLFxuICAgICAgICAgICAgICAgIFwiZW5kXCI6IHJhbmdlX2VuZChub2RlKSxcbiAgICAgICAgICAgIH0pXG4gICAgcmV0dXJuIHtcImRlZmluaXRpb25zXCI6IGRlZmluaXRpb25zLCBcImltcG9ydHNcIjogaW1wb3J0c31cblxuZGVmIGF0dHJpYnV0ZV9jaGFpbihub2RlKTpcbiAgICBjaGFpbiA9IFtdXG4gICAgY3VycmVudCA9IG5vZGVcbiAgICB3aGlsZSBpc2luc3RhbmNlKGN1cnJlbnQsIGFzdC5BdHRyaWJ1dGUpOlxuICAgICAgICBjaGFpbi5hcHBlbmQoY3VycmVudC5hdHRyKVxuICAgICAgICBjdXJyZW50ID0gY3VycmVudC52YWx1ZVxuICAgIGlmIGlzaW5zdGFuY2UoY3VycmVudCwgYXN0Lk5hbWUpOlxuICAgICAgICBjaGFpbi5hcHBlbmQoY3VycmVudC5pZClcbiAgICAgICAgY2hhaW4ucmV2ZXJzZSgpXG4gICAgICAgIHJldHVybiBjaGFpblxuICAgIHJldHVybiBbXVxuXG5jbGFzcyBVc2FnZVZpc2l0b3IoYXN0Lk5vZGVWaXNpdG9yKTpcbiAgICBkZWYgX19pbml0X18oc2VsZik6XG4gICAgICAgIHNlbGYubmFtZXMgPSBzZXQoKVxuICAgICAgICBzZWxmLmF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZGVmIHZpc2l0X05hbWUoc2VsZiwgbm9kZSk6XG4gICAgICAgIGlmIGlzaW5zdGFuY2Uobm9kZS5jdHgsIGFzdC5Mb2FkKTpcbiAgICAgICAgICAgIHNlbGYubmFtZXMuYWRkKG5vZGUuaWQpXG5cbiAgICBkZWYgdmlzaXRfQXR0cmlidXRlKHNlbGYsIG5vZGUpOlxuICAgICAgICBjaGFpbiA9IGF0dHJpYnV0ZV9jaGFpbihub2RlKVxuICAgICAgICBpZiBsZW4oY2hhaW4pID49IDI6XG4gICAgICAgICAgICBzZWxmLm5hbWVzLmFkZChjaGFpblswXSlcbiAgICAgICAgICAgIHNlbGYuYXR0cmlidXRlcy5zZXRkZWZhdWx0KGNoYWluWzBdLCBzZXQoKSkuYWRkKGNoYWluWzFdKVxuICAgICAgICBzZWxmLmdlbmVyaWNfdmlzaXQobm9kZSlcblxuZGVmIGluc3BlY3RfdXNhZ2UodHJlZSk6XG4gICAgdmlzaXRvciA9IFVzYWdlVmlzaXRvcigpXG4gICAgdmlzaXRvci52aXNpdCh0cmVlKVxuICAgIHJldHVybiB7XG4gICAgICAgIFwibmFtZXNcIjogc29ydGVkKHZpc2l0b3IubmFtZXMpLFxuICAgICAgICBcImF0dHJpYnV0ZXNcIjoge2tleTogc29ydGVkKHZhbHVlKSBmb3Iga2V5LCB2YWx1ZSBpbiB2aXNpdG9yLmF0dHJpYnV0ZXMuaXRlbXMoKX0sXG4gICAgfVxuXG50cnk6XG4gICAgdHJlZSA9IGFzdC5wYXJzZShzb3VyY2UpXG5leGNlcHQgU3ludGF4RXJyb3I6XG4gICAgcHJpbnQoanNvbi5kdW1wcyh7XCJkZWZpbml0aW9uc1wiOiBbXSwgXCJpbXBvcnRzXCI6IFtdfSBpZiBtb2RlID09IFwibW9kdWxlXCIgZWxzZSB7XCJuYW1lc1wiOiBbXSwgXCJhdHRyaWJ1dGVzXCI6IHt9fSkpXG4gICAgcmFpc2UgU3lzdGVtRXhpdCgwKVxuXG5pZiBtb2RlID09IFwibW9kdWxlXCI6XG4gICAgcHJpbnQoanNvbi5kdW1wcyhpbnNwZWN0X21vZHVsZSh0cmVlKSkpXG5lbHNlOlxuICAgIHByaW50KGpzb24uZHVtcHMoaW5zcGVjdF91c2FnZSh0cmVlKSkpXG5gO1xuIiwgImltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jayB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFNvdXJjZVJlZmVyZW5jZUhhcm5lc3MoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBzdHJpbmcge1xuICBjb25zdCBjYWxsID0gYmxvY2suc291cmNlUmVmZXJlbmNlPy5jYWxsO1xuICBpZiAoIWNhbGwpIHtcbiAgICByZXR1cm4gYmxvY2suY29udGVudDtcbiAgfVxuXG4gIGNvbnN0IHN5bWJvbE5hbWUgPSBibG9jay5zb3VyY2VSZWZlcmVuY2U/LnN5bWJvbE5hbWU/LnRyaW0oKTtcbiAgY29uc3QgaW5wdXQgPSBibG9jay5jb250ZW50LnRyaW0oKTtcbiAgY29uc3QgZXhwcmVzc2lvbiA9IGNhbGwuZXhwcmVzc2lvbj8udHJpbSgpXG4gICAgPyByZW5kZXJTb3VyY2VDYWxsVGVtcGxhdGUoY2FsbC5leHByZXNzaW9uLCBpbnB1dCwgc3ltYm9sTmFtZSlcbiAgICA6IHJlbmRlckRlZmF1bHRTb3VyY2VDYWxsKHN5bWJvbE5hbWUsIGNhbGwuYXJncywgaW5wdXQpO1xuXG4gIHJldHVybiByZW5kZXJMYW5ndWFnZUNhbGxIYXJuZXNzKGJsb2NrLmxhbmd1YWdlLCBleHByZXNzaW9uLCBjYWxsLnByaW50KTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyRGVmYXVsdFNvdXJjZUNhbGwoc3ltYm9sTmFtZTogc3RyaW5nIHwgdW5kZWZpbmVkLCBhcmdzOiBzdHJpbmcgfCB1bmRlZmluZWQsIGlucHV0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIXN5bWJvbE5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJsb29tLWNhbGwgbmVlZHMgbG9vbS1zeW1ib2wgd2hlbiBubyBjYWxsIGV4cHJlc3Npb24gaXMgcHJvdmlkZWQuXCIpO1xuICB9XG5cbiAgY29uc3QgcmVuZGVyZWRBcmdzID0gcmVuZGVyU291cmNlQ2FsbFRlbXBsYXRlKGFyZ3M/LnRyaW0oKSB8fCBcIntpbnB1dH1cIiwgaW5wdXQsIHN5bWJvbE5hbWUpO1xuICByZXR1cm4gYCR7c3ltYm9sTmFtZX0oJHtyZW5kZXJlZEFyZ3N9KWA7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclNvdXJjZUNhbGxUZW1wbGF0ZSh0ZW1wbGF0ZTogc3RyaW5nLCBpbnB1dDogc3RyaW5nLCBzeW1ib2xOYW1lOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmcge1xuICByZXR1cm4gdGVtcGxhdGVcbiAgICAucmVwbGFjZUFsbChcIntpbnB1dH1cIiwgaW5wdXQpXG4gICAgLnJlcGxhY2VBbGwoXCJ7c3ltYm9sfVwiLCBzeW1ib2xOYW1lID8/IFwiXCIpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJMYW5ndWFnZUNhbGxIYXJuZXNzKGxhbmd1YWdlOiBzdHJpbmcsIGV4cHJlc3Npb246IHN0cmluZywgcHJpbnQ6IGJvb2xlYW4pOiBzdHJpbmcge1xuICBpZiAoIXByaW50KSB7XG4gICAgcmV0dXJuIHJlbmRlckV4cHJlc3Npb25TdGF0ZW1lbnQobGFuZ3VhZ2UsIGV4cHJlc3Npb24pO1xuICB9XG5cbiAgc3dpdGNoIChsYW5ndWFnZSkge1xuICAgIGNhc2UgXCJweXRob25cIjpcbiAgICAgIHJldHVybiBgcHJpbnQoJHtleHByZXNzaW9ufSlgO1xuICAgIGNhc2UgXCJqYXZhc2NyaXB0XCI6XG4gICAgY2FzZSBcInR5cGVzY3JpcHRcIjpcbiAgICAgIHJldHVybiBgY29uc29sZS5sb2coJHtleHByZXNzaW9ufSk7YDtcbiAgICBjYXNlIFwiY1wiOlxuICAgICAgcmV0dXJuIGAjaW5jbHVkZSA8c3RkaW8uaD5cXG5pbnQgbWFpbih2b2lkKSB7IHByaW50ZihcIiVkXFxcXG5cIiwgJHtleHByZXNzaW9ufSk7IHJldHVybiAwOyB9YDtcbiAgICBjYXNlIFwiY3BwXCI6XG4gICAgICByZXR1cm4gYCNpbmNsdWRlIDxpb3N0cmVhbT5cXG5pbnQgbWFpbigpIHsgc3RkOjpjb3V0IDw8ICgke2V4cHJlc3Npb259KSA8PCBcIlxcXFxuXCI7IHJldHVybiAwOyB9YDtcbiAgICBjYXNlIFwib2NhbWxcIjpcbiAgICAgIHJldHVybiBgbGV0ICgpID0gcHJpbnRfZW5kbGluZSAoJHtleHByZXNzaW9ufSlgO1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYGxvb20tY2FsbCBjYW5ub3QgZ2VuZXJhdGUgYSBwcmludGVkIGhhcm5lc3MgZm9yICR7bGFuZ3VhZ2V9LiBVc2UgbG9vbS1wcmludD1mYWxzZSBvciB3cml0ZSB0aGUgaGFybmVzcyBpbiB0aGUgYmxvY2sgYm9keS5gKTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZW5kZXJFeHByZXNzaW9uU3RhdGVtZW50KGxhbmd1YWdlOiBzdHJpbmcsIGV4cHJlc3Npb246IHN0cmluZyk6IHN0cmluZyB7XG4gIHN3aXRjaCAobGFuZ3VhZ2UpIHtcbiAgICBjYXNlIFwicHl0aG9uXCI6XG4gICAgY2FzZSBcIm9jYW1sXCI6XG4gICAgICByZXR1cm4gZXhwcmVzc2lvbjtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGV4cHJlc3Npb24uZW5kc1dpdGgoXCI7XCIpID8gZXhwcmVzc2lvbiA6IGAke2V4cHJlc3Npb259O2A7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBzZXRJY29uIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVRvb2xiYXJIYW5kbGVycyB7XG4gIG9uUnVuOiAoKSA9PiB2b2lkO1xuICBvbkNvcHk6ICgpID0+IHZvaWQ7XG4gIG9uUmVtb3ZlOiAoKSA9PiB2b2lkO1xuICBvblRvZ2dsZUlucHV0OiAoKSA9PiB2b2lkO1xuICBvblRvZ2dsZU91dHB1dDogKCkgPT4gdm9pZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUNvZGVCbG9ja1Rvb2xiYXIoXG4gIGJsb2NrSWQ6IHN0cmluZyxcbiAgaXNSdW5uaW5nOiBib29sZWFuLFxuICBoYW5kbGVyczogbG9vbVRvb2xiYXJIYW5kbGVycyxcbik6IEhUTUxEaXZFbGVtZW50IHtcbiAgY29uc3QgdG9vbGJhciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gIHRvb2xiYXIuY2xhc3NOYW1lID0gXCJsb29tLWNvZGUtdG9vbGJhclwiO1xuICB0b29sYmFyLmRhdGFzZXQubG9vbUJsb2NrSWQgPSBibG9ja0lkO1xuXG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiUnVuIGJsb2NrXCIsIGlzUnVubmluZyA/IFwibG9hZGVyLWNpcmNsZVwiIDogXCJwbGF5XCIsIGhhbmRsZXJzLm9uUnVuLCBpc1J1bm5pbmcpKTtcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJUb2dnbGUgc3RkaW4gaW5wdXRcIiwgXCJ0ZXh0LWN1cnNvci1pbnB1dFwiLCBoYW5kbGVycy5vblRvZ2dsZUlucHV0LCBmYWxzZSkpO1xuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIkNvcHkgY29kZVwiLCBcImNvcHlcIiwgaGFuZGxlcnMub25Db3B5LCBmYWxzZSkpO1xuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIlJlbW92ZSBzbmlwcGV0XCIsIFwidHJhc2gtMlwiLCBoYW5kbGVycy5vblJlbW92ZSwgZmFsc2UpKTtcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJUb2dnbGUgb3V0cHV0XCIsIFwicGFuZWwtYm90dG9tLW9wZW5cIiwgaGFuZGxlcnMub25Ub2dnbGVPdXRwdXQsIGZhbHNlKSk7XG5cbiAgcmV0dXJuIHRvb2xiYXI7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUJ1dHRvbihsYWJlbDogc3RyaW5nLCBpY29uTmFtZTogc3RyaW5nLCBvbkNsaWNrOiAoKSA9PiB2b2lkLCBzcGlubmluZzogYm9vbGVhbik6IEhUTUxCdXR0b25FbGVtZW50IHtcbiAgY29uc3QgYnV0dG9uID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgYnV0dG9uLmNsYXNzTmFtZSA9IGBsb29tLXRvb2xiYXItYnV0dG9uJHtzcGlubmluZyA/IFwiIGlzLXJ1bm5pbmdcIiA6IFwiXCJ9YDtcbiAgYnV0dG9uLnR5cGUgPSBcImJ1dHRvblwiO1xuICBidXR0b24uc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBsYWJlbCk7XG4gIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICBvbkNsaWNrKCk7XG4gIH0pO1xuICBzZXRJY29uKGJ1dHRvbiwgaWNvbk5hbWUpO1xuICByZXR1cm4gYnV0dG9uO1xufVxuIiwgImltcG9ydCB7IHNldEljb24gfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB0eXBlIHsgbG9vbVN0b3JlZE91dHB1dCB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5pbnRlcmZhY2UgbG9vbU91dHB1dFBhbmVsT3B0aW9ucyB7XG4gIGRlZmF1bHRWaXNpYmxlTGluZXM6IG51bWJlcjtcbn1cblxuZnVuY3Rpb24gZ2V0U3RhdHVzS2luZChvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQpOiBcInN1Y2Nlc3NcIiB8IFwid2FybmluZ1wiIHwgXCJmYWlsdXJlXCIge1xuICBpZiAob3V0cHV0LnJlc3VsdC5zdWNjZXNzKSB7XG4gICAgcmV0dXJuIG91dHB1dC5yZXN1bHQuc3RkZXJyLnRyaW0oKSB8fCBvdXRwdXQucmVzdWx0Lndhcm5pbmc/LnRyaW0oKSA/IFwid2FybmluZ1wiIDogXCJzdWNjZXNzXCI7XG4gIH1cblxuICByZXR1cm4gXCJmYWlsdXJlXCI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVPdXRwdXRQYW5lbChvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQsIG9wdGlvbnM6IGxvb21PdXRwdXRQYW5lbE9wdGlvbnMpOiBIVE1MRGl2RWxlbWVudCB7XG4gIGNvbnN0IHBhbmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgcGFuZWwuY2xhc3NOYW1lID0gYGxvb20tb3V0cHV0LXBhbmVsIGlzLSR7Z2V0U3RhdHVzS2luZChvdXRwdXQpfSR7b3V0cHV0LnZpc2libGUgPyBcIlwiIDogXCIgaXMtaGlkZGVuXCJ9YDtcbiAgcGFuZWwuZGF0YXNldC5sb29tQmxvY2tJZCA9IG91dHB1dC5ibG9ja0lkO1xuICByZW5kZXJPdXRwdXRQYW5lbChwYW5lbCwgb3V0cHV0LCBvcHRpb25zKTtcbiAgcmV0dXJuIHBhbmVsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyT3V0cHV0UGFuZWwocGFuZWw6IEhUTUxFbGVtZW50LCBvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQsIG9wdGlvbnM6IGxvb21PdXRwdXRQYW5lbE9wdGlvbnMpOiB2b2lkIHtcbiAgY29uc3Qga2luZCA9IGdldFN0YXR1c0tpbmQob3V0cHV0KTtcbiAgcGFuZWwuY2xhc3NOYW1lID0gYGxvb20tb3V0cHV0LXBhbmVsIGlzLSR7a2luZH0ke291dHB1dC52aXNpYmxlID8gXCJcIiA6IFwiIGlzLWhpZGRlblwifSR7b3V0cHV0LmNvbGxhcHNlZCA/IFwiIGlzLWNvbGxhcHNlZFwiIDogXCJcIn1gO1xuICBwYW5lbC5lbXB0eSgpO1xuICBjb25zdCB2aXNpYmxlTGluZXMgPSByZXNvbHZlVmlzaWJsZUxpbmVzKG91dHB1dCwgb3B0aW9ucy5kZWZhdWx0VmlzaWJsZUxpbmVzKTtcblxuICBjb25zdCBoZWFkZXIgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtaGVhZGVyXCIgfSk7XG4gIGNvbnN0IGJhZGdlID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1iYWRnZVwiIH0pO1xuICBzZXRJY29uKGJhZGdlLCBraW5kID09PSBcInN1Y2Nlc3NcIiA/IFwiY2hlY2stY2lyY2xlLTJcIiA6IGtpbmQgPT09IFwid2FybmluZ1wiID8gXCJhbGVydC10cmlhbmdsZVwiIDogXCJ4LWNpcmNsZVwiKTtcblxuICBjb25zdCB0aXRsZSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtdGl0bGVcIiB9KTtcbiAgdGl0bGUuc2V0VGV4dChgJHtvdXRwdXQucmVzdWx0LnJ1bm5lck5hbWV9IFx1MDBCNyBleGl0ICR7b3V0cHV0LnJlc3VsdC5leGl0Q29kZSA/PyBcIj9cIn1gKTtcblxuICBjb25zdCBtZXRhID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1tZXRhXCIgfSk7XG4gIG1ldGEuc2V0VGV4dChgJHtvdXRwdXQucmVzdWx0LmR1cmF0aW9uTXN9IG1zIFx1MDBCNyAke25ldyBEYXRlKG91dHB1dC5yZXN1bHQuZmluaXNoZWRBdCkudG9Mb2NhbGVUaW1lU3RyaW5nKCl9YCk7XG5cbiAgY29uc3QgYm9keSA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1ib2R5XCIgfSk7XG4gIGlmIChvdXRwdXQucmVzdWx0LnN0ZG91dC50cmltKCkpIHtcbiAgICBjcmVhdGVTdHJlYW0oYm9keSwgXCJTdGRvdXRcIiwgb3V0cHV0LnJlc3VsdC5zdGRvdXQsIHZpc2libGVMaW5lcyk7XG4gIH1cbiAgaWYgKG91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpKSB7XG4gICAgY3JlYXRlU3RyZWFtKGJvZHksIFwiV2FybmluZ1wiLCBvdXRwdXQucmVzdWx0Lndhcm5pbmcsIHZpc2libGVMaW5lcyk7XG4gIH1cbiAgaWYgKG91dHB1dC5yZXN1bHQuc3RkZXJyLnRyaW0oKSkge1xuICAgIGNyZWF0ZVN0cmVhbShib2R5LCBcIlN0ZGVyclwiLCBvdXRwdXQucmVzdWx0LnN0ZGVyciwgdmlzaWJsZUxpbmVzKTtcbiAgfVxuICBpZiAob3V0cHV0LnNvdXJjZVByZXZpZXc/LmNvbnRlbnQudHJpbSgpKSB7XG4gICAgY3JlYXRlU291cmNlUHJldmlldyhib2R5LCBvdXRwdXQuc291cmNlUHJldmlldyk7XG4gIH1cbiAgaWYgKCFvdXRwdXQucmVzdWx0LnN0ZG91dC50cmltKCkgJiYgIW91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpICYmICFvdXRwdXQucmVzdWx0LnN0ZGVyci50cmltKCkgJiYgIW91dHB1dC5zb3VyY2VQcmV2aWV3Py5jb250ZW50LnRyaW0oKSkge1xuICAgIGNvbnN0IGVtcHR5ID0gYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtZW1wdHlcIiB9KTtcbiAgICBlbXB0eS5zZXRUZXh0KFwiTm8gb3V0cHV0XCIpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVN0cmVhbShjb250YWluZXI6IEhUTUxFbGVtZW50LCBsYWJlbDogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcsIHZpc2libGVMaW5lczogbnVtYmVyKTogdm9pZCB7XG4gIGNvbnN0IHNlY3Rpb24gPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXN0cmVhbVwiIH0pO1xuICBjb25zdCBsaW5lQ291bnQgPSBjb3VudExpbmVzKGNvbnRlbnQpO1xuICBzZWN0aW9uLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1zdHJlYW0tbGFiZWxcIiwgdGV4dDogZm9ybWF0U3RyZWFtTGFiZWwobGFiZWwsIGxpbmVDb3VudCwgdmlzaWJsZUxpbmVzKSB9KTtcbiAgY29uc3QgcHJlID0gc2VjdGlvbi5jcmVhdGVFbChcInByZVwiLCB7IGNsczogXCJsb29tLW91dHB1dC1wcmVcIiwgdGV4dDogY29udGVudCB9KTtcbiAgaWYgKHZpc2libGVMaW5lcyA+IDAgJiYgbGluZUNvdW50ID4gdmlzaWJsZUxpbmVzKSB7XG4gICAgcHJlLmFkZENsYXNzKFwiaXMtc2Nyb2xsLWxpbWl0ZWRcIik7XG4gICAgcHJlLnN0eWxlLnNldFByb3BlcnR5KFwiLS1sb29tLW91dHB1dC12aXNpYmxlLWxpbmVzXCIsIFN0cmluZyh2aXNpYmxlTGluZXMpKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjcmVhdGVTb3VyY2VQcmV2aWV3KGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIHByZXZpZXc6IE5vbk51bGxhYmxlPGxvb21TdG9yZWRPdXRwdXRbXCJzb3VyY2VQcmV2aWV3XCJdPik6IHZvaWQge1xuICBjb25zdCBkZXRhaWxzID0gY29udGFpbmVyLmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJsb29tLXNvdXJjZS1wcmV2aWV3XCIgfSk7XG4gIGRldGFpbHMub3BlbiA9IHByZXZpZXcuZXhwYW5kZWQ7XG4gIGNvbnN0IHN1bW1hcnkgPSBkZXRhaWxzLmNyZWF0ZUVsKFwic3VtbWFyeVwiLCB7IGNsczogXCJsb29tLXNvdXJjZS1wcmV2aWV3LXN1bW1hcnlcIiB9KTtcbiAgc3VtbWFyeS5jcmVhdGVTcGFuKHsgdGV4dDogXCJFeHRyYWN0ZWQgc291cmNlXCIgfSk7XG4gIHN1bW1hcnkuY3JlYXRlU3Bhbih7IGNsczogXCJsb29tLXNvdXJjZS1wcmV2aWV3LW1ldGFcIiwgdGV4dDogZm9ybWF0U291cmNlUHJldmlld01ldGEocHJldmlldykgfSk7XG4gIGRldGFpbHMuY3JlYXRlRWwoXCJwcmVcIiwgeyBjbHM6IFwibG9vbS1vdXRwdXQtcHJlIGxvb20tc291cmNlLXByZXZpZXctcHJlXCIsIHRleHQ6IHByZXZpZXcuY29udGVudCB9KTtcbn1cblxuZnVuY3Rpb24gZm9ybWF0U291cmNlUHJldmlld01ldGEocHJldmlldzogTm9uTnVsbGFibGU8bG9vbVN0b3JlZE91dHB1dFtcInNvdXJjZVByZXZpZXdcIl0+KTogc3RyaW5nIHtcbiAgY29uc3QgY2FwYWJpbGl0eSA9IHByZXZpZXcuY2FwYWJpbGl0eTtcbiAgaWYgKCFjYXBhYmlsaXR5IHx8ICFwcmV2aWV3LnNob3dDYXBhYmlsaXR5TWV0YWRhdGEpIHtcbiAgICByZXR1cm4gYCR7cHJldmlldy5sYW5ndWFnZX0gXHUwMEI3ICR7cHJldmlldy5kZXNjcmlwdGlvbn1gO1xuICB9XG4gIHJldHVybiBbXG4gICAgcHJldmlldy5sYW5ndWFnZSxcbiAgICBwcmV2aWV3LmRlc2NyaXB0aW9uLFxuICAgIGBzeW1ib2xzOiR7Y2FwYWJpbGl0eS5zeW1ib2xFeHRyYWN0aW9ufWAsXG4gICAgYGRlcHM6JHtjYXBhYmlsaXR5LmRlcGVuZGVuY3lUcmFjaW5nfWAsXG4gICAgYGNhbGw6JHtjYXBhYmlsaXR5LmNhbGxIYXJuZXNzfWAsXG4gIF0uam9pbihcIiBcdTAwQjcgXCIpO1xufVxuXG5mdW5jdGlvbiByZXNvbHZlVmlzaWJsZUxpbmVzKG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCwgZGVmYXVsdFZpc2libGVMaW5lczogbnVtYmVyKTogbnVtYmVyIHtcbiAgY29uc3Qgb3ZlcnJpZGUgPSBvdXRwdXQuYmxvY2suYXR0cmlidXRlc1tcImxvb20tb3V0cHV0LWxpbmVzXCJdID8/IG91dHB1dC5ibG9jay5hdHRyaWJ1dGVzW1wib3V0cHV0LWxpbmVzXCJdO1xuICBpZiAob3ZlcnJpZGUgIT0gbnVsbCkge1xuICAgIHJldHVybiBub3JtYWxpemVWaXNpYmxlTGluZXMoTnVtYmVyLnBhcnNlSW50KG92ZXJyaWRlLnRyaW0oKSwgMTApKTtcbiAgfVxuICByZXR1cm4gbm9ybWFsaXplVmlzaWJsZUxpbmVzKGRlZmF1bHRWaXNpYmxlTGluZXMpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVWaXNpYmxlTGluZXModmFsdWU6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHZhbHVlKSB8fCB2YWx1ZSA8PSAwKSB7XG4gICAgcmV0dXJuIDA7XG4gIH1cbiAgcmV0dXJuIE1hdGgubWluKE1hdGguZmxvb3IodmFsdWUpLCAyMDAwKTtcbn1cblxuZnVuY3Rpb24gY291bnRMaW5lcyhjb250ZW50OiBzdHJpbmcpOiBudW1iZXIge1xuICByZXR1cm4gY29udGVudC5yZXBsYWNlKC9cXG4kLywgXCJcIikuc3BsaXQoXCJcXG5cIikubGVuZ3RoO1xufVxuXG5mdW5jdGlvbiBmb3JtYXRTdHJlYW1MYWJlbChsYWJlbDogc3RyaW5nLCBsaW5lQ291bnQ6IG51bWJlciwgdmlzaWJsZUxpbmVzOiBudW1iZXIpOiBzdHJpbmcge1xuICBpZiAodmlzaWJsZUxpbmVzID4gMCAmJiBsaW5lQ291bnQgPiB2aXNpYmxlTGluZXMpIHtcbiAgICByZXR1cm4gYCR7bGFiZWx9IFx1MDBCNyAke2xpbmVDb3VudH0gbGluZXMgXHUwMEI3IHNob3dpbmcgJHt2aXNpYmxlTGluZXN9YDtcbiAgfVxuICByZXR1cm4gbGFiZWw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVSdW5uaW5nUGFuZWwoKTogSFRNTERpdkVsZW1lbnQge1xuICBjb25zdCBwYW5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gIHBhbmVsLmNsYXNzTmFtZSA9IFwibG9vbS1vdXRwdXQtcGFuZWwgaXMtcnVubmluZ1wiO1xuXG4gIGNvbnN0IGhlYWRlciA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1oZWFkZXJcIiB9KTtcbiAgY29uc3Qgc3Bpbm5lciA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1zcGlubmVyXCIgfSk7XG4gIHNldEljb24oc3Bpbm5lciwgXCJsb2FkZXItY2lyY2xlXCIpO1xuICBjb25zdCB0aXRsZSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtdGl0bGVcIiB9KTtcbiAgdGl0bGUuc2V0VGV4dChcIlJ1bm5pbmdcIik7XG4gIGNvbnN0IG1ldGEgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LW1ldGFcIiB9KTtcbiAgbWV0YS5zZXRUZXh0KFwiRXhlY3V0aW5nLi4uXCIpO1xuICBzcGlubmVyLnNldEF0dHJpYnV0ZShcImFyaWEtaGlkZGVuXCIsIFwidHJ1ZVwiKTtcblxuICByZXR1cm4gcGFuZWw7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQUFBQSxtQkFTTztBQUNQLG1CQUE2QztBQUM3QyxJQUFBQyxlQUEyRTtBQUMzRSxJQUFBQyxnQkFBd0I7OztBQ1p4QixzQkFBNkM7QUFDN0MsZ0JBQWdEO0FBQ2hELElBQUFDLG1CQUF3RDtBQUN4RCxJQUFBQyxlQUFpRjtBQUNqRixJQUFBQyx3QkFBc0I7OztBQ0p0QixzQkFBdUM7QUFDdkMsZ0JBQXVCO0FBQ3ZCLGtCQUFxQjtBQUNyQiwyQkFBc0I7QUF5QnRCLGVBQXNCLHdCQUNwQixVQUNBLFFBQ0EsVUFDWTtBQUNaLFFBQU0sVUFBVSxVQUFNLDZCQUFRLHNCQUFLLGtCQUFPLEdBQUcsT0FBTyxDQUFDO0FBQ3JELFFBQU0sZUFBVyxrQkFBSyxTQUFTLFFBQVE7QUFFdkMsTUFBSTtBQUNGLGNBQU0sMkJBQVUsVUFBVSwwQkFBMEIsTUFBTSxHQUFHLE1BQU07QUFDbkUsV0FB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QUFNLFdBQVcsWUFBWTtBQUN0RixXQUFPLFlBQVksZUFBZSxTQUFTLEtBQUs7QUFBQSxFQUNsRDtBQUFBLEVBRUEsTUFBYyxrQkFBa0IsTUFBYSxPQUFtRDtBQUM5RixRQUFJLEtBQUssWUFBWSxJQUFJLE1BQU0sRUFBRSxHQUFHO0FBQ2xDLGFBQU8sS0FBSyxZQUFZLElBQUksTUFBTSxFQUFFO0FBQUEsSUFDdEM7QUFFQSxVQUFNLFNBQVMsTUFBTSxXQUFXLFlBQVksS0FBSyxNQUFNLFdBQVc7QUFDbEUsUUFBSSxVQUFVLE1BQU07QUFDbEIsYUFBTyx1QkFBdUIsTUFBTTtBQUFBLElBQ3RDO0FBRUEsVUFBTSxZQUFZLE1BQU0sV0FBVyxpQkFBaUIsS0FBSyxNQUFNLFdBQVcsWUFBWTtBQUN0RixRQUFJLENBQUMsV0FBVyxLQUFLLEdBQUc7QUFDdEIsYUFBTztBQUFBLElBQ1Q7QUFFQSxVQUFNLFlBQVksS0FBSywyQkFBMkIsTUFBTSxTQUFTO0FBQ2pFLFVBQU0sWUFBWSxLQUFLLElBQUksTUFBTSxzQkFBc0IsU0FBUztBQUNoRSxRQUFJLEVBQUUscUJBQXFCLHlCQUFRO0FBQ2pDLFlBQU0sSUFBSSxNQUFNLHlCQUF5QixTQUFTLEVBQUU7QUFBQSxJQUN0RDtBQUNBLFdBQU8sS0FBSyxJQUFJLE1BQU0sV0FBVyxTQUFTO0FBQUEsRUFDNUM7QUFDRjtBQUVBLFNBQVMsdUJBQXVCLE9BQXVCO0FBQ3JELFNBQU8sTUFBTSxRQUFRLFFBQVEsSUFBSSxFQUFFLFFBQVEsUUFBUSxHQUFJO0FBQ3pEOyIsCiAgIm5hbWVzIjogWyJpbXBvcnRfb2JzaWRpYW4iLCAiaW1wb3J0X3ZpZXciLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X3Byb21pc2VzIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9jaGlsZF9wcm9jZXNzIiwgInBvc2l4UGF0aCIsICJub3JtYWxpemVGc1BhdGgiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X29ic2lkaWFuIiwgImFsaWFzZXMiLCAiZ2V0TGVhZGluZ1doaXRlc3BhY2UiLCAicGFyc2VQb3NpdGl2ZUludGVnZXIiLCAiaXNEaXNhYmxlZFZhbHVlIiwgIm5vcm1hbGl6ZUV4dGVuc2lvbiIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfZnMiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X29ic2lkaWFuIiwgImxvb21QbHVnaW4iLCAiaW1wb3J0X2NoaWxkX3Byb2Nlc3MiLCAiaW1wb3J0X3Byb21pc2VzIiwgImltcG9ydF9vcyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfb2JzaWRpYW4iLCAiaW1wb3J0X29ic2lkaWFuIl0KfQo=
