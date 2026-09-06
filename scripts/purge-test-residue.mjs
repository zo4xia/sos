#!/usr/bin/env node
/**
 * 脏数据清理器：ZZ测试组织物理删除 + 全库测试残留扫描
 * 安全模式：先全表外键引用核验，有引用即中止；幂等可重复执行
 * 用法：node scripts/purge-test-residue.mjs [--dry-run]
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("/home/z/my-project/mini-services/cxq-backend/package.json");
const { Pool } = require("pg");

const env = readFileSync("/home/z/my-project/mini-services/cxq-backend/.env", "utf8");
const DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
if (!DATABASE_URL) throw new Error("DATABASE_URL 未找到于 .env");
const DRY = process.argv.includes("--dry-run");

const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
const q = (sql, params = []) => pool.query(sql, params);

// 1. 定位目标组织
const orgs = await q("select id, name, slug, org_type, created_at from organizations order by id");
console.log("=== 全部组织 ===");
for (const o of orgs.rows) console.log(`  id=${o.id}  name=${o.name}  slug=${o.slug}  type=${o.org_type}`);

const targets = orgs.rows.filter((o) => /测试|test/i.test(`${o.name}${o.slug}`));
console.log(`\n=== 测试标记组织（删除候选）: ${targets.length} 个 ===`);
for (const t of targets) console.log(`  → id=${t.id} name=${t.name} slug=${t.slug}`);

// 2. 外键引用核验（所有含 organization_id 的表）
const fkTables = await q(
  "select table_name from information_schema.columns where column_name='organization_id' and table_schema='public' order by table_name",
);
let unsafe = false;
for (const { table_name } of fkTables.rows) {
  for (const t of targets) {
    const r = await q(`select count(*)::int as n from "${table_name}" where organization_id=$1`, [t.id]);
    if (r.rows[0].n > 0) {
      console.log(`  ✗ ${table_name} 存在 ${r.rows[0].n} 条引用（org=${t.slug}）→ 不安全`);
      unsafe = true;
    }
  }
}

// 3. 其他测试残留扫描（用户↔组织经 memberships 中间表关联）
const users = await q(
  `select u.id, u.phone, u.display_name, m.organization_id
     from users u left join memberships m on m.user_id = u.id
    order by u.id`,
);
const orgIds = new Set(orgs.rows.map((o) => o.id));
// 真·脏数据：membership 指向不存在的组织；无 membership 的用户仅提示不算脏
const orphans = users.rows.filter((u) => u.organization_id !== null && !orgIds.has(u.organization_id));
const noOrg = users.rows.filter((u) => u.organization_id === null);
const testUsers = users.rows.filter((u) => /测试|test/i.test(`${u.display_name || ""}`));
console.log(`\n=== 用户健康检查: 共 ${users.rows.length} 人 ===`);
console.log(`  孤儿用户（组织不存在）: ${orphans.length}`);
for (const u of orphans) console.log(`    → id=${u.id} phone=${u.phone} org_id=${u.organization_id}(不存在)`);
console.log(`  无组织用户（仅提示）: ${noOrg.length}`);
for (const u of noOrg) console.log(`    → id=${u.id} ${u.display_name || u.phone}（无 membership）`);
console.log(`  名称含测试标记用户: ${testUsers.length}`);
for (const u of testUsers) console.log(`    → id=${u.id} ${u.display_name} phone=${u.phone}`);

// 4. 执行删除
if (DRY) {
  console.log("\n[dry-run] 未执行任何删除。");
} else if (unsafe || orphans.length > 0) {
  console.log("\n✗ 存在不安全引用/孤儿数据，已中止删除（人工复核后处理）。");
} else if (targets.length === 0) {
  console.log("\n✓ 无测试组织可删（已清理或从未存在）。");
} else {
  for (const t of targets) {
    await q("delete from organizations where id=$1", [t.id]);
    const verify = await q("select count(*)::int as n from organizations where id=$1", [t.id]);
    console.log(`✓ 已删除组织 id=${t.id} name=${t.name}（复核存在=${verify.rows[0].n}）`);
  }
}

// 5. 测试用户清理（MP 回归注册链的 139111* 测试号段；demo 1380000xxxx 为合法演示账号不在其列）
const userTables = await q(
  "select table_name from information_schema.columns where column_name='user_id' and table_schema='public' and table_name<>'users' order by table_name",
);
const testPhoneUsers = users.rows.filter((u) => /^139111/.test(u.phone));
console.log(`\n=== 测试号段用户（139111*）: ${testPhoneUsers.length} 个 ===`);
for (const u of testPhoneUsers) console.log(`  → id=${u.id} phone=${u.phone} ${u.display_name || ""}`);
if (!DRY) {
  for (const u of testPhoneUsers) {
    for (const { table_name } of userTables.rows) {
      await q(`delete from "${table_name}" where user_id=$1`, [u.id]);
    }
    await q("delete from users where id=$1", [u.id]);
    const verify = await q("select count(*)::int as n from users where id=$1", [u.id]);
    console.log(`  ✓ 已删除测试用户 ${u.phone}（复核存在=${verify.rows[0].n}）`);
  }
}

await pool.end();
console.log("\n=== 清理器执行完毕 ===");
