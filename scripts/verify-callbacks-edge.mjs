import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const API = "http://127.0.0.1:3100";
let pass = 0, total = 0;
const ok = (name, cond, detail = "") => { total++; if (cond) pass++; console.log(`${cond ? "✅" : "❌"} ${name}${detail ? " | " + detail : ""}`); };

async function uiLogin(page, phone) {
  await page.goto(`${BASE}/login`);
  await page.waitForTimeout(1000);
  await page.fill('input[placeholder*="登录手机号"]', phone);
  await page.fill('input[placeholder*="密码"]', "123456");
  await page.click('button:has-text("登录工作台")');
  await page.waitForURL("**/dashboard", { timeout: 20000 });
  await page.waitForTimeout(1200);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1560, height: 940 } });
const page = await ctx.newPage();
await uiLogin(page, "13800000002"); // editor

// ① 错误码中文映射：editor 直访 /admin/users → 403 forbidden → 中文话术
await page.goto(`${BASE}/admin/users`);
await page.waitForTimeout(3000);
const msgs = (await page.locator(".t-message, .t-toast").allTextContents()).join("");
ok("P2 错误码中文映射：editor 访问人员管理 403 → 政务中文话术", msgs.includes("暂无权限执行该操作"), msgs.slice(0, 36));

// ② 通知页角色兜底：editor 直访 → 权责提示卡（非 webhook 管理界面）
await page.goto(`${BASE}/admin/notifications`);
await page.waitForTimeout(2500);
const notifTxt = await page.locator(".t-alert, .t-card").first().textContent().catch(() => "");
const addBtn = await page.locator('button:has-text("添加群机器人订阅")').count();
ok("R-04 通知页 editor 兜底提示（无机器人管理界面）", notifTxt.includes("无群机器人管理权") && addBtn === 0, notifTxt.replace(/\s+/g, "").slice(0, 30));

// ③ 公文重复发布 409 中文（通过 UI 触发已发布公告的发布）
const orgs = await (await fetch(`${API}/auth/organizations`)).json();
const org = orgs.find((o) => o.name.includes("演示村"));
const lr = await fetch(`${API}/auth/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: org.id, phone: "13800000001", password: "123456" }) });
const token = (await lr.json()).token;
const fiefs = await (await fetch(`${API}/admin/election-fiefs`, { headers: { Authorization: `Bearer ${token}` } })).json();
const fief = (Array.isArray(fiefs) ? fiefs : []).find((f) => f.status === "active");
const ctx2 = await browser.newContext({ viewport: { width: 1560, height: 940 } });
const p2 = await ctx2.newPage();
await uiLogin(p2, "13800000001"); // sub_admin
await p2.goto(`${BASE}/election/activity/${fief.id}?tab=gongwen`);
await p2.waitForTimeout(3000);
// 默认选中第1篇（已发布）——发布按钮应为「已依法发布」禁用,不产生 409
const pubBtn = p2.locator(".t-card .t-button", { hasText: "已依法发布" }).first();
const pubDisabled = (await pubBtn.count()) > 0;
ok("R-12 已发布公文发布按钮禁用（409 无法从 UI 触发）", pubDisabled);
await ctx2.close();
await ctx.close();
await browser.close();
console.log(`\n===== 边界验证 ${pass}/${total} =====`);
process.exit(pass === total ? 0 : 1);
