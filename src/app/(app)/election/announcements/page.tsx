"use client";

/**
 * M08: 公告发文台账 (/election/announcements)
 * 纯记录只读台账：审计小编是否按法定倒排节点如期发文。公文红头全文预览。
 * 数据推导（对齐后端真实字段，不复刻原版假列）：
 *   - 公告编号 = 列表行 template_code（同后端 /api/announcements 的 annCode 拼法 coalesce(t.at_code,'ANN-00')）
 *   - 所属阶段 = scheduled_for 落在哪一个 election_fief_stages 的 [start_date, end_date] 区间
 *   - 附件数   = 逐行 GET /admin/announcements/:id/files 取 length（数据量小，接受 N+1）
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
  Select,
  Divider,
} from "tdesign-react";
import { BrowseIcon, CheckCircleIcon, TimeIcon } from "tdesign-icons-react";
import {
  getAnnouncements,
  getAnnouncementFiles,
  Announcement,
} from "@/lib/api/announcements";
import { getElectionFiefs,
  pickDefaultFief, getFiefStages, ElectionFief, FiefStage } from "@/lib/api/elections";
import { MaterialFile } from "@/lib/api/files";
import { useAuthStore } from "@/lib/stores/useAuthStore";
import { useElectionStore } from "@/lib/stores/useElectionStore";
import { LegalDocViewer } from "@/lib/components/LegalDocViewer";
import { FileList } from "@/lib/components/FileList";
import { fmtDateTime } from "@/lib/utils/fmt";
import { annDueInfo } from "@/lib/utils/stages";

/** 公告编号推导（照抄后端 /api/announcements 的 annCode 规则） */
const annCodeOf = (ann: Announcement): string => ann.templateCode || "ANN-00";

export default function AnnouncementsPage() {
  const router = useRouter();
  const [list, setList] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [fiefs, setFiefs] = useState<ElectionFief[]>([]);
  const [stages, setStages] = useState<FiefStage[]>([]);
  const [selectedFiefId, setSelectedFiefId] = useState<string>("");
  const [previewVisible, setPreviewVisible] = useState(false);
  const [currentAnn, setCurrentAnn] = useState<Announcement | null>(null);
  const [detailFiles, setDetailFiles] = useState<MaterialFile[]>([]);
  // 逐行附件数（行 id → 数量；加载完成前不显示）
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({});

  const user = useAuthStore((s) => s.user);
  const currentFiefId = useElectionStore((s) => s.currentFiefId);

  // 初始化加载活动
  useEffect(() => {
    getElectionFiefs().then((data) => {
      setFiefs(data);
      if (data.length > 0) {
        const target = pickDefaultFief(data, currentFiefId)?.id || data[0].id;
        setSelectedFiefId(target);
      }
    });
  }, [currentFiefId]);

  // 逐行拉取附件数（数据量小，接受 N+1）
  const loadFileCounts = async (rows: Announcement[]) => {
    const counts = await Promise.all(
      rows.map(async (a) => {
        try {
          return (await getAnnouncementFiles(a.id)).length;
        } catch {
          return 0;
        }
      }),
    );
    setFileCounts(Object.fromEntries(rows.map((a, i) => [a.id, counts[i]])));
  };

  // 加载该活动的公文记录与阶段区间
  const loadData = async () => {
    if (!selectedFiefId) return;
    setLoading(true);
    try {
      const [data, stageData] = await Promise.all([
        getAnnouncements({ electionFiefId: selectedFiefId }),
        getFiefStages(selectedFiefId).catch(() => [] as FiefStage[]),
      ]);
      setList(data);
      setStages(stageData);
      setFileCounts({});
      void loadFileCounts(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "加载公告记录失败";
      MessagePlugin.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedFiefId]);

  // 所属阶段推导：scheduled_for 落在哪个 stage 区间就显示该阶段名，落不进返回空串
  const stageOf = (ann: Announcement): string => {
    const day = (ann.scheduledFor || "").slice(0, 10);
    if (!day) return "";
    const hit = stages.find(
      (s) => day >= (s.startDate || "").slice(0, 10) && day <= (s.endDate || "").slice(0, 10),
    );
    return hit?.stageName || "";
  };

  const openPreview = async (row: Announcement) => {
    setCurrentAnn(row);
    setPreviewVisible(true);
    try {
      setDetailFiles(await getAnnouncementFiles(row.id));
    } catch {
      setDetailFiles([]);
    }
  };

  const columns = [
    {
      colKey: "idx",
      title: "序号",
      width: 70,
      cell: ({ rowIndex }: { rowIndex: number }) => rowIndex + 1,
    },
    {
      colKey: "annCode",
      title: "公告编号",
      width: 110,
      cell: ({ row }: { row: Announcement }) => (
        <span style={{ fontWeight: 500 }}>{annCodeOf(row)}</span>
      ),
    },
    {
      colKey: "title",
      title: "公文名称 / 标题",
      width: 300,
      cell: ({ row }: { row: Announcement }) => (
        <span style={{ fontWeight: 500, color: "#1d2129" }}>{row.title}</span>
      ),
    },
    {
      colKey: "templateName",
      title: "对应法定模板",
      width: 180,
      cell: ({ row }: { row: Announcement }) => (
        <span style={{ color: "#86909c" }}>{row.templateName || "法定正文模板"}</span>
      ),
    },
    {
      colKey: "stage",
      title: "所属阶段",
      width: 130,
      cell: ({ row }: { row: Announcement }) => {
        const stageName = stageOf(row);
        return stageName ? (
          <Tag theme="primary" variant="light">
            {stageName}
          </Tag>
        ) : (
          <span style={{ color: "#86909c" }}>—</span>
        );
      },
    },
    {
      colKey: "status",
      title: "发布状态（小编留痕）",
      width: 150,
      cell: ({ row }: { row: Announcement }) => {
        const isPub = row.status === "published";
        return (
          <Tag
            theme={isPub ? "success" : "default"}
            variant="light"
            icon={isPub ? <CheckCircleIcon /> : <TimeIcon />}
          >
            {isPub ? "已依法发布" : "草稿待发布"}
          </Tag>
        );
      },
    },
    {
      colKey: "scheduledFor",
      title: "法定排期日",
      width: 125,
      cell: ({ row }: { row: Announcement }) => (
        <span style={{ fontVariantNumeric: "tabular-nums", color: "#4e5969" }}>
          {(row.scheduledFor || "").slice(0, 10) || "—"}
        </span>
      ),
    },
    {
      colKey: "dueCheck",
      title: "如期核验",
      width: 130,
      cell: ({ row }: { row: Announcement }) => {
        // R-17：审计口径——已发布比对发布日 vs 排期日；草稿比对今日 vs 排期日，逾期红标
        const due = annDueInfo(row);
        if (!due.scheduled) return <span style={{ color: "#86909c" }}>—</span>;
        return (
          <Tag
            theme={due.overdue ? "danger" : due.onSchedule ? "success" : "warning"}
            variant="light"
          >
            {due.label}
          </Tag>
        );
      },
    },
    {
      colKey: "publishedAt",
      title: "发布时间戳",
      width: 180,
      cell: ({ row }: { row: Announcement }) => (
        <span style={{ fontSize: 13, color: "#4e5969" }}>{fmtDateTime(row.publishedAt)}</span>
      ),
    },
    {
      colKey: "files",
      title: "附件数",
      width: 90,
      cell: ({ row }: { row: Announcement }) => {
        const n = fileCounts[row.id];
        return n === undefined ? (
          <span style={{ color: "#86909c" }}>—</span>
        ) : (
          <span>📎 {n}</span>
        );
      },
    },
    {
      colKey: "op",
      title: "操作",
      width: 210,
      cell: ({ row }: { row: Announcement }) => (
        <Space>
          <Button
            theme="primary"
            variant="text"
            size="small"
            icon={<BrowseIcon />}
            onClick={() => void openPreview(row)}
          >
            查看全文
          </Button>
          {/* 内链优化：台账 → 公文编辑台直链（带锚点选中对应公告） */}
          <Button
            theme="default"
            variant="text"
            size="small"
            onClick={() =>
              router.push(`/election/activity/${selectedFiefId}?tab=gongwen&ann=${row.id}`)
            }
          >
            去公文台
          </Button>
        </Space>
      ),
    },
  ];

  const publishedCount = list.filter((a) => a.status === "published").length;

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="公告发文台账"
        description="所有法定公告内容在【选举提案】通过瞬间全部自动生成。本页面为纯记录台账，用于审计核验小编是否按法定节点执行发文。"
        actions={
          <Space>
            <span style={{ color: "#86909c", fontSize: 13 }}>选择换届活动：</span>
            <Select
              style={{ width: 260 }}
              value={selectedFiefId}
              onChange={(v) => setSelectedFiefId(v as string)}
              options={fiefs.map((f) => ({ label: `${f.name} (${f.dDay})`, value: f.id }))}
            />
          </Space>
        }
      >
        <div style={{ marginBottom: 16, display: "flex", gap: 16 }}>
          <Tag theme="primary" variant="light" size="large">
            总公文数：{list.length} 篇
          </Tag>
          <Tag theme="success" variant="light" size="large">
            已发布：{publishedCount} 篇
          </Tag>
          <Tag theme="default" variant="light" size="large">
            待发布：{list.length - publishedCount} 篇
          </Tag>
        </div>

        <Table data={list} columns={columns} rowKey="id" loading={loading} />
      </Card>

      {/* 公文规范预览弹窗 */}
      <Dialog
        header="公文全文预览"
        visible={previewVisible}
        onClose={() => setPreviewVisible(false)}
        footer={<Button onClick={() => setPreviewVisible(false)}>关闭</Button>}
        width={820}
      >
        {currentAnn && (
          <div>
            <LegalDocViewer
              announcement={currentAnn}
              orgName={user?.orgName || "演示单位"}
              orgType={user?.orgType || "village"}
            />
            <Divider align="left">该公文已归档附件（{detailFiles.length} 份）</Divider>
            <FileList files={detailFiles} />
          </div>
        )}
      </Dialog>
    </div>
  );
}
