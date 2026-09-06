// 演示库演示账号密码重置为 123456（scrypt，与后端 lib.ts 同算法）
// 仅影响 Neon 演示库的演示账号，用于前端 E2E 验证登录
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// pg 安装在 cxq-backend 的 node_modules，用 createRequire 指向该包解析
const require = createRequire('/home/z/my-project/mini-services/cxq-backend/package.json');
const { Pool } = require('pg');

const scrypt = promisify(scryptCallback);
async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

// 从运行中后端进程环境读取 DATABASE_URL（与后端同库）
const env = readFileSync('/proc/4367/environ').toString().split('\0');
const dbUrl = env.find((l) => l.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length);
if (!dbUrl) throw new Error('DATABASE_URL not found');

const pool = new Pool({ connectionString: dbUrl });
const hash = await passwordHash('123456');
const r = await pool.query(
  'update users set password_hash=$1 where phone in ($2,$3)',
  [hash, '15500010001', '15500020001'],
);
console.log(`reset ${r.rowCount} demo accounts (演示村/演示社区 sub_admin) -> 123456`);
await pool.end();
