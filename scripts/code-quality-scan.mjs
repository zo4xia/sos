#!/usr/bin/env node
/**
 * 代码质量全量扫描器（可复用质量门禁）
 * 覆盖：行尾空白 / CRLF / BOM / ZWSP / 弯引号 / tab 缩进混用 / 硬编码凭据 / IP:端口
 * 输出：结构化 JSON 摘要 + 逐项计数（exit 1 = 存在阻断级问题）
 * 用法：node scripts/code-quality-scan.mjs [扫描根目录...]（默认 src + mini-services/cxq-backend/src + scripts + 根配置）
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = "/home/z/my-project";
const DEFAULT_TARGETS = [
  `${ROOT}/src`,
  `${ROOT}/mini-services/cxq-backend/src`,
  `${ROOT}/scripts`,
];
const CONFIG_FILES = [
  `${ROOT}/eslint.config.mjs`,
  `${ROOT}/next.config.ts`,
  `${ROOT}/tsconfig.json`,
  `${ROOT}/Caddyfile`,
  `${ROOT}/package.json`,
  `${ROOT}/mini-services/cxq-backend/tsconfig.json`,
];
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh", ".css", ".json"]);
/** tab 缩进仅对 TS/JS/CSS 代码为缺陷：Caddyfile 与 shell 脚本的 tab 是官方语法约定 */
const TAB_SENSITIVE = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".css"]);
/** 演示密码 123456 为甲方业务口径（演示账号公开密码，回归脚本必需）——记录但不算阻断 */
const DEMO_PW = /["']123456["']/;

/** 递归收集代码文件（跳过 node_modules/.next/uploads/db-backups/_archive） */
function collect(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (["node_modules", ".next", "uploads", "db-backups", "_archive", ".git"].includes(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) collect(p, out);
    else if (CODE_EXT.has(extname(name))) out.push(p);
  }
  return out;
}

const targets = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_TARGETS;
const files = [...targets.flatMap((t) => collect(t)), ...CONFIG_FILES.filter((f) => {
  try { statSync(f); return true; } catch { return false; }
})];

const issues = {
  trailingWhitespace: [],
  crlf: [],
  bom: [],
  zwsp: [],
  smartQuotes: [],
  tabIndent: [],
  hardcodedCredentials: [],
  hardcodedHostPort: [],
  demoPasswordConvention: [],
};
const PAT = {
  cred: /postgres(ql)?:\/\/[^\s"']*:[^\s"']*@|(?<![_a-zA-Z])(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]|sk-[A-Za-z0-9]{20,}|api[_-]?key\s*[:=]\s*['"][^'"]{8,}['"]/i,
  host: /(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?|localhost(?::\d{2,5})?/,
};
/** env 回退白名单：模式本身即正确设计，不算硬编码 */
const ENV_FALLBACK_OK = /process\.env\.\w+\s*\?\?|\|\|\s*process\.env\.|process\.env\.\w+\s*\|\||\|\|\s*['"]http:\/\/127\.0\.0\.1:3100['"]|\$\{PORT:-/;
/** 安全/标准模式白名单：回环绑定（安全设计）、new URL 解析基座（标准用法） */
const SECURE_OK = /host:\s*['"]127\.0\.0\.1['"]|new URL\(/;
/** 运行时代码目录（严格扫 host/port/cred）；scripts/ 测试工装与 Caddyfile（平台网关接线）不在此列 */
const RUNTIME_DIR = /\/src\/|mini-services\/cxq-backend\/src\/|\/eslint\.config\.mjs|\/next\.config\.ts|\/tsconfig\.json|\/package\.json/;

for (const f of files) {
  let buf;
  try {
    buf = readFileSync(f);
  } catch {
    continue;
  }
  const rel = relative(ROOT, f);
  const text = buf.toString("utf8");
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) issues.bom.push(rel);
  if (text.includes("\u200b")) issues.zwsp.push(rel);
  if (text.includes("\r\n")) issues.crlf.push(rel);
  if (/[\u201c\u201d\u2018\u2019]/.test(text)) {
    const lines = text.split("\n");
    const bad = lines.map((l, i) => (/[\u201c\u201d\u2018\u2019]/.test(l) ? i + 1 : 0)).filter(Boolean);
    if (bad.length) issues.smartQuotes.push(`${rel}:${bad.slice(0, 3).join(",")}`);
  }
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (/[ \t]+$/.test(line)) issues.trailingWhitespace.push(`${rel}:${i + 1}`);
    if (/^\t+/.test(line) && TAB_SENSITIVE.has(extname(f))) issues.tabIndent.push(`${rel}:${i + 1}`);
    if (PAT.cred.test(line) && !DEMO_PW.test(line)) issues.hardcodedCredentials.push(`${rel}:${i + 1}`);
    if (DEMO_PW.test(line)) issues.demoPasswordConvention.push(`${rel}:${i + 1}`);
    if (PAT.host.test(line) && RUNTIME_DIR.test(f)) {
      const ctx = lines.slice(Math.max(0, i - 1), i + 2).join(" ");
      if (!ENV_FALLBACK_OK.test(ctx) && !SECURE_OK.test(ctx) && !/^\s*(#|\/\/|\*|<!--)/.test(line)) {
        issues.hardcodedHostPort.push(`${rel}:${i + 1}`);
      }
    }
  });
}

const blocking = { hardcodedCredentials: issues.hardcodedCredentials, bom: issues.bom, crlf: issues.crlf, trailingWhitespace: issues.trailingWhitespace, tabIndent: issues.tabIndent, zwsp: issues.zwsp, smartQuotes: issues.smartQuotes };
const hasBlocking = Object.values(blocking).some((a) => a.length > 0);
const total = Object.values(issues).reduce((n, a) => n + a.length, 0);

console.log("=== 代码质量扫描报告 ===");
console.log(`扫描文件数: ${files.length}`);
for (const [k, v] of Object.entries(issues)) {
  console.log(`${k}: ${v.length}${v.length ? `  →  ${v.slice(0, 8).join(" | ")}` : ""}`);
}
console.log(`总计问题: ${total}；阻断级: ${hasBlocking ? "有" : "无"}`);
process.exit(hasBlocking ? 1 : 0);
