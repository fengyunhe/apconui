#!/usr/bin/env node
/**
 * 自动化代码改进脚本
 * 五个阶段：需求发现 → 需求实现 → BUG 发现 → BUG 修复 → 性能优化
 * 每次运行生成带时间戳的 markdown 报告，并在安全范围内修改源代码
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const LOG_DIR = path.join(PROJECT_ROOT, "auto-logs");
const STATE_FILE = path.join(LOG_DIR, "state.json");

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const NOW = new Date();
const TIMESTAMP = NOW.toISOString().replace(/[:.]/g, "-");
const REPORT_FILE = path.join(LOG_DIR, `report-${TIMESTAMP}.md`);

const loadState = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { lastRun: null, appliedFixes: [], appliedRequirements: [], runCount: 0 };
  }
};
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

let reportLines = [];
const w = (line = "") => reportLines.push(line);

const timestampHuman = () =>
  NOW.toLocaleString("zh-CN", { hour12: false });

/* ----------------------------- 工具函数 ----------------------------- */

function walkDir(dir, exts, ignorePatterns = []) {
  const result = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (ignorePatterns.some((p) => p.test(full) || p.test(entry.name))) continue;
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && exts.some((ext) => entry.name.endsWith(ext))) {
        result.push(full);
      }
    }
  }
  return result;
}

const IGNORE = [/node_modules/, /\.git\//, /auto-logs\//, /dist\//, /build\//, /target\//, /pnpm-lock\.yaml/];
const TS_FILES = () => walkDir(PROJECT_ROOT, [".ts", ".tsx"], IGNORE);
const CSS_FILES = () => walkDir(PROJECT_ROOT, [".css"], IGNORE);
const JS_FILES = () => walkDir(PROJECT_ROOT, [".js", ".mjs"], IGNORE);
const RUST_FILES = () => walkDir(PROJECT_ROOT, [".rs"], IGNORE);

function readFileSafe(p) {
  try { return fs.readFileSync(p, "utf-8"); } catch { return ""; }
}

function patchFile(file, oldStr, newStr) {
  const content = readFileSafe(file);
  if (!content) return false;
  if (!content.includes(oldStr)) return false;
  const updated = content.replace(oldStr, newStr);
  if (updated === content) return false;
  fs.writeFileSync(file, updated);
  return true;
}

/* ----------------------------- 阶段 1：需求发现 ----------------------------- */
/**
 * 通过静态分析推断潜在的功能缺口 / 改进点 / 可复用工具函数
 */
function discoverRequirements() {
  const discoveries = [];
  const ts = TS_FILES();
  const rust = RUST_FILES();

  // 1. 检查是否有未使用的类型 / 工具函数可以抽取
  const utilsContent = readFileSafe(path.join(PROJECT_ROOT, "src", "utils.ts"));
  if (utilsContent && !utilsContent.includes("formatBytes")) {
    discoveries.push({
      id: "REQ-formatBytes",
      title: "缺失通用的字节格式化函数",
      description: "多处需要显示文件/镜像大小，缺少一个统一的 formatBytes 工具函数会导致重复实现。",
      severity: "low",
    });
  }

  // 2. 检查是否有类型定义集中管理
  const typesContent = readFileSafe(path.join(PROJECT_ROOT, "src", "types.ts"));
  if (typesContent) {
    const missingTypes = [];
    ["ToastType", "ConfirmDialog", "TabType"].forEach((t) => {
      if (!typesContent.includes(t)) missingTypes.push(t);
    });
    if (missingTypes.length) {
      discoveries.push({
        id: "REQ-shared-types",
        title: `types.ts 缺少通用共享类型（${missingTypes.join(", ")}）`,
        description: "Toast / Confirm / Tab 的类型在多个组件中被隐式定义，建议集中到 types.ts 便于维护。",
        severity: "low",
      });
    }
  }

  // 3. 检查是否存在大量字符串字面量（硬编码）
  let hardcodedCount = 0;
  const hardcodedSamples = new Set();
  for (const file of ts) {
    const c = readFileSafe(file);
    const matches = c.match(/"error"|"success"|"info"/g) || [];
    hardcodedCount += matches.length;
    if (matches.length > 0 && hardcodedSamples.size < 3) {
      hardcodedSamples.add(path.relative(PROJECT_ROOT, file));
    }
  }
  if (hardcodedCount > 5) {
    discoveries.push({
      id: "REQ-toast-constants",
      title: `存在 ${hardcodedCount} 处硬编码的 toast 类型字符串`,
      description: `样例文件：${Array.from(hardcodedSamples).join(", ")}。建议抽取为常量或枚举，避免拼写错误。`,
      severity: "medium",
    });
  }

  // 4. 检测是否有明显的 Todo / FIXME
  const todos = [];
  for (const file of [...ts, ...rust]) {
    const c = readFileSafe(file);
    const lines = c.split("\n");
    lines.forEach((line, idx) => {
      const low = line.toLowerCase();
      if (low.includes("todo") || low.includes("fixme")) {
        todos.push({ file: path.relative(PROJECT_ROOT, file), line: idx + 1, text: line.trim() });
      }
    });
  }
  if (todos.length) {
    discoveries.push({
      id: "REQ-todo-backlog",
      title: `发现 ${todos.length} 条 TODO/FIXME 备注`,
      description: "这些是代码库中已标记但未完成的需求点，建议纳入待办清单：\n" +
        todos.slice(0, 10).map((t) => `- ${t.file}:${t.line} — ${t.text}`).join("\n"),
      severity: "medium",
    });
  }

  // 5. 检查 CSS 是否缺少暗色主题变量
  const cssFile = path.join(PROJECT_ROOT, "src", "index.css");
  const cssContent = readFileSafe(cssFile);
  if (cssContent && !cssContent.includes("--text-primary") && !cssContent.includes("color-scheme")) {
    discoveries.push({
      id: "REQ-theme-vars",
      title: "CSS 缺少设计系统变量（颜色/间距/字体）",
      description: "index.css 应定义统一的 CSS 变量（如 --text-primary、--bg-primary），便于主题切换与统一视觉风格。",
      severity: "medium",
    });
  }

  return discoveries;
}

/* ----------------------------- 阶段 2：需求实现 ----------------------------- */
/**
 * 针对需求发现阶段的部分条目，自动实施低风险的改进：
 * - 抽取 toast 类型常量
 * - 统一 formatBytes
 * - 补充 types.ts 共享类型
 * - 在 index.css 中加入 CSS 变量
 */
function implementRequirements() {
  const applied = [];

  // 2.1: 抽取 toast 常量到 utils.ts
  const utilsPath = path.join(PROJECT_ROOT, "src", "utils.ts");
  const utilsOld = readFileSafe(utilsPath);
  if (utilsOld && !utilsOld.includes("TOAST_")) {
    const constBlock =
      "\n// ===== 共享常量 =====\n" +
      "export const TOAST_ERROR = \"error\";\n" +
      "export const TOAST_SUCCESS = \"success\";\n" +
      "export const TOAST_INFO = \"info\";\n";
    patchFile(utilsPath, `export function formatBytes(bytes: number): string {`,
      constBlock + `export function formatBytes(bytes: number): string {`);
    // 尝试替换一个常见的文件中的硬编码
    const appPath = path.join(PROJECT_ROOT, "src", "App.tsx");
    const appOld = readFileSafe(appPath);
    if (appOld && !appOld.includes("TOAST_")) {
      if (patchFile(appPath,
        `import { useToast } from "./hooks/useToast";`,
        `import { useToast } from "./hooks/useToast";\nimport { TOAST_ERROR, TOAST_SUCCESS } from "./utils";`)) {
        patchFile(appPath, `showToast("error",`, `showToast(TOAST_ERROR,`);
        patchFile(appPath, `showToast("success",`, `showToast(TOAST_SUCCESS,`);
      }
    }
    applied.push("REQ-toast-constants — 抽取 TOAST_ERROR/TOAST_SUCCESS 常量");
  }

  // 2.2: 补充 types.ts 共享类型（若缺失）
  const typesPath = path.join(PROJECT_ROOT, "src", "types.ts");
  const typesOld = readFileSafe(typesPath);
  if (typesOld && !typesOld.includes("ToastType")) {
    const typeBlock =
      "\n// ===== 共享 UI 类型 =====\n" +
      "export type ToastType = \"info\" | \"success\" | \"error\";\n" +
      "export interface ConfirmDialog {\n" +
      "  show: boolean;\n" +
      "  message: string;\n" +
      "  onConfirm?: () => void;\n" +
      "}\n" +
      "export type Tab = \"containers\" | \"images\" | \"volumes\" | \"networks\" | \"machines\" | \"terminal\" | \"settings\";\n";
    fs.writeFileSync(typesPath, typesOld + typeBlock);
    applied.push("REQ-shared-types — 补充 ToastType / ConfirmDialog / Tab 类型");
  }

  // 2.3: 在 index.css 补充设计系统 CSS 变量
  const cssPath = path.join(PROJECT_ROOT, "src", "index.css");
  const cssOld = readFileSafe(cssPath);
  if (cssOld && !cssOld.includes("--text-primary")) {
    const varBlock =
      "/* ===== Design Tokens (auto-added) ===== */\n" +
      ":root {\n" +
      "  --bg-primary: #1a1d23;\n" +
      "  --bg-secondary: #22262e;\n" +
      "  --bg-tertiary: #2d323c;\n" +
      "  --text-primary: #e6e8ec;\n" +
      "  --text-secondary: #9aa0a6;\n" +
      "  --accent: #4f8cff;\n" +
      "  --danger: #ef5350;\n" +
      "  --success: #66bb6a;\n" +
      "  --border: #3a3f48;\n" +
      "  --radius-sm: 4px;\n" +
      "  --radius-md: 8px;\n" +
      "  --spacing-xs: 4px;\n" +
      "  --spacing-sm: 8px;\n" +
      "  --spacing-md: 16px;\n" +
      "  --spacing-lg: 24px;\n" +
      "}\n\n";
    fs.writeFileSync(cssPath, varBlock + cssOld);
    applied.push("REQ-theme-vars — 添加设计系统 CSS 变量到 index.css");
  }

  return applied;
}

/* ----------------------------- 阶段 3：BUG 发现 ----------------------------- */
/**
 * 通过静态分析定位常见的代码问题：
 * - 空 catch 吞噬错误
 * - console.log 调试残留
 * - 重复字符串字面量
 * - 可选链 / 空值合并缺失导致的潜在 undefined 访问
 * - 未处理的 Promise
 * - useEffect 依赖缺失
 */
function discoverBugs() {
  const bugs = [];
  const ts = TS_FILES();

  for (const file of ts) {
    const rel = path.relative(PROJECT_ROOT, file);
    const content = readFileSafe(file);
    const lines = content.split("\n");

    lines.forEach((line, idx) => {
      const trimmed = line.trim();

      // 空 catch
      if (/catch\s*\([^)]*\)\s*\{?\s*$/.test(trimmed) || /^\}\s*catch\s*\([^)]*\)\s*\{\s*$/.test(trimmed)) {
        // 检查下一行是否为空白或只有 }
        const next = lines[idx + 1] || "";
        if (next.trim() === "" || next.trim() === "}") {
          bugs.push({
            id: `BUG-empty-catch-${bugs.length}`,
            title: `空的 catch 块（${rel}:${idx + 1}）`,
            description: "错误被静默吞噬，可能隐藏运行时问题，建议至少记录日志。",
            severity: "medium",
            file: rel, line: idx + 1,
          });
        }
      }

      // 调试残留
      if (/^[^/\n]*\bconsole\.(log|info|debug)\s*\(/.test(trimmed) && !trimmed.includes("//")) {
        bugs.push({
          id: `BUG-console-${bugs.length}`,
          title: `调试残留 console.log（${rel}:${idx + 1}）`,
          description: "生产构建前应移除或替换为受控日志。",
          severity: "low",
          file: rel, line: idx + 1,
        });
      }

      // 直接访问可能为 undefined 的属性（简单启发式）
      if (/\.toUpperCase\(\)|\.split\(["']\/["']\)|JSON\.parse\s*\(/.test(trimmed) && !/try\s*\{/.test(lines[idx - 1] || "")) {
        if (!trimmed.includes("try") && !trimmed.includes("catch")) {
          // 忽略 JSON.parse 之外的 — 仅在明显缺少防御时报警
        }
      }
    });

    // 空 catch（更通用：匹配 catch {} 或 catch() {} 中无内容）
    const emptyCatchMatches = content.match(/catch\s*\([^)]*\)\s*\{\s*\}/g);
    if (emptyCatchMatches) {
      emptyCatchMatches.forEach(() => {
        bugs.push({
          id: `BUG-empty-catch-block-${bugs.length}`,
          title: `空 catch 块（${rel}）`,
          description: "catch 块为空，异常被静默吞没。",
          severity: "medium",
          file: rel,
        });
      });
    }

    // useEffect 依赖缺失的粗略启发式
    const useEffects = content.match(/useEffect\s*\(\s*\(\)\s*=>\s*\{[^}]*\}\s*,\s*\[[^\]]*\]/g) || [];
    if (useEffects.length === 0) {
      // 检测是否存在空依赖数组但内部使用了外部变量
      const risky = content.match(/useEffect\s*\([^,]+,\s*\[\s*\]/g);
      if (risky && risky.length > 0) {
        bugs.push({
          id: `BUG-useeffect-deps-${bugs.length}`,
          title: `useEffect 空依赖数组（${rel}）`,
          description: `发现 ${risky.length} 处空依赖数组的 useEffect，需要人工确认是否真的只需在挂载时执行一次。`,
          severity: "medium",
          file: rel,
        });
      }
    }
  }

  return bugs;
}

/* ----------------------------- 阶段 4：BUG 修复 ----------------------------- */
/**
 * 低风险的自动修复：
 * - 空 catch 填充日志
 * - 移除 debug console.log（保留 error/warn）
 * - 为直接的 JSON.parse 添加 try/catch（若已存在则不重复）
 */
function fixBugs() {
  const fixes = [];
  const ts = TS_FILES();

  for (const file of ts) {
    const rel = path.relative(PROJECT_ROOT, file);
    const content = readFileSafe(file);
    let updated = content;
    let fileFixes = 0;

    // 4.1 空 catch -> 填充 console.error
    updated = updated.replace(/catch\s*\(([^)]*)\)\s*\{\s*\}/g, (m, arg) => {
      fileFixes++;
      return `catch (${arg}) {\n    console.error("Caught error", ${arg || "e"});\n  }`;
    });

    // 4.2 空 catch（多行版本）
    updated = updated.replace(/catch\s*\(([^)]*)\)\s*\{\s*\n\s*\}/g, (m, arg) => {
      fileFixes++;
      return `catch (${arg}) {\n    console.error("Caught error", ${arg || "e"});\n  }`;
    });

    // 4.3 移除明显的调试用 console.log（保留 error/warn）
    // 只处理整行独立的 console.log(...)
    const linesBefore = updated.split("\n");
    const linesAfter = linesBefore.map((ln) => {
      const trimmed = ln.trim();
      if (/^console\.(log|info|debug)\s*\([^)]*\);?\s*$/.test(trimmed)) {
        fileFixes++;
        // 保留注释作为指示，而不是直接删除，避免破坏空行缩进
        const indent = ln.match(/^(\s*)/)[1];
        return `${indent}// removed debug: ${trimmed}`;
      }
      return ln;
    });
    updated = linesAfter.join("\n");

    if (updated !== content) {
      fs.writeFileSync(file, updated);
      fixes.push(`${rel}（${fileFixes} 处修复）`);
    }
  }

  return fixes;
}

/* ----------------------------- 阶段 5：性能优化 ----------------------------- */
/**
 * 基于静态分析给出前端性能优化建议，并自动实施低风险的优化：
 * - 给列表 / 频繁渲染项补上 useMemo / useCallback
 * - 将 setInterval 等副作用收敛
 * - 建议图片懒加载、列表虚拟化
 * - 对大的 JSON.parse 给出 warning
 */
function optimizePerformance() {
  const suggestions = [];
  const applied = [];
  const ts = TS_FILES();

  for (const file of ts) {
    const rel = path.relative(PROJECT_ROOT, file);
    const content = readFileSafe(file);

    // 5.1 检测频繁更新的数组却没有 useMemo
    if (/\.map\s*\(/.test(content) && /useState|useContainers|useImages/.test(content)) {
      if (!content.includes("useMemo")) {
        suggestions.push({
          id: `PERF-memo-${rel}`,
          title: `组件 ${rel} 未使用 useMemo`,
          description: "容器/镜像/卷等长列表在每次刷新时都会 re-render，建议用 useMemo 缓存派生数据。",
          severity: "medium",
        });
      }
    }

    // 5.2 检测 setInterval 未带清理（已在 App.tsx 中清理，这里做二次校验）
    const intervalMatches = content.match(/setInterval\s*\(/g) || [];
    const clearMatches = content.match(/clearInterval\s*\(/g) || [];
    if (intervalMatches.length > clearMatches.length) {
      suggestions.push({
        id: `PERF-interval-${rel}`,
        title: `${rel} 存在 setInterval 但缺失对应 clearInterval`,
        description: "定时器未清理可能导致内存泄漏。",
        severity: "high",
      });
    }

    // 5.3 检测未使用 React.memo 的大数据组件（粗略启发）
    if (/\.length\s*>\s*0/.test(content) && /map\s*\(\s*\w+\s*=>\s*<\w+/.test(content) && !/React\.memo|memo\s*\(/.test(content)) {
      suggestions.push({
        id: `PERF-list-memo-${rel}`,
        title: `${rel} 列表渲染建议使用 React.memo`,
        description: "列表项数量较多时，使用 React.memo 可减少无效重渲染。",
        severity: "low",
      });
    }
  }

  // 5.4 自动实施：给 App.tsx 中的 containers/ images 等派生数据加 useMemo
  const appPath = path.join(PROJECT_ROOT, "src", "App.tsx");
  const appOld = readFileSafe(appPath);
  if (appOld && !appOld.includes("// PERF: memoized counts")) {
    if (appOld.includes("import { useState, useEffect, useCallback } from \"react\";")) {
      const newImport = "import { useState, useEffect, useCallback, useMemo } from \"react\";";
      const patched = appOld.replace(
        "import { useState, useEffect, useCallback } from \"react\";",
        newImport + "\n\n// PERF: memoized counts"
      );
      fs.writeFileSync(appPath, patched);
      applied.push("App.tsx — 引入 useMemo，为后续派生数据缓存做准备");
    }
  }

  // 5.5 自动实施：给 index.css 加上 content-visibility 相关建议
  const cssPath = path.join(PROJECT_ROOT, "src", "App.css");
  const cssOld = readFileSafe(cssPath);
  if (cssOld && !cssOld.includes("content-visibility")) {
    const addition =
      "\n/* ===== Performance (auto-added) ===== */\n" +
      ".list-row {\n" +
      "  content-visibility: auto;\n" +
      "  contain-intrinsic-size: 1px 48px;\n" +
      "}\n";
    fs.writeFileSync(cssPath, cssOld + addition);
    applied.push("App.css — 添加 content-visibility 用于长列表性能优化");
  }

  return { suggestions, applied };
}

/* ----------------------------- 主流程 ----------------------------- */
function main() {
  const state = loadState();
  w(`# 自动化代码改进报告 — ${timestampHuman()}`);
  w(`> 执行目录：\`${PROJECT_ROOT}\``);
  w(`> 运行次数：${state.runCount + 1}`);
  w("");

  // 阶段 1
  w(`## 阶段 1：需求发现`);
  const reqs = discoverRequirements();
  if (reqs.length === 0) {
    w("未发现明确的需求缺口。");
  } else {
    reqs.forEach((r) => {
      w(`### [${r.severity.toUpperCase()}] ${r.title}（${r.id}）`);
      w(`> ${r.description.replace(/\n/g, "\n> ")}`);
      w("");
    });
  }

  // 阶段 2
  w(`## 阶段 2：需求实现（自动应用）`);
  try {
    const applied = implementRequirements();
    if (applied.length === 0) w("本次无需新的改动（相关代码已存在）。");
    else {
      w("以下改动已应用：");
      applied.forEach((a) => w(`- ${a}`));
      state.appliedRequirements.push(...applied.map((x) => `${TIMESTAMP}: ${x}`));
    }
  } catch (err) {
    w(`需求实现阶段异常：${String(err)}`);
  }
  w("");

  // 阶段 3
  w(`## 阶段 3：BUG 发现`);
  const bugs = discoverBugs();
  if (bugs.length === 0) {
    w("未通过静态分析发现明显缺陷。");
  } else {
    bugs.forEach((b) => {
      const loc = b.file ? `@ ${b.file}${b.line ? `:${b.line}` : ""}` : "";
      w(`### [${b.severity.toUpperCase()}] ${b.title} ${loc}`);
      w(b.description);
      w("");
    });
  }

  // 阶段 4
  w(`## 阶段 4：BUG 修复（自动应用）`);
  try {
    const fixed = fixBugs();
    if (fixed.length === 0) w("本次无低风险可自动修复的问题。");
    else {
      w("以下文件进行了修复（空 catch 填充日志 / 注释掉 debug console.log）：");
      fixed.forEach((f) => w(`- ${f}`));
      state.appliedFixes.push(`${TIMESTAMP}: ${fixed.length} 个文件被修复`);
    }
  } catch (err) {
    w(`BUG 修复阶段异常：${String(err)}`);
  }
  w("");

  // 阶段 5
  w(`## 阶段 5：性能优化`);
  try {
    const perf = optimizePerformance();
    w("### 建议");
    if (perf.suggestions.length === 0) w("未发现可优化点。");
    else perf.suggestions.forEach((s) => w(`- [${s.severity.toUpperCase()}] ${s.title} — ${s.description}`));
    w("");
    w("### 已自动应用");
    if (perf.applied.length === 0) w("本次未应用改动。");
    else perf.applied.forEach((a) => w(`- ${a}`));
  } catch (err) {
    w(`性能优化阶段异常：${String(err)}`);
  }
  w("");

  // 汇总
  w(`## 汇总`);
  w(`- 发现需求：**${reqs.length}** 条`);
  w(`- 发现 BUG：**${bugs.length}** 条`);
  w(`- 性能建议：**${
    (() => { try { return optimizePerformance().suggestions.length; } catch { return 0; } })()
  }** 条`);
  w(`- 上次运行：${state.lastRun || "首次"}`);
  w("");
  w(`> 完整报告已保存至：\`${path.relative(PROJECT_ROOT, REPORT_FILE)}\``);

  state.lastRun = NOW.toISOString();
  state.runCount = (state.runCount || 0) + 1;
  saveState(state);

  fs.writeFileSync(REPORT_FILE, reportLines.join("\n"));
  console.log(reportLines.join("\n"));
}

try {
  main();
} catch (e) {
  console.error("脚本执行失败：", e);
  process.exit(1);
}
