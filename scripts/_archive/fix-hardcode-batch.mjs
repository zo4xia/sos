#!/usr/bin/env node
/**
 * 硬编码/格式缺陷批量修复器（一次性执行，变更全部留痕输出）
 * 修复项：
 *  F1  8 个后端 check/reset/seed 脚本：裸连接串 → env-guard（复用 migrate.ts 模式）
 *  F2  main.ts 补 export {}（修 TS1375 顶层 await）
 *  F3  cxq-backend tsconfig：allowImportingTsExtensions + noEmit（修 TS5097）
 *  F4  instrumentation.ts 探活端口 → env 回退
 *  F5  keep-cxq-backend-alive.sh 探活端口 → 复用已 source 的 $PORT
 *  F6  accounts.ts 去 BOM + CRLF；clean_orgs_and_positions.json 去 CRLF
 *  F7  eslint.config.mjs 行尾空白
 *  F8  .gitignore 增补 tool-results/
 */
import { readFileSync, writeFileSync } from "node:fs";

const R = "/home/z/my-project";
const changes = [];
let failed = 0;

/** 精确单点替换：找不到即报错退出（fail-loud，防错位） */
function patch(file, find, replace, tag) {
  const before = readFileSync(file, "utf8");
  if (!before.includes(find)) {
    console.error(`✗ [${tag}] 未找到目标片段: ${file}`);
    failed++;
    return;
  }
  const after = before.replace(find, replace);
  if (after === before) {
    console.error(`✗ [${tag}] 替换无变化: ${file}`);
    failed++;
    return;
  }
  writeFileSync(file, after);
  changes.push({ tag, file: file.replace(R + "/", ""), find: find.trim().slice(0, 90), replace: replace.trim().split("\n")[0].slice(0, 90) });
  console.log(`✓ [${tag}] ${file.replace(R + "/", "")}`);
}

const B = `${R}/mini-services/cxq-backend`;
const OLD = (v) => `const ${v} = new Pool({ connectionString: 'postgresql://postgres:123456@localhost:5432/backend_new' });`;
const NEW = (v) => `const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const ${v} = new Pool({ connectionString });`;

// F1：8 个脚本 env-guard 化
for (const [file, varName] of [
  ["src/check-cr.ts", "p"], ["src/check-pwd.ts", "p"], ["src/check-cols.ts", "p"],
  ["src/check-db.ts", "p"], ["src/check-biz.ts", "p"], ["src/check-constraint.ts", "p"],
  ["src/reset-pwd.ts", "pool"], ["src/seed-candidates.ts", "pool"],
]) {
  patch(`${B}/${file}`, OLD(varName), NEW(varName), `F1-${file}`);
}

// F2：main.ts 模块化
patch(`${B}/src/main.ts`, 'await import("./server.ts");', 'await import("./server.ts");\n\nexport {};', "F2-main-module");

// F3：tsconfig 补编译选项
{
  const f = `${B}/tsconfig.json`;
  const j = JSON.parse(readFileSync(f, "utf8"));
  j.compilerOptions.allowImportingTsExtensions = true;
  j.compilerOptions.noEmit = true;
  delete j.compilerOptions.outDir; // noEmit 下无意义，顺手清理
  writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
  console.log("✓ [F3-tsconfig] allowImportingTsExtensions + noEmit");
  changes.push({ tag: "F3-tsconfig", file: "mini-services/cxq-backend/tsconfig.json", find: "(无 allowImportingTsExtensions/noEmit)", replace: "allowImportingTsExtensions:true + noEmit:true" });
}

// F4：instrumentation 探活端口 env 化
patch(`${R}/src/instrumentation.ts`,
  'const s = net.connect({ port: 3100, host: "127.0.0.1" });',
  'const s = net.connect({ port: Number(process.env.CXQ_BACKEND_PORT ?? 3100), host: "127.0.0.1" });',
  "F4-inst-port");

// F5：看门狗脚本探活端口复用 $PORT（.env 已 source，shell 变量优先）
patch(`${R}/scripts/keep-cxq-backend-alive.sh`,
  "if curl -s -m 1 http://127.0.0.1:3100/health > /dev/null 2>&1; then",
  'if curl -s -m 1 "http://127.0.0.1:${PORT:-3100}/health" > /dev/null 2>&1; then',
  "F5-watchdog-port");

// F6：BOM / CRLF 清理（二进制安全处理）
for (const [file, opts] of [
  [`${B}/src/routes/accounts.ts`, { bom: true, crlf: true }],
  [`${B}/src/data/clean_orgs_and_positions.json`, { bom: false, crlf: true }],
]) {
  let buf = readFileSync(file);
  if (opts.bom && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    buf = buf.subarray(3);
    console.log(`✓ [F6-bom] ${file.replace(R + "/", "")}`);
    changes.push({ tag: "F6-bom", file: file.replace(R + "/", ""), find: "EF BB BF", replace: "(已剥离)" });
  }
  const text = buf.toString("utf8");
  if (opts.crlf && text.includes("\r\n")) {
    writeFileSync(file, text.replace(/\r\n/g, "\n"));
    console.log(`✓ [F6-crlf] ${file.replace(R + "/", "")}`);
    changes.push({ tag: "F6-crlf", file: file.replace(R + "/", ""), find: "CRLF", replace: "LF" });
  }
}

// F7：eslint.config.mjs 行尾空白
{
  const f = `${R}/eslint.config.mjs`;
  const t = readFileSync(f, "utf8");
  const clean = t.replace(/[ \t]+$/gm, "");
  if (clean !== t) {
    writeFileSync(f, clean);
    console.log("✓ [F7-trailing-ws] eslint.config.mjs");
    changes.push({ tag: "F7-trailing-ws", file: "eslint.config.mjs", find: "3 处行尾空白", replace: "(已清除)" });
  }
}

// F8：.gitignore 增补
{
  const f = `${R}/.gitignore`;
  const t = readFileSync(f, "utf8");
  if (!t.includes("tool-results/")) {
    writeFileSync(f, t + "\n# 平台工具自动生成的持久化输出\ntool-results/\n");
    console.log("✓ [F8-gitignore] + tool-results/");
    changes.push({ tag: "F8-gitignore", file: ".gitignore", find: "(无 tool-results)", replace: "+ tool-results/" });
  }
}

console.log(`\n=== 修复完成：${changes.length} 项变更，失败 ${failed} 项 ===`);
if (failed > 0) process.exit(1);
