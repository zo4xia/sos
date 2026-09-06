/** 探明演示库三角色走查前的数据分布（只读） */
const API = "http://127.0.0.1:3100";
async function login(phone) {
  const orgs = await (await fetch(`${API}/auth/organizations`)).json();
  const org = orgs.find((o) => o.name.includes("演示村")) || orgs[0];
  const r = await fetch(`${API}/auth/admin/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId: org.id, phone, password: "123456" }),
  });
  const j = await r.json();
  return j.token;
}
const token = await login("13800000001");
const H = { Authorization: `Bearer ${token}` };
const fiefs = await (await fetch(`${API}/admin/election-fiefs`, { headers: H })).json();
const fl = Array.isArray(fiefs) ? fiefs : fiefs.data || [];
const active = fl.find((f) => f.status === "active") || fl[0];
console.log("fiefs:", fl.map((f) => `${f.id.slice(0, 8)}:${f.status}`).join(" | "));
const props = await (await fetch(`${API}/admin/proposals`, { headers: H })).json();
console.log("proposals:", (props.data || props).map((p) => `${p.name.slice(0, 10)}:${p.status}`).join(" | "));
const mats = await (await fetch(`${API}/admin/materials`, { headers: H })).json();
console.log("materials:", (mats.data || mats).map((m) => `${(m.title || "").slice(0, 8)}:${m.status}`).join(" | "));
const cands = await (await fetch(`${API}/api/candidates?electionId=${active.id}`, { headers: H })).json();
console.log("candidates(active fief):", (cands.data || cands).map((c) => `${c.candName}:${c.candStatus}:${c.candCurrentRound}`).join(" | "));
const anns = await (await fetch(`${API}/admin/announcements?electionFiefId=${active.id}`, { headers: H })).json();
const al = anns.data || anns;
console.log("anns(active fief):", al.length, "| draft:", al.filter((a) => a.status === "draft").length, "| published:", al.filter((a) => a.status === "published").length);
