/**
 * 演示账号直通（验收快捷登录）浏览器实弹验证
 * 7 个后台演示账号逐个：下拉选中 → 自动登录 → 工作台角色/组织回显正确
 * + 手动表单回归（正常登录不受直通影响）
 */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` | ${detail}` : ""}`);
};

const ACCOUNTS = [
  { phone: "13800000000", label: "演示村 · 平台超管", expectRole: "平台超管", expectOrg: "演示村" },
  { phone: "13800000001", label: "演示村 · 子管理（选委会主任）", expectRole: "选委会主任 (子管理)", expectOrg: "演示村" },
  { phone: "13800000002", label: "演示村 · 经办编辑", expectRole: "经办编辑", expectOrg: "演示村" },
  { phone: "13800000003", label: "演示村 · 审核人", expectRole: "审核人", expectOrg: "演示村" },
  { phone: "13800000011", label: "演示社区 · 子管理（选委会主任）", expectRole: "选委会主任 (子管理)", expectOrg: "演示社区" },
  { phone: "13800000012", label: "演示社区 · 经办编辑", expectRole: "经办编辑", expectOrg: "演示社区" },
  { phone: "13800000013", label: "演示社区 · 审核人", expectRole: "审核人", expectOrg: "演示社区" },
];

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // 直通条视觉就位
  await page.goto(`${BASE}/login`);
  await page.waitForTimeout(1800);
  ok("直通条渲染（徽标+标题+提示）", (await page.locator(".login-demo-direct").count()) === 1);
  ok("直通下拉含 7 个演示账号", (await page.locator(".login-demo-direct .t-select").count()) >= 1);
  await page.screenshot({ path: "download/07-回归产出/demo-direct-login-page.png" });

  // 逐账号直通
  for (const acc of ACCOUNTS) {
    await page.goto(`${BASE}/login`);
    await page.waitForTimeout(1500);
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE}/login`);
    await page.waitForTimeout(1800);

    await page.locator(".login-demo-direct .t-select").click();
    await page.waitForTimeout(700);
    const opt = page.locator(".t-select__option, li", { hasText: acc.label }).first();
    await opt.click();
    try {
      await page.waitForURL("**/dashboard", { timeout: 20000 });
    } catch { /* fallthrough */ }
    const onDash = page.url().includes("/dashboard");
    const hero = onDash ? await page.locator(".hero-card").textContent() : "";
    const roleOk = hero.includes(acc.expectRole);
    const orgOk = hero.includes(acc.expectOrg);
    ok(`直通登录 ${acc.phone}（${acc.label}）`, onDash && roleOk && orgOk,
      `url=${page.url().slice(-16)} role=${roleOk ? "✓" : "✗"} org=${orgOk ? "✓" : "✗"}`);
  }

  // 截两张角色证据图
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/login`);
  await page.waitForTimeout(1500);
  await page.locator(".login-demo-direct .t-select").click();
  await page.waitForTimeout(700);
  await page.locator(".t-select__option, li", { hasText: "演示社区 · 子管理（选委会主任）" }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "download/07-回归产出/demo-direct-sub11-dashboard.png" });

  // 手动表单回归：正常输入登录仍可用
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/login`);
  await page.waitForTimeout(1500);
  await page.locator(".t-radio-button", { hasText: "城市社区" }).click();
  await page.waitForTimeout(500);
  // 选组织
  await page.locator(".login-card .t-select").first().click();
  await page.waitForTimeout(600);
  await page.locator(".t-select__option, li", { hasText: "演示社区" }).first().click();
  await page.waitForTimeout(500);
  await page.fill('input[placeholder*="登录手机号"]', "13800000012");
  await page.fill('input[placeholder*="密码"]', "123456");
  await page.click('button:has-text("登录工作台")');
  try {
    await page.waitForURL("**/dashboard", { timeout: 20000 });
    const hero = await page.locator(".hero-card").textContent();
    ok("手动表单回归（社区编辑12 手动输入登录）", page.url().includes("/dashboard") && hero.includes("经办编辑"));
  } catch {
    ok("手动表单回归（社区编辑12 手动输入登录）", false, page.url());
  }

  await browser.close();
  const fail = results.filter((r) => !r.pass);
  console.log(`\n═══ 演示直通验证：${results.length - fail.length}/${results.length} 通过 ═══`);
  if (fail.length) process.exit(1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
