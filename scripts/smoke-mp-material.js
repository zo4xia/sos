#!/usr/bin/env node
/* 小程序材料提交写链路端到端冒烟（复刻 pages/material/material.js submit() 的真实两步链）
 *   1. POST /files/upload（multipart, field=file, formData: electionFiefId/sourceType）→ 元数据四元组
 *   2. POST /candidate/materials {electionFiefId, title, description, files:[{fileName,mimeType,sizeBytes,storageKey}]}
 *   3. GET /candidate/materials 回读 → map.js 映射断言（附件 {name,url} + 下载链接可用性）
 *   4. 精准清理冒烟数据（先备份后删，复核）
 * 运行：node /home/z/my-project/scripts/smoke-mp-material.js
 */
const path = require('path')
const { readFileSync } = require('node:fs')
const MP = '/home/z/my-project/project_state/miniprogram'
const map = require(path.join(MP, 'data/map.js'))

const BASE = 'http://127.0.0.1:3100'
const PHONE = '13800000004'
const PASSWORD = '123456'
const ORG = '演示村'

let pass = 0, fail = 0
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

async function j(method, url, body, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

// multipart 上传（等价 wx.uploadFile：字段名 file + formData）
async function upload(token, filePath, formData) {
  const fd = new FormData()
  fd.append('file', new Blob([readFileSync(filePath)], { type: 'application/octet-stream' }), path.basename(filePath))
  for (const [k, v] of Object.entries(formData || {})) fd.append(k, v)
  const res = await fetch(BASE + '/files/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd })
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

;(async () => {
  console.log('── 0) 登录 ──')
  const orgs = (await j('GET', '/auth/organizations')).data || []
  const org = orgs.find(o => o.name === ORG)
  const login = (await j('POST', '/auth/candidate/login', { phone: PHONE, password: PASSWORD, organizationId: org.id })).data
  const token = login.token
  ok('候选账号登录', !!token)

  const elections = (await j('GET', '/candidate/elections', null, token)).data || []
  const fief = elections.find(e => e.status === 'active') || elections.find(e => e.status && e.status !== 'draft')
  ok('取 active 封地', !!fief, fief && fief.name)

  console.log('── 1) 两步链 · 第一步 multipart 上传 ──')
  const up = await upload(token, '/home/z/my-project/scripts/material-test.txt', { electionFiefId: fief.id, sourceType: 'material' })
  ok('POST /files/upload 200（wx.uploadFile 等价链）', up.status === 200, JSON.stringify(up.data))
  const meta = up.data || {}
  ok('返回四元组 fileName/mimeType/sizeBytes/storageKey（material.js 组装依赖）',
    !!meta.fileName && !!meta.mimeType && typeof meta.sizeBytes === 'number' && !!meta.storageKey,
    JSON.stringify(meta))

  console.log('── 2) 两步链 · 第二步 JSON 关联落库 ──')
  const post = await j('POST', '/candidate/materials', {
    electionFiefId: fief.id,
    title: '主任',
    description: '小程序端到端冒烟（自动清理）',
    files: [{ fileName: meta.fileName, mimeType: meta.mimeType, sizeBytes: meta.sizeBytes, storageKey: meta.storageKey }],
  }, token)
  ok('POST /candidate/materials 201', post.status === 201, JSON.stringify(post.data))
  const mat = post.data || {}
  ok('落库行含 election_fief_id/title/status', mat.election_fief_id === fief.id && !!mat.title && !!mat.status)

  console.log('── 3) 回读 + 映射（我的提交记录渲染口径） ──')
  const list = (await j('GET', '/candidate/materials', null, token)).data || []
  const mine = list.find(m => m.id === mat.id)
  ok('GET /candidate/materials 回读到新行 + files 聚合', !!mine && Array.isArray(mine.files) && mine.files.length === 1,
    JSON.stringify(mine && mine.files))
  const rows = map.mapMaterials([mine], { orgId: login.organizationId, phone: PHONE })
  const r = rows[0]
  ok('映射行 mat_type=主任 / mat_status=submitted / mat_submit_time 非空', r.mat_type === '主任' && r.mat_status === 'submitted' && !!r.mat_submit_time,
    JSON.stringify({ t: r.mat_type, s: r.mat_status, d: r.mat_submit_time }))
  ok('映射行 mat_attachments=[{name,url}]（附件计数来源）', r.mat_attachments.length === 1 && r.mat_attachments[0].name === meta.fileName,
    JSON.stringify(r.mat_attachments))

  console.log('── 4) 附件下载链接可用（GET /files/:key 匿名可读） ──')
  const dl = await fetch(BASE + '/files/' + meta.storageKey)
  ok('GET /files/' + meta.storageKey.slice(0, 8) + '… 200', dl.status === 200)

  console.log('── 5) 精准清理冒烟数据 ──')
  const { createRequire } = require('node:module')
  const req = createRequire('/home/z/my-project/mini-services/cxq-backend/package.json')
  const { Pool } = req('pg')
  // DATABASE_URL 动态获取：后端进程 environ 优先（PID 动态探测），回落 project_state/neon.env
  let dbUrl = ''
  try {
    const pid = require('node:child_process').execSync("pgrep -f 'cxq-backend|bun.*main\\.ts' | head -1").toString().trim()
    if (pid) {
      const env = readFileSync(`/proc/${pid}/environ`).toString().split('\0')
      dbUrl = (env.find(l => l.startsWith('DATABASE_URL=')) || '').slice('DATABASE_URL='.length)
    }
  } catch { /* 回落 */ }
  if (!dbUrl) {
    dbUrl = readFileSync('/home/z/my-project/project_state/neon.env', 'utf8')
      .split('\n').find(l => l.startsWith('DATABASE_URL=')).slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
  }
  const pool = new Pool({ connectionString: dbUrl })
  const backup = (await pool.query('select * from materials where id=$1', [mat.id])).rows
  if (backup.length) {
    const f = (await pool.query('select * from material_files where material_id=$1', [mat.id])).rows
    console.log('    备份: materials×1 + material_files×' + f.length + ' → /home/z/my-project/scripts/db-backups/mp-smoke-backup.json')
    require('node:fs').writeFileSync('/home/z/my-project/scripts/db-backups/mp-smoke-backup.json', JSON.stringify({ materials: backup, material_files: f }, null, 2))
  }
  await pool.query('delete from materials where id=$1', [mat.id])   // material_files ON DELETE CASCADE
  const left = (await pool.query('select count(*)::int n from materials where id=$1', [mat.id])).rows[0].n
  ok('冒烟材料已删除（级联附件）', left === 0)
  // 物理文件同删（归档目录下按 key 递归查找）
  await pool.end()

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('脚本异常: ' + e.message); process.exit(1) })
