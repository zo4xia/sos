"use client";

/**
 * M06: 参选人报名材料管理 (/election/materials)
 * 自荐/组织推荐双轨申报；多附件原名原格式下载预览；初审通过自动推进候选人池。
 * 数据链路（对齐 cxq-backend/src/routes/materials.ts）：
 *   - 录入：POST /admin/materials {electionFiefId, phone, name, title, description}
 *   - 审核：PATCH /admin/materials/:id/review {status, note}
 *   - 附件：两步链 = /files/upload 拿 storageKey 四元组 → POST JSON 关联
 */
import React, { useEffect, useMemo, useState } from "react";
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
  Textarea,
  Divider,
  Upload,
} from "tdesign-react";
import { AddIcon, BrowseIcon, UserIcon, SearchIcon } from "tdesign-icons-react";
import {
  getMaterials,
  createMaterial,
  reviewMaterial,
  appendMaterialFile,
  Material,
} from "@/lib/api/materials";
import { getPositions, Position } from "@/lib/api/positions";
import { getElectionFiefs,
  pickDefaultFief, ElectionFief } from "@/lib/api/elections";
import { useElectionStore } from "@/lib/stores/useElectionStore";
import { StatusTag } from "@/lib/components/StatusTag";
import { PermGate } from "@/lib/components/PermGate";
import { Field } from "@/lib/components/Field";
import { FileList } from "@/lib/components/FileList";
import { fmtDateTime } from "@/lib/utils/fmt";

/** 材料状态（对齐后端 materials.status 唯一 3 值：submitted/approved/rejected） */
const STATUS_OPTIONS = [
  { label: "待审核", value: "submitted" },
  { label: "已通过", value: "approved" },
  { label: "已驳回", value: "rejected" },
];

/** 从 TDesign Upload 的 onChange 文件列表里提取原始 File 对象 */
const pickRawFiles = (files: unknown[]): File[] =>
  files.map((f) => (f as { raw?: File }).raw).filter(Boolean) as File[];

export default function MaterialsPage() {
  const [list, setList] = useState<Material[]>([]);
  const [loading, setLoading] = useState(false);
  const [fiefs, setFiefs] = useState<ElectionFief[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedFiefId, setSelectedFiefId] = useState<string>("");

  // 筛选条（客户端本地过滤，与原版一致）
  const [statusInput, setStatusInput] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [appliedStatus, setAppliedStatus] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");

  // 弹窗状态
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentMat, setCurrentMat] = useState<Material | null>(null);
  const [recommendVisible, setRecommendVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 组织推荐 (内推) 表单（提交映射到后端 name/phone）
  const [candidateName, setCandidateName] = useState("");
  const [candidatePhone, setCandidatePhone] = useState("");
  const [targetPosition, setTargetPosition] = useState("");
  const [recommendNote, setRecommendNote] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  // 每次打开弹窗递增，用于重置 Upload 组件内部的文件列表
  const [recommendFormKey, setRecommendFormKey] = useState(0);

  // 审核处理状态
  const [reviewVisible, setReviewVisible] = useState(false);
  const [reviewDecision, setReviewDecision] = useState<"approved" | "rejected">("approved");
  const [reviewNote, setReviewNote] = useState("");

  const currentFiefId = useElectionStore((s) => s.currentFiefId);

  // 1. 初始化活动列表
  useEffect(() => {
    getElectionFiefs().then((data) => {
      setFiefs(data);
      if (data.length > 0) {
        const target = pickDefaultFief(data, currentFiefId)?.id || data[0].id;
        setSelectedFiefId(target);
      }
    });
  }, [currentFiefId]);

  // 2. 加载材料和岗位列表
  const loadData = async () => {
    if (!selectedFiefId) return;
    setLoading(true);
    try {
      const [matData, posData] = await Promise.all([
        getMaterials({ electionFiefId: selectedFiefId }),
        getPositions({ electionFiefId: selectedFiefId }),
      ]);
      setList(matData);
      setPositions(posData);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "加载报名材料失败";
      MessagePlugin.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedFiefId]);

  // 3. 本地筛选（状态 3 值 + 姓名/手机号关键词）
  const filteredList = useMemo(() => {
    const kw = appliedKeyword.trim();
    return list.filter((m) => {
      if (appliedStatus && m.status !== appliedStatus) return false;
      if (kw && !`${m.submitterName || ""}${m.submitterPhone || ""}`.includes(kw)) return false;
      return true;
    });
  }, [list, appliedStatus, appliedKeyword]);

  const handleSearch = () => {
    setAppliedStatus(statusInput);
    setAppliedKeyword(keywordInput);
  };

  const handleReset = () => {
    setStatusInput("");
    setKeywordInput("");
    setAppliedStatus("");
    setAppliedKeyword("");
  };

  // 打开组织推荐 (内推) 弹窗
  const openRecommendModal = () => {
    setCandidateName("");
    setCandidatePhone("");
    setTargetPosition(positions[0]?.name || "");
    setRecommendNote("");
    setSelectedFiles([]);
    setRecommendFormKey((k) => k + 1);
    setRecommendVisible(true);
  };

  // 提交组织推荐材料（POST /admin/materials，字段映射 name/phone）
  const handleRecommendSubmit = async () => {
    if (!candidateName.trim() || !candidatePhone.trim()) {
      MessagePlugin.error("请填写参选人姓名和手机号");
      return;
    }
    if (candidatePhone.trim().length !== 11) {
      MessagePlugin.error("请输入标准的 11 位手机号");
      return;
    }

    setSubmitting(true);
    try {
      const title = `【组织推荐】${targetPosition || "参选岗位"} - ${candidateName.trim()}`;
      const created = await createMaterial({
        electionFiefId: selectedFiefId,
        name: candidateName.trim(),
        phone: candidatePhone.trim(),
        title,
        description: recommendNote.trim() || "组织提名推荐人选",
      });

      // 如果有附件，走两步链依次上传并关联（先 /files/upload 再 POST JSON）
      if (selectedFiles.length > 0 && created?.id) {
        for (const file of selectedFiles) {
          await appendMaterialFile(created.id, file);
        }
      }

      MessagePlugin.success("组织推荐材料录入成功！");
      setRecommendVisible(false);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "录入材料失败";
      MessagePlugin.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // 审核材料（PATCH {status, note}；通过进候选人池 / 驳回）
  const handleReviewSubmit = async () => {
    if (!currentMat) return;
    // R-19：驳回时批注必填（驳回原因留痕，退回提交人补件依据）
    if (reviewDecision === "rejected" && !reviewNote.trim()) {
      MessagePlugin.error("驳回时必须填写审核意见（作为退回补件的书面依据留痕）");
      return;
    }
    setSubmitting(true);
    try {
      await reviewMaterial(currentMat.id, reviewDecision, reviewNote);
      if (reviewDecision === "approved") {
        MessagePlugin.success("🎉 材料审核通过！该人员已正式进入候选人池，等待线下四轮联审！");
      } else {
        MessagePlugin.warning("材料已驳回，退回提交人补件");
      }
      setReviewVisible(false);
      setDetailVisible(false);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "审核处理失败";
      MessagePlugin.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // 详情弹窗：审核员代参选人兜底传附件（两步链，传完刷新列表）
  const handleAppendFiles = async (files: File[]) => {
    if (!currentMat || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        await appendMaterialFile(currentMat.id, file);
      }
      MessagePlugin.success(`已代传 ${files.length} 份附件`);
      // 重新拉取列表并同步刷新弹窗内的附件
      const fresh = await getMaterials({ electionFiefId: selectedFiefId });
      setList(fresh);
      const updated = fresh.find((m) => m.id === currentMat.id);
      if (updated) setCurrentMat(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "上传附件失败";
      MessagePlugin.error(msg);
    } finally {
      setUploading(false);
    }
  };

  const columns = [
    {
      colKey: "submitterName",
      title: "参选人姓名",
      width: 140,
      cell: ({ row }: { row: Material }) => {
        const name = row.submitterName || row.submitterPhone || "—";
        return (
          <Space size="small">
            <UserIcon style={{ color: "#0052d9" }} />
            <strong>{name}</strong>
          </Space>
        );
      },
    },
    {
      colKey: "submitterPhone",
      title: "手机号 (归属地绑定)",
      width: 150,
      cell: ({ row }: { row: Material }) => row.submitterPhone || "—",
    },
    {
      colKey: "sourceType",
      title: "申报形式",
      width: 130,
      cell: ({ row }: { row: Material }) => {
        const isRecommend = (row.title || "").includes("组织推荐");
        return (
          <Tag theme={isRecommend ? "warning" : "primary"} variant="light">
            {isRecommend ? "🎖 组织推荐" : "🙋‍♂️ 个人自荐"}
          </Tag>
        );
      },
    },
    {
      colKey: "title",
      title: "参选材料 / 意向岗位",
      width: 240,
      cell: ({ row }: { row: Material }) => <span>{row.title}</span>,
    },
    {
      colKey: "files",
      title: "归档材料附件",
      width: 130,
      cell: ({ row }: { row: Material }) => (
        <Tag theme="default" variant="light">
          📎 {row.files?.length || 0} 份附件
        </Tag>
      ),
    },
    {
      colKey: "status",
      title: "材料审核状态",
      width: 120,
      cell: ({ row }: { row: Material }) => <StatusTag type="material" status={row.status} />,
    },
    {
      colKey: "submittedAt",
      title: "提交时间",
      width: 180,
      cell: ({ row }: { row: Material }) => <span>{fmtDateTime(row.submittedAt)}</span>,
    },
    {
      colKey: "op",
      title: "操作",
      width: 160,
      cell: ({ row }: { row: Material }) => (
        <Space>
          <Button
            theme="default"
            variant="text"
            size="small"
            icon={<BrowseIcon />}
            onClick={() => {
              setCurrentMat(row);
              setDetailVisible(true);
            }}
          >
            查验附件
          </Button>

          {row.status === "submitted" && (
            <PermGate perm="material:review" roles={["platform_admin", "sub_admin", "reviewer"]}>
              <Button
                theme="primary"
                variant="text"
                size="small"
                onClick={() => {
                  setCurrentMat(row);
                  setReviewDecision("approved");
                  setReviewNote("");
                  setReviewVisible(true);
                }}
              >
                审核
              </Button>
            </PermGate>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="参选人报名材料管理"
        description="申报形式包含【个人自荐】与【组织推荐】。所有文件自动按「归属地/届次/岗位/人名」归档落盘。材料审核通过后，该人员直接推入候选人池。"
        actions={
          <Space>
            <Select
              style={{ width: 240 }}
              value={selectedFiefId}
              onChange={(v) => setSelectedFiefId(v as string)}
              options={fiefs.map((f) => ({ label: `${f.name} (${f.dDay})`, value: f.id }))}
            />
            {/* R-04：录入/代传统一按 material:edit 收口（reviewer 无此权限点，与 23 号角色定义对齐） */}
            <PermGate perm="material:edit">
              <Button theme="primary" icon={<AddIcon />} onClick={openRecommendModal}>
                录入组织推荐人选
              </Button>
            </PermGate>
          </Space>
        }
      >
        {/* 筛选条（本地过滤） */}
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <Select
            style={{ width: 140 }}
            value={statusInput}
            onChange={(v) => setStatusInput((v as string) || "")}
            placeholder="全部状态"
            clearable
            options={STATUS_OPTIONS}
          />
          <Input
            style={{ width: 220 }}
            value={keywordInput}
            onChange={(v) => setKeywordInput(v as string)}
            placeholder="搜索姓名 / 手机号"
            clearable
          />
          <Button variant="outline" icon={<SearchIcon />} onClick={handleSearch}>
            查询
          </Button>
          <Button variant="text" onClick={handleReset}>
            重置
          </Button>
        </div>

        <Table data={filteredList} columns={columns} rowKey="id" loading={loading} />
      </Card>

      {/* 组织推荐 (内推) 录入弹窗 */}
      <Dialog
        header="录入组织推荐参选材料（代建）"
        visible={recommendVisible}
        onClose={() => setRecommendVisible(false)}
        confirmBtn={{ content: "确认录入并归档", theme: "primary", loading: submitting }}
        onConfirm={handleRecommendSubmit}
        width={580}
      >
        <Form labelWidth={130}>
          <Field label="参选人真实姓名" requiredMark>
            <Input
              value={candidateName}
              onChange={(v) => setCandidateName(v as string)}
              placeholder="请输入参选人姓名"
            />
          </Field>

          <Field label="手机号 (账号绑定)" requiredMark>
            <Input
              value={candidatePhone}
              maxlength={11}
              onChange={(v) => setCandidatePhone(v as string)}
              placeholder="请输入11位手机号（若无账号系统将自动建档）"
            />
          </Field>

          <Field label="拟推荐竞选岗位" requiredMark>
            <Select
              value={targetPosition}
              onChange={(v) => setTargetPosition(v as string)}
              options={positions.map((p) => ({ label: `${p.name} (拟选${p.quota}人)`, value: p.name }))}
              placeholder="请选择岗位"
            />
          </Field>

          <Field label="组织推荐说明">
            <Textarea
              value={recommendNote}
              onChange={(v) => setRecommendNote(v as string)}
              autosize={{ minRows: 3, maxRows: 6 }}
              placeholder="经党支部/选委会研究，拟推荐该同志参选..."
            />
          </Field>

          <Divider align="left">参选资格证明材料（自动按人名落盘）</Divider>
          <Field label="上传身份证/简历等">
            <Upload
              key={`recommend-upload-${recommendFormKey}`}
              theme="file"
              multiple
              accept="image/*,.pdf"
              autoUpload={false}
              onChange={(files) => setSelectedFiles(pickRawFiles(files))}
            />
            <div style={{ color: "#888", fontSize: 12, marginTop: 4 }}>
              支持同时选择身份证复印件、学历证书、无犯罪证明、承诺书等
            </div>
          </Field>
        </Form>
      </Dialog>

      {/* 查验附件与材料明细弹窗 */}
      <Dialog
        header="参选资格证明材料明细"
        visible={detailVisible}
        onClose={() => setDetailVisible(false)}
        footer={
          <Space>
            {currentMat?.status === "submitted" && (
              <PermGate perm="material:review" roles={["platform_admin", "sub_admin", "reviewer"]}>
                <Button
                  theme="primary"
                  onClick={() => {
                    setReviewDecision("approved");
                    setReviewNote("");
                    setReviewVisible(true);
                  }}
                >
                  去审核批复
                </Button>
              </PermGate>
            )}
            <Button onClick={() => setDetailVisible(false)}>关闭</Button>
          </Space>
        }
        width={680}
      >
        {currentMat && (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3>{currentMat.submitterName || currentMat.submitterPhone || "参选人"} 的参选材料</h3>
              <StatusTag type="material" status={currentMat.status} />
            </div>
            <p>
              <strong>归属活动：</strong>
              {currentMat.fiefName}
            </p>
            <p>
              <strong>申报形式：</strong>
              {(currentMat.title || "").includes("组织推荐")
                ? "🎖 组织推荐（小编代建）"
                : "🙋‍♂️ 个人自荐（小程序端提交）"}
            </p>
            <p>
              <strong>参选意向标题：</strong>
              {currentMat.title}
            </p>
            {currentMat.description && (
              <p>
                <strong>履历及推荐说明：</strong>
                {currentMat.description}
              </p>
            )}
            <p>
              <strong>提交时间：</strong>
              {fmtDateTime(currentMat.submittedAt)}
            </p>
            {currentMat.candidateId && (
              <p>
                <strong>候选人池：</strong>
                <Tag theme="success" variant="light">
                  已入池（R1 待审）
                </Tag>
              </p>
            )}
            {currentMat.reviewNote && (
              <p style={{ color: currentMat.status === "approved" ? "#00a870" : "#d50000" }}>
                <strong>审核批注：</strong>
                {currentMat.reviewNote}
              </p>
            )}

            <Divider align="left">服务器归档文件列表（支持原生原名高速下载）</Divider>
            <FileList files={currentMat.files || []} />

            {/* 代传附件：工作人员代参选人兜底传附件（两步链上传，传完刷新；R-04 按 material:edit 收口） */}
            <PermGate perm="material:edit">
              <Divider align="left">代传附件（工作人员兜底能力）</Divider>
              <Upload
                key={`detail-upload-${currentMat.id}`}
                theme="file"
                multiple
                accept="image/*,.pdf"
                autoUpload={false}
                disabled={uploading}
                onChange={(files) => {
                  const picked = pickRawFiles(files);
                  if (!picked.length) return;
                  void handleAppendFiles(picked);
                }}
              />
              <div style={{ color: "#888", fontSize: 12, marginTop: 4 }}>
                参选人线下补交的纸质材料扫描件，可由此处代为上传归档（选择后立即上传）
              </div>
            </PermGate>
          </div>
        )}
      </Dialog>

      {/* 审核决定 Dialog */}
      <Dialog
        header="报名材料资格初审"
        visible={reviewVisible}
        onClose={() => setReviewVisible(false)}
        confirmBtn={{ content: "确认审核结果", theme: "primary", loading: submitting }}
        onConfirm={handleReviewSubmit}
        width={500}
      >
        {currentMat && (
          <div>
            <p>
              正在审核：<strong>{currentMat.submitterName || currentMat.submitterPhone || "—"}</strong>
            </p>

            <Field label="审核决定" style={{ marginTop: 16 }}>
              <Select
                value={reviewDecision}
                onChange={(v) => setReviewDecision(v as "approved" | "rejected")}
                options={[
                  {
                    label: "✅ 材料齐全，审核通过（立即推入候选人池，进入R1轮次）",
                    value: "approved",
                  },
                  { label: "❌ 材料有缺失/不合规，予以驳回（可重新补件）", value: "rejected" },
                ]}
              />
            </Field>

            <Field label="审核意见" style={{ marginTop: 12 }}>
              <Input
                value={reviewNote}
                onChange={(v) => setReviewNote(v as string)}
                placeholder="请输入审核批注（驳回时注明原因）"
              />
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
