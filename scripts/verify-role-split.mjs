/**
 * R-20 三角色权责分流实弹验证（用户裁定：审核人=提案/材料/候选人；编辑=公告/导入材料）
 * 独立 Playwright 真实事件（绕开 agent-browser CDP 合成事件缺陷），零写操作、只读走查。
 *
 * 覆盖矩阵：
 *  reviewer(13800000003)：
 *    - dashboard 待办含 提案待审批×1 / 参选材料待初审×3 / 线下联审待回填×2，且【无】法定公文待发布
 *    - 待办「前往处理」真实跳转提案页
 *    - 提案页 批复审核 可见；材料页 审核×3 可见、录入隐藏、详情弹窗无「代传附件」有「去审核批复」
 *    - 候选人页 回填审查×2 可见、描述文案「由审核人…回填留痕」
 *    - 公文台（草稿）：保存草稿隐藏 / 确认依法发布隐藏 / 新「查阅口径」Alert 出现
 *  editor(13800000002)：
 *    - dashboard 待办仅 公文待发布（无提案/材料/联审三类），「前往处理」真实跳转公文台锚点
 *    - 公文台（草稿）：保存草稿可见 / 确认依法发布隐藏 / 无查阅口径 Alert
 *    - 材料页 录入可见、审核×0；详情弹窗「代传附件」可见、无「去审核批复」
 *    - 候选人页 回填×0；提案页 发起提案可见、批复审核×0
 *  sub_admin(13800000001)：
 *    - dashboard 待办四类齐备；公文台双按钮（保存草稿+确认依法发布）齐备
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
  // 显式点选归属地下拉（.login-card 内那个；首个 .t-select 是演示直通下拉，勿碰）→ 选「演示村」
  try {
    const orgSelect = page.locator('.login-card .t-select').first();
    await orgSelect.click();
    await page.waitForTimeout(500);
    const opt = page.locator('.t-select-option:has-text("演示村")').first();
    if (await opt.count()) {
      await opt.click();
      await page.waitForTimeout(300);
    } else {
      await page.keyboard.press('Escape');
    }
  } catch { /* 下拉未开：保留默认选择（登录页已确定性默认演示村） */ }
  await page.fill('input[placeholder*="登录手机号"]', phone);
  await page.fill('input[placeholder*="密码"]', "123456");
  await page.click('button:has-text("登录工作台")');
  try {
    await page.waitForURL("**/dashboard", { timeout: 20000 });
  } catch (e) {
    await page.screenshot({ path: `/tmp/login-fail-${phone}.png` });
    throw e;
  }
  await page.waitForTimeout(2000);
}

/** 读取 dashboard 待办表格全部文本 */
async function todoText(page) {
  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(3000);
  return page.locator(".t-card", { hasText: "实时法定业务待办事项" }).textContent();
}

/** 公文台：点选第一篇草稿并等待编辑台就绪 */
async function selectDraft(page) {
  const listCard = page.locator(".t-card", { hasText: "本届预排公文清单" });
  const draftRow = listCard
    .locator(".t-card__body div > div")
    .filter({ has: page.locator('.t-tag:has-text("草稿")') })
    .first();
  await draftRow.click();
  await page.waitForTimeout(1500);
}

async function main() {
  const browser = await chromium.launch();
  const sub = await apiLogin("13800000001");
  const fiefs = await (await fetch(`${API}/admin/election-fiefs`, { headers: { Authorization: `Bearer ${sub.token}` } })).json();
  const fl = Array.isArray(fiefs) ? fiefs : fiefs.data || [];
  const activeFief = fl.find((f) => f.status === "active") || fl[0];

  /* ═══ 场景 1：reviewer ═══ */
  const ctx1 = await browser.newContext({ viewport: { width: 1560, height: 940 } });
  const p1 = await ctx1.newPage();
  await uiLogin(p1, "13800000003");

  const todo1 = await todoText(p1);
  ok("R-20 reviewer 待办含「提案待审批」", todo1.includes("提案待审批"));
  ok("R-20 reviewer 待办含「参选材料待初审」", todo1.includes("参选材料待初审"));
  ok("R-20 reviewer 待办含「线下联审待回填」", todo1.includes("线下联审待回填"));
  ok("R-20 reviewer 待办【无】「法定公文待发布」（公告=编辑的事）", !todo1.includes("法定公文待发布"));
  ok("R-20 待办卡片说明「按权责自动分流」", todo1.includes("按当前账号权责自动分流"));

  // 待办「前往处理」真实跳转（第一条=提案待审批 → /election/proposals）
  await p1.locator('table tbody tr button:has-text("前往处理")').first().click();
  await p1.waitForURL("**/election/proposals", { timeout: 10000 });
  ok("R-20 reviewer 待办「前往处理」真实跳转提案页", p1.url().includes("/election/proposals"));
  await p1.waitForTimeout(2500);
  const rvReview = await p1.locator("table tbody button").filter({ hasText: /^批复审核$/ }).count();
  ok("reviewer 提案页「批复审核」可见（pending 行）", rvReview >= 1, `count=${rvReview}`);

  // 材料页
  await p1.goto(`${BASE}/election/materials`);
  await p1.waitForTimeout(2500);
  ok("reviewer 材料页「录入组织推荐人选」隐藏", (await p1.locator('button:has-text("录入组织推荐人选")').count()) === 0);
  const rvMatReview = await p1.locator("table tbody button").filter({ hasText: /^审核$/ }).count();
  // 断言本意＝reviewer 可见行内「审核」（submitted 行数随演示数据自然变动，取 >=1 角色门禁断言）
  ok("reviewer 材料页行内「审核」可见（submitted 行）", rvMatReview >= 1, `count=${rvMatReview}`);

  // 材料详情弹窗：无代传附件、有去审核批复 —— 必须从 submitted 行打开（approved 行无批复按钮，非回归）
  const submittedRow = p1.locator("table tbody tr").filter({ has: p1.locator('button:has-text("审核")') }).first();
  await submittedRow.locator('button:has-text("查验附件")').first().click();
  await p1.waitForTimeout(1000);
  const dlg1 = p1.locator(".t-dialog", { hasText: "参选资格证明材料明细" });
  ok("reviewer 材料详情弹窗无「代传附件」区（导入=编辑的事）", !(await dlg1.textContent()).includes("代传附件"));
  ok("reviewer 材料详情弹窗「去审核批复」可见", (await dlg1.locator('button:has-text("去审核批复")').count()) >= 1);
  await p1.keyboard.press("Escape");
  await p1.waitForTimeout(600);

  // 候选人页
  await p1.goto(`${BASE}/election/candidates`);
  await p1.waitForTimeout(2500);
  const rvBackfill = await p1.locator("table tbody button").filter({ hasText: /^回填审查$/ }).count();
  // reviewing 候选数随演示数据自然变动（冒烟新增参选人），取 >=1 角色门禁断言
  ok("reviewer 候选人页「回填审查」可见（reviewing 行）", rvBackfill >= 1, `count=${rvBackfill}`);
  const candDesc = await p1.locator(".t-card", { hasText: "候选人资格联审池" }).textContent();
  ok("R-20 候选人页描述改「由审核人…回填留痕」", candDesc.includes("由审核人依法依文号回填留痕"));
  await p1.screenshot({ path: "download/07-回归产出/role-split-b01-reviewer-candidates.png" });

  // 公文台（草稿）
  await p1.goto(`${BASE}/election/activity/${activeFief.id}?tab=gongwen`);
  await p1.waitForTimeout(3000);
  await selectDraft(p1);
  ok("R-20 reviewer 公文台「保存草稿」隐藏", (await p1.locator(".t-card button, .t-card .t-button").filter({ hasText: "保存草稿" }).count()) === 0);
  ok("R-20 reviewer 公文台「确认依法发布」隐藏（发布=子管理/超管）", (await p1.locator(".t-card button, .t-card .t-button").filter({ hasText: "确认依法发布" }).count()) === 0);
  const newAlert = await p1.locator(".t-alert", { hasText: "查阅口径" }).count();
  ok("R-20 reviewer 公文台新「查阅口径」提示（指引编辑/子管理）", newAlert >= 1);
  await p1.screenshot({ path: "download/07-回归产出/role-split-b02-reviewer-activity.png" });
  await ctx1.close();

  /* ═══ 场景 2：editor ═══ */
  const ctx2 = await browser.newContext({ viewport: { width: 1560, height: 940 } });
  const p2 = await ctx2.newPage();
  await uiLogin(p2, "13800000002");

  const todo2 = await todoText(p2);
  ok("R-20 editor 待办含「法定公文待发布」", todo2.includes("法定公文待发布"));
  ok("R-20 editor 待办【无】提案/材料/联审三类（审核=审核人的事）", !todo2.includes("提案待审批") && !todo2.includes("参选材料待初审") && !todo2.includes("线下联审待回填"));

  // 待办「前往处理」真实跳转公文台锚点
  await p2.locator('table tbody tr button:has-text("前往处理")').first().click();
  try {
    await p2.waitForURL(/\/election\/activity\/.+tab=gongwen/, { timeout: 10000 });
    ok("R-20 editor 待办「前往处理」真实跳转公文台锚点", true, p2.url().slice(-40));
  } catch {
    ok("R-20 editor 待办「前往处理」真实跳转公文台锚点", false, p2.url());
  }
  await p2.waitForTimeout(3000);
  await selectDraft(p2);
  ok("R-20 editor 公文台「保存草稿」可见", (await p2.locator(".t-card button, .t-card .t-button").filter({ hasText: "保存草稿" }).count()) >= 1);
  ok("R-20 editor 公文台「确认依法发布」隐藏（无 announcement:publish）", (await p2.locator(".t-card button, .t-card .t-button").filter({ hasText: "确认依法发布" }).count()) === 0);
  ok("R-20 editor 公文台无「查阅口径」Alert（其有编辑权）", (await p2.locator(".t-alert", { hasText: "查阅口径" }).count()) === 0);
  await p2.screenshot({ path: "download/07-回归产出/role-split-b03-editor-activity.png" });

  // 材料页
  await p2.goto(`${BASE}/election/materials`);
  await p2.waitForTimeout(2500);
  ok("R-20 editor 材料页「录入组织推荐人选」可见（导入材料=编辑）", (await p2.locator('button:has-text("录入组织推荐人选")').count()) === 1);
  const edMatReview = await p2.locator("table tbody button").filter({ hasText: /^审核$/ }).count();
  ok("R-20 editor 材料页行内「审核」×0（审核=审核人的事）", edMatReview === 0, `count=${edMatReview}`);

  // 材料详情弹窗：有代传附件、无去审核批复
  await p2.locator("table tbody button").filter({ hasText: /^查验附件$/ }).first().click();
  await p2.waitForTimeout(1000);
  const dlg2 = p2.locator(".t-dialog", { hasText: "参选资格证明材料明细" });
  ok("R-20 editor 材料详情弹窗「代传附件」可见", (await dlg2.textContent()).includes("代传附件"));
  ok("R-20 editor 材料详情弹窗无「去审核批复」", (await dlg2.locator('button:has-text("去审核批复")').count()) === 0);
  await p2.keyboard.press("Escape");
  await p2.waitForTimeout(600);

  // 候选人页 + 提案页
  await p2.goto(`${BASE}/election/candidates`);
  await p2.waitForTimeout(2500);
  ok("R-20 editor 候选人页「回填审查」×0（候选人=审核人的事）", (await p2.locator("table tbody button").filter({ hasText: /^回填审查$/ }).count()) === 0);
  await p2.goto(`${BASE}/election/proposals`);
  await p2.waitForTimeout(2500);
  ok("R-20 editor 提案页「发起本届换届提案」可见", (await p2.locator('button:has-text("发起本届换届提案")').count()) >= 1);
  ok("R-20 editor 提案页「批复审核」×0", (await p2.locator("table tbody button").filter({ hasText: /^批复审核$/ }).count()) === 0);
  await p2.screenshot({ path: "download/07-回归产出/role-split-b04-editor-proposals.png" });
  await ctx2.close();

  /* ═══ 场景 3：sub_admin（全量正向） ═══ */
  const ctx3 = await browser.newContext({ viewport: { width: 1560, height: 940 } });
  const p3 = await ctx3.newPage();
  await uiLogin(p3, "13800000001");
  const todo3 = await todoText(p3);
  ok(
    "R-20 sub_admin 待办四类齐备（全权角色）",
    todo3.includes("提案待审批") && todo3.includes("参选材料待初审") && todo3.includes("线下联审待回填") && todo3.includes("法定公文待发布")
  );
  await p3.goto(`${BASE}/election/activity/${activeFief.id}?tab=gongwen`);
  await p3.waitForTimeout(3000);
  await selectDraft(p3);
  ok("R-20 sub_admin 公文台「保存草稿」可见", (await p3.locator(".t-card button, .t-card .t-button").filter({ hasText: "保存草稿" }).count()) >= 1);
  ok("R-20 sub_admin 公文台「确认依法发布」可见（发布核准权）", (await p3.locator(".t-card button, .t-card .t-button").filter({ hasText: "确认依法发布" }).count()) >= 1);
  await p3.screenshot({ path: "download/07-回归产出/role-split-b05-subadmin-activity.png" });
  await ctx3.close();

  await browser.close();

  const fail = results.filter((r) => !r.pass);
  console.log(`\n═══ R-20 权责分流验证：${results.length - fail.length}/${results.length} 通过 ═══`);
  if (fail.length) {
    console.log("失败项：");
    fail.forEach((f) => console.log(`  ❌ ${f.name} | ${f.detail}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
