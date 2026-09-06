"use client";

/**
 * D-013 隐藏解锁页：归属地账号预设 (/org-setup)
 * 仅平台超管可见；解锁码 + 归属地 + 批量预设账号（后端真实校验，非前端摆设）。
 * 结构照原版 Admin/OrgSetup 1:1 移植：解锁框 → ①选归属地 → ②批量账号行 → ③现有账号表。
 */
import React, { useEffect, useState } from "react";
import { Button, Dialog, Input, Select, Table, Tag, MessagePlugin } from "tdesign-react";
import {
  getAccounts,
  presetAccounts,
  Account,
  PresetAccountInput,
  PresetResult,
} from "@/lib/api/accounts";
import { getOrganizations, OrgItem } from "@/lib/api/auth";
import { useAuthStore } from "@/lib/stores/useAuthStore";

interface Row {
  key: number;
  name: string;
  phone: string;
  roleKey: "sub_admin" | "editor" | "reviewer";
  password: string;
}

const ROLE_OPTIONS = [
  { value: "sub_admin", label: "子管理（本村全权限）" },
  { value: "editor", label: "编辑" },
  { value: "reviewer", label: "审核员" },
];

const ROLE_TAG: Record<
  string,
  { label: string; theme: "primary" | "warning" | "success" | "default" }
> = {
  sub_admin: { label: "子管理", theme: "primary" },
  editor: { label: "编辑", theme: "warning" },
  reviewer: { label: "审核员", theme: "success" },
  candidate: { label: "参选人", theme: "default" },
};

let rowSeq = 1;

const sectionBox: React.CSSProperties = {
  background: "#fff",
  borderRadius: 6,
  padding: "20px 24px",
  marginBottom: 16,
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 15,
  marginBottom: 14,
  color: "#1d2129",
};

export default function OrgSetupPage() {
  const user = useAuthStore((s) => s.user);
  // R-02：后端 preset 守卫为 roleGuard('platform_admin','sub_admin')——前端同步开放子管理（限本 org）
  const isAdmin = user?.role === "platform_admin" || user?.role === "sub_admin";
  const isPlatform = user?.role === "platform_admin";

  const [unlocked, setUnlocked] = useState(false);
  const [unlockCode, setUnlockCode] = useState("");
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [orgId, setOrgId] = useState("");
  const [rows, setRows] = useState<Row[]>([
    { key: rowSeq++, name: "", phone: "", roleKey: "sub_admin", password: "" },
  ]);
  const [existing, setExisting] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PresetResult | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    getOrganizations()
      .then((list) => {
        setOrgs(list);
        // 子管理默认锁定本归属地（后端会拒绝跨 org 预设，前端同步锁定）
        if (!isPlatform && user?.organizationId) {
          setOrgId(user.organizationId);
          loadExisting(user.organizationId);
        }
      })
      .catch(() => MessagePlugin.error("归属地列表加载失败"));
  }, [isAdmin]);

  const loadExisting = async (oid: string) => {
    if (!oid) return;
    setLoading(true);
    try {
      const list = await getAccounts({ orgId: oid });
      setExisting(list || []);
    } catch {
      MessagePlugin.error("现有账号加载失败");
    } finally {
      setLoading(false);
    }
  };

  const onOrgChange = (v: string) => {
    setOrgId(v);
    loadExisting(v);
  };

  const addRow = () =>
    setRows((r) => [
      ...r,
      { key: rowSeq++, name: "", phone: "", roleKey: "sub_admin", password: "" },
    ]);

  const delRow = (key: number) =>
    setRows((r) => (r.length > 1 ? r.filter((x) => x.key !== key) : r));

  const updRow = (key: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const onSave = async () => {
    if (!orgId) {
      MessagePlugin.warning("请先选择归属地");
      return;
    }
    const valid = rows.filter((r) => r.phone.trim() || r.name.trim());
    if (!valid.length) {
      MessagePlugin.warning("至少填写一个账号");
      return;
    }
    for (const r of valid) {
      if (!/^1\d{10}$/.test(r.phone.trim())) {
        MessagePlugin.warning(`手机号格式不对：${r.phone || "(空)"}`);
        return;
      }
    }
    setSaving(true);
    try {
      const accounts: PresetAccountInput[] = valid.map((r) => ({
        name: r.name.trim() || undefined,
        phone: r.phone.trim(),
        roleKey: r.roleKey,
        password: r.password.trim() || undefined,
      }));
      const res = await presetAccounts({ unlockCode, orgId, accounts });
      setResult(res);
      MessagePlugin.success(
        `预设完成：新增 ${res.created.length} · 更新 ${res.updated.length} · 跳过 ${res.skipped.length}`,
      );
      setRows([{ key: rowSeq++, name: "", phone: "", roleKey: "sub_admin", password: "" }]);
      loadExisting(orgId);
    } catch (e) {
      const err = e as { message?: string; data?: { error?: string } };
      const msg =
        err?.data?.error === "invalid_unlock_code" || /invalid_unlock_code/.test(err?.message || "")
          ? "解锁码错误（后端校验未通过）"
          : err?.message || "预设失败，请检查解锁码";
      MessagePlugin.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // 非超管/子管理：锁定提示（不暴露任何功能）
  if (!isAdmin) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ ...sectionBox, textAlign: "center", padding: "48px 24px" }}>
          <h3 style={{ marginBottom: 8 }}>仅平台超管或村居子管理员可访问</h3>
          <p style={{ color: "#8a8f99", fontSize: 13 }}>
            此页面用于为村/社区预设登录账号，请使用平台超管或本村子管理员账号登录后访问。
          </p>
        </div>
      </div>
    );
  }

  const existingCols = [
    { colKey: "displayName", title: "姓名", width: 120 },
    { colKey: "phone", title: "手机号", width: 150 },
    {
      colKey: "roleKey",
      title: "角色",
      width: 120,
      cell: ({ row }: { row: Account }) => {
        const m =
          ROLE_TAG[row.roleKey || row.role || ""] ||
          ({ label: row.roleKey || row.role || "未分配", theme: "default" } as const);
        return (
          <Tag theme={m.theme} variant="light" size="small">
            {m.label}
          </Tag>
        );
      },
    },
    {
      colKey: "status",
      title: "状态",
      width: 100,
      cell: ({ row }: { row: Account }) => (
        <Tag
          theme={row.status === "active" ? "success" : "default"}
          variant="outline"
          size="small"
        >
          {row.status === "active" ? "启用" : "停用"}
        </Tag>
      ),
    },
    {
      colKey: "createdAt",
      title: "创建时间",
      width: 170,
      cell: ({ row }: { row: Account }) =>
        (row.createdAt || "").slice(0, 16).replace("T", " "),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1080 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>归属地账号预设（隐藏页）</h2>
        <div style={{ color: "#8a8f99", fontSize: 13, marginTop: 6 }}>
          为村/社区预设登录账号：子管理 / 编辑 / 审核员，初始密码
          123456。预设后即可用「归属地 + 手机号 + 密码」登录对应后台。
        </div>
      </div>

      {!unlocked ? (
        <div
          style={{
            ...sectionBox,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            padding: "48px 24px",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 16 }}>🔒 请输入超管解锁码</div>
          <Input
            type="password"
            value={unlockCode}
            onChange={(v) => setUnlockCode(String(v))}
            placeholder="解锁码（默认 123456，后端校验）"
            style={{ maxWidth: 320 }}
          />
          <Button theme="primary" disabled={!unlockCode} onClick={() => setUnlocked(true)}>
            解锁进入
          </Button>
          <div style={{ color: "#a9abb2", fontSize: 12 }}>
            解锁码不在前端校验对错，提交预设时由后端二次校验，错误会提示。
          </div>
        </div>
      ) : (
        <>
          <div style={sectionBox}>
            <div style={sectionTitle}>① 选择归属地</div>
            <Select
              value={orgId}
              onChange={(v) => onOrgChange(String(v))}
              placeholder="请选择村 / 社区"
              style={{ maxWidth: 360 }}
              disabled={!isPlatform}
              options={orgs
                // 子管理仅可为本归属地预设（后端 organization_mismatch 拦截，前端同步锁定）
                .filter((o) => isPlatform || o.id === user?.organizationId)
                .map((o) => ({
                  value: o.id,
                  label: `${o.name}（${o.orgType === "community" ? "社区" : "村"}）`,
                }))}
            />
            {!isPlatform && (
              <div style={{ color: "#8a8f99", fontSize: 12, marginTop: 6 }}>
                子管理员仅可为本村（社区）预设账号，归属地已锁定
              </div>
            )}
          </div>

          <div style={sectionBox}>
            <div style={sectionTitle}>② 添加账号（可批量）</div>
            <div
              style={{
                display: "flex",
                gap: 12,
                fontWeight: 600,
                fontSize: 13,
                color: "#4e5969",
                padding: "8px 12px",
                background: "#f2f3f5",
                borderRadius: "4px 4px 0 0",
              }}
            >
              <span style={{ width: 170 }}>角色</span>
              <span style={{ width: 140 }}>姓名（可选）</span>
              <span style={{ width: 180 }}>手机号</span>
              <span style={{ width: 160 }}>密码（留空=123456）</span>
              <span style={{ width: 60 }}>操作</span>
            </div>
            {rows.map((r) => (
              <div
                key={r.key}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  padding: "8px 12px",
                  borderBottom: "1px solid #f0f0f0",
                }}
              >
                <Select
                  value={r.roleKey}
                  onChange={(v) => updRow(r.key, { roleKey: v as Row["roleKey"] })}
                  style={{ width: 170 }}
                  options={ROLE_OPTIONS}
                />
                <Input
                  value={r.name}
                  onChange={(v) => updRow(r.key, { name: String(v) })}
                  placeholder="如：林建国"
                  style={{ width: 140 }}
                />
                <Input
                  value={r.phone}
                  onChange={(v) => updRow(r.key, { phone: String(v) })}
                  placeholder="11 位手机号"
                  style={{ width: 180 }}
                />
                <Input
                  value={r.password}
                  onChange={(v) => updRow(r.key, { password: String(v) })}
                  placeholder="默认 123456"
                  style={{ width: 160 }}
                />
                <Button
                  variant="text"
                  theme="danger"
                  disabled={rows.length === 1}
                  onClick={() => delRow(r.key)}
                >
                  删除
                </Button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
              <Button variant="outline" onClick={addRow}>
                ＋ 添加一行
              </Button>
              <Button theme="primary" loading={saving} onClick={onSave}>
                保存预设
              </Button>
            </div>
          </div>

          {result && (
            <Dialog
              header="预设结果"
              visible={!!result}
              onClose={() => setResult(null)}
              footer={
                <Button theme="primary" onClick={() => setResult(null)}>
                  知道了
                </Button>
              }
              width={480}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <Tag theme="success" variant="light">
                    新增 {result.created.length}
                  </Tag>{" "}
                  {result.created.join("、") || "—"}
                </div>
                <div>
                  <Tag theme="primary" variant="light">
                    更新 {result.updated.length}
                  </Tag>{" "}
                  {result.updated.join("、") || "—"}
                </div>
                <div>
                  <Tag theme="warning" variant="light">
                    跳过 {result.skipped.length}
                  </Tag>
                </div>
                {result.skipped.map((s) => (
                  <div key={s.phone} style={{ fontSize: 12, color: "#8a8f99" }}>
                    · {s.phone}：{s.reason}
                  </div>
                ))}
              </div>
            </Dialog>
          )}

          <div style={sectionBox}>
            <div style={sectionTitle}>③ 该归属地现有账号</div>
            <Table
              rowKey="id"
              columns={existingCols}
              data={existing}
              loading={loading}
              size="small"
            />
          </div>
        </>
      )}
    </div>
  );
}
