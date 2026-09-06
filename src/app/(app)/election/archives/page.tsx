"use client";

/**
 * M10: 历史法律材料全链归档树 (/election/archives)
 * 照原版结构移植：TDesign Tree 三级树（根 → 届 → 来源类型 → 归档项）+ 归档项详情弹窗
 * （可见性 / 文件版本 / 原文件下载），右侧保留检索表格增强。数据全部来自后端真实台账，无 mock。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  Row,
  Col,
  Table,
  Button,
  Tag,
  Space,
  Input,
  Dialog,
  Empty,
  Loading,
  Tree,
  MessagePlugin,
} from "tdesign-react";
import { FolderIcon, SearchIcon, DownloadIcon } from "tdesign-icons-react";
import { getArchives, ArchiveItem } from "@/lib/api/archives";
import { getWebElections, WebElection } from "@/lib/api/elections";
import { getFileUrl } from "@/lib/api/files";

interface TNode {
  label: React.ReactNode;
  value: string;
  children?: TNode[];
  item?: ArchiveItem;
}

// 归档来源类型（后端 arch_source_type）→ 中文分组名（照原版 9 类）
const SOURCE_META: Record<
  string,
  { label: string; theme: "primary" | "warning" | "success" | "default" }
> = {
  proposal: { label: "提案方案", theme: "primary" },
  announcement: { label: "公告文件", theme: "warning" },
  material: { label: "参选人材料", theme: "success" },
  result: { label: "选举结果", theme: "default" },
  stage_evidence: { label: "阶段凭证", theme: "default" },
  proposal_file: { label: "提案附件", theme: "primary" },
  announcement_file: { label: "公告附件", theme: "warning" },
  position_file: { label: "岗位附件", theme: "default" },
  material_file: { label: "材料附件", theme: "success" },
};
const VIS_LABEL: Record<string, string> = { public: "公开", internal: "内部" };

const sourceLabel = (type: string) => SOURCE_META[type]?.label || type || "其他";

export default function ArchivesPage() {
  const [list, setList] = useState<ArchiveItem[]>([]);
  const [elections, setElections] = useState<WebElection[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ArchiveItem | null>(null);
  const [searchKey, setSearchKey] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ar, el] = await Promise.all([getArchives(), getWebElections()]);
      setList(ar || []);
      setElections(el || []);
    } catch (e) {
      MessagePlugin.error((e as { message?: string })?.message || "归档数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // elId → 届次信息
  const elMap = useMemo(() => {
    const m = new Map<string, WebElection>();
    elections.forEach((e) => m.set(e.elId, e));
    return m;
  }, [elections]);

  // 真实数据 → 树：根 → 届 → 来源类型 → 归档项（照原版算法移植）
  const treeData = useMemo<TNode[]>(() => {
    const byEl = new Map<string, ArchiveItem[]>();
    list.forEach((it) => {
      const k = it.elId || "unknown";
      if (!byEl.has(k)) byEl.set(k, []);
      byEl.get(k)!.push(it);
    });
    const elNodes: TNode[] = [];
    byEl.forEach((items, elId) => {
      const el = elMap.get(elId);
      const byType = new Map<string, ArchiveItem[]>();
      items.forEach((it) => {
        const t = it.archSourceType || "other";
        if (!byType.has(t)) byType.set(t, []);
        byType.get(t)!.push(it);
      });
      const typeNodes: TNode[] = [];
      byType.forEach((rows, type) => {
        const meta = SOURCE_META[type] || {
          label: type || "其他",
          theme: "default" as const,
        };
        typeNodes.push({
          label: (
            <span>
              <Tag theme={meta.theme} variant="light" size="small">
                {meta.label}
              </Tag>
              <span style={{ marginLeft: 8, color: "var(--td-text-color-secondary)" }}>
                {rows.length} 项
              </span>
            </span>
          ),
          value: `${elId}-${type}`,
          children: rows.map((r) => ({
            label: `📄 ${r.archDisplayName || "未命名归档项"}`,
            value: r.id,
            item: r,
          })),
        });
      });
      elNodes.push({
        label: `📁 ${el?.elTerm || el?.elName || elId} ｜ D日 ${el?.elElectionDate || "未定"}`,
        value: `el-${elId}`,
        children: typeNodes,
      });
    });
    return [
      { label: `🗂️ 选举归档（共 ${list.length} 项 · ${byEl.size} 届）`, value: "root", children: elNodes },
    ];
  }, [list, elMap]);

  const handleClick = (context: any) => {
    const d = context?.node?.data as TNode | undefined;
    if (d?.item) setDetail(d.item);
  };

  // 检索表格（右侧增强）：搜索按归档项名称判空匹配，避免 undefined.toLowerCase 崩溃
  const filteredList = useMemo(
    () =>
      list.filter((item) => {
        const matchSearch =
          !searchKey ||
          (item.archDisplayName || "").toLowerCase().includes(searchKey.toLowerCase());
        const matchType = selectedType === "all" || item.archSourceType === selectedType;
        return matchSearch && matchType;
      }),
    [list, searchKey, selectedType],
  );

  const detailEl = detail ? elMap.get(detail.elId) : null;

  const columns = [
    {
      colKey: "archDisplayName",
      title: "归档项名称",
      width: 280,
      cell: ({ row }: { row: ArchiveItem }) => (
        <Space size="small">
          <FolderIcon style={{ color: "#0052d9" }} />
          <span style={{ fontWeight: 500, color: "#1d2129" }} title={row.archDisplayName}>
            {row.archDisplayName || "未命名归档项"}
          </span>
        </Space>
      ),
    },
    {
      colKey: "archSourceType",
      title: "归档业务分类",
      width: 160,
      cell: ({ row }: { row: ArchiveItem }) => {
        const meta = SOURCE_META[row.archSourceType] || {
          label: row.archSourceType || "其他",
          theme: "default" as const,
        };
        return (
          <Tag theme={meta.theme} variant="light">
            {meta.label}
          </Tag>
        );
      },
    },
    {
      colKey: "elTerm",
      title: "所属届次",
      width: 200,
      cell: ({ row }: { row: ArchiveItem }) => {
        const el = elMap.get(row.elId);
        return <span>{el?.elTerm || el?.elName || "—"}</span>;
      },
    },
    {
      colKey: "archVisibility",
      title: "可见性",
      width: 100,
      cell: ({ row }: { row: ArchiveItem }) => (
        <Tag
          theme={row.archVisibility === "public" ? "success" : "default"}
          variant="outline"
          size="small"
        >
          {VIS_LABEL[row.archVisibility] || row.archVisibility}
        </Tag>
      ),
    },
    {
      colKey: "archFileVersion",
      title: "文件版本",
      width: 90,
      cell: ({ row }: { row: ArchiveItem }) => <span>{row.archFileVersion || "v1"}</span>,
    },
    {
      colKey: "op",
      title: "操作",
      width: 120,
      cell: ({ row }: { row: ArchiveItem }) =>
        row.storageKey ? (
          <Button
            theme="primary"
            variant="text"
            size="small"
            icon={<DownloadIcon />}
            onClick={() => window.open(getFileUrl(row.storageKey as string), "_blank")}
          >
            原生下载
          </Button>
        ) : (
          <span style={{ color: "#a9abb2", fontSize: 12 }}>台账项</span>
        ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="历史法律材料全链归档树"
        description="以每一届建立文件夹，按「提案 / 公告 / 材料 / 附件」分类归档。正式归档文件存储在服务器 uploads 目录，按「归属地 / 届 / 分类」物理隔离；本档案树为全周期法案追溯提供依据。"
        actions={
          <Button theme="primary" variant="outline" size="small" loading={loading} onClick={load}>
            刷新
          </Button>
        }
      >
        <Row gutter={20}>
          {/* 左侧：真实数据三级归档树（TDesign Tree） */}
          <Col span={9}>
            <div
              style={{
                background: "#f8f9fa",
                padding: 16,
                borderRadius: 6,
                minHeight: 560,
                maxHeight: 640,
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 15,
                  marginBottom: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <FolderIcon style={{ color: "#0052d9" }} />
                <span>选举归档目录结构</span>
              </div>
              {loading ? (
                <Loading text="加载归档台账…" />
              ) : list.length === 0 ? (
                <Empty description="暂无归档记录（正式选举日（D 日）过后系统自动生成归档）" />
              ) : (
                <Tree data={treeData as unknown as any[]} expandAll hover activable onClick={handleClick} />
              )}
              <Button
                theme="default"
                variant="dashed"
                block
                style={{ marginTop: 12 }}
                onClick={() => setSelectedType("all")}
              >
                查看全部归档文件 ({list.length})
              </Button>
            </div>
          </Col>

          {/* 右侧：归档检索表格（增强，字段已对齐后端真实行） */}
          <Col span={15}>
            <div
              style={{
                marginBottom: 16,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Space>
                <Tag theme="primary" variant="light" size="large">
                  当前分类：{selectedType === "all" ? "全部归档文件" : sourceLabel(selectedType)}
                </Tag>
                <span style={{ color: "#888", fontSize: 13 }}>
                  共检索到 {filteredList.length} 项归档
                </span>
              </Space>

              <Input
                style={{ width: 260 }}
                value={searchKey}
                onChange={(v) => setSearchKey(v as string)}
                placeholder="按归档项名称搜索..."
                prefixIcon={<SearchIcon />}
                clearable
              />
            </div>

            <Table data={filteredList} columns={columns} rowKey="id" loading={loading} />
          </Col>
        </Row>
      </Card>

      {/* 归档项详情 Dialog（照原版：名称/届次/类型/可见性/版本/下载） */}
      <Dialog
        header="归档项详情"
        visible={!!detail}
        onClose={() => setDetail(null)}
        footer={false}
        width={480}
      >
        {detail && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <span style={{ color: "#8a8f99", marginRight: 12 }}>名称</span>
              <strong>{detail.archDisplayName || "未命名归档项"}</strong>
            </div>
            <div>
              <span style={{ color: "#8a8f99", marginRight: 12 }}>所属届次</span>
              <span>{detailEl?.elTerm || detailEl?.elName || detail.elId}</span>
            </div>
            <div>
              <span style={{ color: "#8a8f99", marginRight: 12 }}>来源类型</span>
              <Tag
                theme={SOURCE_META[detail.archSourceType]?.theme || "default"}
                variant="light"
                size="small"
              >
                {sourceLabel(detail.archSourceType)}
              </Tag>
            </div>
            <div>
              <span style={{ color: "#8a8f99", marginRight: 12 }}>可见性</span>
              <Tag
                theme={detail.archVisibility === "public" ? "success" : "default"}
                variant="outline"
                size="small"
              >
                {VIS_LABEL[detail.archVisibility] || detail.archVisibility}
              </Tag>
            </div>
            <div>
              <span style={{ color: "#8a8f99", marginRight: 12 }}>文件版本</span>
              <span>{detail.archFileVersion || "v1"}</span>
            </div>
            {detail.storageKey && (
              <div>
                <span style={{ color: "#8a8f99", marginRight: 12 }}>归档文件</span>
                <a
                  href={getFileUrl(detail.storageKey)}
                  target="_blank"
                  rel="noreferrer"
                  download={detail.archDisplayName}
                >
                  <Button theme="primary" size="small" variant="outline">
                    下载 / 预览原文件
                  </Button>
                </a>
              </div>
            )}
            <div style={{ color: "#a9abb2", fontSize: 12, marginTop: 4 }}>
              正式归档文件存储在服务器 uploads 目录，按「归属地 / 届 / 分类」归档；此处为归档台账。
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
