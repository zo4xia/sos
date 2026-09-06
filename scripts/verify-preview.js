// 预览域名端到端实测：模拟用户浏览器访问 preview-chat-*.space-z.ai
const { chromium } = require('playwright');

const PV = 'https://preview-chat-345a35d2-457a-495f-8442-82af218c59b1.space-z.ai';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  const failedReqs = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 200)));
  page.on('requestfailed', (r) => failedReqs.push(`${r.method()} ${r.url().slice(0, 120)} :: ${r.failure()?.errorText}`));

  console.log('1) 根路径（用户点预览的入口）');
  await page.goto(`${PV}/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);
  console.log(`   URL: ${page.url()}`);
  await page.screenshot({ path: 'download/07-回归产出/preview-01-root.png' });

  console.log('2) 登录页渲染（含样式/图标完整性）');
  await page.goto(`${PV}/login`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2500);
  const hasBrand = await page.locator('text=城厢区村居换届选举').count();
  const hasDemoSelect = await page.locator('.login-demo-direct').count();
  const cssLoaded = await page.evaluate(() => {
    // 样式实际生效判定：登录卡片宽度非零且有背景
    const card = document.querySelector('.login-card');
    if (!card) return 'no-card';
    const cs = getComputedStyle(card);
    return `w=${Math.round(card.getBoundingClientRect().width)} bg=${cs.backgroundColor}`;
  });
  console.log(`   品牌标题: ${hasBrand > 0 ? '✅' : '❌'} | 演示直通区: ${hasDemoSelect > 0 ? '✅' : '❌'} | 卡片样式: ${cssLoaded}`);
  await page.screenshot({ path: 'download/07-回归产出/preview-02-login.png' });

  console.log('3) 快捷登录（演示社区子管理）');
  await page.locator('.login-demo-direct .t-select').first().click();
  await page.waitForTimeout(700);
  await page.locator('.t-select-option:has-text("演示社区 · 子管理")').first().click();
  await page.waitForURL(/\/dashboard\/?$/, { timeout: 25000 });
  await page.waitForTimeout(2500);
  const user = await page.evaluate(() => JSON.parse(localStorage.getItem('cxq_user') || '{}'));
  console.log(`   登录: role=${user.role} org=${user.orgName} URL=${page.url()}`);
  const todoTxt = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 150);
  console.log(`   dashboard: ${todoTxt}`);
  await page.screenshot({ path: 'download/07-回归产出/preview-03-dashboard.png' });

  console.log('\n=== 控制台错误 ===');
  errors.length ? errors.slice(0, 10).forEach(e => console.log('  ' + e)) : console.log('  (无)');
  console.log('=== 失败请求 ===');
  failedReqs.length ? failedReqs.slice(0, 10).forEach(e => console.log('  ' + e)) : console.log('  (无)');

  await browser.close();
})();
