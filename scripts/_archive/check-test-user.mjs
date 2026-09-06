#!/usr/bin/env node
/** 排查：13911115555 注册测试用户是否已存在（往轮测试残留） */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/home/z/my-project/mini-services/cxq-backend/package.json");
const { Pool } = require("pg");
const env = readFileSync("/home/z/my-project/mini-services/cxq-backend/.env", "utf8");
const pool = new Pool({ connectionString: env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim(), max: 1 });

const r = await pool.query(
  `select u.id, u.phone, u.display_name, u.created_at, m.organization_id, o.name as org_name, m.role
     from users u left join memberships m on m.user_id=u.id
     left join organizations o on o.id=m.organization_id
    where u.phone like '139111%' or u.display_name like '%测试%' or u.display_name like '%test%'
    order by u.created_at desc`,
);
console.log(`测试手机号/测试名用户: ${r.rows.length} 个`);
for (const u of r.rows) console.log(JSON.stringify(u));
await pool.end();
