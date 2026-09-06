import { chromium } from "playwright";
const BASE = "http://localhost:3000";
async function uiLogin(page, phone) {
  await page.goto(`${BASE}/login`);
  await page.waitForTimeout(1200);
  await page.fill('input[placeholder*="登录手机号"]', phone);
  await page.fill('input[placeholder*="密码"]', "123456");
  await page.click('button:has-text("登录工作台")');
  await page.waitForURL("**/dashboard", { timeout: 20000 });
  await page.waitForTimeout(3000);
}
const browser = await chromium.launch();
for (const [phone, name] of [["13800000003", "reviewer"], ["13800000002", "editor"]]) {
  const ctx = await browser.newContext({ viewport: { width: 1560, height: 940 } });
  const page = await ctx.newPage();
  await uiLogin(page, phone);
  await page.screenshot({ path: `download/07-回归产出/role-split-dash-${name}.png` });
  await ctx.close();
  console.log(`saved: role-split-dash-${name}.png`);
}
await browser.close();
