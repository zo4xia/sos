"use client";

/**
 * M04: 活动详情与SOP公文预排工作台 (/election/activity/:id)
 * Tab1: 14 阶段法定工期（SopTimeline + 甲方 DOCX 业务映射）
 * Tab2: 16 篇预排公文编辑、落款推导与正式发布
 */
import React, { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  Row,
  Col,
  Button,
  Tabs,
  Form,
  Input,
  Textarea,
  Tag,
  Space,
  MessagePlugin,
  Divider,
  Dialog,
  Upload,
  Alert,
} from "tdesign-react";
import { RollbackIcon, SaveIcon, SendIcon, BrowseIcon, FolderIcon, UserIcon } from "tdesign-icons-react";
import { getElectionFief, getFiefStages, ElectionFief, FiefStage } from "@/lib/api/elections";
import {
  getAnnouncements,
  saveAnnouncement,
  publishAnnouncement,
  uploadAnnouncementFile,
  getAnnouncementFiles,
  Announcement,
} from "@/lib/api/announcements";
import { MaterialFile } from "@/lib/api/files";
import { useAuthStore } from "@/lib/stores/useAuthStore";
import { useBreadcrumbStore } from "@/lib/stores/useBreadcrumbStore";
import { SopTimeline } from "@/lib/components/SopTimeline";
import { LegalDocViewer } from "@/lib/components/LegalDocViewer";
import { PermGate, usePerm } from "@/lib/components/PermGate";
import { StatusTag } from "@/lib/components/StatusTag";
import { FileList } from "@/lib/components/FileList";
import { Field } from "@/lib/components/Field";
import { VILLAGE_DOCX_STAGES, COMMUNITY_DOCX_STAGES } from "@/lib/utils/docxRules";
import { fmtDateTime } from "@/lib/utils/fmt";
import { annDueInfo, cnDate, withDerivedStages } from "@/lib/utils/stages";

const { TabPanel } = Tabs;

/** 从 TDesign Upload 的 onChange 文件列表里提取原始 File 对象 */
const pickRawFiles = (files: unknown[]): File[] =>
  files.map((f) => (f as { raw?: File }).raw).filter(Boolean) as File[];

export default function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  // R-04：公告正文编辑权（announcement:edit：editor/sub_admin/platform 有，reviewer 无）
  const canEditAnn = usePerm("announcement:edit");

  const [fief, setFief] = useState<ElectionFief | null>(null);
  const [stages, setStages] = useState<FiefStage[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  // Tab 受控（支持 ?tab=gongwen 深链锚点，R-06 待办直达公文台）
  const [activeTab, setActiveTab] = useState("pipeline");
  // ?ann=<id> 深链锚点（ref 避免闭包时序问题）
  const annAnchorRef = useRef<string | null>(null);

  // 公文编辑台状态
  const [currentAnnIdx, setCurrentAnnIdx] = useState(0);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editSign, setEditSign] = useState("");
  const [editSignDate, setEditSignDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  // 当前公告已归档附件（GET /admin/announcements/:id/files 按需拉取）
  const [currentFiles, setCurrentFiles] = useState<MaterialFile[]>([]);
  const setCrumbTail = useBreadcrumbStore((s) => s.setTail);
  const clearCrumbTail = useBreadcrumbStore((s) => s.clearTail);

  const loadAll = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [fiefData, stageData, annData] = await Promise.all([
        getElectionFief(id),
        getFiefStages(id),
        getAnnouncements({ electionFiefId: id }),
      ]);
      setFief(fiefData);
      setStages(stageData);
      setAnnouncements(annData);
      // 面包屑动态尾段：活动名称
      if (fiefData?.name) setCrumbTail(fiefData.name);

      if (annData.length > 0) {
        // R-06：深链锚点优先（?ann=<id> 直达指定公文）
        const anchor = annAnchorRef.current;
        const idx = anchor ? annData.findIndex((a) => a.id === anchor) : -1;
        if (idx >= 0) {
          annAnchorRef.current = null;
          setCurrentAnnIdx(idx);
          initEditor(annData[idx]);
        } else {
          initEditor(annData[0]);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "加载活动 Pipeline 失败";
      MessagePlugin.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [id]);

  // R-06：解析深链锚点（?tab=gongwen&ann=<id>），必须在 loadAll 前执行
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("tab") === "gongwen" || q.get("tab") === "announcements") {
      setActiveTab("announcements");
    }
    const annId = q.get("ann");
    if (annId) annAnchorRef.current = annId;
  }, []);

  // 卸载时清理面包屑尾段，避免串到其他页面
  useEffect(() => () => clearCrumbTail(), [clearCrumbTail]);

  const initEditor = (ann: Announcement) => {
    setEditTitle(ann.title || "");
    setEditBody(ann.body || "");
    const isCommunity = user?.orgType === "community";
    setEditSign(
      ann.annSign ||
        (isCommunity
          ? `${user?.orgName || ""}居民选举委员会`
          : `${user?.orgName || ""}村民选举委员会`),
    );
    // 成文日期治理：真实落款 → 排期日 → 今日（政务中文格式；杜绝「2026年XX月XX日」占位串落库）
    setEditSignDate(
      ann.annSignDate || cnDate(ann.scheduledFor) || cnDate(new Date().toISOString()),
    );
    setSelectedFile(null);
    // 拉取该公告已归档的真实附件回显（附件列表走 biz-files 通用路由）
    void refreshFiles(ann.id);
  };

  const refreshFiles = async (annId: string) => {
    try {
      setCurrentFiles(await getAnnouncementFiles(annId));
    } catch {
      setCurrentFiles([]);
    }
  };

  const handleSelectAnnouncement = (idx: number) => {
    setCurrentAnnIdx(idx);
    if (announcements[idx]) {
      initEditor(announcements[idx]);
    }
  };

  // 保存草稿（后端 PATCH 白名单字段：title/body/sign/signDate，落款不再静默丢失）
  const handleSaveDraft = async () => {
    const target = announcements[currentAnnIdx];
    if (!target) return;
    setSaving(true);
    try {
      await saveAnnouncement(target.id, {
        title: editTitle,
        body: editBody,
        sign: editSign,
        signDate: editSignDate,
      });

      if (selectedFile) {
        await uploadAnnouncementFile(target.id, selectedFile);
      }

      MessagePlugin.success("公文草稿已成功保存");
      const updatedAnns = await getAnnouncements({ electionFiefId: id });
      setAnnouncements(updatedAnns);
      if (updatedAnns[currentAnnIdx]) initEditor(updatedAnns[currentAnnIdx]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "保存草稿失败";
      MessagePlugin.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // 确认发布公文
  const handlePublish = async () => {
    const target = announcements[currentAnnIdx];
    if (!target) return;
    setSaving(true);
    try {
      // 先把最新修改同步保存（sign/signDate 映射到后端白名单字段）
      await saveAnnouncement(target.id, {
        title: editTitle,
        body: editBody,
        sign: editSign,
        signDate: editSignDate,
      });
      // 正式触发法定发布
      await publishAnnouncement(target.id);
      MessagePlugin.success("🎉 红头公文已正式依法发布！");
      const updatedAnns = await getAnnouncements({ electionFiefId: id });
      setAnnouncements(updatedAnns);
      if (updatedAnns[currentAnnIdx]) initEditor(updatedAnns[currentAnnIdx]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "发布公文失败";
      MessagePlugin.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const currentAnn = announcements[currentAnnIdx];
  const docxStages = user?.orgType === "community" ? COMMUNITY_DOCX_STAGES : VILLAGE_DOCX_STAGES;
  // R-12：已发布公文内容锁定只读
  const isPublished = currentAnn?.status === "published";
  // 表单整体锁：已发布 或 当前角色无编辑权（R-04）
  const formLocked = isPublished || !canEditAnn;

  return (
    <div style={{ padding: 24 }}>
      {/* 顶部导航与活动标题 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Space>
          <Button
            theme="default"
            variant="base"
            icon={<RollbackIcon />}
            onClick={() => router.push("/election/activities")}
          >
            返回活动列表
          </Button>
          <h2 style={{ fontSize: 20 }}>
            {fief ? `${fief.name} · 法定 Pipeline 实施大厅` : "活动详情"}
          </h2>
          {fief && <StatusTag type="election" status={fief.status} />}
        </Space>

        <Space>
          <Button theme="default" icon={<FolderIcon />} onClick={() => router.push("/election/materials")}>
            材料管理
          </Button>
          <Button theme="default" icon={<UserIcon />} onClick={() => router.push("/election/candidates")}>
            候选人联审
          </Button>
        </Space>
      </div>

      <Tabs value={activeTab} onChange={(v) => setActiveTab(v as string)} size="large">
        {/* Tab 1: 14 阶段日程时间轴（直接对应甲方 docx 工期表） */}
        <TabPanel value="pipeline" label="📅 14 阶段法定工期与工作事项">
          <Row gutter={24} style={{ marginTop: 16 }}>
            <Col span={7}>
              <Card title="法定时间轴推进状态" bordered loading={loading}>
                {/* R-09：阶段状态按日期推导（后端无状态写路径，倒排工期表本就日期驱动） */}
                <SopTimeline stages={withDerivedStages(stages)} />
              </Card>
            </Col>

            <Col span={17}>
              <Card title="《甲方倒排工期表》法定业务对应规则" bordered>
                <div style={{ maxHeight: 680, overflowY: "auto" }}>
                  {docxStages.map((s, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: "14px 16px",
                        background: idx % 2 === 0 ? "#fcfcfc" : "#ffffff",
                        borderBottom: "1px solid #f0f0f0",
                        borderRadius: 4,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong style={{ color: "#0052d9", fontSize: 15 }}>
                          【{s.offsetLabel}】{s.stageName}
                        </strong>
                        <Tag theme="primary" variant="light">
                          法定公文：{s.announcementNums}
                        </Tag>
                      </div>
                      <div style={{ marginTop: 6, color: "#333", fontSize: 13, whiteSpace: "pre-wrap" }}>
                        <strong>核心工作事项：</strong>
                        {s.workItems}
                      </div>
                      <div style={{ marginTop: 4, color: "#00a870", fontSize: 13, whiteSpace: "pre-wrap" }}>
                        <strong>系统业务对应操作：</strong>
                        {s.systemAction}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </Col>
          </Row>
        </TabPanel>

        {/* Tab 2: 16 篇预排公文编辑台（小编纯不干活，全是系统推导） */}
        <TabPanel value="announcements" label="📜 法定公文预排与发布台">
          <Row gutter={20} style={{ marginTop: 16 }}>
            {/* 左侧：16 篇预排公文目录树 */}
            <Col span={7}>
              <Card title="本届预排公文清单" bordered>
                <div style={{ maxHeight: 600, overflowY: "auto" }}>
                  {announcements.map((ann, idx) => {
                    const isSelected = idx === currentAnnIdx;
                    const isPublished = ann.status === "published";
                    return (
                      <div
                        key={ann.id}
                        onClick={() => handleSelectAnnouncement(idx)}
                        style={{
                          padding: "12px 14px",
                          marginBottom: 8,
                          borderRadius: 6,
                          cursor: "pointer",
                          background: isSelected ? "#eef4ff" : "#f7f8fa",
                          border: isSelected ? "1px solid #0052d9" : "1px solid transparent",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: isSelected ? 600 : 400,
                              color: isSelected ? "#0052d9" : "#333",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {idx + 1}. {ann.title}
                          </div>
                          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                            {ann.templateName || "法定模板"}
                          </div>
                          {/* R-06：排期日 + 距今/逾期标记（到期感知，编辑侧核心盲区） */}
                          {(() => {
                            const due = annDueInfo(ann);
                            return due.scheduled ? (
                              <div style={{ fontSize: 12, marginTop: 2, display: "flex", gap: 6, alignItems: "center" }}>
                                <span style={{ color: "#98a2b3" }}>排期 {due.scheduled}</span>
                                <span
                                  style={{
                                    color: due.overdue ? "#d54941" : "#4e5969",
                                    fontWeight: due.overdue ? 600 : 400,
                                  }}
                                >
                                  {due.label}
                                </span>
                              </div>
                            ) : null;
                          })()}
                        </div>
                        <StatusTag type="announcement" status={ann.status} />
                      </div>
                    );
                  })}
                </div>
              </Card>
            </Col>

            {/* 右侧：公文编辑与落款发布工作台 */}
            <Col span={17}>
              {currentAnn ? (
                <Card
                  title={`编辑公文 · ${currentAnn.title}`}
                  bordered
                  actions={
                    <Space>
                      <Button
                        theme="default"
                        variant="outline"
                        icon={<BrowseIcon />}
                        onClick={() => setPreviewVisible(true)}
                      >
                        预览红头排版
                      </Button>
                      {/* R-04/R-12：保存草稿按 announcement:edit 收口（reviewer 隐藏）；已发布锁定 */}
                      <PermGate perm="announcement:edit">
                        <Button
                          theme="primary"
                          variant="base"
                          icon={<SaveIcon />}
                          loading={saving}
                          disabled={isPublished}
                          onClick={handleSaveDraft}
                        >
                          {isPublished ? "已发布锁定" : "保存草稿"}
                        </Button>
                      </PermGate>
                      <PermGate
                        perm="announcement:publish"
                        roles={["platform_admin", "sub_admin"]}
                      >
                        <Button
                          theme="success"
                          variant="base"
                          icon={<SendIcon />}
                          loading={saving}
                          disabled={isPublished}
                          onClick={handlePublish}
                        >
                          {isPublished ? "已依法发布" : "确认依法发布"}
                        </Button>
                      </PermGate>
                    </Space>
                  }
                >
                  <Form labelWidth={120}>
                    {/* R-12：已发布锁定提示；R-04：无编辑权角色提示（均可预览查阅） */}
                    {isPublished && (
                      <Alert
                        theme="warning"
                        message="该公文已依法发布，内容锁定只读（政务发布留痕保护，不可再修改）。"
                        style={{ marginBottom: 12 }}
                      />
                    )}
                    {!isPublished && !canEditAnn && (
                      <Alert
                        theme="info"
                        message="当前账号为查阅口径：可预览公文正文与附件。正文修改由经办编辑负责，依法发布由选委会主任（子管理）核准。"
                        style={{ marginBottom: 12 }}
                      />
                    )}
                    <Field label="公告状态">
                      <>
                        <StatusTag type="announcement" status={currentAnn.status} />
                        {currentAnn.publishedAt && (
                          <span style={{ marginLeft: 12, color: "#00a870", fontSize: 13 }}>
                            发布于：{fmtDateTime(currentAnn.publishedAt)}
                          </span>
                        )}
                      </>
                    </Field>

                    {/* R-07：诚实明示发布模式（后端无调度器，不做假定时控件） */}
                    {!isPublished && (
                      <div style={{ color: "#888", fontSize: 12, marginBottom: 10 }}>
                        发布说明：当前为即时发布模式，点击「确认依法发布」后公文即刻生效并留痕。
                      </div>
                    )}

                    <Field label="公文标题">
                      <Input
                        value={editTitle}
                        onChange={(v) => setEditTitle(v as string)}
                        placeholder="请输入公告标题"
                        disabled={formLocked}
                      />
                    </Field>

                    <Field label="公文正文（模板回填）">
                      <Textarea
                        value={editBody}
                        onChange={(v) => setEditBody(v as string)}
                        autosize={{ minRows: 10, maxRows: 24 }}
                        placeholder="法定模板正文已由系统依法替换，经办人员可按实际情况微调"
                        disabled={formLocked}
                      />
                    </Field>

                    <Row gutter={16}>
                      <Col span={12}>
                        <Field label="落款单位">
                          <Input
                            value={editSign}
                            onChange={(v) => setEditSign(v as string)}
                            placeholder="如：演示村村民选举委员会"
                            disabled={formLocked}
                          />
                        </Field>
                      </Col>
                      <Col span={12}>
                        <Field label="成文日期">
                          <Input
                            value={editSignDate}
                            onChange={(v) => setEditSignDate(v as string)}
                            placeholder="如：2026年10月24日"
                            disabled={formLocked}
                          />
                        </Field>
                      </Col>
                    </Row>

                    <Divider align="left">公文附带红头附件</Divider>
                    {/* P2：原生 input file 换 TDesign Upload；R-04 按 announcement:edit 收口；R-12 发布后锁定 */}
                    {canEditAnn && !isPublished ? (
                      <Field label="上传公文盖章附件">
                        <>
                          <Upload
                            key={`ann-upload-${currentAnn.id}`}
                            theme="file"
                            autoUpload={false}
                            onChange={(files) => {
                              const picked = pickRawFiles(files);
                              setSelectedFile(picked[0] || null);
                            }}
                          />
                          <span style={{ color: "#888", fontSize: 12, marginLeft: 8 }}>
                            如盖章 PDF、扫描件等，选择后随「保存草稿」一并归档
                          </span>
                        </>
                      </Field>
                    ) : (
                      <Field label="附件上传">
                        <span style={{ color: "#888", fontSize: 13 }}>
                          {isPublished ? "已发布锁定，附件不可再增补" : "当前角色无附件代传权"}
                        </span>
                      </Field>
                    )}

                    <div style={{ marginTop: 12 }}>
                      <FileList files={currentFiles} />
                    </div>
                  </Form>
                </Card>
              ) : (
                <div style={{ padding: 48, textAlign: "center", color: "#999" }}>
                  请在左侧选择要编辑的预排公文
                </div>
              )}
            </Col>
          </Row>
        </TabPanel>
      </Tabs>

      {/* 红头公文标准格式预览弹窗 */}
      <Dialog
        header="公文红头排版预览（政务标准）"
        visible={previewVisible}
        onClose={() => setPreviewVisible(false)}
        footer={<Button onClick={() => setPreviewVisible(false)}>关闭预览</Button>}
        width={820}
      >
        <LegalDocViewer
          announcement={{
            title: editTitle,
            body: editBody,
            annSign: editSign,
            annSignDate: editSignDate,
          }}
          orgName={user?.orgName || "演示单位"}
          orgType={user?.orgType || "village"}
        />
      </Dialog>
    </div>
  );
}
