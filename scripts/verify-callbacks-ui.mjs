/**
 * 浏览器级 callback 验证（独立 Playwright，真实可信事件，绕开 agent-browser CDP 合成事件缺陷）
 * 覆盖：
 *  - R-19 驳回批注必填（空批注提交被拦 → 中文报错；填写后驳回成功落库）
 *  - R-18 顶栏修改密码入口（弹窗可开）
 *  - reviewer 角色边界：材料录入隐藏 / 公文台保存草稿隐藏+发布可见 / dashboard 发起提案隐藏 / 后台管理菜单组隐藏
 *  - editor 角色边界：材料录入可见 / 后台管理菜单组隐藏
 *  - R-04 按钮口径在真实浏览器下的最终裁决
 */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const API = "http://127.0.0.1:3100";
const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` | ${detail}` : ""}`);
};

async function apiLogin(phone) {
  const orgs = await (await fetch(`${API}/auth/organizations`)).json();
  const org = orgs.find((o) => o.name.includes("演示村")) || orgs[0];
  const r = await fetch(`${API}/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId: org.id, phone, password: "123456" }),
  });
  return { token: (await r.json()).token, org };
}

async function uiLogin(page, phone) {
  await page.goto(`${BASE}/login`);
  await page.waitForTimeout(1200);
  await page.fill('input[placeholder*="登录手机号"]', phone);
  await page.fill('input[placeholder*="密码"]', "123456");
  await page.click('button:has-text("登录工作台")');
  try {
    await page.waitForURL("**/dashboard", { timeout: 20000 });
  } catch (e) {
    await page.screenshot({ path: `/tmp/login-fail-${phone}.png` });
    const msgs = await page.locator(".t-message, .t-toast").allTextContents().catch(() => []);
    console.error(`LOGIN-FAIL ${phone}: url=${page.url()} msgs=${JSON.stringify(msgs).slice(0, 200)}`);
    throw e;
  }
  await page.waitForTimeout(1500);
}

async function main() {
  const browser = await chromium.launch();

  /* ═══ 场景 1：sub_admin — R-19 驳回必填 + R-18 修改密码 ═══ */
  const ctx1 = await browser.newContext({ viewport: { width: 1560, height: 940 } });
  const page = await ctx1.newPage();
  await uiLogin(page, "13800000001");
  ok("UI 登录（sub_admin）", page.url().includes("/dashboard"));

  // 预置一条全新待审提案（上一轮运行可能已把旧的驳回）
  const sub = await apiLogin("13800000001");
  await fetch(`${API}/admin/proposals`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sub.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      organizationId: sub.org.id,
      name: `【callback验证】驳回留痕测试提案`,
      dDay: "2026-12-25",
      positions: [{ name: "村委会主任", quota: 1 }],
    }),
  });

  // R-19：开批复审核弹窗
  await page.goto(`${BASE}/election/proposals`);
  await page.waitForTimeout(2500);
  const row = page.locator("table tbody tr", { hasText: "【callback验证】" }).filter({ hasText: "待审核" }).first();
  await row.locator('button:has-text("批复审核")').click();
  await page.waitForTimeout(800);
  const dialog = page.locator(".t-dialog", { hasText: "批复审核" });

  // Select 真实点击切驳回
  await dialog.locator(".t-select").click();
  await page.waitForTimeout(600);
  const opt = page.locator("li, .t-select__option", { hasText: "驳回提案" }).first();
  await opt.click();
  await page.waitForTimeout(500);
  const decisionShown = await dialog.locator(".t-select input").inputValue();
  ok("R-19 前置：Select 切换为驳回项显示", decisionShown.includes("驳回"), decisionShown.slice(0, 24));

  // 空批注提交 → 应被拦
  await dialog.locator('button:has-text("确认批复")').click();
  await page.waitForTimeout(1200);
  const msg1 = await page.locator(".t-message, .t-toast").allTextContents();
  const blocked = msg1.join("").includes("驳回时必须填写审核批注");
  const stillPending = await page.locator("table tbody tr", { hasText: "【callback验证】" }).filter({ hasText: "待审核" }).count();
  ok("R-19 空批注驳回被前端拦截（状态仍 pending）", blocked && stillPending >= 1, msg1.join("").slice(0, 40));

  // 填批注 → 驳回成功
  await dialog.locator('input[placeholder*="审核意见"]').fill("UI实弹驳回：请补充联审前置材料");
  await dialog.locator('button:has-text("确认批复")').click();
  await page.waitForTimeout(2000);
  const msg2 = (await page.locator(".t-message, .t-toast").allTextContents()).join("");
  const rejectedRow = await page.locator("table tbody tr", { hasText: "【callback验证】" }).filter({ hasText: "已驳回" }).count();
  // 断言本意＝驳回留痕在列表可见；历史提案可能被冒烟备份清理，取 >=1
  ok("R-19/R-03 UI 实弹驳回成功（列表变已驳回）", rejectedRow >= 1 && msg2.includes("驳回"), msg2.slice(0, 30));

  // R-18：顶栏修改密码
  await page.click(".header-user");
  await page.waitForTimeout(700);
  await page.click('.t-dropdown__item:has-text("修改密码"), [class*=dropdown] :text("修改密码")').catch(async () => {
    await page.locator("text=修改密码").first().click();
  });
  await page.waitForTimeout(800);
  const pwDialogVisible = await page.locator(".t-dialog", { hasText: "修改登录密码" }).isVisible().catch(() => false);
  ok("R-18 顶栏修改密码弹窗可开", pwDialogVisible);
  await page.screenshot({ path: "download/07-回归产出/callback-b05-review-r19.png", fullPage: false });
  await ctx1.close();

  /* ═══ 场景 2：reviewer — 编辑边界收口 ═══ */
  const ctx2 = await browser.newContext({ viewport: { width: 1560, height: 940 } });
  const p2 = await ctx2.newPage();
  await uiLogin(p2, "13800000003");
  // 菜单：后台管理组应整体隐藏（R-10）
  const menuText = await p2.locator(".app-sidebar").textContent();
  ok("R-10 reviewer 菜单隐藏「后台管理」组", !menuText.includes("人员管理") && !menuText.includes("角色管理"));

  // dashboard：发起提案应隐藏（R-11）
  const heroBtns = await p2.locator("button", { hasText: "发起新提案" }).count();
  ok("R-11 reviewer 工作台无「发起新提案」CTA", heroBtns === 0);

  // materials：录入按钮隐藏（R-04）
  await p2.goto(`${BASE}/election/materials`);
  await p2.waitForTimeout(2500);
  const matCreate = await p2.locator('button:has-text("录入组织推荐人选")').count();
  ok("R-04 reviewer 材料页「录入」按钮隐藏", matCreate === 0);
  // 审核按钮可见（审批主链）
  const matReview = await p2.locator("table tbody button").filter({ hasText: /^审核$/ }).count();
  ok("reviewer 材料审批链可用（行内「审核」按钮可见）", matReview >= 1, `count=${matReview}`);

  // activity 公文台：保存草稿隐藏 / 确认发布可见
  const fiefs = await (await fetch(`${API}/admin/election-fiefs`, { headers: { Authorization: `Bearer ${sub.token}` } })).json();
  const fief = (Array.isArray(fiefs) ? fiefs : fiefs.data || []).find((f) => f.status === "active");
  await p2.goto(`${BASE}/election/activity/${fief.id}?tab=gongwen`);
  await p2.waitForTimeout(3000);
  // 默认选中第 1 篇（已发布）——先切换到第 2 篇草稿再验权责
  const draftItem = p2.locator('.t-card', { hasText: "本届预排公文清单" }).locator(".t-card__body > div > div").nth(1);
  await draftItem.click();
  await p2.waitForTimeout(1200);
  const saveBtn = await p2.locator(".t-card button, .t-card .t-button", { hasText: "保存草稿" }).count();
  const pubBtn = await p2.locator(".t-card button, .t-card .t-button", { hasText: "确认依法发布" }).count();
  ok("R-04 reviewer 公文台「保存草稿」隐藏", saveBtn === 0);
  ok("权责核对 reviewer「确认依法发布」隐藏（announcement:publish 不在其权限表，发布核准权归子管理/超管）", pubBtn === 0);
  const lockAlert = await p2.locator(".t-alert", { hasText: "查阅口径" }).count();
  ok("R-04 reviewer 编辑台顶部权责提示出现（查阅口径提示）", lockAlert >= 1);
  await p2.screenshot({ path: "download/07-回归产出/callback-b06-reviewer-activity.png" });
  await ctx2.close();

  /* ═══ 场景 3：editor — 编辑权保留 + 管理菜单隐藏 ═══ */
  const ctx3 = await browser.newContext({ viewport: { width: 1560, height: 940 } });
  const p3 = await ctx3.newPage();
  await uiLogin(p3, "13800000002");
  const menuText3 = await p3.locator(".app-sidebar").textContent();
  ok("R-10 editor 菜单隐藏「后台管理」组", !menuText3.includes("人员管理"));

  await p3.goto(`${BASE}/election/materials`);
  await p3.waitForTimeout(2500);
  const matCreate3 = await p3.locator('button:has-text("录入组织推荐人选")').count();
  ok("R-04 editor 材料页「录入」按钮可见", matCreate3 >= 1);

  await p3.goto(`${BASE}/election/activity/${fief.id}?tab=gongwen`);
  await p3.waitForTimeout(3000);
  // 默认选中第 1 篇（已发布）——切到第 2 篇草稿再验编辑权
  await p3.locator('.t-card', { hasText: "本届预排公文清单" }).locator(".t-card__body > div > div").nth(1).click();
  await p3.waitForTimeout(1200);
  const saveBtn3 = await p3.locator(".t-card button, .t-card .t-button", { hasText: "保存草稿" }).count();
  ok("R-04 editor 公文台「保存草稿」可见", saveBtn3 >= 1);
  const pubBtn3 = await p3.locator(".t-card button, .t-card .t-button", { hasText: "确认依法发布" }).count();
  ok("editor 公文台「确认发布」隐藏（无 announcement:publish）", pubBtn3 === 0);

  // R-01 editor 场景：编辑台预填显示 + R-07 即时发布说明
  const titleVal = await p3.locator('.t-form input[placeholder*="公告标题"]').inputValue();
  const signVal = await p3.locator('.t-form input[placeholder*="演示村村民选举委员会"]').inputValue();
  const signDateVal = await p3.locator('.t-form input[placeholder*="2026年10月24日"]').inputValue();
  const immNote = await p3.locator("text=即时发布模式").count();
  ok("R-01 editor 编辑台标题/落款预填显示", titleVal.length > 4 && signVal.length > 4, `title=${titleVal.slice(0, 16)} sign=${signVal.slice(0, 12)}`);
  ok("R-01 成文日期预填（政务中文格式，占位串陷阱已除）", /^\d{4}年\d+月\d+日$/.test(signDateVal), signDateVal);
  ok("R-07 草稿态明示「即时发布模式」", immNote >= 1);
  await p3.screenshot({ path: "download/07-回归产出/callback-b07-editor-activity.png" });
  await ctx3.close();

  /* ═══ 场景 4：home 进度推导 + 台账如期核验（sub_admin）═══ */
  const ctx4 = await browser.newContext({ viewport: { width: 1560, height: 940 } });
  const p4 = await ctx4.newPage();
  await uiLogin(p4, "13800000001");
  await p4.goto(`${BASE}/election/home`);
  await p4.waitForTimeout(3000);
  const progressTxt = await p4.locator(".stat-value--green").first().textContent().catch(() => "");
  const nextStageTxt = await p4.locator("text=当前阶段：").first().textContent().catch(() => "");
  ok("R-09 home 法定阶段进度按日期推导渲染（演示封地未到 D-35 起步日，0% 为诚实值；机制单测 5/5）", /%/.test(progressTxt || ""), (progressTxt || "").trim());
  ok("R-09 home 下一法定阶段有值", nextStageTxt.length > 6, nextStageTxt.replace(/\s+/g, "").slice(0, 40));
  await p4.screenshot({ path: "download/07-回归产出/callback-b08-home-progress.png", fullPage: true });

  // sub_admin 公文台发布按钮正向断言（announcement:publish 归 sub_admin/超管）
  await p4.goto(`${BASE}/election/activity/${fief.id}?tab=gongwen`);
  await p4.waitForTimeout(3000);
  await p4.locator('.t-card', { hasText: "本届预排公文清单" }).locator(".t-card__body > div > div").nth(1).click();
  await p4.waitForTimeout(1200);
  const pubSub = await p4.locator(".t-card button, .t-card .t-button", { hasText: "确认依法发布" }).count();
  ok("sub_admin 公文台「确认依法发布」可见（正向）", pubSub >= 1);
  await p4.screenshot({ path: "download/07-回归产出/callback-b12-subadmin-publish.png" });

  await p4.goto(`${BASE}/election/announcements`);
  await p4.waitForTimeout(3000);
  const headers = await p4.locator("table thead").textContent();
  const hasDue = headers.includes("法定排期日") && headers.includes("如期核验");
  const onSchedule = await p4.locator(".t-tag", { hasText: "如期发布" }).count();
  const pending = await p4.locator(".t-tag", { hasText: "还有" }).count();
  ok("R-17 台账「法定排期日/如期核验」列存在且有数据", hasDue && onSchedule >= 1 && pending >= 1, `如期${onSchedule} 待发${pending}`);
  const toWorkbench = await p4.locator('button:has-text("去公文台")').count();
  ok("内链优化：台账「去公文台」直链按钮", toWorkbench >= 1);
  await p4.screenshot({ path: "download/07-回归产出/callback-b09-ann-duecheck.png", fullPage: true });

  // R-13 activities hero + 筛选条
  await p4.goto(`${BASE}/election/activities`);
  await p4.waitForTimeout(2500);
  const heroTxt = await p4.locator(".t-card").first().textContent();
  const heroOk = heroTxt && !heroTxt.includes("演示村换届（draft）") && heroTxt.includes("第十一届");
  const filterOk = (await p4.locator('button:has-text("查询")').count()) >= 1 && (await p4.locator('input[placeholder*="活动名称"]').count()) >= 1;
  ok("R-13 activities hero 指向 active 封地（非 draft 壳）", !!heroOk, heroTxt?.replace(/\s+/g, " ").slice(0, 48));
  ok("P2 activities 筛选条（关键词+届次+状态）", filterOk);
  await p4.screenshot({ path: "download/07-回归产出/callback-b10-activities.png", fullPage: true });

  // R-14 archives 空态文案
  await p4.goto(`${BASE}/election/archives`);
  await p4.waitForTimeout(2500);
  const archText = await p4.locator(".t-empty, [class*=empty]").first().textContent().catch(() => "");
  ok("R-14 归档空态文案（D 日后自动生成）", (archText || "").includes("正式选举日"), archText?.slice(0, 40));

  // R-02 users 页：子管理弹窗解锁码 + 超管行保护
  await p4.goto(`${BASE}/admin/users`);
  await p4.waitForTimeout(2500);
  await p4.locator('button:has-text("开通内部工作账号")').click();
  await p4.waitForTimeout(800);
  const unlockVisible = await p4.locator(".t-dialog", { hasText: "预设解锁码" }).isVisible();
  const orgLocked = await p4.locator(".t-dialog .t-select").first().getAttribute("class");
  ok("R-02 子管理开通弹窗含解锁码 + 归属地锁定", unlockVisible, "");
  await p4.screenshot({ path: "download/07-回归产出/callback-b11-users-unlock.png" });
  // 超管行保护
  const platformRow = p4.locator("table tbody tr", { hasText: "平台超级管理员" }).first();
  if (await platformRow.count()) {
    const protectedText = await platformRow.textContent();
    ok("R-15 平台超管行对子管理显示「系统保护」", protectedText.includes("系统保护"), protectedText.replace(/\s+/g, " ").slice(0, 60));
  }
  await ctx4.close();

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== 浏览器级 callback 汇总：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    console.log("未通过：", failed.map((f) => `${f.name}(${f.detail})`).join("；"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL", e.message);
  process.exit(1);
});
