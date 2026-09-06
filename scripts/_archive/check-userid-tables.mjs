#!/usr/bin/env node
/** 排查：全库 user_id 引用表清单（测试用户清理需覆盖的表） */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/home/z/my-project/mini-services/cxq-backend/package.json");
const { Pool } = require("pg");
const env = readFileSync("/home/z/my-project/mini-services/cxq-backend/.env", "utf8");
const pool = new Pool({ connectionString: env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim(), max: 1 });

const r = await pool.query(
  "select table_name from information_schema.columns where column_name='user_id' and table_schema='public' order by table_name",
);
console.log("含 user_id 的表:", r.rows.map((x) => x.table_name).join(", "));

// 测试用户在各级表的引用计数
const u = (await pool.query("select id from users where phone='13911115555'")).rows[0];
if (u) {
  for (const { table_name } of r.rows) {
    const c = await pool.query(`select count(*)::int as n from "${table_name}" where user_id=$1`, [u.id]);
    if (c.rows[0].n > 0) console.log(`  ${table_name}: ${c.rows[0].n} 条`);
  }
} else {
  console.log("测试用户 13911115555 不存在");
}
await pool.end();
