"use client";

/**
 * M07: 候选人四轮资格联审池 (/election/candidates)
 * 红线 A-002：绝无线上投票/选票/得票统计。四轮联审线下举办，线上依文号回填留痕。
 *
 * 数据口径（Sub D 切换）：列表源 = GET /api/candidates?electionId=<fiefId>（web 兼容口径）
 * —— candName/candPhone/candR1~R4 平铺/materials 内嵌（含 files[].file_name+storage_key）
 * 状态真实值域仅 3 种：reviewing / approved / rejected（不复刻原版 11 种假状态）
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
  Radio,
  Textarea,
  Select,
  Input,
  Divider,
} from "tdesign-react";
import { BrowseIcon, UserIcon, EditIcon, SearchIcon, RefreshIcon, DownloadIcon, MailIcon } from "tdesign-icons-react";
import {
  WebCandidate,
  WebCandidateMaterial,
  WebCandidateRoundKey,
  getWebCandidates,
  addCandidateReview,
} from "@/lib/api/candidates";
import { getElectionFiefs,
  pickDefaultFief, getFiefStages, ElectionFief, FiefStage } from "@/lib/api/elections";
import { getFileUrl, MaterialFile } from "@/lib/api/files";
import { useElectionStore } from "@/lib/stores/useElectionStore";
import { useElectionTerms } from "@/lib/hooks/useElectionTerms";
import { StatusTag } from "@/lib/components/StatusTag";
import { PermGate } from "@/lib/components/PermGate";
import { Field } from "@/lib/components/Field";
import { FileList } from "@/lib/components/FileList";
import { fmtDateTime as fmtTime } from "@/lib/utils/fmt";


// 四轮联审法定定义（直接映射甲方 DOCX）
const ROUND_CONFIG: Record<string, { name: string; dept: string; short: string }> = {
  R1: { name: "第一轮 · 乡镇/街道资格初审", dept: "乡镇/街道换届选举指导组", short: "R1初审" },
  R2: { name: "第二轮 · 竞选预选/差额筛选", dept: "村民代表大会 / 居民代表会议", short: "R2预选" },
  R3: { name: "第三轮 · 区级11部门资格联审", dept: "纪委监委、公安、法院、民政等11个部门", short: "R3联审" },
  R4: { name: "第四轮 · 党委/党工委考察确定", dept: "乡镇党委 / 街道党工委", short: "R4考察" },
};

const ROUND_KEYS: WebCandidateRoundKey[] = ["R1", "R2", "R3", "R4"];

// R1~R4 表头日期区间取自该封地 14 阶段日程（stage_key 与原版口径一致）
const ROUND_STAGE_KEYS: Record<WebCandidateRoundKey, string> = {
  R1: "prelim_shortlist",
  R2: "nominate_cont",
  R3: "joint_review",
  R4: "campaign_prep",
};

// 状态筛选：仅后端真实 3 值（原版 11 种状态系假枚举，不复刻）
const STATUS_OPTIONS = [
  { label: "审核中（四轮联审进行中）", value: "reviewing" },
  { label: "正式候选人（四轮全过）", value: "approved" },
  { label: "已淘汰（联审未通过）", value: "rejected" },
];

const CAND_STATUS_TEXT: Record<string, string> = {
  reviewing: "审核中（四轮联审进行中）",
  approved: "正式候选人（四轮全过）",
  rejected: "已淘汰（联审未通过）",
};

const ROUND_TAG_THEME: Record<string, "success" | "danger" | "warning" | "default"> = {
  通过: "success",
  不通过: "danger",
};

// 四轮联审时间展示统一走共享 fmtTime（@/lib/utils/fmt，YYYY-MM-DD HH:mm）

/** 单个轮次结果小标签（candR* 值为后端平铺的 "通过"/"不通过"，缺省即未到轮次） */
function RoundTag({ result }: { result?: string }) {
  if (!result) return <span style={{ color: "#c0c4cc" }}>—</span>;
  return (
    <Tag size="small" theme={ROUND_TAG_THEME[result] || "default"} variant="light">
      {result}
    </Tag>
  );
}

/** 强制下载（保持原文件名，新窗口兜底） */
const triggerDownload = (url: string, name: string) => {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

/** 过滤掉 storage_key 为空的种子行（后端存在 storage_key null 的历史数据） */
const pickRealFiles = (files: MaterialFile[]): MaterialFile[] =>
  (files || []).filter((f) => f && f.storageKey);

const displayName = (c: WebCandidate) => c.candName || c.candPhone || "—";

export default function CandidatesPage() {
  const [list, setList] = useState<WebCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [fiefs, setFiefs] = useState<ElectionFief[]>([]);
  const [selectedFiefId, setSelectedFiefId] = useState<string>("");
  const [stages, setStages] = useState<FiefStage[]>([]);

  // 筛选条（客户端本地过滤）
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [keyword, setKeyword] = useState<string>("");

  // 弹窗状态
  const [detailVisible, setDetailVisible] = useState(false);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [currentCand, setCurrentCand] = useState<WebCandidate | null>(null);

  // 录入线下联审结果表单
  const [selectedRound, setSelectedRound] = useState<WebCandidateRoundKey>("R1");
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [reviewNote, setReviewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const currentFiefId = useElectionStore((s) => s.currentFiefId);
  const { termMap } = useElectionTerms();

  // 封地（届）列表：默认选当前 store 中的封地，其次第一个
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

  // 列表 + 该封地阶段日程（R1~R4 表头日期用）
  const loadData = async (fiefId: string = selectedFiefId) => {
    if (!fiefId) return;
    setLoading(true);
    try {
      const [cands, stageRows] = await Promise.all([
        getWebCandidates(fiefId),
        getFiefStages(fiefId).catch(() => [] as FiefStage[]),
      ]);
      setList(cands);
      setStages(stageRows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "加载候选人池失败";
      MessagePlugin.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedFiefId) {
      setStages([]);
      setList([]);
      loadData(selectedFiefId);
    }
  }, [selectedFiefId]);

  // R1~R4 表头：带法定审核日期区间（照原版列结构）
  const roundHeaders = useMemo(
    () =>
      ROUND_KEYS.map((k) => {
        const stage = stages.find((s) => s.stageKey === ROUND_STAGE_KEYS[k]);
        const label = ROUND_CONFIG[k].short;
        return stage && stage.startDate && stage.endDate
          ? `${label}（${stage.startDate} ~ ${stage.endDate}）`
          : label;
      }),
    [stages],
  );

  // 客户端本地过滤（状态 + 姓名/手机号关键词）
  const filtered = useMemo(
    () =>
      list.filter((c) => {
        if (statusFilter && c.candStatus !== statusFilter) return false;
        const kw = keyword.trim();
        if (kw && !`${c.candName || ""}${c.candPhone || ""}`.includes(kw)) return false;
        return true;
      }),
    [list, statusFilter, keyword],
  );

  const resetFilters = () => {
    setStatusFilter("");
    setKeyword("");
  };

  // 打开录入结果弹窗（默认停在候选人当前轮次；后端按 current_round 强校验顺序）
  const openReviewModal = (cand: WebCandidate) => {
    setCurrentCand(cand);
    const currentR = (cand.candCurrentRound === "complete" ? "R4" : cand.candCurrentRound) as
      | WebCandidateRoundKey
      | undefined;
    setSelectedRound(currentR || "R1");
    setDecision("approved");
    setReviewNote("");
    setReviewVisible(true);
  };

  // 提交线下四轮审查结果录入（POST /admin/candidates/:id/reviews，回填链路保持不动）
  const handleReviewSubmit = async () => {
    if (!currentCand) return;
    setSubmitting(true);
    try {
      await addCandidateReview(currentCand.id, {
        round: selectedRound,
        decision,
        note: reviewNote.trim() || undefined,
      });

      MessagePlugin.success(`线下联审【${selectedRound}】结果已成功录入系统！`);
      setReviewVisible(false);
      await loadData();
      // 同步刷新详情弹窗里的该候选人
      if (detailVisible) {
        const rows = await getWebCandidates(selectedFiefId).catch(() => [] as WebCandidate[]);
        const fresh = rows.find((x) => x.id === currentCand.id);
        if (fresh) setCurrentCand(fresh);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "录入联审结果失败";
      MessagePlugin.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // 当前候选人名下全部附件（跨多条材料扁平化，免二次请求）
  const candFiles = useMemo(() => {
    const all = (currentCand?.materials || []).flatMap((m) => pickRealFiles(m.files || []));
    const total = (currentCand?.materials || []).reduce((s, m) => s + (m.files?.length || 0), 0);
    return { all, missing: total - all.length };
  }, [currentCand]);

  /** 外部送审（甲方拍板的工作方式）：mailto 预填候选人信息 + 全部附件 URL */
  const externalReview = (cand: WebCandidate) => {
    const files = (cand.materials || []).flatMap((m) => pickRealFiles(m.files || []));
    const name = displayName(cand);
    const subject = encodeURIComponent(`【候选人送审】${name}`);
    const fileList = files.map((f, i) => `${i + 1}. ${f.fileName}: ${getFileUrl(f.storageKey)}`).join("\n");
    const body = encodeURIComponent(
      `候选人信息：\n姓名：${name}\n手机号：${cand.candPhone || "—"}\n当前状态：${
        CAND_STATUS_TEXT[cand.candStatus || ""] || cand.candStatus || "—"
      }\n当前轮次：${cand.candCurrentRound || "—"}\n\n报名材料附件（共${files.length}个，点击链接预览/下载）：\n${fileList}\n\n请审核后将结果反馈给经办人，由经办人在系统内录入审核结论。`,
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  /** 下载候选人信息（前端 Blob 生成 TXT，政务存档用） */
  const downloadCandidateInfo = (cand: WebCandidate) => {
    const files = (cand.materials || []).flatMap((m) => pickRealFiles(m.files || []));
    const name = displayName(cand);
    const fileList = files.map((f, i) => `  ${i + 1}. ${f.fileName} (${getFileUrl(f.storageKey)})`).join("\n");
    const roundsText = ROUND_KEYS.map((k) => {
      const result = cand[`cand${k}` as keyof WebCandidate] as string | undefined;
      const comment = cand[`cand${k}Comment` as keyof WebCandidate] as string | undefined;
      const time = cand[`cand${k}Time` as keyof WebCandidate] as string | undefined;
      return `  ${ROUND_CONFIG[k].name}：${result || "未到轮次"}${comment ? ` 意见：${comment}` : ""}${
        time ? ` ${fmtTime(time)}` : ""
      }`;
    }).join("\n");
    const content = `═══════════════════════════════\n  候选人信息存档表\n═══════════════════════════════\n\n姓名：${name}\n手机号：${cand.candPhone || "—"}\n当前状态：${
      CAND_STATUS_TEXT[cand.candStatus || ""] || cand.candStatus || "—"
    }\n当前轮次：${cand.candCurrentRound || "—"}\n\n四轮审核记录：\n${roundsText}\n\n报名材料附件（共${files.length}个）：\n${fileList}\n\n存档时间：${new Date().toLocaleString("zh-CN")}\n═══════════════════════════════`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `候选人信息_${name}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 下载全部附件（遍历 materials[].files，storage_key 判空兜底） */
  const downloadAllFiles = () => {
    if (!currentCand) return;
    const files = (currentCand.materials || []).flatMap((m) => pickRealFiles(m.files || []));
    if (!files.length) {
      MessagePlugin.warning("该候选人暂无可下载的附件文件");
      return;
    }
    files.forEach((f) => triggerDownload(getFileUrl(f.storageKey), f.fileName));
  };

  const columns = [
    {
      colKey: "candName",
      title: "候选人姓名",
      width: 140,
      cell: ({ row }: { row: WebCandidate }) => (
        <Space size="small">
          <UserIcon style={{ color: "#0052d9" }} />
          <strong>{displayName(row)}</strong>
        </Space>
      ),
    },
    { colKey: "candPhone", title: "手机号", width: 150, cell: ({ row }: { row: WebCandidate }) => row.candPhone || "—" },
    {
      colKey: "r1",
      title: roundHeaders[0],
      width: 165,
      cell: ({ row }: { row: WebCandidate }) => <RoundTag result={row.candR1} />,
    },
    {
      colKey: "r2",
      title: roundHeaders[1],
      width: 165,
      cell: ({ row }: { row: WebCandidate }) => <RoundTag result={row.candR2} />,
    },
    {
      colKey: "r3",
      title: roundHeaders[2],
      width: 165,
      cell: ({ row }: { row: WebCandidate }) => <RoundTag result={row.candR3} />,
    },
    {
      colKey: "r4",
      title: roundHeaders[3],
      width: 165,
      cell: ({ row }: { row: WebCandidate }) => <RoundTag result={row.candR4} />,
    },
    {
      colKey: "candStatus",
      title: "当前状态",
      width: 150,
      cell: ({ row }: { row: WebCandidate }) => <StatusTag type="candidate" status={row.candStatus || ""} />,
    },
    {
      colKey: "candCurrentRound",
      title: "当前审查进度",
      width: 210,
      cell: ({ row }: { row: WebCandidate }) => {
        if (row.candStatus === "approved") {
          return (
            <Tag theme="success" variant="light">
              🎉 经4轮全过 · 正式候选人
            </Tag>
          );
        }
        if (row.candStatus === "rejected") {
          return (
            <Tag theme="danger" variant="light">
              ❌ 联审未通过 · 已淘汰
            </Tag>
          );
        }
        return (
          <Tag theme="primary" variant="light">
            ⏳ 进行中：{ROUND_CONFIG[row.candCurrentRound || ""]?.name || row.candCurrentRound || "待初审"}
          </Tag>
        );
      },
    },
    {
      colKey: "op",
      title: "操作",
      width: 190,
      fixed: "right" as const,
      cell: ({ row }: { row: WebCandidate }) => (
        <Space>
          <Button
            theme="default"
            variant="text"
            size="small"
            icon={<BrowseIcon />}
            onClick={() => {
              setCurrentCand(row);
              setDetailVisible(true);
            }}
          >
            审查档案
          </Button>

          {row.candStatus === "reviewing" && (
            <PermGate roles={["platform_admin", "sub_admin", "reviewer"]}>
              <Button
                theme="primary"
                variant="text"
                size="small"
                icon={<EditIcon />}
                onClick={() => openReviewModal(row)}
              >
                回填审查
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
        title="候选人资格联审池"
        description="报名材料审核通过的人选方可进入本候选人池。四轮联审（R1镇街初审、R2代表预选、R3区11部门联审、R4党委考察）在线下举办，线上由审核人依法依文号回填留痕。"
        actions={
          <Space>
            <Select
              style={{ width: 260 }}
              value={selectedFiefId || undefined}
              placeholder="选择选举活动（届）"
              onChange={(v) => setSelectedFiefId(v as string)}
              options={fiefs.map((f) => ({
                label: `${termMap[f.id]?.elTerm ? `${termMap[f.id].elTerm} · ` : ""}${f.name}（${f.dDay}）`,
                value: f.id,
              }))}
            />
          </Space>
        }
      >
        {/* 筛选条：状态（真实 3 值）+ 关键词 + 查询/重置（客户端本地过滤） */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <Select
            style={{ width: 230 }}
            value={statusFilter || undefined}
            placeholder="全部状态"
            clearable
            options={STATUS_OPTIONS}
            onChange={(v) => setStatusFilter((v as string) || "")}
          />
          <Input
            style={{ width: 220 }}
            value={keyword}
            onChange={(v) => setKeyword(v)}
            placeholder="搜索姓名 / 手机号"
            clearable
          />
          <Button theme="primary" variant="outline" icon={<SearchIcon />} onClick={() => loadData()}>
            查询
          </Button>
          <Button theme="default" variant="outline" icon={<RefreshIcon />} onClick={resetFilters}>
            重置
          </Button>
          <span style={{ color: "#999", fontSize: 12, marginLeft: "auto" }}>
            共 {filtered.length} / {list.length} 人 · 评审流程：外部送审邮箱 → 领导线下评 → 结果由审核人在此录入留痕
          </span>
        </div>

        <Table
          data={filtered}
          columns={columns}
          rowKey="id"
          loading={loading}
          tableLayout="fixed"
          empty={filtered.length === 0 && list.length > 0 ? "没有符合当前筛选条件的候选人" : "暂无候选人（材料审核通过后自动进入）"}
        />
      </Card>

      {/* 回填审查结果弹窗（保持 /admin/candidates/:id/reviews 回填链路） */}
      <Dialog
        header="线下审查结果回填录入"
        visible={reviewVisible}
        onClose={() => setReviewVisible(false)}
        confirmBtn={{ content: "确认录入留痕", theme: "primary", loading: submitting }}
        onConfirm={handleReviewSubmit}
        width={560}
      >
        {currentCand && (
          <Form labelWidth={130}>
            <p>
              正在回填：<strong>{displayName(currentCand)}</strong>
              <span style={{ color: "#888", fontSize: 12, marginLeft: 8 }}>
                （当前轮次：{currentCand.candCurrentRound || "—"}，后端按轮次顺序强校验）
              </span>
            </p>

            <Field label="选择录入轮次" requiredMark>
              <Select
                value={selectedRound}
                onChange={(v) => setSelectedRound(v as WebCandidateRoundKey)}
                options={ROUND_KEYS.map((r) => ({ label: `${r}：${ROUND_CONFIG[r].name}`, value: r }))}
              />
            </Field>

            <Field label="负责审查单位">
              <span style={{ color: "#888" }}>{ROUND_CONFIG[selectedRound]?.dept}</span>
            </Field>

            <Field label="审查结论" requiredMark>
              <Radio.Group value={decision} onChange={(v) => setDecision(v as "approved" | "rejected")}>
                <Radio value="approved">✅ 审查合格（通过本轮）</Radio>
                <Radio value="rejected">❌ 存在负面清单/不合格（予以淘汰）</Radio>
              </Radio.Group>
            </Field>

            <Field label="线下文号及意见">
              <Textarea
                value={reviewNote}
                onChange={(v) => setReviewNote(v as string)}
                autosize={{ minRows: 3, maxRows: 6 }}
                placeholder="例如：经区纪委、法院、公安联合审查，未发现负面清单情形（城联审字[2026]XX号）"
              />
            </Field>
          </Form>
        )}
      </Dialog>

      {/* 查看审查档案明细弹窗（materials 内嵌 + 附件列表 + 送审/存档） */}
      <Dialog
        header="候选人资格审查全链档案"
        visible={detailVisible}
        onClose={() => setDetailVisible(false)}
        footer={<Button onClick={() => setDetailVisible(false)}>关闭</Button>}
        width={720}
      >
        {currentCand && (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3>{displayName(currentCand)} 的资格审查全案</h3>
              <StatusTag type="candidate" status={currentCand.candStatus || ""} />
            </div>
            <p>
              <strong>手机号：</strong>
              {currentCand.candPhone || "—"}
            </p>
            <p>
              <strong>当前轮次：</strong>
              {ROUND_CONFIG[currentCand.candCurrentRound || ""]?.name ||
                (currentCand.candCurrentRound === "complete" ? "四轮已全部完成" : "—")}
            </p>

            {/* 操作栏：外部送审 + 下载存档（照原版拼法移植） */}
            <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
              <Button
                size="small"
                theme="primary"
                variant="outline"
                icon={<MailIcon />}
                onClick={() => externalReview(currentCand)}
              >
                ✉️ 外部送审（抄送邮箱）
              </Button>
              <Button
                size="small"
                theme="default"
                variant="outline"
                icon={<DownloadIcon />}
                onClick={() => downloadCandidateInfo(currentCand)}
              >
                📄 下载候选人信息（存档）
              </Button>
              <span style={{ fontSize: 12, color: "#9aa3af", alignSelf: "center" }}>
                外部送审打开邮箱预填信息；下载生成TXT存档文件
              </span>
            </div>

            <Divider align="left">四轮线下联审留痕台账</Divider>
            <div style={{ background: "#f8f9fa", padding: "12px 16px", borderRadius: 6 }}>
              {ROUND_KEYS.map((r) => {
                const result = currentCand[`cand${r}` as keyof WebCandidate] as string | undefined;
                const comment = currentCand[`cand${r}Comment` as keyof WebCandidate] as string | undefined;
                const time = currentCand[`cand${r}Time` as keyof WebCandidate] as string | undefined;
                const cfg = ROUND_CONFIG[r];
                return (
                  <div
                    key={r}
                    style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px dashed #e5e6eb" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong>{cfg.name}</strong>
                      {result ? (
                        <Tag theme={ROUND_TAG_THEME[result] || "default"} variant="light">
                          {result === "通过" ? "✅ 审查通过" : "❌ 审查不通过"}
                        </Tag>
                      ) : (
                        <Tag theme="default" variant="light">
                          待举办审查
                        </Tag>
                      )}
                    </div>
                    <div style={{ color: "#888", fontSize: 12, marginTop: 4 }}>
                      审查单位：{cfg.dept}
                    </div>
                    {result && (
                      <div style={{ marginTop: 6, color: "#4e5969", fontSize: 13 }}>
                        <strong>审核意见/文号：</strong>
                        {comment || "审查合格，准予通过"}
                        <span style={{ marginLeft: 12, color: "#999", fontSize: 12 }}>
                          （记录时间：{fmtTime(time)}）
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <Divider align="left">报名申报原始材料与附件</Divider>
            {(currentCand.materials || []).length > 0 ? (
              <div>
                <div style={{ marginBottom: 8 }}>
                  <Button
                    size="small"
                    theme="primary"
                    variant="outline"
                    icon={<DownloadIcon />}
                    onClick={downloadAllFiles}
                  >
                    下载全部附件（{candFiles.all.length} 个）
                  </Button>
                  {candFiles.missing > 0 && (
                    <span style={{ marginLeft: 12, fontSize: 12, color: "#e37318" }}>
                      另有 {candFiles.missing} 个附件缺少存储文件（历史数据无 storage_key），暂不可下载
                    </span>
                  )}
                </div>
                {(currentCand.materials || []).map((m: WebCandidateMaterial) => (
                  <div
                    key={m.id}
                    style={{
                      border: "1px solid #eceef2",
                      borderRadius: 6,
                      padding: "10px 14px",
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <strong style={{ fontSize: 14 }}>{m.title || "报名材料"}</strong>
                      <Space size="small">
                        <StatusTag type="material" status={m.status || ""} />
                        <span style={{ color: "#999", fontSize: 12 }}>
                          提交于 {fmtTime(m.submittedAt)}
                        </span>
                      </Space>
                    </div>
                    {m.reviewNote && (
                      <div style={{ color: "#4e5969", fontSize: 13, marginBottom: 6 }}>
                        <strong>材料审核意见：</strong>
                        {m.reviewNote}
                      </div>
                    )}
                    <FileList files={pickRealFiles(m.files || [])} />
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ color: "#999" }}>暂无附件（材料审核通过后此处展示报名材料）</span>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
