"use client";

/**
 * M13: 消息订阅与推送 (/admin/notifications)
 * 配置企业微信、飞书群机器人或自定义 HTTP 回调。全异步静默推送，带【发送测试】。
 */
import React, { useEffect, useState } from "react";
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
  Switch,
  Popconfirm,
  Divider,
  Alert,
} from "tdesign-react";
import { AddIcon, ChatIcon, SendIcon, DeleteIcon, EditIcon } from "tdesign-icons-react";
import {
  getWebhookSubscriptions,
  createWebhookSubscription,
  updateWebhookSubscription,
  deleteWebhookSubscription,
  testWebhookSubscription,
  WebhookSubscription,
} from "@/lib/api/webhooks";
import { PermGate } from "@/lib/components/PermGate";
import { Field } from "@/lib/components/Field";

const CHANNEL_MAP: Record<string, { label: string; theme: "success" | "primary" | "default" }> = {
  wecom: { label: "企业微信群机器人", theme: "success" },
  feishu: { label: "飞书群机器人", theme: "primary" },
  plain: { label: "自定义 HTTP 接口", theme: "default" },
};


export default function NotificationsPage() {
  const [list, setList] = useState<WebhookSubscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [channel, setChannel] = useState<"wecom" | "feishu" | "plain">("wecom");
  const [url, setUrl] = useState("");
  const [mobile, setMobile] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getWebhookSubscriptions();
      setList(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "加载消息订阅失败";
      MessagePlugin.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setEditingId(null);
    setName("");
    setChannel("wecom");
    setUrl("");
    setMobile("");
    setModalVisible(true);
  };

  const openEditModal = (item: WebhookSubscription) => {
    setEditingId(item.id);
    setName(item.name);
    setChannel(item.channel);
    setUrl(item.url);
    setMobile(item.mobile || "");
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !url.trim()) {
      MessagePlugin.error("请填写订阅名称和 Webhook 回调地址");
      return;
    }

    setSubmitting(true);
    try {
      if (editingId) {
        // 后端 PATCH 不收 channel（创建后渠道不可改），故编辑时不上传 channel
        await updateWebhookSubscription(editingId, {
          name: name.trim(),
          url: url.trim(),
          mobile: mobile.trim() || undefined,
        });
        MessagePlugin.success("消息机器人配置已更新");
      } else {
        await createWebhookSubscription({
          name: name.trim(),
          channel,
          url: url.trim(),
          mobile: mobile.trim() || undefined,
        });
        MessagePlugin.success("消息机器人添加成功！");
      }
      setModalVisible(false);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "保存失败";
      MessagePlugin.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (item: WebhookSubscription) => {
    try {
      await updateWebhookSubscription(item.id, { active: !item.active });
      MessagePlugin.success(`已${!item.active ? "启用" : "禁用"}推送`);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "切换失败";
      MessagePlugin.error(msg);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWebhookSubscription(id);
      MessagePlugin.success("已删除该推送机器人");
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "删除失败";
      MessagePlugin.error(msg);
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      await testWebhookSubscription(id);
      MessagePlugin.success("🎉 测试消息已成功推送到群聊！");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "测试推送失败，请检查机器人 Webhook 地址";
      MessagePlugin.error(msg);
    } finally {
      setTestingId(null);
    }
  };

  const columns = [
    {
      colKey: "name",
      title: "订阅名称 / 备注",
      width: 200,
      cell: ({ row }: { row: WebhookSubscription }) => (
        <Space size="small">
          <ChatIcon style={{ color: "#0052d9" }} />
          <strong>{row.name}</strong>
        </Space>
      ),
    },
    {
      colKey: "channel",
      title: "渠道类型",
      width: 170,
      cell: ({ row }: { row: WebhookSubscription }) => {
        const c = CHANNEL_MAP[row.channel] || { label: row.channel, theme: "default" as const };
        return (
          <Tag theme={c.theme} variant="light">
            {c.label}
          </Tag>
        );
      },
    },
    {
      colKey: "url",
      title: "Webhook 回调 URL",
      width: 300,
      cell: ({ row }: { row: WebhookSubscription }) => (
        <span style={{ fontFamily: "monospace", fontSize: 12, color: "#4e5969" }} title={row.url}>
          {row.url}
        </span>
      ),
    },
    {
      colKey: "mobile",
      title: "指定提醒人手机",
      width: 140,
      cell: ({ row }: { row: WebhookSubscription }) => <span>{row.mobile || "群全员"}</span>,
    },
    {
      colKey: "active",
      title: "状态",
      width: 90,
      cell: ({ row }: { row: WebhookSubscription }) => (
        <Switch value={row.active} onChange={() => handleToggleActive(row)} />
      ),
    },
    {
      colKey: "op",
      title: "管理操作",
      width: 230,
      cell: ({ row }: { row: WebhookSubscription }) => (
        <Space>
          <Button
            theme="primary"
            variant="text"
            size="small"
            icon={<SendIcon />}
            loading={testingId === row.id}
            onClick={() => handleTest(row.id)}
          >
            发送测试
          </Button>

          <Button
            theme="default"
            variant="text"
            size="small"
            icon={<EditIcon />}
            onClick={() => openEditModal(row)}
          >
            编辑
          </Button>

          <Popconfirm content="确认移除此推送机器人吗？" onConfirm={() => handleDelete(row.id)}>
            <Button theme="danger" variant="text" size="small" icon={<DeleteIcon />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* R-04：机器人管理按角色收口（webhook 守卫后端为 staff 级，前端对齐 23 号权责：editor/reviewer 无管理权） */}
      <PermGate roles={["platform_admin", "sub_admin"]} fallback={
        <Alert
          theme="info"
          message="当前角色无群机器人管理权。换届审批/发布结果将由系统自动向已配置的工作群推送，无需操作。"
        />
      }>
        <Card
          title="消息订阅与群机器人推送"
          description="支持配置企业微信与飞书群机器人。在【提案批复】、【材料审核】、【公文发布】等法定节点，系统将自动异步向本群推送通知，做到行政留痕与秒级提醒。"
          actions={
            <Button theme="primary" icon={<AddIcon />} onClick={openCreateModal}>
              添加群机器人订阅
            </Button>
          }
        >
          <Table data={list} columns={columns} rowKey="id" loading={loading} />
        </Card>
      </PermGate>

      {/* 新建/编辑机器人 Dialog */}
      <Dialog
        header={editingId ? "编辑群机器人配置" : "添加群机器人订阅"}
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        confirmBtn={{ content: "保存配置", theme: "primary", loading: submitting }}
        onConfirm={handleSubmit}
        width={560}
      >
        <Form labelWidth={130}>
          <Field label="订阅机器人名称" requiredMark>
            <Input
              value={name}
              onChange={(v) => setName(v as string)}
              placeholder="例如：阔口社区换届工作通知群"
            />
          </Field>

          <Field label="推送渠道类型" requiredMark>
            <Select
              value={channel}
              onChange={(v) => setChannel(v as "wecom" | "feishu" | "plain")}
              disabled={!!editingId}
              options={[
                { label: "企业微信群机器人 (WeCom)", value: "wecom" },
                { label: "飞书群机器人 (Feishu)", value: "feishu" },
                { label: "自定义 HTTP GET/POST 接口", value: "plain" },
              ]}
            />
            {!!editingId && (
              <div style={{ color: "#888", fontSize: 12, marginTop: 4 }}>
                渠道类型创建后不可修改
              </div>
            )}
          </Field>

          <Field label="Webhook 地址" requiredMark>
            <Input
              value={url}
              onChange={(v) => setUrl(v as string)}
              placeholder="请粘贴企业微信或飞书群机器人的 Webhook URL"
            />
          </Field>

          <Field label="指定 @ 提醒手机号">
            <Input
              value={mobile}
              maxlength={11}
              onChange={(v) => setMobile(v as string)}
              placeholder="选填：消息将单独 @ 该干部的手机号"
            />
          </Field>

          <Divider style={{ margin: "16px 0" }} />
          <div style={{ color: "#888", fontSize: 12, lineHeight: 1.6 }}>
            提示：Webhook 推送为全异步静默模式。若网络波动或地址失效，绝不会影响主线换届审批流程，系统会在后台记录日志。
          </div>
        </Form>
      </Dialog>
    </div>
  );
}
