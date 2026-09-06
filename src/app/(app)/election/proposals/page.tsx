"use client";

/**
 * M02: 换届选举提案 (/election/proposals)
 * 换届活动诞生的唯一起点。D-day 锚点 + 动态设岗 + 附件；审批通过单事务触发全套 Pipeline。
 */
import React, { useEffect, useState } from "react";
import {
  Card,
  Table,
  Button,
  Dialog,
  Form,
  Input,
  DatePicker,
  Select,
  InputNumber,
  Space,
  MessagePlugin,
  Divider,
  Upload,
  Alert,
  Tag,
} from "tdesign-react";
import { AddIcon, DeleteIcon, SearchIcon, BrowseIcon, EditIcon } from "tdesign-icons-react";
import {
  getProposals,
  createProposal,
  reviewProposal,
  uploadProposalFile,
  Proposal,
  PositionInput,
} from "@/lib/api/proposals";
import { getAccounts } from "@/lib/api/accounts";
import { useAuthStore } from "@/lib/stores/useAuthStore";
import { StatusTag } from "@/lib/components/StatusTag";
import { PermGate } from "@/lib/components/PermGate";
import { FileList } from "@/lib/components/FileList";
import { Field } from "@/lib/components/Field";
import { fmtDateTime } from "@/lib/utils/fmt";

/** 从 TDesign Upload 的 onChange 文件列表里提取原始 File 对象 */
const pickRawFiles = (files: unknown[]): File[] =>
  files.map((f) => (f as { raw?: File }).raw).filter(Boolean) as File[];

export default function ProposalsPage() {
  const [list, setList] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [currentProposal, setCurrentProposal] = useState<Proposal | null>(null);
  const [reviewDecision, setReviewDecision] = useState<"approved" | "rejected">("approved");
  const [reviewNote, setReviewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 筛选条（客户端本地过滤，照原版「查询/重置」交互；后端不收 status/keyword）
  const [kwInput, setKwInput] = useState("");
  const [statusInput, setStatusInput] = useState("all");
  const [kw, setKw] = useState("");
  const [status, setStatus] = useState("all");

  // 驳回后重新编辑：预填自被驳回提案，提交时生成新提案送审（原驳回记录留痕）
  const [resubmitFrom, setResubmitFrom] = useState<Proposal | null>(null);
  // R-08：审核人姓名解析（仅 sub_admin/platform 可访问账号表；其余角色不显示该行）
  const [reviewerName, setReviewerName] = useState("");

  // 表单状态：D-day、提案名称、岗位表
  const [name, setName] = useState("");
  const [dDay, setDDay] = useState("");
  const [positions, setPositions] = useState<PositionInput[]>([
    { name: "村委会主任", quota: 1, requirement: "年满十八周岁，具有选民资格" },
    { name: "村委会委员", quota: 4, requirement: "遵纪守法，品行良好，公道正派" },
  ]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  // 弹窗重开时递增，重置 Upload 组件内部文件列表
  const [uploadKey, setUploadKey] = useState(0);

  const user = useAuthStore((s) => s.user);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getProposals();
      setList(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "加载提案失败";
      MessagePlugin.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // R-08：打开明细时解析审核人姓名（需 /admin/accounts 权限，无权则静默不显示）
  useEffect(() => {
    setReviewerName("");
    if (!currentProposal?.reviewedBy) return;
    const canLookup = user?.role === "platform_admin" || user?.role === "sub_admin";
    if (!canLookup) return;
    getAccounts({ orgId: currentProposal.organizationId })
      .then((rows) => {
        const hit = rows.find((r) => r.id === currentProposal.reviewedBy);
        if (hit) setReviewerName(hit.displayName || hit.phone);
      })
      .catch(() => setReviewerName(""));
  }, [currentProposal]);

  // R-16：返修版推导 —— 同名提案存在更早的驳回记录，则本条 pending 为返修送审版（纯展示推导，不污染数据）
  const isResubmission = (row: Proposal): boolean =>
    row.status === "pending" &&
    list.some(
      (p) => p.status === "rejected" && p.name === row.name && p.createdAt < row.createdAt,
    );

  // 重置新建表单（根据村/社区自动带出初始岗位名称）；传入 from 则为驳回后重新编辑预填
  const openCreateModal = (from?: Proposal) => {
    setResubmitFrom(from || null);
    const isCommunity = user?.orgType === "community";
    if (from) {
      setName(from.name);
      setDDay(from.dDay || "");
      setPositions(
        (from.positions || []).length > 0
          ? from.positions.map((p) => ({
              name: p.name,
              quota: p.quota,
              requirement: p.requirement,
            }))
          : [{ name: "村委会主任", quota: 1, requirement: "年满十八周岁，具有选民资格" }],
      );
    } else {
      setName(`${user?.orgName || ""}2026年换届选举工作方案提案`);
      setPositions(
        isCommunity
          ? [
              { name: "居委会主任", quota: 1, requirement: "年满十八周岁，具有居民代表选举资格" },
              { name: "居委会副主任", quota: 1, requirement: "热心社区公益事业，遵纪守法" },
              { name: "居委会委员", quota: 5, requirement: "热心社区服务，品行良好，身体健康" },
            ]
          : [
              { name: "村委会主任", quota: 1, requirement: "年满十八周岁，具有选民资格，遵纪守法" },
              { name: "村委会副主任", quota: 1, requirement: "热心农村公益事业，公道正派" },
              { name: "村委会委员", quota: 3, requirement: "遵纪守法，品行端正，廉洁奉公" },
            ],
      );
    }
    setSelectedFiles([]);
    setUploadKey((k) => k + 1);
    setCreateVisible(true);
  };

  const addPositionRow = () => {
    setPositions([...positions, { name: "", quota: 1, requirement: "" }]);
  };

  const removePositionRow = (index: number) => {
    if (positions.length <= 1) {
      MessagePlugin.warning("换届提案至少须设置 1 个岗位");
      return;
    }
    setPositions(positions.filter((_, i) => i !== index));
  };

  // 提交提案（重新编辑时为新建一条新提案，原驳回记录留痕可追溯）
  const handleSubmitProposal = async () => {
    if (!name.trim() || !dDay) {
      MessagePlugin.error("请完整填写提案名称并指定正式选举日 (D-day)");
      return;
    }
    for (const p of positions) {
      if (!p.name.trim()) {
        MessagePlugin.error("所有岗位名称均不能为空");
        return;
      }
    }

    setSubmitting(true);
    try {
      const created = await createProposal({
        organizationId: user?.organizationId,
        name: name.trim(),
        dDay,
        orgType: user?.orgType || "village",
        positions,
      });

      // 如果选了附件，一并上传关联到 proposal_files
      if (selectedFiles.length > 0 && created?.id) {
        for (const f of selectedFiles) {
          await uploadProposalFile(created.id, f);
        }
      }

      if (resubmitFrom) {
        MessagePlugin.success("已重新提交提案送审！原驳回记录保留留痕，可追溯比对修改");
      } else {
        MessagePlugin.success("提案已发起！等待审核人批复");
      }
      setCreateVisible(false);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "发起提案失败";
      MessagePlugin.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // 批复审核
  const handleReview = async () => {
    if (!currentProposal) return;
    // R-19：驳回时批注必填（驳回原因将落库留痕，供发起人返修参考）
    if (reviewDecision === "rejected" && !reviewNote.trim()) {
      MessagePlugin.error("驳回时必须填写审核批注（驳回原因将留痕供发起人返修参考）");
      return;
    }
    setSubmitting(true);
    try {
      await reviewProposal(currentProposal.id, reviewDecision, reviewNote);
      if (reviewDecision === "approved") {
        MessagePlugin.success(
          "🎉 提案审批通过！全套 14 阶段日程、各岗位、法定预排公告已由 Pipeline 自动生成！",
        );
      } else {
        MessagePlugin.warning("提案已驳回，发起人可重新修改后提交");
      }
      setReviewVisible(false);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "审核处理失败";
      MessagePlugin.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // 表格数据：客户端本地过滤（关键词 + 状态）
  const filteredList = list.filter(
    (p) =>
      (!kw || p.name.toLowerCase().includes(kw.toLowerCase())) &&
      (status === "all" || p.status === status),
  );

  const columns = [
    {
      colKey: "name",
      title: "提案名称",
      width: 260,
      cell: ({ row }: { row: Proposal }) => (
        <Space size={4}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.name}
          </span>
          {isResubmission(row) && (
            <Tag theme="warning" variant="light" size="small">
              返修版
            </Tag>
          )}
        </Space>
      ),
    },
    { colKey: "organizationName", title: "归属村/社区", width: 140 },
    {
      colKey: "dDay",
      title: "法定选举日 (D-day)",
      width: 160,
      cell: ({ row }: { row: Proposal }) => (
        <strong style={{ color: "#0052d9" }}>{row.dDay}</strong>
      ),
    },
    {
      colKey: "status",
      title: "状态",
      width: 100,
      cell: ({ row }: { row: Proposal }) => <StatusTag type="proposal" status={row.status} />,
    },
    {
      colKey: "createdAt",
      title: "发起时间",
      width: 180,
      cell: ({ row }: { row: Proposal }) => <span>{fmtDateTime(row.createdAt)}</span>,
    },
    {
      colKey: "op",
      title: "操作",
      width: 250,
      cell: ({ row }: { row: Proposal }) => (
        <Space>
          <Button
            theme="default"
            variant="text"
            size="small"
            icon={<BrowseIcon />}
            onClick={() => {
              setCurrentProposal(row);
              setDetailVisible(true);
            }}
          >
            查看明细
          </Button>

          {/* 驳回后重新编辑：预填原提案，提交生成新提案送审（原记录留痕） */}
          {row.status === "rejected" && (
            <PermGate perm="proposal:create" roles={["platform_admin", "sub_admin", "editor"]}>
              <Button
                theme="warning"
                variant="text"
                size="small"
                icon={<EditIcon />}
                onClick={() => openCreateModal(row)}
              >
                重新编辑
              </Button>
            </PermGate>
          )}

          {/* 只有 pending 且具备审核权限的人才可批复 */}
          {row.status === "pending" && (
            <PermGate perm="proposal:review" roles={["platform_admin", "reviewer", "sub_admin"]}>
              <Button
                theme="primary"
                variant="text"
                size="small"
                onClick={() => {
                  setCurrentProposal(row);
                  setReviewDecision("approved");
                  setReviewNote("");
                  setReviewVisible(true);
                }}
              >
                批复审核
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
        title="换届选举提案管理"
        description="正式选举日 (D-day) 是一切法定流程与发文 SOP 的时间锚点。提案审核通过后，系统自动初始化本届全套 Pipeline。"
        actions={
          <PermGate perm="proposal:create" roles={["platform_admin", "sub_admin", "editor"]}>
            <Button theme="primary" icon={<AddIcon />} onClick={() => openCreateModal()}>
              发起本届换届提案
            </Button>
          </PermGate>
        }
      >
        {/* 筛选条（照原版：关键词 + 状态 + 查询/重置，客户端本地过滤） */}
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <Input
            style={{ width: 240 }}
            value={kwInput}
            onChange={(v) => setKwInput(v as string)}
            placeholder="输入提案名称关键词..."
            prefixIcon={<SearchIcon />}
            clearable
          />
          <Select
            style={{ width: 160 }}
            value={statusInput}
            onChange={(v) => setStatusInput(v as string)}
            options={[
              { label: "全部状态", value: "all" },
              { label: "待审批", value: "pending" },
              { label: "已通过", value: "approved" },
              { label: "已驳回", value: "rejected" },
            ]}
          />
          <Button
            theme="primary"
            variant="outline"
            icon={<SearchIcon />}
            onClick={() => {
              setKw(kwInput.trim());
              setStatus(statusInput);
            }}
          >
            查询
          </Button>
          <Button
            theme="default"
            variant="outline"
            onClick={() => {
              setKwInput("");
              setStatusInput("all");
              setKw("");
              setStatus("all");
            }}
          >
            重置
          </Button>
          <span style={{ color: "#888", fontSize: 13, marginLeft: "auto" }}>
            共 {filteredList.length} 条提案
          </span>
        </div>

        <Table data={filteredList} columns={columns} rowKey="id" loading={loading} />
      </Card>

      {/* 新建换届提案 Dialog（重新编辑时：预填 + 留痕警示） */}
      <Dialog
        header={
          resubmitFrom
            ? "重新编辑并再次提交提案（原驳回记录留痕）"
            : "发起村居换届选举提案"
        }
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        confirmBtn={{
          content: resubmitFrom ? "重新提交送审" : "提交提案送审",
          theme: "primary",
          loading: submitting,
        }}
        onConfirm={handleSubmitProposal}
        width={720}
      >
        <div style={{ maxHeight: 520, overflowY: "auto", paddingRight: 8 }}>
          {resubmitFrom && (
            <Alert
              theme="warning"
              message={`原提案「${resubmitFrom.name}」的驳回记录将保留留痕；本次提交将生成新的提案记录重新送审，两版可追溯比对。`}
              style={{ marginBottom: 16 }}
            />
          )}
          <Form labelWidth={140}>
            <Field label="归属地">
              <Input
                value={`${user?.orgType === "community" ? "🏘 社区" : "🏡 农村行政村"} · ${user?.orgName || ""}`}
                disabled
              />
            </Field>

            <Field label="提案名称" requiredMark>
              <Input
                value={name}
                onChange={(v) => setName(v as string)}
                placeholder="例如：阔口社区2026年第十一届居民委员会换届选举提案"
              />
            </Field>

            <Field label="选举方式">
              <Input
                disabled
                value={
                  user?.orgType === "community"
                    ? "全民直选 / 户代表选举 / 居民代表选举（三选一，按居民委员会组织法确定）"
                    : "全民直选（唯一模式，依村民委员会组织法）"
                }
              />
              <div style={{ color: "#888", fontSize: 12, marginTop: 4 }}>
                * 选举方式将载入正式提案文书归档；结构化入库字段待后端扩展，当前以文书为准。
              </div>
            </Field>

            <Field label="法定选举日 (D-day)" requiredMark>
              <DatePicker
                value={dDay}
                onChange={(v: unknown) => setDDay(String(v || ""))}
                placeholder="请指定正式选举投票日"
                style={{ width: "100%" }}
              />
              <div style={{ color: "#0052d9", fontSize: 12, marginTop: 4 }}>
                * 核心定盘星：确认该日期后，全套 14 阶段公文、报名期限、联审日程均由系统依法倒排秒级生成。
              </div>
            </Field>

            <Divider align="left">本届拟设换届岗位及职数</Divider>
            <div
              style={{
                color: "#888",
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              * 任职资格与条件为提案文书要素，随线下正式文书一并存档（结构化字段待后端扩展）。
            </div>
            <div style={{ marginBottom: 16 }}>
              {positions.map((pos, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    marginBottom: 8,
                    background: "#f8f9fa",
                    padding: "8px 12px",
                    borderRadius: 4,
                  }}
                >
                  <Input
                    style={{ width: 160 }}
                    value={pos.name}
                    placeholder="岗位名称 (如主任)"
                    onChange={(v) => {
                      const next = [...positions];
                      next[idx] = { ...next[idx], name: v as string };
                      setPositions(next);
                    }}
                  />
                  <InputNumber
                    style={{ width: 110 }}
                    value={pos.quota}
                    min={1}
                    max={20}
                    onChange={(v) => {
                      const next = [...positions];
                      next[idx] = { ...next[idx], quota: Number(v || 1) };
                      setPositions(next);
                    }}
                  />
                  <Input
                    style={{ flex: 1 }}
                    value={pos.requirement}
                    placeholder="法定任职资格与条件"
                    onChange={(v) => {
                      const next = [...positions];
                      next[idx] = { ...next[idx], requirement: v as string };
                      setPositions(next);
                    }}
                  />
                  <Button
                    theme="danger"
                    variant="text"
                    shape="circle"
                    icon={<DeleteIcon />}
                    onClick={() => removePositionRow(idx)}
                  />
                </div>
              ))}
              <Button theme="default" variant="dashed" block icon={<AddIcon />} onClick={addPositionRow}>
                增加岗位设定
              </Button>
            </div>

            <Divider align="left">选举实施方案及附件材料</Divider>
            <Field label="上传附件材料">
              <Upload
                key={`proposal-upload-${uploadKey}`}
                theme="file"
                multiple
                autoUpload={false}
                onChange={(files) => setSelectedFiles(pickRawFiles(files))}
              />
              <div style={{ color: "#888", fontSize: 12, marginTop: 4 }}>
                支持上传由上级或选委会盖章的选举筹备文件、空白报名表单模板等附件（可多选）
              </div>
            </Field>
          </Form>
        </div>
      </Dialog>

      {/* 查看提案明细 Dialog */}
      <Dialog
        header="提案明细"
        visible={detailVisible}
        onClose={() => setDetailVisible(false)}
        footer={
          <Space>
            {currentProposal?.status === "rejected" && (
              <PermGate perm="proposal:create" roles={["platform_admin", "sub_admin", "editor"]}>
                <Button
                  theme="primary"
                  icon={<EditIcon />}
                  onClick={() => {
                    setDetailVisible(false);
                    openCreateModal(currentProposal);
                  }}
                >
                  ✏️ 重新编辑并再次提交
                </Button>
              </PermGate>
            )}
            <Button onClick={() => setDetailVisible(false)}>关闭</Button>
          </Space>
        }
        width={640}
      >
        {currentProposal && (
          <div>
            <p>
              <strong>提案名称：</strong>
              {currentProposal.name}
            </p>
            <p>
              <strong>归属地：</strong>
              {currentProposal.organizationName}
            </p>
            <p>
              <strong>法定选举日 (D-day)：</strong>
              <strong style={{ color: "#0052d9" }}>{currentProposal.dDay}</strong>
            </p>
            <p>
              <strong>提案状态：</strong>
              <StatusTag type="proposal" status={currentProposal.status} />
            </p>
            <p>
              <strong>发起时间：</strong>
              {fmtDateTime(currentProposal.createdAt)}
            </p>

            {/* R-03/R-08：审核留痕三要素（谁在何时依据什么批的） */}
            {currentProposal.reviewedAt && (
              <p>
                <strong>审核时间：</strong>
                {fmtDateTime(currentProposal.reviewedAt)}
              </p>
            )}
            {reviewerName && currentProposal.reviewedBy && (
              <p>
                <strong>审核人：</strong>
                {reviewerName}
              </p>
            )}
            {currentProposal.status === "rejected" && (
              <Alert
                theme="error"
                message={`驳回原因：${currentProposal.rejectReason || "（审批人未填写书面批注，请联系其补充说明）"}`}
                style={{ marginTop: 8 }}
              />
            )}

            <Divider align="left">本届设岗方案</Divider>
            <div style={{ background: "#f5f7fa", padding: 12, borderRadius: 4 }}>
              {(currentProposal.positions || []).map((p, i) => (
                <div key={i} style={{ marginBottom: 6 }}>
                  <strong>{p.name}</strong> —— 职数：{p.quota} 人；要求：{p.requirement || "按组织法规定"}
                </div>
              ))}
            </div>

            <Divider align="left">关联附件</Divider>
            <FileList files={currentProposal.files || []} />
          </div>
        )}
      </Dialog>

      {/* 批复审核 Dialog */}
      <Dialog
        header="换届提案批复审核"
        visible={reviewVisible}
        onClose={() => setReviewVisible(false)}
        confirmBtn={{ content: "确认批复", theme: "primary", loading: submitting }}
        onConfirm={handleReview}
        width={500}
      >
        {currentProposal && (
          <div>
            <p>
              <strong>正在审核：</strong>
              {currentProposal.name}
            </p>
            <p>
              <strong>法定选举日：</strong>
              {currentProposal.dDay}
            </p>

            <Field label="审核决定" style={{ marginTop: 16 }}>
              <Select
                value={reviewDecision}
                onChange={(v) => setReviewDecision(v as "approved" | "rejected")}
                options={[
                  {
                    label: "✅ 审核通过（自动触发生成本届 Pipeline 全套日程与公文）",
                    value: "approved",
                  },
                  { label: "❌ 驳回提案（退回发起人重新修改）", value: "rejected" },
                ]}
              />
            </Field>

            <Field label="审核批注" style={{ marginTop: 12 }}>
              <Input
                value={reviewNote}
                onChange={(v) => setReviewNote(v as string)}
                placeholder="请输入审核意见（驳回时必填）"
              />
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
