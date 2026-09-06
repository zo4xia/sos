#!/usr/bin/env node
/* 小程序数据映射层回归测试（契约 fixture = cxq-backend 各 /candidate/* 端点真实返回形态）
 * 覆盖：organizations/elections/announcements/positions/materials/candidates 映射
 *       + scopedOf 作用域过滤（修复后真实数据不再被滤空）
 *       + kit 状态词表（materialStatus/statusType 对真实值域）
 * 运行：node /home/z/my-project/scripts/test-mp-map.js
 */
const path = require('path')
const MP = '/home/z/my-project/project_state/miniprogram'
const map = require(path.join(MP, 'data/map.js'))
const dbm = require(path.join(MP, 'data/db.js'))
const kit = require(path.join(MP, 'utils/kit.js'))

let pass = 0, fail = 0
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + '\n    期望: ' + e + '\n    实际: ' + a) }
}

const ORG_ID = 'f81c0000-0000-4000-8000-000000000001'
const FIEF_ID = 'e52b0000-0000-4000-8000-000000000002'
const PHONE = '13800000001'
const ctx = { orgId: ORG_ID, phone: PHONE }

console.log('── 1) /auth/organizations 映射 ──')
const orgRows = map.mapOrgs([
  { id: ORG_ID, slug: 'cun-demo', name: '演示村', org_type: 'village_committee', status: 'active' },
  { id: '9999', slug: 'boss', name: '城厢区换届选举平台', org_type: 'root', status: 'active' },
])
eq('id 保留（findOrg 双键匹配依赖）', orgRows[0].id, ORG_ID)
eq('type ← org_type', orgRows[0].type, 'village_committee')

console.log('── 2) /candidate/elections 映射 ──')
const elRows = map.mapElections([
  { id: FIEF_ID, name: '演示村第6届换届选举', d_day: '2026-10-15', status: 'in_progress', term_name: '第6届' },
], ctx)
eq('el_org_id ← ctx.orgId（method/notice 届次选择器过滤依赖）', elRows[0].el_org_id, ORG_ID)
eq('el_id ← id', elRows[0].el_id, FIEF_ID)
eq('el_election_date ← d_day', elRows[0].el_election_date, '2026-10-15')
eq('el_term ← term_name', elRows[0].el_term, '第6届')

console.log('── 3) stages 映射（D-15~D-13 窗口引擎依赖） ──')
const stRows = map.mapStages([
  { stage_key: 'D-15', stage_name: '候选人提名启动', start_date: '2026-09-30', end_date: '2026-09-30', stage_order: 3, status: '进行中' },
  { stage_key: 'D-13', stage_name: '提名截止收审', start_date: '2026-10-02', end_date: '2026-10-02', stage_order: 5, status: '未开始' },
], '2026-10-15', '', FIEF_ID)
eq('es_election_id ← elId', stRows[0].es_election_id, FIEF_ID)
eq('es_status 进行中→办理中（词表归一）', stRows[0].es_status, '办理中')
eq('es_offset_start 反推 D 偏移', stRows[0].es_offset_start, -15)
const win = kit ? null : null
const dates = require(path.join(MP, 'utils/dates.js'))
const winRes = dates.materialWindow(dates.computeStageDates('2026-10-15', stRows), '2026-10-01')
eq('材料窗口判定（D-15~D-13 闭区间，今日 10-01 开放）', winRes.state, 'open')

console.log('── 4) /candidate/announcements 映射 ──')
const annRows = map.mapAnnouncements([
  { id: 'a1', title: '预选结果公告', body: '正文', status: 'published', published_at: '2026-09-01 10:00:00+00', stage_key: null, at_code: '第6-1号' },
], ctx)
eq('ann_org_id ← ctx.orgId（scopedOf 公告过滤依赖）', annRows[0].ann_org_id, ORG_ID)
eq('ann_code ← at_code', annRows[0].ann_code, '第6-1号')
eq('ann_publish_time 截到分钟', annRows[0].ann_publish_time, '2026-09-01 10:00')
eq('ann_content ← body', annRows[0].ann_content, '正文')

console.log('── 5) /candidate/positions 映射 ──')
const posRows2 = map.mapPositions([
  { id: 'p1', name: '主任', quota: 1, status: 'recruiting', application_start: '2026-09-30', application_end: '2026-10-02', material_review_start: null, material_review_end: null },
], ctx)
eq('pos_org_id ← ctx.orgId（scopedOf 岗位过滤依赖）', posRows2[0].pos_org_id, ORG_ID)
eq('pos_type ← name', posRows2[0].pos_type, '主任')
eq('pos_quota ← quota', posRows2[0].pos_quota, 1)

console.log('── 6) /candidate/materials 映射（P0 修复核心） ──')
const matRows = map.mapMaterials([
  {
    id: 'm1', election_fief_id: FIEF_ID, candidate_user_id: 'u1',
    title: '主任', description: '个人自荐', status: 'submitted',
    submitted_at: '2026-09-05 09:12:34+00', reviewed_at: null, review_note: null,
    files: [
      { id: 'mf1', material_id: 'm1', file_name: '自荐表.jpg', mime_type: 'image/jpeg', size_bytes: 2048, storage_key: 'a1b2c3d4e5f60718293a4b5c6d7e8f90.jpg' },
      { id: 'mf2', material_id: 'm1', file_name: '坏行无key', mime_type: 'text/plain', size_bytes: 1, storage_key: null },
    ],
  },
  {
    id: 'm2', election_fief_id: FIEF_ID, candidate_user_id: 'u1',
    title: '报名材料-李四', description: null, status: 'approved',
    submitted_at: '2026-09-04 08:00:00+00', reviewed_at: '2026-09-05 10:00:00+00', review_note: '材料齐全',
    files: [],
  },
], ctx)
eq('mat_type ← title（记录名不再恒「参选材料」）', matRows[0].mat_type, '主任')
eq('mat_status ← status（记录状态不再恒空）', matRows[0].mat_status, 'submitted')
eq('mat_submit_time ← submitted_at', matRows[0].mat_submit_time, '2026-09-05 09:12')
eq('mat_election_id ← election_fief_id（scopedOf 按届过滤依赖）', matRows[0].mat_election_id, FIEF_ID)
eq('mat_review_comment ← review_note', matRows[1].mat_review_comment, '材料齐全')
eq('mat_review_time ← reviewed_at', matRows[1].mat_review_time, '2026-09-05 10:00')
eq('附件换算 {name,url}（无 key 行剔除）', matRows[0].mat_attachments, [
  { name: '自荐表.jpg', url: 'http://127.0.0.1:3100/files/a1b2c3d4e5f60718293a4b5c6d7e8f90.jpg' },
])
eq('kit.materialStatus(submitted)', kit.materialStatus('submitted').text, '已提交')
eq('kit.materialStatus(approved).cls', kit.materialStatus('approved').cls, 'done')

console.log('── 7) /candidate/candidates 映射（新数据源） ──')
const candRows = map.mapCandidates([
  {
    id: 'c1', election_fief_id: FIEF_ID, display_name: '张三', phone: PHONE,
    status: 'reviewing', current_round: 'R2',
    reviews: [
      { round: 'R1', decision: 'approved', note: '材料齐全', created_at: '2026-09-01 09:00:00+00' },
    ],
  },
  {
    id: 'c2', election_fief_id: FIEF_ID, display_name: '李四', phone: '13800000002',
    status: 'rejected', current_round: 'R3',
    reviews: [
      { round: 'R1', decision: 'approved', note: null, created_at: '2026-09-01 09:00:00+00' },
      { round: 'R2', decision: 'approved', note: null, created_at: '2026-09-02 09:00:00+00' },
      { round: 'R3', decision: 'rejected', note: '联审发现失信记录取消资格', created_at: '2026-09-03 09:00:00+00' },
    ],
  },
  {
    id: 'c3', election_fief_id: FIEF_ID, display_name: '王五', phone: '13800000003',
    status: 'approved', current_round: 'complete',
    reviews: [
      { round: 'R1', decision: 'approved', created_at: '2026-09-01 09:00:00+00' },
      { round: 'R2', decision: 'approved', created_at: '2026-09-02 09:00:00+00' },
      { round: 'R3', decision: 'approved', created_at: '2026-09-03 09:00:00+00' },
      { round: 'R4', decision: 'approved', created_at: '2026-09-04 09:00:00+00' },
    ],
  },
], ctx)
eq('cand_acc_id ← phone（profile 参选档案按手机号命中）', candRows[0].cand_acc_id, PHONE)
eq('cand_election_id ← election_fief_id', candRows[0].cand_election_id, FIEF_ID)
eq('cand_org_id ← ctx.orgId', candRows[0].cand_org_id, ORG_ID)
eq('reviewing+R2 → 待第2轮', candRows[0].cand_status, '待第2轮')
eq('R1 通过 / R2 待审（curRound 检测依赖）', [candRows[0].cand_r1, candRows[0].cand_r2], ['通过', '待审'])
eq('R1 意见/时间', [candRows[0].cand_r1_comment, candRows[0].cand_r1_time], ['材料齐全', '2026-09-01 09:00'])
eq('rejected+R3 → 联审不通过', candRows[1].cand_status, '联审不通过')
eq('R3 不通过 / R4 冻结为待审', [candRows[1].cand_r3, candRows[1].cand_r4], ['不通过', '待审'])
eq('rejected 状态色 → bad', kit.statusType(candRows[1].cand_status), 'bad')
eq('approved+complete → 正式候选人', candRows[2].cand_status, '正式候选人')
eq('四轮全过', [candRows[2].cand_r1, candRows[2].cand_r2, candRows[2].cand_r3, candRows[2].cand_r4], ['通过', '通过', '通过', '通过'])
eq('云通道旧行（驼峰）仍走 SCHEMA 投影', map.mapCandidates([{ candName: '甲', candPhone: '13900000000', candR1: '通过' }], ctx)[0].cand_name, '甲')

console.log('── 8) scopedOf 作用域端到端（映射行 → 页面可见性） ──')
// 模拟 http.syncAll 的原位覆盖
Object.assign(dbm.DB, {
  organizations: orgRows, elections: elRows, election_stages: stRows,
  announcements: annRows, positions: posRows2, materials: matRows, candidates: candRows,
})
const s = dbm.scopedOf(ORG_ID, FIEF_ID)
eq('findOrg 按 UUID 命中（登录态 orgId 是后端 UUID）', !!(dbm.findOrg(ORG_ID) && dbm.findOrg(ORG_ID).name === '演示村'), true)
eq('findOrg 按 slug 命中（云通道兼容）', !!(dbm.findOrg('cun-demo') && dbm.findOrg('cun-demo').name === '演示村'), true)
eq('公告不再被按届过滤滤空', s.announcements.length, 1)
eq('岗位不再被按届过滤滤空', s.positions.length, 1)
eq('我的材料按届可见', s.materials.length, 2)
eq('候选人公示按届可见', s.candidates.length, 3)
eq('阶段按届可见', s.stages.length, 2)

console.log('── 9) kit 状态词表（真实值域全覆盖） ──')
eq('statusType(材料审核不通过) → bad', kit.statusType('材料审核不通过'), 'bad')
eq('statusType(资格初审不通过) → bad', kit.statusType('资格初审不通过'), 'bad')
eq('statusType(待第1轮) → live', kit.statusType('待第1轮'), 'live')
eq('roundType(不通过) → bad', kit.roundType('不通过'), 'bad')
eq('roundType(待审) → live', kit.roundType('待审'), 'live')

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail ? 1 : 0)
