import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const req = createRequire("/home/z/my-project/mini-services/cxq-backend/package.json");
const { Pool } = req("pg");
const dbUrl = readFileSync("/home/z/my-project/project_state/neon.env", "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
const pool = new Pool({ connectionString: dbUrl });
const users = (await pool.query(`
  select u.phone, u.display_name, u.role, u.status, o.name org_name
  from users u join organizations o on o.id = u.organization_id
  order by o.name, u.role, u.phone
`)).rows;
console.log("== 全库账号（按组织） ==");
users.forEach((u) => console.log(` ${u.org_name} | ${u.phone} | ${u.display_name} | ${u.role} | ${u.status}`));
const data = (await pool.query(`
  select o.name org_name,
    (select count(*) from election_proposals p where p.organization_id = o.id) proposals,
    (select count(*) from election_fiefs f where f.organization_id = o.id) fiefs,
    (select count(*) from materials m where m.organization_id = o.id) materials,
    (select count(*) from candidates c where c.organization_id = o.id) candidates,
    (select count(*) from announcements a where a.organization_id = o.id) anns
  from organizations o order by o.name
`)).rows;
console.log("\n== 各组织数据量 ==");
data.forEach((d) => console.log(` ${d.org_name}: 提案${d.proposals} 封地${d.fiefs} 材料${d.materials} 候选人${d.candidates} 公告${d.anns}`));
// 候选账号明细（小程序端参选用户）
const cands = (await pool.query(`
  select u.phone, u.display_name, u.role, o.name org_name
  from users u join organizations o on o.id = u.organization_id
  where u.role = 'candidate' order by o.name, u.phone
`)).rows;
console.log("\n== 参选用户（candidate 角色） ==");
cands.forEach((c) => console.log(` ${c.org_name} | ${c.phone} | ${c.display_name}`));
await pool.end();
