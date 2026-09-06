#!/usr/bin/env node
/* R-21 归属地会话链 · 小程序登录全链仿真（真实后端 3100，mock wx 运行时）
 *
 * 背景（用户报错「直接报错，好好检查自己的用户体系」根因）：
 *   login.js _enter 此前 acc_org_id='' 且 app.login 第三参传空 → globalData.orgId=''
 *   → home/profile/material/notice/candidate/method 六页守卫 !g.orgId 全命中
 *   → 登录成功即 wx.reLaunch 踢回登录页（观感=登录报错进不去）。
 *
 * 本脚本加载【真实源码】app.js + pages/login/login.js + pages/home/home.js，
 * mock wx（request→真实 fetch 3100 / storage / switchTab / reLaunch 记录），
 * 完整复刻微信开发者工具里的用户操作并断言修复生效。
 *
 * 运行：node /home/z/my-project/scripts/verify-mp-login-chain.js
 */
const path = require('path')
const Module = require('module')

const MP = '/home/z/my-project/project_state/miniprogram'
const BASE = 'http://127.0.0.1:3100'
const TEST_PHONE = '13911115555'

/* ── 注册链测试用户自净（幂等）：直连 DB 预清理+事后清理，杜绝住轮残留导致 phone_already_registered ── */
let _pgPool
async function purgeRegisterTestUser() {
  try {
    if (!_pgPool) {
      const createRequire = require('module').createRequire
      const req2 = createRequire('/home/z/my-project/mini-services/cxq-backend/package.json')
      const fs = require('fs')
      const env = fs.readFileSync('/home/z/my-project/mini-services/cxq-backend/.env', 'utf8')
      const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim()
      _pgPool = new (req2('pg').Pool)({ connectionString: url, max: 1 })
    }
    const u = (await _pgPool.query('select id from users where phone=$1', [TEST_PHONE])).rows[0]
    if (!u) return
    for (const t of ['sessions', 'memberships', 'candidates']) {
      await _pgPool.query(`delete from ${t} where user_id=$1`, [u.id])
    }
    await _pgPool.query('delete from users where id=$1', [u.id])
    console.log(`  (已清理往轮注册链测试用户 ${TEST_PHONE})`)
  } catch (e) {
    console.warn(`  (测试用户预清理跳过: ${e.message}，若注册断言失败请先跑 scripts/purge-test-residue.mjs)`)
  }
}

/* ── wx 运行时 mock ── */
const storage = {}
const nav = { reLaunch: [], switchTab: [], navigateTo: [], toasts: [] }

global.wx = {
  request(opts) {
    const url = opts.url.startsWith('http') ? opts.url : BASE + opts.url
    fetch(url, {
      method: opts.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, opts.header || {}),
      body: opts.data && (opts.method || 'GET') !== 'GET' && typeof opts.data === 'object'
        ? JSON.stringify(opts.data) : (opts.data || undefined),
    }).then(async (res) => {
      const text = await res.text()
      let data = null
      try { data = JSON.parse(text) } catch { data = text }
      opts.success && opts.success({ statusCode: res.status, data })
    }).catch(() => opts.fail && opts.fail(new Error('network')))
  },
  getStorageSync: (k) => (k in storage ? storage[k] : ''),
  setStorageSync: (k, v) => { storage[k] = v },
  removeStorageSync: (k) => { delete storage[k] },
  showLoading() {}, hideLoading() {},
  showToast(o) { nav.toasts.push(o && o.title) },
  switchTab(o) { nav.switchTab.push(o && o.url) },
  reLaunch(o) { nav.reLaunch.push(o && o.url) },
  navigateTo(o) { nav.navigateTo.push(o && o.url) },
}

/* ── App / Page 捕获（微信框架行为仿真）── */
let appOptions = null
let appInstance = null
global.App = (opts) => { appOptions = opts }
global.Page = () => { /* 页面类由测试手动实例化 */ }
global.getCurrentPages = () => []
global.getApp = () => {
  if (!appInstance) {
    appInstance = Object.create(appOptions)
    appInstance.globalData = JSON.parse(JSON.stringify(appOptions.globalData || {}))
  }
  return appInstance
}

/* ── 从小程序目录加载真实模块 ── */
const mpRequire = Module.createRequire(path.join(MP, 'main.js'))
/* 先取 Page 注册表：把全局 Page 改造成可捕获 */
const pageRegistry = {}
global.Page = (opts) => { pageRegistry.__last = opts; return opts }

/* 实例化一个页面对象（setData 合并 + 事件处理方法） */
function makePage(opts) {
  const page = Object.create(opts)
  page.data = JSON.parse(JSON.stringify(opts.data || {}))
  page.setData = function (patch) { Object.assign(this.data, patch || {}) }
  return page
}

const pathLogin = path.join(MP, 'pages/login/login.js')
const pathHome = path.join(MP, 'pages/home/home.js')
require(path.join(MP, 'app.js')) // App() 注册 appOptions

let pass = 0, fail = 0
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* 清 storage + 重建 app 实例（模拟冷启动到登录页） */
function coldStart() {
  for (const k of Object.keys(storage)) delete storage[k]
  nav.reLaunch.length = 0; nav.switchTab.length = 0; nav.toasts.length = 0
  appInstance = null
  const app = getApp()
  app.globalData = JSON.parse(JSON.stringify(appOptions.globalData || {}))
  return app
}

async function runAccount(label, phone, expectOrgName) {
  console.log(`\n──── ${label} (${phone}) ────`)
  const app = coldStart()

  /* 1. 登录页 onLoad：拉组织列表 */
  delete require.cache[pathLogin]
  require(pathLogin)
  const loginPage = makePage(pageRegistry.__last)
  loginPage.onLoad()
  await sleep(1500)
  ok('onLoad 拉到组织列表（含' + expectOrgName + '）', loginPage.data.orgs.length > 0 && loginPage.data.orgs.some((o) => o.name === expectOrgName),
    { count: loginPage.data.orgs.length, names: loginPage.data.orgs.map((o) => o.name) })

  /* 2. 模拟用户在演示直通 picker 里选中该账号 */
  const idx = loginPage.data.demoLabels.findIndex(() => true) // 由调用方指定 phone 语义：直接走 submit 链
  const acc = (loginPage.data.demoLabels.length ? DEMO_PHONES[phone] : null)
  // 直接设置表单后调 submit（与 onDemoPick 内部路径一致：填 orgIndex/phone/password 后 submit）
  const orgIndex = loginPage.data.orgs.findIndex((o) => o.name === expectOrgName)
  loginPage.setData({ orgIndex, phone, password: '123456', error: '' })
  await loginPage.submit()
  await sleep(2500) // _enter: app.login + serverLogin(syncAll 真实拉全量)

  /* 3. 断言登录会话链（R-21 核心） */
  ok('globalData.orgId 已设为真实归属地 UUID（六页守卫放行前提）', !!app.globalData.orgId && app.globalData.orgId.length === 36, { orgId: app.globalData.orgId })
  ok('globalData.account/roleKey 就位', !!app.globalData.account && app.globalData.roleKey === 'candidate', { role: app.globalData.roleKey })
  const binding = storage.electionLoginBinding
  ok('binding.orgId 非空（冷启动可恢复会话）', !!(binding && binding.orgId && binding.orgId.length === 36), binding)
  const mpAuth = storage.mpAuth
  ok('mpAuth.orgId 非空（serverLogin 存对归属地）', !!(mpAuth && mpAuth.orgId && mpAuth.orgId.length === 36), { orgId: mpAuth && mpAuth.orgId, orgName: mpAuth && mpAuth.orgName })
  ok('switchTab 已进 home（未被踢回）', nav.switchTab.includes('/pages/home/home') && !nav.reLaunch.includes('/pages/login/login'),
    { switchTab: nav.switchTab, reLaunch: nav.reLaunch })

  /* 4. home 页 onShow → syncAll → refresh（真实消费链） */
  delete require.cache[pathHome]
  require(pathHome)
  const homePage = makePage(pageRegistry.__last)
  homePage.onShow()
  await sleep(3000)
  ok('home.refresh 未触发 reLaunch 踢回登录页', !nav.reLaunch.includes('/pages/login/login'), nav.reLaunch)
  ok('home.orgName 渲染 = ' + expectOrgName, homePage.data.orgName === expectOrgName, { orgName: homePage.data.orgName })
  ok('home.electionName/进度渲染非空', !!homePage.data.electionName && homePage.data.progressDone >= 0,
    { electionName: homePage.data.electionName, done: homePage.data.progressDone })
  ok('home 走马灯有内容（公告链）', typeof homePage.data.marqueeText === 'string' && homePage.data.marqueeText.length > 0, homePage.data.marqueeText)
  return { app, homePage }
}

/* phone → 组织名（演示直通表口径） */
const DEMO_PHONES = {
  '13800000004': '演示村', '13800000005': '演示村',
  '13800000014': '演示社区', '13800000015': '演示社区',
}
let DEMO_PHONES_REF = DEMO_PHONES

;(async () => {
  console.log('════ R-21 小程序登录全链仿真（mock wx + 真实后端 3100）════')

  /* 村账号 04（自荐参选 · 陈大明） */
  const r04 = await runAccount('演示村 · 陈大明', '13800000004', '演示村')

  /* 村社数据隔离：04 的公告应来自演示村 */
  const annsVillage = r04.homePage.data.latestAnns
  ok('村账号公告数据就位', Array.isArray(annsVillage), annsVillage && annsVillage.map((a) => a.title))

  /* 社区账号 14（自荐参选 · 刘美丽） */
  const r14 = await runAccount('演示社区 · 刘美丽', '13800000014', '演示社区')
  ok('村社账号 orgName 互异（隔离有效）', r04.homePage.data.orgName !== r14.homePage.data.orgName,
    { 村: r04.homePage.data.orgName, 社区: r14.homePage.data.orgName })
  ok('社区账号与村账号 electionId 不同（各自封地）', r04.app.globalData.electionId !== r14.app.globalData.electionId,
    { 村: r04.app.globalData.electionId, 社区: r14.app.globalData.electionId })

  /* 其余两个演示账号（05 组织推荐 · 王建国 / 15 组织推荐 · 吴志强） */
  await runAccount('演示村 · 王建国', '13800000005', '演示村')
  await runAccount('演示社区 · 吴志强', '13800000015', '演示社区')

  /* 注册链路（新参选用户，走 register() → 自动登录 → _enter 同一修复点）
     幂等保障：注册前预清理往轮残留用户 */
  console.log(`\n──── 注册链路（新手机号 ${TEST_PHONE} · 演示村）────`)
  await purgeRegisterTestUser()
  {
    const app = coldStart()
    delete require.cache[pathLogin]
    require(pathLogin)
    const loginPage = makePage(pageRegistry.__last)
    loginPage.onLoad()
    await sleep(1500)
    const orgIndex = loginPage.data.orgs.findIndex((o) => o.name === '演示村')
    loginPage.setData({ orgIndex, phone: TEST_PHONE, password: '123456', error: '' })
    await loginPage.register()
    await sleep(3000)
    ok('注册→自动登录后 globalData.orgId 就位', !!app.globalData.orgId && app.globalData.orgId.length === 36, { orgId: app.globalData.orgId })
    ok('注册链未被踢回登录页', !nav.reLaunch.includes('/pages/login/login'), nav.reLaunch)
    ok('注册 toast=注册成功', nav.toasts.includes('注册成功'), nav.toasts)
  }

  /* 事后清理：注册链产生的测试用户当场删除，演示库零残留 */
  await purgeRegisterTestUser()
  if (_pgPool) await _pgPool.end().catch(() => {})

  console.log(`\n════ 结果: ${pass} 通过 / ${fail} 失败 ════`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error('脚本异常:', e); process.exit(1) })
