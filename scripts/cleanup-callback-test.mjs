/**
 * callback 验证产物精准清理（先备份后删，复核演示库复原）
 * 清理范围：
 *  - 提案：【callback验证】开头的测试提案（含两轮运行的 4 条）
 *  - 账号：13900000099 + 1390000XXXX（preset 测试账号）
 *  - 材料：callback材料回归（13700000077）及其 material_files 行与物理文件
 *  保留（有意的演示资产）：
 *  - 候选人附件种子（资格审查材料-*.txt，P2 演示样本）
 *  - 一切原有演示数据
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/home/z/my-project/mini-services/cxq-backend/package.json");
const { Pool } = require("pg");

const env = readFileSync("/proc/4367/environ").toString().split("\0");
const dbUrl = env.find((l) => l.startsWith("DATABASE_URL="))?.slice("DATABASE_URL=".length);
const pool = new Pool({ connectionString: dbUrl });

const backup = { proposals: [], users: [], materials: [] };

async function main() {
  // 0. 误审批产生的测试活动链（fief → stages/positions/announcements 级联）
  const testFiefs = await pool.query(
    "select * from election_fiefs where name like '【callback验证】%'",
  );
  for (const f of testFiefs.rows) {
    const anns = await pool.query("select * from announcements where election_fief_id=$1", [f.id]);
    for (const a of anns.rows) {
      await pool.query("delete from announcement_files where announcement_id=$1", [a.id]);
    }
    await pool.query("delete from announcements where election_fief_id=$1", [f.id]);
    await pool.query("delete from positions where election_fief_id=$1", [f.id]);
    await pool.query("delete from election_fief_stages where election_fief_id=$1", [f.id]);
    await pool.query("delete from election_fiefs where id=$1", [f.id]);
    console.log(`测试活动链清理：${f.name}（公告 ${anns.rowCount} 篇）`);
  }

  // 1. 测试提案（按名称前缀，含历史两轮）
  const props = await pool.query(
    "select * from election_proposals where name like '【callback验证】%' order by created_at",
  );
  backup.proposals = props.rows;
  if (props.rowCount) {
    await pool.query("delete from election_proposals where name like '【callback验证】%'");
  }
  console.log(`提案清理：${props.rowCount} 条（名称前缀【callback验证】）`);

  // 2. 测试账号
  const users = await pool.query(
    "select u.id, u.phone, u.display_name, m.role from users u join memberships m on m.user_id=u.id where u.phone like '1390000%'",
  );
  backup.users = users.rows;
  for (const row of users.rows) {
    await pool.query("delete from memberships where user_id=$1", [row.id]);
    await pool.query("delete from users where id=$1", [row.id]);
  }
  console.log(`账号清理：${users.rowCount} 个（1390000* 测试号）`);

  // 3. 冒烟材料 + 其附件（materials 无 phone 列，按 title 前缀定位；其自动建档用户一并清理）
  const mats = await pool.query(
    "select * from materials where title like '组织推荐-callback回归验证%'",
  );
  backup.materials = mats.rows;
  const smokeUserIds = mats.rows.map((m) => m.candidate_user_id);
  for (const m of mats.rows) {
    // approved 的材料会派生 candidates 行（外键引用），先备份并删除
    const cands = await pool.query("select * from candidates where material_id=$1", [m.id]);
    backup[`candidates_${m.id}`] = cands.rows;
    if (cands.rowCount) {
      await pool.query("delete from candidate_reviews where candidate_id = any($1)", [cands.rows.map((c) => c.id)]);
      await pool.query("delete from candidates where material_id=$1", [m.id]);
    }
    const files = await pool.query("select * from material_files where material_id=$1", [m.id]);
    backup[`files_${m.id}`] = files.rows;
    await pool.query("delete from material_files where material_id=$1", [m.id]);
    await pool.query("delete from materials where id=$1", [m.id]);
    console.log(`材料清理：${m.id}（附件 ${files.rowCount} 个，派生候选人 ${cands.rowCount} 个）`);
  }
  // 自动建档的测试用户（无 membership，仅 user 行）
  if (smokeUserIds.length) {
    const smokeUsers = await pool.query("select * from users where id = any($1)", [smokeUserIds]);
    backup.smokeUsers = smokeUsers.rows;
    await pool.query("delete from users where id = any($1)", [smokeUserIds]);
    console.log(`冒烟用户清理：${smokeUsers.rowCount} 个`);
  }

  writeFileSync(
    "/home/z/my-project/scripts/db-backups/callback-cleanup-backup.json",
    JSON.stringify(backup, null, 2),
  );

  // 4. 复核
  const leftProps = await pool.query("select count(*)::int c from election_proposals where name like '【callback验证】%'");
  const leftUsers = await pool.query("select count(*)::int c from users where phone like '1390000%'");
  const leftMats = await pool.query("select count(*)::int c from materials where title like '组织推荐-callback回归验证%'");
  const candSeed = await pool.query(
    "select count(*)::int c from material_files where file_name like '资格审查材料-%'",
  );
  console.log(`复核：残留提案 ${leftProps.rows[0].c} / 残留账号 ${leftUsers.rows[0].c} / 残留材料 ${leftMats.rows[0].c} / 候选人种子附件(保留) ${candSeed.rows[0].c}`);
  await pool.end();
  if (leftProps.rows[0].c || leftUsers.rows[0].c || leftMats.rows[0].c) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
