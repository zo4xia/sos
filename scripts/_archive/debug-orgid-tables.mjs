#!/usr/bin/env node
/** 临时调试：定位 organization_id 列的表/视图类型与可查性 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/home/z/my-project/mini-services/cxq-backend/package.json");
const { Pool } = require("pg");

const env = readFileSync("/home/z/my-project/mini-services/cxq-backend/.env", "utf8");
const DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });

const cols = await pool.query(
  "select table_name from information_schema.columns where column_name='organization_id' and table_schema='public' order by table_name",
);
const names = cols.rows.map((r) => r.table_name);
console.log(`含 organization_id 的对象: ${names.length} 个`);

for (const tn of names) {
  try {
    const r = await pool.query(`select count(*)::int as n from "${tn}" where organization_id is not null`);
    console.log(`  OK   ${tn}: 非空行 ${r.rows[0].n}`);
  } catch (e) {
    console.log(`  FAIL ${tn}: ${e.message}`);
  }
}

const types = await pool.query(
  "select table_name, table_type from information_schema.tables where table_schema='public' order by table_name",
);
const views = types.rows.filter((r) => r.table_type !== "BASE TABLE");
console.log(`\n非基表对象: ${views.length} 个`);
for (const v of views) console.log(`  ${v.table_type}: ${v.table_name}`);

await pool.end();
