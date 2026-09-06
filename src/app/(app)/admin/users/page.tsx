"use client";

/**
 * M11: 人员与账号中枢 (/admin/users)
 * 平台超管或选委会负责人秘密开通村居工作账号，重置初始密码为 123456，账号启停管理。
 */
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  Table,
  Button,
  Tag,
  Space,
  MessagePlugin,
  Dialog,
  Form,
  Input,
  Select,
  Popconfirm,
  Divider,
  Alert,
  Tooltip,
} from "tdesign-react";
import { AddIcon, UserIcon, RefreshIcon, LockOnIcon } from "tdesign-icons-react";
import {
  getAccounts,
  createAccount,
  presetAccounts,
  resetPassword,
  toggleAccountStatus,
  Account,
} from "@/lib/api/accounts";
import { getOrganizations, OrgItem } from "@/lib/api/auth";
import { useAuthStore } from "@/lib/stores/useAuthStore";
import { StatusTag } from "@/lib/components/StatusTag";
import { PermGate } from "@/lib/components/PermGate";
import { Field } from "@/lib/components/Field";
import { fmtDateTime } from "@/lib/utils/fmt";

const ROLE_MAP: Record<
  string,
  { name: string; theme: "primary" | "warning" | "success" | "default" | "danger" }
> = {
  platform_admin: { name: "平台超级管理员", theme: "danger" },
  sub_admin: { name: "村居子管理员 (选委会主任)", theme: "primary" },
  editor: { name: "经办编辑 (选委会工作人员)", theme: "warning" },
  reviewer: { name: "审核人 (联审/指导组代表)", theme: "success" },
  candidate: { name: "参选人 (小程序端专属)", theme: "default" },
};

export default function UsersPage() {
  const router = useRouter();
  const [list, setList] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");

  // 秘密开账号弹窗
  const [createVisible, setCreateVisible] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newRole, setNewRole] = useState("sub_admin");
  const [newOrgId, setNewOrgId] = useState("");
  // R-02：子管理开通走 preset 端点时的解锁码（后端 roleGuard('platform_admin','sub_admin')，直建仅 platform_admin）
  const [unlockCode, setUnlockCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const user = useAuthStore((s) => s.user);
  const isPlatformAdmin = user?.role === "platform_admin";

  const loadData = async () => {
    setLoading(true);
    try {
      const [accData, orgData] = await Promise.all([
        getAccounts(selectedOrgId ? { orgId: selectedOrgId } : undefined),
        getOrganizations(),
      ]);
      setList(accData);
      setOrgs(orgData);
      if (!newOrgId && orgData.length > 0) {
        setNewOrgId(user?.organizationId || orgData[0].id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "加载账号列表失败";
      MessagePlugin.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedOrgId]);

  // 打开创建账号弹窗
  const openCreateModal = () => {
    setNewPhone("");
    setNewDisplayName("");
    setNewRole("sub_admin");
    // 子管理固定本归属地；平台超管默认当前机构可改选
    setNewOrgId(isPlatformAdmin ? user?.organizationId || orgs[0]?.id || "" : user?.organizationId || "");
    setUnlockCode("");
    setCreateVisible(true);
  };

  // 提交秘密开通账号
  // R-02：双轨对齐后端守卫——platform_admin 走直建 POST /admin/accounts；
  // sub_admin 走批量预设 POST /admin/accounts/preset（后端允许子管理限本 org+解锁码），
  // 彻底消灭「按钮可见可提交但必 403」的三方错位断链。
  const handleCreateSubmit = async () => {
    if (!newPhone.trim() || !newDisplayName.trim() || !newOrgId) {
      MessagePlugin.error("请完整输入手机号、真实姓名并指定归属地");
      return;
    }
    if (newPhone.trim().length !== 11) {
      MessagePlugin.error("请输入 11 位有效手机号");
      return;
    }

    setSubmitting(true);
    try {
      if (isPlatformAdmin) {
        await createAccount({
          phone: newPhone.trim(),
          displayName: newDisplayName.trim(),
          organizationId: newOrgId,
          role: newRole,
        });
      } else {
        if (!unlockCode.trim()) {
          MessagePlugin.error("请输入区平台管理员下发的预设解锁码");
          setSubmitting(false);
          return;
        }
        const result = await presetAccounts({
          unlockCode: unlockCode.trim(),
          orgId: user?.organizationId || newOrgId,
          accounts: [
            {
              phone: newPhone.trim(),
              name: newDisplayName.trim(),
              roleKey: newRole as "sub_admin" | "editor" | "reviewer",
            },
          ],
        });
        const created = result?.created?.length > 0;
        if (!created && result?.updated?.length > 0) {
          MessagePlugin.warning("该手机号已存在，已按本次指定角色更新其在本归属地的权限");
          setCreateVisible(false);
          loadData();
          return;
        }
      }

      MessagePlugin.success("账号开通成功！初始密码默认已设为 123456");
      setCreateVisible(false);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "开通账号失败";
      MessagePlugin.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // 重置初始密码 123456
  const handleResetPassword = async (account: Account) => {
    try {
      await resetPassword(account.id);
      MessagePlugin.success(
        `已成功将【${account.displayName || account.phone}】密码重置为初始密码 123456`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "重置密码失败";
      MessagePlugin.error(msg);
    }
  };

  // 启停账号
  const handleToggleStatus = async (account: Account) => {
    const nextStatus = account.status === "active" ? "disabled" : "active";
    try {
      await toggleAccountStatus(account.id, nextStatus);
      MessagePlugin.success(`账号已成功${nextStatus === "active" ? "启用" : "停用"}`);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "切换状态失败";
      MessagePlugin.error(msg);
    }
  };

  const columns = [
    {
      colKey: "displayName",
      title: "姓名 / 显示名",
      width: 160,
      cell: ({ row }: { row: Account }) => (
        <Space size="small">
          <UserIcon style={{ color: "#0052d9" }} />
          <strong>{row.displayName || "（未设）"}</strong>
        </Space>
      ),
    },
    { colKey: "phone", title: "手机号 (登录账号)", width: 160 },
    { colKey: "organizationName", title: "归属村居单位", width: 180 },
    {
      colKey: "role",
      title: "行政职务角色",
      width: 210,
      cell: ({ row }: { row: Account }) => {
        const r = ROLE_MAP[row.role] || { name: row.role, theme: "default" as const };
        return (
          <Tag theme={r.theme} variant="light">
            {r.name}
          </Tag>
        );
      },
    },
    {
      colKey: "status",
      title: "账号状态",
      width: 110,
      cell: ({ row }: { row: Account }) => <StatusTag type="account" status={row.status} />,
    },
    {
      colKey: "createdAt",
      title: "开通时间",
      width: 180,
      cell: ({ row }: { row: Account }) => <span>{fmtDateTime(row.createdAt)}</span>,
    },
    {
      colKey: "op",
      title: "管理操作",
      width: 220,
      cell: ({ row }: { row: Account }) => {
        const isSelf = row.id === user?.id;
        // R-15：权限倒挂防护——子管理不可对挂靠本村的平台超管行做任何操作（重置/停用均隐藏）
        const isProtectedPlatformRow = row.role === "platform_admin" && !isPlatformAdmin;
        if (isProtectedPlatformRow) {
          return (
            <Tooltip content="平台超管账号由区级统一管理，村居侧不可操作">
              <span style={{ color: "#b2b5bd", fontSize: 12 }}>🔒 系统保护</span>
            </Tooltip>
          );
        }
        return (
          <Space>
            <Popconfirm
              content={`确认将该账号密码重置为 123456 吗？${isSelf ? "（将影响你自己当前登录使用的密码）" : ""}`}
              onConfirm={() => handleResetPassword(row)}
            >
              <Button theme="primary" variant="text" size="small" icon={<RefreshIcon />}>
                重置密码
              </Button>
            </Popconfirm>

            {/* R-15：自身行停用强警示（防误操作自锁）；其余行照旧 */}
            {isSelf ? (
              <Popconfirm
                theme="danger"
                content="⚠️ 这是您当前登录的账号：停用后将立即无法登录本系统，确定要停用自己吗？"
                onConfirm={() => handleToggleStatus(row)}
              >
                <Button theme="danger" variant="text" size="small">
                  停用
                </Button>
              </Popconfirm>
            ) : (
              <Button
                theme={row.status === "active" ? "danger" : "success"}
                variant="text"
                size="small"
                onClick={() => handleToggleStatus(row)}
              >
                {row.status === "active" ? "停用" : "启用"}
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="人员与账号管理"
        description="内部工作账号严禁公开注册，均由区平台超级管理员或各村居选委会负责人按行政权责统一开通，初始密码统一为 123456。"
        actions={
          <Space>
            {isPlatformAdmin && (
              <Select
                style={{ width: 220 }}
                value={selectedOrgId || undefined}
                onChange={(v) => setSelectedOrgId(v as string)}
                placeholder="按归属地筛选"
                clearable
                options={orgs.map((o) => ({
                  label: `${o.orgType === "community" ? "🏘" : "🏡"} ${o.name}`,
                  value: o.id,
                }))}
              />
            )}
            <Button theme="primary" variant="outline" icon={<RefreshIcon />} onClick={loadData}>
              刷新
            </Button>
            <PermGate perm="account:create" roles={["platform_admin", "sub_admin"]}>
              <Button theme="primary" icon={<AddIcon />} onClick={openCreateModal}>
                开通内部工作账号
              </Button>
            </PermGate>
            {(user?.role === "platform_admin" || user?.role === "sub_admin") && (
              <Button
                theme="default"
                variant="outline"
                onClick={() => router.push("/org-setup")}
              >
                ＋ 账号预设
              </Button>
            )}
          </Space>
        }
      >
        <Table data={list} columns={columns} rowKey="id" loading={loading} />
      </Card>

      {/* 秘密开通内部账号 Dialog */}
      <Dialog
        header="秘密开通村居工作账号"
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        confirmBtn={{ content: "确认开通并分配密码", theme: "primary", loading: submitting }}
        onConfirm={handleCreateSubmit}
        width={540}
      >
        <Form labelWidth={130}>
          {!isPlatformAdmin && (
            <Alert
              theme="info"
              message="子管理员开通账号需使用区平台下发的预设解锁码，且仅能为本归属地开通。"
              style={{ marginBottom: 14 }}
            />
          )}
          <Field label="归属村居单位" requiredMark>
            <Select
              value={newOrgId}
              onChange={(v) => setNewOrgId(v as string)}
              options={orgs.map((o) => ({
                label: `${o.orgType === "community" ? "🏘 社区" : "🏡 行政村"} · ${o.name}`,
                value: o.id,
              }))}
              placeholder="请指定归属地（一旦分配终身绑死）"
              disabled={!isPlatformAdmin}
            />
          </Field>

          <Field label="分配行政角色" requiredMark>
            <Select
              value={newRole}
              onChange={(v) => setNewRole(v as string)}
              options={[
                { label: "村居子管理员（选委会主任/全面管辖）", value: "sub_admin" },
                { label: "经办编辑（选委会工作人员/干活小编）", value: "editor" },
                { label: "审核人（上级联审代表/指导组）", value: "reviewer" },
              ]}
            />
          </Field>

          <Field label="人员真实姓名" requiredMark>
            <Input
              value={newDisplayName}
              onChange={(v) => setNewDisplayName(v as string)}
              placeholder="请输入村居干部真实姓名"
            />
          </Field>

          <Field label="登录手机号" requiredMark>
            <Input
              value={newPhone}
              maxlength={11}
              onChange={(v) => setNewPhone(v as string)}
              placeholder="请输入11位登录手机号"
            />
          </Field>

          {/* R-02：子管理双轨——解锁码走 preset 端点（后端校验 UNLOCK_CODE，默认 123456） */}
          {!isPlatformAdmin && (
            <Field label="预设解锁码" requiredMark>
              <Input
                value={unlockCode}
                onChange={(v) => setUnlockCode(v as string)}
                prefixIcon={<LockOnIcon />}
                placeholder="请输入区平台管理员下发的解锁码"
              />
            </Field>
          )}

          <Divider style={{ margin: "16px 0" }} />
          <div
            style={{
              background: "#eef4ff",
              padding: "10px 14px",
              borderRadius: 4,
              color: "#0052d9",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            🔒 安全机制：新账号开通后默认登录密码统一设为 <strong>123456</strong>
            。工作人员首次登录后，可在工作台顶部自主修改密码。
          </div>
        </Form>
      </Dialog>
    </div>
  );
}
