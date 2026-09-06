// 快捷登录下拉全账号实测：7 个后台演示账号逐个「选中即登录」
const { chromium } = require('playwright');

const BASE = 'http://localhost:3000';
const ACCOUNTS = [
  { label: '演示村 · 平台超管', org: '演示村', expectRole: 'platform_admin' },
  { label: '演示村 · 子管理（选委会主任）', org: '演示村', expectRole: 'sub_admin' },
  { label: '演示村 · 经办编辑', org: '演示村', expectRole: 'editor' },
  { label: '演示村 · 审核人', org: '演示村', expectRole: 'reviewer' },
  { label: '演示社区 · 子管理（选委会主任）', org: '演示社区', expectRole: 'sub_admin' },
  { label: '演示社区 · 经办编辑', org: '演示社区', expectRole: 'editor' },
  { label: '演示社区 · 审核人', org: '演示社区', expectRole: 'reviewer' },
];

(async () => {
  const browser = await chromium.launch();
  let pass = 0, fail = 0;
  for (const acc of ACCOUNTS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'load' });
      await page.waitForTimeout(1800); // 组织列表加载+默认选中
      // 打开演示直通下拉（第一个 .t-select 在 .login-demo-direct 内）
      await page.locator('.login-demo-direct .t-select').first().click();
      await page.waitForTimeout(700);
      await page.locator(`.t-select-option:has-text("${acc.label}")`).first().click();
      await page.waitForURL('**/dashboard', { timeout: 20000 });
      await page.waitForTimeout(2000);
      const user = await page.evaluate(() => JSON.parse(localStorage.getItem('cxq_user') || '{}'));
      const roleOk = user.role === acc.expectRole;
      const orgOk = (user.orgName || '') === acc.org;
      if (roleOk && orgOk) { pass++; console.log(`✅ ${acc.label} → 登录成功 role=${user.role} org=${user.orgName}`); }
      else { fail++; console.log(`❌ ${acc.label} → role=${user.role}(期望${acc.expectRole}) org=${user.orgName}(期望${acc.org})`); }
    } catch (e) {
      fail++;
      console.log(`❌ ${acc.label} → ${e.message.slice(0, 120)}`);
      await page.screenshot({ path: `/home/z/my-project/download/07-回归产出/quicklogin-fail-${Date.now()}.png` }).catch(() => {});
    }
    await ctx.close();
  }

  // 手动登录：演示社区子管理（复现用户报错的原场景）
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: 'load' });
    await page.waitForTimeout(1800);
    await page.click('label:has-text("社区")');
    await page.waitForTimeout(500);
    await page.locator('.login-card .t-select').first().click();
    await page.waitForTimeout(600);
    await page.locator('.t-select-option:has-text("演示社区")').first().click();
    await page.waitForTimeout(400);
    await page.fill('input[placeholder*="登录手机号"]', '13800000011');
    await page.fill('input[placeholder*="密码"]', '123456');
    await page.click('button:has-text("登录工作台")');
    await page.waitForURL('**/dashboard', { timeout: 20000 });
    await page.waitForTimeout(2000);
    const user = await page.evaluate(() => JSON.parse(localStorage.getItem('cxq_user') || '{}'));
    if (user.role === 'sub_admin' && user.orgName === '演示社区') { pass++; console.log('✅ 手动登录 演示社区子管理 13800000011 → 成功'); }
    else { fail++; console.log(`❌ 手动登录 → role=${user.role} org=${user.orgName}`); }
    await ctx.close();
  } catch (e) { fail++; console.log(`❌ 手动登录演示社区子管理 → ${e.message.slice(0, 120)}`); }

  // 反向验证：ZZ测试组织已不在下拉（村轨/社区轨均无测试组织）
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: 'load' });
    await page.waitForTimeout(1800);
    const zzGone = !(await page.locator('text=ZZ测试组织').count());
    if (zzGone) { pass++; console.log('✅ 登录页下拉已无「ZZ测试组织」测试残留'); }
    else { fail++; console.log('❌ 登录页仍显示 ZZ测试组织'); }
    await ctx.close();
  } catch (e) { fail++; console.log(`❌ ZZ组织检查 → ${e.message.slice(0, 100)}`); }

  console.log(`\n═══ 快捷登录实测：${pass} 通过 / ${fail} 失败 ═══`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
