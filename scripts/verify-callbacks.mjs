/**
 * callback 总验证脚本（用户铁令：必须全部能够 callback，不是玩笑）
 * 每一条修复都必须：真实请求 → 真实响应 → 落库核验 → 界面可回显
 *
 * 覆盖：
 *  - R-03 驳回批注落库（后端 1 行 + 全链回读）
 *  - R-02 子管理 preset 开通（原直建必 403 的断链修复）
 *  - 材料写链路回归（录入/两步附件/审核 PATCH）
 *  - 候选人材料附件种子补齐（P2 演示样本，真实链路上传，保留）
 *  - 公告落款保存回归
 *  - 错误码形状（供前端中文映射层消费）
 *
 * 测试产物清理：测试提案/测试账号最后由 cleanup-callback-test.mjs 精准删除
 */
const BASE = "http://127.0.0.1:3100";
const { readFileSync } = await import("node:fs");
const { createRequire } = await import("node:module");

let results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` | ${detail}` : ""}`);
};

async function login(phone) {
  const orgs = await (await fetch(`${BASE}/auth/organizations`)).json();
  const org = orgs.find((o) => o.name.includes("演示村")) || orgs[0];
  const r = await fetch(`${BASE}/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId: org.id, phone, password: "123456" }),
  });
  const j = await r.json();
  return { token: j.token, org, user: j };
}

const j = (r) => r.json();

async function main() {
  /* ── 0. 环境 ── */
  const health = await (await fetch(`${BASE}/health`)).json();
  ok("后端健康", health.ok && health.db === "up");

  const sub = await login("13800000001"); // 子管理
  ok("子管理登录", !!sub.token, `org=${sub.org.name}`);
  const H = { Authorization: `Bearer ${sub.token}`, "Content-Type": "application/json" };

  /* ── 1. R-03 驳回批注落库（核心政务留痕链）── */
  const TEST_NAME = "【callback验证】驳回留痕测试提案";
  const createRes = await fetch(`${BASE}/admin/proposals`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      organizationId: sub.org.id,
      name: TEST_NAME,
      dDay: "2026-12-20",
      positions: [{ name: "村委会主任", quota: 1 }],
    }),
  });
  const created = await j(createRes);
  ok("R-03 前置：测试提案创建", createRes.status === 201, `id=${created.id}`);

  const REVIEW_NOTE = "驳回批注-实弹验证：岗位职数与工作方案不符，请按第11届方案修正后重报";
  const reviewRes = await fetch(`${BASE}/admin/proposals/${created.id}/review`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ decision: "rejected", note: REVIEW_NOTE }),
  });
  const reviewed = await j(reviewRes);
  ok(
    "R-03 驳回批注落库（reject_reason 写入）",
    reviewRes.status === 200 && reviewed.reject_reason === REVIEW_NOTE,
    `reject_reason=${JSON.stringify(reviewed.reject_reason)?.slice(0, 40)}…`,
  );

  const listAfter = await (await fetch(`${BASE}/admin/proposals`, { headers: H })).json();
  const row = (Array.isArray(listAfter) ? listAfter : listAfter.data || []).find((p) => p.id === created.id);
  ok(
    "R-03 列表回读三要素齐全",
    row && row.status === "rejected" && row.reject_reason === REVIEW_NOTE && !!row.reviewed_by && !!row.reviewed_at,
    `status=${row?.status} reviewed_by=${(row?.reviewed_by || "").slice(0, 8)}… reviewed_at=${row?.reviewed_at}`,
  );

  // R-16 数据前提：同名返修版（pending）——供浏览器轮验证「返修版」Tag
  const resubmitRes = await fetch(`${BASE}/admin/proposals`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      organizationId: sub.org.id,
      name: TEST_NAME,
      dDay: "2026-12-25",
      positions: [{ name: "村委会主任", quota: 1 }],
    }),
  });
  ok("R-16 数据前提：同名返修版提案（pending）", resubmitRes.status === 201);

  /* ── 2. R-02 子管理开通职能（preset 双轨）── */
  const TEST_PHONE = `1390000${String(Date.now()).slice(-4)}`; // 每次唯一，幂等可重跑
  const direct = await fetch(`${BASE}/admin/accounts`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      phone: TEST_PHONE,
      displayName: "callback测试",
      organizationId: sub.org.id,
      role: "editor",
    }),
  });
  ok("R-02 错位确认：直建对子管理仍 403（后端守卫未动）", direct.status === 403, (await direct.json()).error);

  const presetRes = await fetch(`${BASE}/admin/accounts/preset`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      unlockCode: "123456",
      orgId: sub.org.id,
      accounts: [{ phone: TEST_PHONE, name: "callback测试账号", roleKey: "editor" }],
    }),
  });
  const preset = await j(presetRes);
  const pdata = preset.data || preset;
  ok(
    "R-02 子管理 preset 开通成功（真实 callback，created/upsert 均算通）",
    presetRes.status === 200 && ((pdata.created || []).includes(TEST_PHONE) || (pdata.updated || []).includes(TEST_PHONE)),
    `created=${JSON.stringify(pdata.created)} updated=${JSON.stringify(pdata.updated)} org=${pdata.orgName}`,
  );

  const badCode = await fetch(`${BASE}/admin/accounts/preset`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      unlockCode: "000000",
      orgId: sub.org.id,
      accounts: [{ phone: "13900000098", roleKey: "editor" }],
    }),
  });
  ok("R-02 解锁码校验真实生效（错码 403）", badCode.status === 403, (await badCode.json()).error);

  /* ── 3. 材料写链路回归（录入 → 两步附件 → 审核 PATCH）── */
  const fiefsRaw = await (await fetch(`${BASE}/admin/election-fiefs`, { headers: H })).json();
  const fiefs = Array.isArray(fiefsRaw) ? fiefsRaw : fiefsRaw.data || [];
  const fief = fiefs.find((f) => f.status === "active") || fiefs.at(-1);
  ok("取得 active 封地", !!fief, `${fief?.name} D=${fief?.d_day}`);

  const matRes = await fetch(`${BASE}/admin/materials`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      electionFiefId: fief.id,
      phone: "13700000077",
      name: "callback材料回归",
      title: "组织推荐-callback回归验证",
      description: "实弹验证材料录入链路",
    }),
  });
  const mat = await j(matRes);
  ok("材料录入回归（POST {phone,name}）", matRes.status === 201, `id=${mat.id}`);

  // 两步附件：/files/upload multipart → JSON 关联
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from("callback 两步链附件验证 " + Date.now())], { type: "text/plain" }), "callback-附件.txt");
  const upRes = await fetch(`${BASE}/files/upload`, { method: "POST", headers: { Authorization: `Bearer ${sub.token}` }, body: fd });
  const up = await j(upRes);
  ok("附件物理上传（/files/upload）", upRes.status === 200 || upRes.status === 201, `storageKey=${(up.storageKey || up.storage_key || "").slice(0, 40)}`);

  const attachRes = await fetch(`${BASE}/admin/materials/${mat.id}/file`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      storageKey: up.storageKey || up.storage_key,
      fileName: "callback-附件.txt",
      mimeType: "text/plain",
      sizeBytes: 32,
    }),
  });
  ok("附件 JSON 关联（/admin/materials/:id/file）", attachRes.status === 201, JSON.stringify(await attachRes.json()).slice(0, 80));

  const revRes = await fetch(`${BASE}/admin/materials/${mat.id}/review`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ status: "approved", note: "callback 回归审核通过" }),
  });
  const rev = await j(revRes);
  ok("材料审核 PATCH 回归", revRes.status === 200 && rev.status === "approved", `status=${rev.status}`);

  /* ── 4. 候选人材料附件种子（P2 演示样本，真实链路，保留不清理）── */
  const matsResp = await (await fetch(`${BASE}/admin/materials?electionFiefId=${fief.id}`, { headers: H })).json();
  const matsAll = Array.isArray(matsResp) ? matsResp : matsResp.data || [];
  const candListRaw = await (await fetch(`${BASE}/api/candidates?electionId=${fief.id}`, { headers: H })).json();
  const cands = Array.isArray(candListRaw) ? candListRaw : candListRaw.data || [];
  const seedTargets = [];
  for (const c of cands.slice(0, 2)) {
    const matIds = (c.materials || []).map((m) => m.id);
    for (const mid of matIds.slice(0, 1)) {
      // 检查是否已有附件
      const mrow = matsAll.find((m) => m.id === mid);
      const existing = mrow?.files?.length || (c.materials.find((m) => m.id === mid)?.files?.length ?? 0);
      if (existing > 0) continue;
      const f2 = new FormData();
      f2.append("file", new Blob([Buffer.from(`候选人参选资格附件-${c.candName}-${Date.now()}`)], { type: "text/plain" }), `资格审查材料-${c.candName || "候选人"}.txt`);
      const up2 = await (await fetch(`${BASE}/files/upload`, { method: "POST", headers: { Authorization: `Bearer ${sub.token}` }, body: f2 })).json();
      const a2 = await fetch(`${BASE}/admin/materials/${mid}/file`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ storageKey: up2.storageKey || up2.storage_key, fileName: `资格审查材料-${c.candName || "候选人"}.txt`, mimeType: "text/plain", sizeBytes: 48 }),
      });
      seedTargets.push({ candidate: c.candName, materialId: mid, status: a2.status });
    }
  }
  const allCandsHaveFiles = cands.length > 0 && cands.every((c) => (c.materials || []).some((m) => (m.files || []).length > 0));
  ok(
    "候选人附件样本（真实链路上传；已全部有附件亦算通过）",
    (seedTargets.length > 0 && seedTargets.every((s) => s.status === 201)) || allCandsHaveFiles,
    `本次新增=${JSON.stringify(seedTargets)} 全员已有附件=${allCandsHaveFiles}`,
  );

  /* ── 5. 公告落款保存回归 ── */
  const annsRaw = await (await fetch(`${BASE}/admin/announcements?electionFiefId=${fief.id}`, { headers: H })).json();
  const anns = Array.isArray(annsRaw) ? annsRaw : annsRaw.data || [];
  const draftAnn = anns.find((a) => a.status === "draft");
  if (draftAnn) {
    const patch = await fetch(`${BASE}/admin/announcements/${draftAnn.id}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ sign: "演示村村民选举委员会", signDate: "2026年9月6日" }),
    });
    const patched = await j(patch);
    ok("公告落款 PATCH 回归（sign/signDate 落库）", patch.status === 200 && patched.ann_sign === "演示村村民选举委员会", `ann_sign=${patched.ann_sign} ann_sign_date=${patched.ann_sign_date}`);
    // 还原 signDate 为空（避免污染演示数据），保留 sign 默认
    await fetch(`${BASE}/admin/announcements/${draftAnn.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ sign: draftAnn.ann_sign || "演示村村民选举委员会", signDate: draftAnn.ann_sign_date || "" }) });
  } else {
    ok("公告落款 PATCH 回归（无草稿可测，跳过）", true, "无 draft 公告");
  }

  /* ── 6. 错误码形状（前端中文映射消费源）── */
  const pub409 = anns.find((a) => a.status === "published");
  if (pub409) {
    const republish = await fetch(`${BASE}/admin/announcements/${pub409.id}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sub.token}` },
    });
    const body = await republish.json();
    ok("错误码形状：重复发布 → 409 announcement_already_published（映射层消费）", republish.status === 409 && body.error === "announcement_already_published", body.error);
  }

  /* ── 汇总 ── */
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== callback 验证汇总：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    console.log("未通过项：", failed.map((f) => f.name).join("；"));
    process.exit(1);
  }
  // 把测试产物 id 落盘供清理脚本
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    "/home/z/my-project/scripts/db-backups/callback-test-artifacts.json",
    JSON.stringify(
      {
        proposalIds: [created.id, (await j(resubmitRes)).id],
        testAccountPhones: [TEST_PHONE, "13900000099"],
        smokeMaterial: { id: mat.id, phone: "13700000077" },
      },
      null,
      2,
    ),
  );
  console.log("测试产物已记录 → scripts/db-backups/callback-test-artifacts.json（浏览器轮后统一清理）");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
