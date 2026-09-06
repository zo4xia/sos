/**
 * 演示社区演示链种子（全真实 API，幂等可复跑）
 * 镜像演示村结构：提案→批复(自动初始化 pipeline)→参选用户注册→材料两条链→审核入池→公告落款发布
 * 参选用户：13800000014 刘美丽(自荐) / 13800000015 吴志强(组织推荐)
 */
const API = "http://127.0.0.1:3100";
const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` | ${detail}` : ""}`);
};

const j = async (method, path, body, token) => {
  const r = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
};

async function adminLogin(phone, orgId) {
  const r = await j("POST", "/auth/admin/login", { organizationId: orgId, phone, password: "123456" });
  return r.data?.token;
}
async function candLogin(phone, orgId) {
  const r = await j("POST", "/auth/candidate/login", { phone, password: "123456", organizationId: orgId });
  return r.data?.token;
}

const C14 = { phone: "13800000014", displayName: "刘美丽 (自荐参选人)" };
const C15 = { phone: "13800000015", displayName: "吴志强 (组织推荐参选人)" };

(async () => {
  /* 0) 组织定位 */
  const orgs = await (await fetch(`${API}/auth/organizations`)).json();
  const com = orgs.find((o) => o.name.includes("演示社区"));
  if (!com) { console.error("找不到演示社区组织"); process.exit(1); }
  console.log("演示社区:", com.id);

  const sub11 = await adminLogin("13800000011", com.id);
  const ed12 = await adminLogin("13800000012", com.id);
  const rv13 = await adminLogin("13800000013", com.id);
  ok("三后台账号登录(11子管理/12编辑/13审核)", !!(sub11 && ed12 && rv13));

  /* 1) 提案（幂等：已有 approved 提案则跳过） */
  const props = (await j("GET", "/admin/proposals", null, sub11)).data || [];
  let prop = props.find((p) => p.organization_id === com.id && p.status === "approved");
  if (!prop) {
    const created = await j("POST", "/admin/proposals", {
      organizationId: com.id,
      name: "演示社区2026年第十一届居民委员会换届选举提案",
      dDay: "2026-12-27",
      positions: [
        { name: "居委会主任", quota: 1 },
        { name: "居委会副主任", quota: 1 },
        { name: "居委会委员", quota: 3 },
      ],
    }, ed12);
    ok("编辑12发起社区提案", created.status === 201, JSON.stringify(created.data).slice(0, 80));
    const pid = created.data?.id;
    const review = await j("POST", `/admin/proposals/${pid}/review`, {
      decision: "approved",
      note: "经社区党工委研究同意，按程序启动第十一届居委会换届选举",
    }, rv13);
    ok("审核13批复通过（自动初始化 pipeline）", [200, 201, 204].includes(review.status), `status=${review.status}`);
    prop = { id: pid };
  } else {
    ok("社区提案已存在（幂等跳过）", true, prop.name?.slice(0, 20));
  }

  /* 2) 定位社区 active 封地 */
  const fiefs = (await j("GET", "/admin/election-fiefs", null, sub11)).data || [];
  const fief = fiefs.find((f) => f.organization_id === com.id && f.status === "active");
  ok("社区 active 封地就位", !!fief, fief ? `${fief.name?.slice(0, 18)} D=${fief.d_day?.slice(0, 10)}` : "缺");

  /* 3) 参选用户注册（幂等：已注册则直接登录） */
  for (const c of [C14, C15]) {
    const reg = await j("POST", "/auth/register", {
      phone: c.phone, password: "123456", displayName: c.displayName, organizationId: com.id,
    });
    const tok = await candLogin(c.phone, com.id);
    ok(`参选用户 ${c.phone} ${c.displayName.slice(0, 3)}（${reg.status === 201 ? "新注册" : "已存在"}）`, !!tok, `reg=${reg.status}`);
    c.token = tok;
  }

  /* 4) 材料：幂等判断 */
  const my14 = (await j("GET", "/candidate/materials", null, C14.token)).data || [];
  let mat14 = my14.find((m) => m.election_fief_id === fief.id);
  if (!mat14) {
    // 两步链：multipart 上传 → JSON 关联
    const fd = new FormData();
    fd.append("file", new Blob(["居委会参选资格自荐材料（演示）。"], { type: "text/plain" }), "liumeili-material.txt");
    fd.append("electionFiefId", fief.id);
    fd.append("sourceType", "material");
    const up = await (await fetch(`${API}/files/upload`, { method: "POST", headers: { Authorization: `Bearer ${C14.token}` }, body: fd })).json();
    ok("刘美丽·两步链上传第一步(multipart)", !!up.storageKey, up.storageKey?.slice(0, 12));
    const post = await j("POST", "/candidate/materials", {
      electionFiefId: fief.id,
      title: "自荐参选居委会委员",
      description: "本人长期从事社区志愿服务，群众基础良好，自愿报名参选第十一届居委会委员。",
      files: [{ fileName: up.fileName, mimeType: up.mimeType, sizeBytes: up.sizeBytes, storageKey: up.storageKey }],
    }, C14.token);
    ok("刘美丽·自荐材料提交(候选端链路)", post.status === 201, `status=${post.status}`);
    mat14 = post.data;
  } else {
    ok("刘美丽·材料已存在（幂等跳过）", true, mat14.title?.slice(0, 16));
  }

  // 吴志强：编辑12代建组织推荐（幂等：按手机号查已有）
  const allMats = (await j("GET", "/admin/materials?electionFiefId=" + fief.id, null, ed12)).data || [];
  let mat15 = allMats.find((m) => (m.submitter_phone || m.phone) === C15.phone || (m.title || "").includes("吴志强"));
  if (!mat15) {
    const created = await j("POST", "/admin/materials", {
      electionFiefId: fief.id,
      phone: C15.phone,
      name: "吴志强",
      title: "【组织推荐】居委会委员候选人推荐材料",
      description: "经社区党支部研究，拟推荐该同志参选第十一届居委会委员，群众评价良好。",
    }, ed12);
    ok("编辑12·代建吴志强组织推荐材料", created.status === 201 || created.status === 200, `status=${created.status}`);
    mat15 = created.data;
  } else {
    ok("吴志强·材料已存在（幂等跳过）", true, mat15.title?.slice(0, 16));
  }

  /* 5) 审核：刘美丽材料通过 → 入候选人池 */
  if (mat14 && mat14.status !== "approved") {
    const review = await j("PATCH", `/admin/materials/${mat14.id}/review`, {
      status: "approved",
      note: "资格初审通过，未发现负面清单情形，准予参选。",
    }, rv13);
    ok("审核13·刘美丽材料批复通过（推入候选人池）", review.status === 200 || review.status === 204, `status=${review.status}`);
  } else if (mat14) {
    ok("刘美丽·材料已审核（幂等跳过）", true, `status=${mat14.status}`);
  }
  // 吴志强材料保持 submitted（演示待审流程）

  /* 6) 公告：落款 + 发布「关于确定选举日的公告」（与村庄镜像；排序不稳定故按标题定位） */
  const anns = (await j("GET", "/admin/announcements?electionFiefId=" + fief.id, null, sub11)).data || [];
  const published = anns.filter((a) => a.status === "published");
  if (published.length === 0) {
    const first = anns.find((a) => (a.title || "").includes("确定选举日")) || anns[0];
    if (first && first.status === "draft") {
      await j("PATCH", `/admin/announcements/${first.id}`, {
        sign: "演示社区居民选举委员会",
        signDate: "2026-11-12",
      }, sub11);
      const pub = await j("POST", `/admin/announcements/${first.id}/publish`, null, sub11);
      ok("子管理11·「确定选举日」公告落款并依法发布", [200, 201, 204].includes(pub.status), `status=${pub.status}`);
    } else {
      ok("社区公告发布态（无草稿可发）", true, `anns=${anns.length}`);
    }
  } else {
    ok("社区公告已发布（幂等跳过）", true, `${published.length} 篇：${published[0].title}`);
  }

  /* 7) 终态核验（候选端真实可见性，双向隔离） */
  const ann14 = (await j("GET", "/candidate/announcements", null, C14.token)).data || [];
  ok("刘美丽端·可见公告 1 篇(仅已发布)", ann14.length === 1, `n=${ann14.length}`);
  const pos14 = (await j("GET", "/candidate/positions", null, C14.token)).data || [];
  ok("刘美丽端·可见岗位 3 个", pos14.length === 3, `n=${pos14.length}`);
  const cands = (await j("GET", "/candidate/candidates?electionId=" + fief.id, null, C14.token)).data || [];
  ok("刘美丽端·候选人公示 1 人(本人已入池)", cands.length === 1 && (cands[0].display_name || "").includes("刘美丽"), `n=${cands.length} name=${cands[0]?.display_name || ""}`);
  const my15 = (await j("GET", "/candidate/materials", null, C15.token)).data || [];
  ok("吴志强端·我的提交记录 1 条(组织推荐)", my15.length === 1, `n=${my15.length}`);

  // 村社隔离：村庄候选账号仍只看到村庄数据
  const village = orgs.find((o) => o.name.includes("演示村"));
  const tok04 = await candLogin("13800000004", village.id);
  const ann04 = (await j("GET", "/candidate/announcements", null, tok04)).data || [];
  ok("隔离核验·村庄候选04公告不串社区数据", ann04.length >= 1 && !ann04.some((a) => (a.title || "").includes("社区")), `n=${ann04.length}`);

  const fail = results.filter((r) => !r.pass);
  console.log(`\n═══ 演示社区种子：${results.length - fail.length}/${results.length} 通过 ═══`);
  if (fail.length) process.exit(1);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
