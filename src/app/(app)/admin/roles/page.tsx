"use client";

/**
 * M12: 角色管理 (/admin/roles)
 * 纯只读角色清单（回退对齐原版）：当前登录角色 + 5 类法定角色表格 + 底部鉴权规则说明。
 * 数据走 GET /admin/roles（权限点内嵌于行 permissions 数组）。
 * 说明：全部角色 is_system=true，后端对系统角色权限修改一律 409 system_role_frozen，
 * 故本页不做任何权限编辑入口（原版即只读，鉴权由后端守卫收口）。
 */
import React, { useEffect, useState } from "react";
import { Card, Table, Tag, MessagePlugin } from "tdesign-react";
import { getRoles, Role } from "@/lib/api/roles";
import { useAuthStore } from "@/lib/stores/useAuthStore";

/** 权限点「资源:动作」→ 中文标签（只读展示用） */
const RESOURCE_LABEL: Record<string, string> = {
  proposal: "提案",
  material: "材料",
  candidate: "候选人",
  announcement: "公告",
  account: "账号",
  org: "组织",
  role: "角色",
  position: "岗位",
  data: "数据",
};
const ACT_LABEL: Record<string, string> = {
  create: "新增",
  edit: "编辑",
  review: "审核",
  publish: "发布",
  manage: "管理",
  view: "查看",
};
const permLabel = (perm: string) => {
  const [res, act] = perm.split(":");
  return `${RESOURCE_LABEL[res] || res}·${ACT_LABEL[act] || act}`;
};

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);

  const user = useAuthStore((s) => s.user);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getRoles();
      setRoles(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "加载系统角色失败";
      MessagePlugin.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const currentRoleName =
    roles.find((r) => r.key === user?.role)?.name || user?.role || "—";

  const columns = [
    { colKey: "name", title: "角色名称", width: 130 },
    {
      colKey: "key",
      title: "角色编码",
      width: 170,
      cell: ({ row }: { row: Role }) => (
        <span style={{ fontFamily: "Consolas,monospace", fontSize: 12 }}>{row.key}</span>
      ),
    },
    {
      colKey: "isStaff",
      title: "类型",
      width: 90,
      cell: ({ row }: { row: Role }) =>
        row.isStaff ? (
          <Tag theme="primary" variant="light">
            后台
          </Tag>
        ) : (
          <Tag theme="default" variant="light">
            小程序
          </Tag>
        ),
    },
    {
      colKey: "permissions",
      title: "权限点",
      minWidth: 320,
      cell: ({ row }: { row: Role }) => (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {row.permissions?.length ? (
            row.permissions.map((p) => (
              <Tag key={p} theme={row.isSystem ? "primary" : "warning"} variant="outline">
                {permLabel(p)}
              </Tag>
            ))
          ) : (
            <span style={{ color: "#6B7280", fontSize: 12 }}>仅查看</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card title="角色管理">
        {/* 当前登录角色 */}
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#4e5969" }}>
          <span>当前登录角色：</span>
          <Tag theme="primary" variant="light">
            {currentRoleName}
          </Tag>
          <span style={{ color: "#a6a6a6", fontSize: 12 }}>
            （角色跟随登录，权限由后端 roles / role_permissions 表控制）
          </span>
        </div>

        <Table data={roles} columns={columns} rowKey="key" loading={loading} />
      </Card>

      {/* 鉴权规则说明（原文照抄原版） */}
      <div
        style={{
          marginTop: 16,
          background: "#eef4ff",
          borderRadius: 6,
          padding: "12px 14px",
          fontSize: 13,
          lineHeight: 1.6,
          color: "#1d2129",
        }}
      >
        <b>鉴权规则：</b>
        <span>
          页面不做细粒度按钮鉴权；关键操作（审核 / 发布 / 审批 / 建账号）由后端静默验证角色权限，无权限时报错。
        </span>
      </div>
    </div>
  );
}
