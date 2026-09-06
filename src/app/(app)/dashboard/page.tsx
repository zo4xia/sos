"use client";

/**
 * M14: 概览工作台 (/dashboard)
 * 全景汇聚当前归属地的 6 大法定指标与全流程待办事项。
 */
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  Row,
  Col,
  Table,
  Button,
  Tag,
  Space,
  MessagePlugin,
} from "tdesign-react";
import { CalendarIcon, FileAddIcon } from "tdesign-icons-react";
import { getProposals, Proposal } from "@/lib/api/proposals";
import { getMaterials, Material } from "@/lib/api/materials";
import { getWebCandidates, WebCandidate } from "@/lib/api/candidates";
import { getAnnouncements, Announcement } from "@/lib/api/announcements";
import { getPositions, Position } from "@/lib/api/positions";
import { getElectionFiefs, pickDefaultFief, ElectionFief } from "@/lib/api/elections";
import { useAuthStore } from "@/lib/stores/useAuthStore";
import { PermGate } from "@/lib/components/PermGate";
import { annDueInfo } from "@/lib/utils/stages";
import { fmtDateTime } from "@/lib/utils/fmt";

export default function DashboardPage() {
  const [fiefs, setFiefs] = useState<ElectionFief[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [candidates, setCandidates] = useState<WebCandidate[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  // R-20：待办按登录账号权责分流（用户裁定：审核人=提案/材料/候选人；编辑=公告/导入材料）
  const hasPerm = useAuthStore((s) => s.hasPerm);

  useEffect(() => {
    (async () => {
      try {
        // 先取当届活动，再携带 electionFiefId 并发聚合（后端强校验封地范围）
        const fiefData = await getElectionFiefs();
        setFiefs(fiefData);
        // 默认取「当前届」：优先持久化选择，否则最新 active 封地（与 home/各页口径一致）
        const currentFiefId = pickDefaultFief(fiefData)?.id;

        const [propData, matData, candData, annData, posData] = await Promise.all([
          getProposals(),
          getMaterials(),
          // 候选人切 web 兼容口径 /api/candidates（candName/candPhone 真实字段，原 /admin 行无 candidateName 数虚标致待办恒 undefined）
          currentFiefId ? getWebCandidates(currentFiefId) : Promise.resolve([] as WebCandidate[]),
          currentFiefId
            ? getAnnouncements({ electionFiefId: currentFiefId })
            : Promise.resolve([] as Announcement[]),
          currentFiefId ? getPositions({ electionFiefId: currentFiefId }) : Promise.resolve([] as Position[]),
        ]);
        setProposals(propData);
        setMaterials(matData);
        setCandidates(candData);
        setAnnouncements(annData);
        setPositions(posData);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "加载工作台统计失败";
        MessagePlugin.error(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 待办事项汇总联动
  const pendingProposals = proposals.filter((p) => p.status === "pending");
  const submittedMaterials = materials.filter((m) => m.status === "submitted");
  const reviewingCandidates = candidates.filter((c) => c.candStatus === "reviewing");
  const draftAnnouncements = announcements.filter((a) => a.status === "draft");

  // 候选人待办时间：取最近一轮留痕时间，无则退回材料提交时间（/api/candidates 行无 created_at）
  const candTodoTime = (c: WebCandidate): string => {
    const times = [c.candR1Time, c.candR2Time, c.candR3Time, c.candR4Time].filter(Boolean) as string[];
    if (times.length) return fmtDateTime(times[times.length - 1]);
    return fmtDateTime(c.materials?.[0]?.submittedAt);
  };

  // R-20：四类待办分别按审核权/编辑权过滤——审核人只见提案/材料/联审，编辑只见公文，互不噪声
  const todoList = [
    ...(hasPerm("proposal:review")
      ? pendingProposals.map((p) => ({
          id: `prop-${p.id}`,
          type: "提案待审批",
          name: p.name,
          time: fmtDateTime(p.createdAt),
          overdue: false,
          link: "/election/proposals",
          theme: "warning" as const,
        }))
      : []),
    ...(hasPerm("material:review")
      ? submittedMaterials.map((m) => ({
          id: `mat-${m.id}`,
          type: "参选材料待初审",
          name: `${m.submitterName || m.submitterPhone || "参选人"} 提交的资格材料`,
          time: fmtDateTime(m.submittedAt),
          overdue: false,
          link: "/election/materials",
          theme: "primary" as const,
        }))
      : []),
    ...(hasPerm("candidate:review")
      ? reviewingCandidates.map((c) => ({
          id: `cand-${c.id}`,
          type: "线下联审待回填",
          name: `${c.candName || c.candPhone || "候选人"}（当前${c.candCurrentRound || "待初审"}）`,
          time: candTodoTime(c),
          overdue: false,
          link: "/election/candidates",
          theme: "success" as const,
        }))
      : []),
    ...(hasPerm("announcement:edit")
      ? draftAnnouncements.slice(0, 5).map((a) => {
          // R-06：排期日 + 逾期标记（到期感知），并带锚点直达公文台对应公告
          const due = annDueInfo(a);
          return {
            id: `ann-${a.id}`,
            type: "法定公文待发布",
            name: a.title,
            time: `${fmtDateTime(a.createdAt)}${due.scheduled ? ` · 排期 ${due.scheduled}` : ""}`,
            overdue: due.overdue,
            link: `/election/activity/${a.electionFiefId || ""}?tab=gongwen&ann=${a.id}`,
            theme: (due.overdue ? "danger" : "default") as "danger" | "default",
          };
        })
      : []),
  ];

  const todoColumns = [
    {
      colKey: "type",
      title: "事项类型",
      width: 150,
      cell: ({ row }: { row: (typeof todoList)[number] }) => (
        <Tag theme={row.theme} variant="light">
          {row.type}
        </Tag>
      ),
    },
    {
      colKey: "name",
      title: "事项内容 / 待办标的",
      width: 320,
      cell: ({ row }: { row: (typeof todoList)[number] }) => (
        <span style={{ fontWeight: 500 }}>{row.name}</span>
      ),
    },
    {
      colKey: "time",
      title: "产生时间 / 排期",
      width: 220,
      cell: ({ row }: { row: (typeof todoList)[number] }) => (
        <span style={{ color: row.overdue ? "#d54941" : undefined, fontWeight: row.overdue ? 600 : 400 }}>
          {row.time}
        </span>
      ),
    },
    {
      colKey: "op",
      title: "操作",
      width: 120,
      cell: ({ row }: { row: (typeof todoList)[number] }) => (
        <Button
          theme="primary"
          variant="text"
          size="small"
          onClick={() => router.push(row.link)}
        >
          前往处理
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 顶部欢迎卡片 */}
      <Card className="hero-card" style={{ marginBottom: 24 }}>
        <Row align="middle" justify="space-between">
          <Col span={16}>
            <h2 style={{ fontSize: 22, color: "#1d2129" }}>
              您好，{user?.displayName || user?.phone} · {user?.orgName || "城厢区村居换届工作台"}
            </h2>
            <div style={{ color: "#4e5969", fontSize: 13, marginTop: 8 }}>
              当前职务权限：
              <Tag theme="primary" variant="light" style={{ marginLeft: 6 }}>
                {user?.role === "platform_admin"
                  ? "平台超管"
                  : user?.role === "sub_admin"
                    ? "选委会主任 (子管理)"
                    : user?.role === "reviewer"
                      ? "审核人"
                      : "经办编辑"}
              </Tag>
              <span style={{ marginLeft: 16 }}>
                法律机制：D-day 全周期倒排驱动 · 村居彻底双轨隔离
              </span>
            </div>
          </Col>

          <Col span={8} style={{ textAlign: "right" }}>
            <Space>
              {/* R-11：发起提案仅对有 proposal:create 的角色开放（reviewer 点击后到提案页无按钮白跑一趟） */}
              <PermGate perm="proposal:create">
                <Button theme="primary" icon={<FileAddIcon />} onClick={() => router.push("/election/proposals")}>
                  发起新提案
                </Button>
              </PermGate>
              <Button theme="default" icon={<CalendarIcon />} onClick={() => router.push("/election/activities")}>
                活动大厅
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 六大关键指标统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={4}>
          <div onClick={() => router.push("/election/activities")} style={{ cursor: "pointer" }}>
            <Card bordered hoverShadow>
              <div style={{ color: "#888", fontSize: 13 }}>当届选举活动</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#0052d9", marginTop: 4 }}>
                {loading ? "—" : fiefs.length}
              </div>
              <div style={{ fontSize: 12, color: "#00a870", marginTop: 4 }}>D-day 已倒排锁死</div>
            </Card>
          </div>
        </Col>
        <Col span={4}>
          <div onClick={() => router.push("/election/positions")} style={{ cursor: "pointer" }}>
            <Card bordered hoverShadow>
              <div style={{ color: "#888", fontSize: 13 }}>本届拟设岗位</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#1d2129", marginTop: 4 }}>
                {loading ? "—" : positions.length}
              </div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
                总拟选职数：{positions.reduce((s, p) => s + (p.quota || 1), 0)} 人
              </div>
            </Card>
          </div>
        </Col>
        <Col span={4}>
          <div onClick={() => router.push("/election/materials")} style={{ cursor: "pointer" }}>
            <Card bordered hoverShadow>
              <div style={{ color: "#888", fontSize: 13 }}>报名材料上报</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#fa8c16", marginTop: 4 }}>
                {loading ? "—" : materials.length}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: submittedMaterials.length > 0 ? "#fa8c16" : "#888",
                  marginTop: 4,
                }}
              >
                待初审：{submittedMaterials.length} 份
              </div>
            </Card>
          </div>
        </Col>
        <Col span={4}>
          <div onClick={() => router.push("/election/candidates")} style={{ cursor: "pointer" }}>
            <Card bordered hoverShadow>
              <div style={{ color: "#888", fontSize: 13 }}>候选人联审池</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#00a870", marginTop: 4 }}>
                {loading ? "—" : candidates.length}
              </div>
              <div style={{ fontSize: 12, color: "#00a870", marginTop: 4 }}>
                四轮联审中：{reviewingCandidates.length} 人
              </div>
            </Card>
          </div>
        </Col>
        <Col span={4}>
          <div onClick={() => router.push("/election/announcements")} style={{ cursor: "pointer" }}>
            <Card bordered hoverShadow>
              <div style={{ color: "#888", fontSize: 13 }}>法定公文发文</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#2ba471", marginTop: 4 }}>
                {loading ? "—" : announcements.length}
              </div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
                已发布：{announcements.filter((a) => a.status === "published").length} 篇
              </div>
            </Card>
          </div>
        </Col>
        <Col span={4}>
          <div onClick={() => router.push("/election/proposals")} style={{ cursor: "pointer" }}>
            <Card bordered hoverShadow>
              <div style={{ color: "#888", fontSize: 13 }}>换届选举提案</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#0052d9", marginTop: 4 }}>
                {loading ? "—" : proposals.length}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: pendingProposals.length > 0 ? "#fa8c16" : "#888",
                  marginTop: 4,
                }}
              >
                待审批：{pendingProposals.length} 项
              </div>
            </Card>
          </div>
        </Col>
      </Row>

      {/* 待办事项全流程联动看板 */}
      <Card
        title="实时法定业务待办事项"
        description="待办已按当前账号权责自动分流（审核类事项推审核人，公告发文事项推经办编辑）。所有事项均由 D-day Pipeline 时间节点依法触发。"
      >
        <Table
          data={todoList}
          columns={todoColumns}
          rowKey="id"
          loading={loading}
          empty="当前账号权责范围内暂无待办事项"
        />
      </Card>
    </div>
  );
}
