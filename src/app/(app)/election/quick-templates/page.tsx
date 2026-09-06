"use client";

/**
 * M09: 法定公文快捷模板库 (/election/quick-templates)
 * 收录甲方 DOCX 规定的全套发文模板。村委会版与居委会版双轨切换查阅，一键复制全文。
 */
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  Table,
  Button,
  Tag,
  Space,
  Radio,
  Dialog,
  MessagePlugin,
  Input,
} from "tdesign-react";
import { FileCopyIcon, BrowseIcon, SearchIcon, ArrowRightIcon } from "tdesign-icons-react";
import { getAnnouncementTemplates, AnnouncementTemplate } from "@/lib/api/announcements";
import { useAuthStore } from "@/lib/stores/useAuthStore";
import { useElectionStore } from "@/lib/stores/useElectionStore";
import { getElectionFiefs, pickDefaultFief } from "@/lib/api/elections";
import { LegalDocViewer } from "@/lib/components/LegalDocViewer";

export default function TemplatesPage() {
  const router = useRouter();
  const [list, setList] = useState<AnnouncementTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"village" | "community">("village");
  const [searchKey, setSearchKey] = useState("");
  const [previewVisible, setPreviewVisible] = useState(false);
  const [currentTpl, setCurrentTpl] = useState<AnnouncementTemplate | null>(null);

  const user = useAuthStore((s) => s.user);
  const currentFiefId = useElectionStore((s) => s.currentFiefId);

/** 双轨正文适配（照原版 adaptOrgType：社区版将村口径文案替换为居民口径） */
const adaptOrgType = (body: string, orgType: "village" | "community"): string => {
  if (orgType !== "community") return body;
  return body
    .replaceAll("村民委员会", "居民委员会")
    .replaceAll("村务监督委员会", "居务监督委员会")
    .replaceAll("村委会", "居委会")
    .replaceAll("村民", "居民")
    .replaceAll("本村", "本社区")
    .replaceAll("回村", "回社区")
    .replaceAll("全村", "全社区")
    .replaceAll("各村民小组", "各居民小组");
};

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getAnnouncementTemplates({ orgType: activeTab });
      setList(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "加载公文模板库失败";
      MessagePlugin.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeTab]);

  // 复制正文到剪贴板（双轨适配后复制）
  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(adaptOrgType(content, activeTab)).then(() => {
      MessagePlugin.success("模板正文及占位符已按当前轨适配并复制到剪贴板！");
    });
  };

  const filteredList = list.filter((item) => {
    if (!searchKey) return true;
    return (
      item.atCode.toLowerCase().includes(searchKey.toLowerCase()) ||
      item.atName.toLowerCase().includes(searchKey.toLowerCase()) ||
      (item.atContent || "").toLowerCase().includes(searchKey.toLowerCase())
    );
  });

  const columns = [
    {
      colKey: "atCode",
      title: "公文编码",
      width: 120,
      cell: ({ row }: { row: AnnouncementTemplate }) => (
        <strong style={{ color: "#0052d9" }}>{row.atCode}</strong>
      ),
    },
    {
      colKey: "atName",
      title: "法定公文名称",
      width: 300,
      cell: ({ row }: { row: AnnouncementTemplate }) => (
        <span style={{ fontWeight: 500, color: "#1d2129" }}>{row.atName}</span>
      ),
    },
    {
      colKey: "atVersion",
      title: "适用法案版本",
      width: 150,
      cell: () => (
        <Tag theme={activeTab === "community" ? "warning" : "primary"} variant="light">
          {activeTab === "community" ? "居委会组织法版" : "村民委员会组织法版"}
        </Tag>
      ),
    },
    {
      colKey: "atNeedRemind",
      title: "到期提醒机制",
      width: 140,
      cell: ({ row }: { row: AnnouncementTemplate }) => (
        <Tag theme={row.atNeedRemind ? "warning" : "default"} variant="light">
          {row.atNeedRemind ? "⏰ 提前24小时" : "无特殊提醒"}
        </Tag>
      ),
    },
    {
      colKey: "op",
      title: "操作",
      width: 200,
      cell: ({ row }: { row: AnnouncementTemplate }) => (
        <Space>
          <Button
            theme="default"
            variant="text"
            size="small"
            icon={<BrowseIcon />}
            onClick={() => {
              setCurrentTpl(row);
              setPreviewVisible(true);
            }}
          >
            全文预览
          </Button>
          <Button
            theme="primary"
            variant="text"
            size="small"
            icon={<FileCopyIcon />}
            onClick={() => handleCopy(row.atContent)}
          >
            一键复制
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="法定公文快捷模板库"
        description="系统内置全套法定发文模板（依据甲方 DOCX 编制）。村委会版与居委会版物理彻底分轨，正文包含 {{组织名称}}、{{届次}}、{{选举日}} 等法定占位符。"
        actions={
          <Space>
            <Input
              style={{ width: 240 }}
              value={searchKey}
              onChange={(v) => setSearchKey(v as string)}
              placeholder="搜索公告编号或标题..."
              prefixIcon={<SearchIcon />}
              clearable
            />
            <Button
              theme="primary"
              variant="outline"
              icon={<ArrowRightIcon />}
              onClick={async () => {
                // P2 断头路修复：原指向只读台账「去编辑」却不能编辑——改为直指公文编辑台
                try {
                  const fiefs = await getElectionFiefs();
                  const target = pickDefaultFief(fiefs, currentFiefId);
                  if (target) {
                    router.push(`/election/activity/${target.id}?tab=gongwen`);
                    return;
                  }
                } catch {
                  /* 兜底回落台账 */
                }
                router.push("/election/announcements");
              }}
            >
              去公文台编辑
            </Button>
          </Space>
        }
      >
        <div
          style={{
            marginBottom: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Radio.Group
            value={activeTab}
            onChange={(v) => setActiveTab(v as "village" | "community")}
            variant="default-filled"
            size="large"
          >
            <Radio.Button value="village">🏡 村委会版法定模板</Radio.Button>
            <Radio.Button value="community">🏘 居委会版法定模板</Radio.Button>
          </Radio.Group>

          <span style={{ color: "#888", fontSize: 13 }}>
            共包含 {filteredList.length} 套法定公文模板
          </span>
        </div>

        <Table data={filteredList} columns={columns} rowKey="id" loading={loading} />
      </Card>

      {/* 模板正文预览弹窗 */}
      <Dialog
        header={`模板原文预览 · ${currentTpl?.atName || ""}`}
        visible={previewVisible}
        onClose={() => setPreviewVisible(false)}
        footer={
          <Space>
            <Button
              theme="primary"
              icon={<FileCopyIcon />}
              onClick={() => {
                if (currentTpl) handleCopy(currentTpl.atContent);
              }}
            >
              复制模板正文
            </Button>
            <Button onClick={() => setPreviewVisible(false)}>关闭</Button>
          </Space>
        }
        width={780}
      >
        {currentTpl && (
          <LegalDocViewer
            announcement={{
              title: currentTpl.atName,
              body: adaptOrgType(currentTpl.atContent, activeTab),
              annSign: adaptOrgType(
                activeTab === "community"
                  ? "{{某某社区}}居民选举委员会"
                  : "{{某某村}}村民选举委员会",
                activeTab,
              ),
              annSignDate: "{{成文日期}}",
            }}
            orgName={user?.orgName || "演示单位"}
            orgType={activeTab}
          />
        )}
      </Dialog>
    </div>
  );
}
