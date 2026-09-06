"use client";

/**
 * M05: 岗位选举表 (/election/positions)
 * 设岗审计台账；法定报名周期（D-15~D-13）；岗位资格红头文件上传。
 *
 * Sub D 口径切换：
 *  · 顶部届次切换 Select（全量 fiefs，label = `${elTerm} · ${fief.name}`，elTerm 来自 useElectionTerms）
 *  · 明细弹窗附件回显走 GET /admin/positions/:id/files（biz-files 通用路由，原先恒空的根因）
 *  · 上传换 TDesign Upload（theme=file，multipart 直传 /admin/positions/:id/file——后端 biz-files
 *    attach 路由为 multipart 形态，非材料的 JSON 两步链，已按源码核对实现）
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
  Divider,
  Select,
  Upload,
} from "tdesign-react";
import type { UploadFile } from "tdesign-react";
import { BrowseIcon, UploadIcon } from "tdesign-icons-react";
import {
  Position,
  PositionFile,
  getPositions,
  getPositionFiles,
  uploadPositionFile,
} from "@/lib/api/positions";
import { getElectionFiefs,
  pickDefaultFief, ElectionFief } from "@/lib/api/elections";
import { useElectionStore } from "@/lib/stores/useElectionStore";
import { useElectionTerms } from "@/lib/hooks/useElectionTerms";
import { PermGate } from "@/lib/components/PermGate";
import { FileList } from "@/lib/components/FileList";

export default function PositionsPage() {
  const [list, setList] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [fiefs, setFiefs] = useState<ElectionFief[]>([]);
  const [selectedFiefId, setSelectedFiefId] = useState<string>("");
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentPos, setCurrentPos] = useState<Position | null>(null);
  const [detailFiles, setDetailFiles] = useState<PositionFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);

  const currentFiefId = useElectionStore((s) => s.currentFiefId);
  // 届次映射：elId（= election_fiefs.id）→ { elTerm, ... }
  const { termMap } = useElectionTerms();

  // 封地（届）列表：默认选当前届（store 中的封地），其次第一个；可切换
  useEffect(() => {
    let alive = true;
    getElectionFiefs()
      .then((data) => {
        if (!alive) return;
        setFiefs(data);
        setSelectedFiefId((prev) => {
          if (prev && data.some((f) => f.id === prev)) return prev;
          if (currentFiefId && data.some((f) => f.id === currentFiefId)) return currentFiefId;
          return pickDefaultFief(data)?.id || data[0]?.id || "";
        });
      })
      .catch(() => {
        if (alive) MessagePlugin.error("加载选举活动列表失败");
      });
    return () => {
      alive = false;
    };
  }, [currentFiefId]);

  const loadData = async (fiefId: string = selectedFiefId) => {
    if (!fiefId) return;
    setLoading(true);
    try {
      const data = await getPositions({ electionFiefId: fiefId });
      setList(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "加载岗位列表失败";
      MessagePlugin.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedFiefId) {
      setList([]);
      loadData(selectedFiefId);
    }
  }, [selectedFiefId]);

  // 打开明细：拉取该岗位附件列表（biz-files 通用路由）
  const openDetail = async (pos: Position) => {
    setCurrentPos(pos);
    setDetailFiles([]);
    setUploadFiles([]);
    setDetailVisible(true);
    setFilesLoading(true);
    try {
      setDetailFiles(await getPositionFiles(pos.id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "加载岗位附件失败";
      MessagePlugin.error(msg);
    } finally {
      setFilesLoading(false);
    }
  };

  // 选文件后直传（multipart → /admin/positions/:id/file，上传后回显刷新）
  const handleSelectFiles = async (files: File[]) => {
    if (!currentPos || !files.length) return;
    setUploading(true);
    try {
      for (const f of files) {
        await uploadPositionFile(currentPos.id, f);
      }
      MessagePlugin.success(`已上传 ${files.length} 份岗位资格文件`);
      setUploadFiles([]);
      setDetailFiles(await getPositionFiles(currentPos.id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "上传附件失败";
      MessagePlugin.error(msg);
    } finally {
      setUploading(false);
    }
  };

  const columns = [
    {
      colKey: "name",
      title: "岗位名称",
      width: 180,
      cell: ({ row }: { row: Position }) => (
        <strong style={{ fontSize: 15, color: "#1d2129" }}>{row.name}</strong>
      ),
    },
    {
      colKey: "quota",
      title: "拟选名额",
      width: 110,
      cell: ({ row }: { row: Position }) => (
        <Tag theme="primary" variant="light">
          {row.quota} 名
        </Tag>
      ),
    },
    {
      colKey: "applicationTime",
      title: "法定报名起止周期",
      width: 220,
      cell: ({ row }: { row: Position }) => (
        <span style={{ fontSize: 13, color: "#4e5969" }}>
          {row.applicationStart} 至 {row.applicationEnd}
        </span>
      ),
    },
    {
      colKey: "reviewTime",
      title: "材料审核起止周期",
      width: 220,
      cell: ({ row }: { row: Position }) => (
        <span style={{ fontSize: 13, color: "#4e5969" }}>
          {row.materialReviewStart} 至 {row.materialReviewEnd}
        </span>
      ),
    },
    {
      colKey: "status",
      title: "状态",
      width: 100,
      cell: ({ row }: { row: Position }) => (
        <Tag theme={row.status === "open" ? "success" : "default"} variant="light">
          {row.status === "open" ? "报名招募中" : "已截止"}
        </Tag>
      ),
    },
    {
      colKey: "op",
      title: "操作",
      width: 140,
      cell: ({ row }: { row: Position }) => (
        <Button
          theme="primary"
          variant="text"
          size="small"
          icon={<BrowseIcon />}
          onClick={() => openDetail(row)}
        >
          查看岗位明细
        </Button>
      ),
    },
  ];

  const selectedFief = selectedFiefId ? fiefs.find((f) => f.id === selectedFiefId) : undefined;

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="换届岗位选举表"
        description="换届岗位及职数由【选举提案】审批通过后依法固化生成。报名与审核起止时间已由 D-day 自动依法倒排（D-15至D-13）。"
        actions={
          <Space>
            <Select
              style={{ width: 280 }}
              value={selectedFiefId || undefined}
              placeholder="切换选举届次"
              onChange={(v) => setSelectedFiefId(v as string)}
              options={fiefs.map((f) => ({
                label: termMap[f.id]?.elTerm ? `${termMap[f.id].elTerm} · ${f.name}` : f.name,
                value: f.id,
              }))}
            />
          </Space>
        }
      >
        {selectedFief && (
          <div style={{ marginBottom: 12, color: "#888", fontSize: 12 }}>
            当前查看：{termMap[selectedFief.id]?.elTerm || "换届届次"} · {selectedFief.name}（选举日 {selectedFief.dDay}）· 共 {list.length} 个岗位
          </div>
        )}
        <Table data={list} columns={columns} rowKey="id" loading={loading} />
      </Card>

      {/* 岗位明细弹窗（附件回显 + Upload 上传） */}
      <Dialog
        header={`岗位明细 · ${currentPos?.name || ""}`}
        visible={detailVisible}
        onClose={() => setDetailVisible(false)}
        footer={<Button onClick={() => setDetailVisible(false)}>关闭</Button>}
        width={620}
      >
        {currentPos && (
          <div>
            <p>
              <strong>岗位名称：</strong>
              {currentPos.name}
            </p>
            <p>
              <strong>计划职数：</strong>
              {currentPos.quota} 人
            </p>
            <p>
              <strong>自荐/联名报名期限：</strong>
              {currentPos.applicationStart} 至 {currentPos.applicationEnd}
            </p>
            <p>
              <strong>资格材料初审期限：</strong>
              {currentPos.materialReviewStart} 至 {currentPos.materialReviewEnd}
            </p>

            <Divider align="left">岗位招募文件及附件</Divider>
            <div style={{ color: filesLoading ? "#999" : undefined }}>
              {filesLoading ? (
                <span style={{ color: "#999" }}>附件加载中…</span>
              ) : (
                <FileList files={detailFiles} />
              )}
            </div>

            <div style={{ marginTop: 20 }}>
              {/* 原版无按钮级鉴权（后端 staff 级守卫），去掉 perm 门槛只留 staff 角色判定 */}
              <PermGate roles={["platform_admin", "sub_admin", "editor"]}>
                <Upload
                  theme="file"
                  autoUpload={false}
                  multiple
                  disabled={uploading}
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                  files={uploadFiles}
                  onChange={(v) => setUploadFiles(v)}
                  onSelectChange={(files) => handleSelectFiles(files)}
                  placeholder="选择报名表 / 资格文件（支持多选，选定即上传）"
                />
                <div style={{ marginTop: 8, fontSize: 12, color: "#999" }}>
                  上传后小程序端「选举方式」页及本弹窗即可下载该岗位资格文件。
                </div>
              </PermGate>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
