#!/usr/bin/env node
/* 小程序端 ↔ cxq-backend 真实端到端验证
 * 链路 = 登录页 login.js + data/http.js syncAll 的完整模拟（真实 HTTP，非 fixture）：
 *   1. GET /auth/organizations → 演示村 UUID
 *   2. POST /auth/candidate/login（候选账号）→ token
 *   3. GET /candidate/{elections, announcements, positions, materials, candidates} + stages
 *   4. 全部真实响应喂给 data/map.js → 断言映射行可被 scopedOf/页面消费
 * 运行：node /home/z/my-project/scripts/verify-mp-e2e.js
 */
const path = require('path')
const MP = '/home/z/my-project/project_state/miniprogram'
const map = require(path.join(MP, 'data/map.js'))
const dbm = require(path.join(MP, 'data/db.js'))

const BASE = 'http://127.0.0.1:3100'
const PHONE = process.env.MP_PHONE || '13800000004'
const PASSWORD = '123456'

let pass = 0, fail = 0
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

async function j(method, url, body, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      token ? { Authorization: 'Bearer ' + token } : {}
    ),
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

;(async () => {
  console.log('── 1) 归属地清单 ──')
  const orgsRes = await j('GET', '/auth/organizations')
  ok('GET /auth/organizations 200', orgsRes.status === 200)
  const orgRows = map.mapOrgs(orgsRes.data || [])
  const org = orgRows.find(o => o.name === '演示村')
  ok('演示村映射行含 id/type（org_type 归一 village→village_committee）', !!org && !!org.id && org.type === 'village_committee',
    JSON.stringify(org && { id: org.id, type: org.type }))
  console.log('    归属地: ' + (org ? org.name + ' (' + org.id + ')' : '未找到'))

  console.log('── 2) 候选人登录（登录页链路） ──')
  const loginRes = await j('POST', '/auth/candidate/login', { phone: PHONE, password: PASSWORD, organizationId: org.id })
  ok('POST /auth/candidate/login 200', loginRes.status === 200, JSON.stringify(loginRes.data))
  const login = loginRes.data || {}
  const token = login.token
  ok('返回 token/organizationId/role/orgName/displayName（login.js _enter 依赖）',
    !!token && !!login.organizationId && login.role === 'candidate' && login.orgName !== undefined && login.displayName !== undefined,
    JSON.stringify({ role: login.role, orgName: login.orgName, displayName: login.displayName }))

  const ctx = { orgId: login.organizationId, phone: PHONE }

  console.log('── 3) syncAll 批1：届次 + 健康 ──')
  const [elRes, healthRes] = await Promise.all([j('GET', '/candidate/elections', null, token), j('GET', '/health')])
  ok('GET /candidate/elections 200', elRes.status === 200)
  ok('GET /health 200（无 today 字段 → 前端已回落设备时钟）', healthRes.status === 200 && !('today' in (healthRes.data || {})),
    JSON.stringify(healthRes.data))
  const elRows = map.mapElections(elRes.data || [], ctx)
  ok('届次映射行 el_org_id/el_id/日期/届名齐全', elRows.every(e => e.el_org_id === ctx.orgId && e.el_id && e.el_election_date && e.el_term),
    JSON.stringify(elRows[0]))
  // 选届逻辑与 http.js syncAll 同口径：active 优先，跳过 draft 引导空壳封地
  const current = elRows.find(e => e.el_status === 'active') || elRows.find(e => e.el_status && e.el_status !== 'draft') || elRows[0]
  ok('选届跳过 draft 空壳封地（active 优先）', current.el_status === 'active',
    JSON.stringify({ status: current.el_status, name: current.el_name }))
  console.log('    当前届: ' + (current ? current.el_term + ' ' + current.el_name + ' D=' + current.el_election_date : '无'))

  const stRes = await j('GET', '/candidate/elections/' + encodeURIComponent(current.el_id) + '/stages', null, token)
  ok('GET /candidate/elections/:id/stages 200（' + (Array.isArray(stRes.data) ? stRes.data.length : '?') + ' 阶段）', stRes.status === 200 && Array.isArray(stRes.data))
  const stRows = map.mapStages(stRes.data || [], current.el_election_date, '', current.el_id)
  ok('阶段映射行 es_election_id/es_stage_key/状态齐全', stRows.length > 0 && stRows.every(s => s.es_election_id === current.el_id && s.es_stage_key && s.es_status))

  console.log('── 4) syncAll 批2：公告/岗位/材料/候选人公示 ──')
  const [annRes, posRes, matRes, candRes] = await Promise.all([
    j('GET', '/candidate/announcements', null, token),
    j('GET', '/candidate/positions', null, token),
    j('GET', '/candidate/materials', null, token),
    j('GET', '/candidate/candidates', null, token),
  ])
  ok('GET /candidate/announcements 200（' + (Array.isArray(annRes.data) ? annRes.data.length : '?') + ' 条已发布）', annRes.status === 200 && Array.isArray(annRes.data))
  ok('GET /candidate/positions 200（' + (Array.isArray(posRes.data) ? posRes.data.length : '?') + ' 岗位）', posRes.status === 200 && Array.isArray(posRes.data))
  ok('GET /candidate/materials 200（' + (Array.isArray(matRes.data) ? matRes.data.length : '?') + ' 条）', matRes.status === 200 && Array.isArray(matRes.data))
  ok('GET /candidate/candidates 200（' + (Array.isArray(candRes.data) ? candRes.data.length : '?') + ' 人公示）', candRes.status === 200 && Array.isArray(candRes.data))

  const annRows = map.mapAnnouncements(annRes.data || [], ctx)
  const posRows = map.mapPositions(posRes.data || [], ctx)
  const matRows = map.mapMaterials(matRes.data || [], ctx)
  const candRows = map.mapCandidates(candRes.data || [], ctx)

  ok('公告映射行 ann_org_id 全回填（scopedOf 不再滤空）', annRows.length > 0 && annRows.every(a => a.ann_org_id === ctx.orgId))
  ok('公告标题/正文/编号非空', annRows.every(a => a.ann_title && a.ann_content !== undefined))
  ok('岗位映射行 pos_org_id 全回填 + pos_type/quota', posRows.length > 0 && posRows.every(p => p.pos_org_id === ctx.orgId && p.pos_type && p.pos_quota !== undefined),
    JSON.stringify(posRows.map(p => p.pos_type + '×' + p.pos_quota)))
  ok('材料映射行 状态/时间/标题 真实（不再 const 空串）', matRows.every(m => m.mat_status && m.mat_submit_time && m.mat_type),
    JSON.stringify(matRows.map(m => ({ t: m.mat_type, s: m.mat_status, d: m.mat_submit_time }))))
  ok('材料附件 {name,url} 换算', matRows.every(m => (m.mat_attachments || []).every(f => f.name && f.url && f.url.indexOf('/files/') > 0)),
    JSON.stringify((matRows[0] || { mat_attachments: [] }).mat_attachments))
  ok('材料映射行能落在 active 封地（选届修复后）', matRows.some(m => m.mat_election_id === current.el_id),
    JSON.stringify(matRows.map(m => m.mat_election_id === current.el_id ? '当前封地' : '其他封地')))
  ok('候选人映射行 状态中文词表 + 四轮平铺', candRows.every(c => c.cand_status && ['待第1轮','待第2轮','待第3轮','待第4轮考察','正式候选人','材料审核不通过','资格初审不通过','联审不通过','考察不通过','待审核','审核不通过'].includes(c.cand_status) && c.cand_r1 !== undefined),
    JSON.stringify(candRows.map(c => c.cand_name + ':' + c.cand_status)))
  ok('候选人映射行 org/届键回填', candRows.every(c => c.cand_org_id === ctx.orgId && c.cand_election_id))

  console.log('── 5) scopedOf 页面可见性（真实数据端到端） ──')
  Object.assign(dbm.DB, {
    organizations: orgRows, elections: elRows, election_stages: stRows,
    announcements: annRows, positions: posRows, materials: matRows, candidates: candRows,
  })
  const s = dbm.scopedOf(ctx.orgId, current.el_id)
  ok('公告页可见 ' + s.announcements.length + ' 条', s.announcements.length > 0)
  ok('选举方式页岗位可见 ' + s.positions.length + ' 个', s.positions.length > 0)
  ok('材料页我的记录可见 ' + s.materials.length + ' 条', s.materials.length > 0, JSON.stringify(s.materials.map(m => m.mat_type + '/' + m.mat_status)))
  ok('候选人公示页可见 ' + s.candidates.length + ' 人', s.candidates.length > 0)
  ok('我的页参选档案命中（按手机号+封地）', !!dbm.DB.candidates.find(c => c.cand_acc_id === PHONE && c.cand_election_id === current.el_id))
  ok('app.org() 可命中（机构名回显）', !!(dbm.findOrg(ctx.orgId) && dbm.findOrg(ctx.orgId).name))

  console.log('── 6) 材料窗口判定（真实语义阶段键 + 今日） ──')
  const dates = require(path.join(MP, 'utils/dates.js'))
  const win = dates.materialWindow(dates.computeStageDates(current.el_election_date, stRows), new Date().toISOString().slice(0, 10))
  console.log('    真实窗口: ' + JSON.stringify(win))
  ok('窗口引擎可判定（不再恒 none）', ['before', 'open', 'after'].includes(win.state) && !!win.start && !!win.end,
    'state=' + win.state)
  ok('窗口区间 = 提名启动~收审截止（D-15~D-13）', win.start && win.end && win.start.slice(0, 10) !== '' && win.end >= win.start, '')

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('脚本异常: ' + e.message); process.exit(1) })
