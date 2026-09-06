"use client";

/**
 * M15: D日推进大看板 (/election/home) —— 首页工作台
 * 结构对齐甲方过目截图（后台首页.png）：
 *   浅色 hero 卡「依法选举 公正公开」+ 三联统计（距D日/正式选举日/进度%）+ Progress 进度条
 *   + 「已发布公告」列表卡（仅 published，后端 strip 查询参数须前端过滤）
 *   + 「下一法定阶段」卡（stages 第一个非 completed 阶段，用真实 status 值判断）
 *   SOP 14 阶段时间轴收纳进「下一法定阶段」卡的折叠区，视觉主干对齐截图。
 */
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  Row,
  Col,
  Button,
  Tag,
  Space,
  Progress,
  Collapse,
  MessagePlugin,
} from "tdesign-react";
import { NotificationIcon, CalendarIcon, TimeIcon, DashboardIcon, ChevronRightIcon } from "tdesign-icons-react";
import { getElectionFiefs, getFiefStages, pickDefaultFief, ElectionFief, FiefStage } from "@/lib/api/elections";
import { getAnnouncements, Announcement } from "@/lib/api/announcements";
import { useElectionTerms } from "@/lib/hooks/useElectionTerms";
import { useAuthStore } from "@/lib/stores/useAuthStore";
import { useElectionStore } from "@/lib/stores/useElectionStore";
import { SopTimeline } from "@/lib/components/SopTimeline";
import { StatusTag } from "@/lib/components/StatusTag";
import {
  deriveStageStatus,
  derivedProgress,
  nextPendingStage,
  withDerivedStages,
} from "@/lib/utils/stages";

const { Panel: CollapsePanel } = Collapse;

export default function HomePage() {
  const [fiefs, setFiefs] = useState<ElectionFief[]>([]);
  const [stages, setStages] = useState<FiefStage[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);

  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const currentFiefId = useElectionStore((s) => s.currentFiefId);
  const setFiefQuick = useElectionStore((s) => s.setFiefQuick);
  // 届次映射：elId（= election_fiefs.id）→ { elTerm, orgName, elElectionDate, elStatus }
  const { termMap } = useElectionTerms();

  const loadData = async () => {
    setLoading(true);
    try {
      const fiefData = await getElectionFiefs();
      setFiefs(fiefData);

      // 默认取「当前届」：优先持久化选择，否则最新 active 封地；并回写 store 供全站同步
      const target = pickDefaultFief(fiefData, currentFiefId);
      if (target) {
        setFiefQuick(target);
        const [stageData, annData] = await Promise.all([
          getFiefStages(target.id),
          // 注意：后端 /admin/announcements 会 strip status 查询参数，草稿混入必须前端过滤
          getAnnouncements({ electionFiefId: target.id }),
        ]);
        setStages(stageData);
        setAnnouncements(annData);
      } else {
        setStages([]);
        setAnnouncements([]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "加载 D-day 工作台失败";
      MessagePlugin.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const currentFief = fiefs.find((f) => f.id === (useElectionStore.getState().currentFiefId || "")) || fiefs[fiefs.length - 1];
  const currentTerm = currentFief ? termMap[currentFief.id] : undefined;

  const calcDays = (dDay?: string) => {
    if (!dDay) return 0;
    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const target = new Date(`${dDay}T00:00:00Z`);
    return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

  const daysLeft = currentFief ? calcDays(currentFief.dDay) : 0;

  // R-09：法定阶段进度按日期推导（后端无状态写路径恒 not_started；倒排工期表本就日期驱动）
  const progressPercent = derivedProgress(stages);
  // 下一法定阶段：推导口径第一个未完成（优先进行中，其次未开始）
  const nextStage = nextPendingStage(stages);
  // 已完成计数（推导口径）
  const completedStages = stages.filter((s) => deriveStageStatus(s) === "completed").length;

  // 已发布公告：仅 status === 'published'（前端过滤）
  const publishedAnns = useMemo(
    () => announcements.filter((a) => a.status === "published"),
    [announcements],
  );

  return (
    <div style={{ padding: 24 }}>
      {/* 顶部浅色 Hero：依法选举 公正公开 + 三联统计 + Progress（照甲方过目截图） */}
      <Card
        className="hero-card"
        style={{ marginBottom: 20 }}
        loading={loading}
        bordered={false}
      >
        <Row align="middle" justify="space-between" style={{ marginBottom: 20, position: "relative" }}>
          <Col>
            <div style={{ fontSize: 14, color: "#4e5969", fontWeight: 600 }}>
              {`${currentTerm?.orgName || user?.orgName || "城厢区"} · ${currentTerm?.elTerm || "村居换届选举"}`}
            </div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 800,
                color: "#0052d9",
                letterSpacing: 2,
                marginTop: 8,
                lineHeight: 1.25,
              }}
            >
              依法选举 公正公开
            </div>
            <div style={{ color: "#8a93a3", fontSize: 12, marginTop: 8 }}>
              法律依据：《{user?.orgType === "community" ? "城市居民委员会组织法" : "村民委员会组织法"}》 ·{" "}
              {user?.orgType === "community" ? "城市社区居委会" : "农村村民委员会"}
            </div>
          </Col>
          <Col>
            <Space size="small">
              {currentTerm && <StatusTag type="election" status={currentTerm.elStatus} />}
              {currentFief && (
                <Button
                  theme="primary"
                  variant="outline"
                  size="small"
                  icon={<ChevronRightIcon />}
                  onClick={() => router.push(`/election/activity/${currentFief.id}`)}
                >
                  进入活动详情公文台
                </Button>
              )}
            </Space>
          </Col>
        </Row>

        {/* 三联统计块：距D日 / 正式选举日 / 进度（图标圆底 + 等宽数字 + hover 微浮） */}
        <Row gutter={20} style={{ position: "relative" }}>
          <Col span={8}>
            <div className="stat-cell">
              <div className="stat-icon stat-icon--brand">
                <TimeIcon size="22px" />
              </div>
              <div>
                {/* P2：D 日已过不再显示负数天数，语义化展示 */}
                {daysLeft >= 0 ? (
                  <>
                    <div className="stat-value stat-value--brand">{daysLeft}</div>
                    <div className="stat-label">距 D 日（天）</div>
                  </>
                ) : (
                  <>
                    <div className="stat-value stat-value--green">已选</div>
                    <div className="stat-label">选举日已过 {Math.abs(daysLeft)} 天</div>
                  </>
                )}
              </div>
            </div>
          </Col>
          <Col span={8}>
            <div className="stat-cell">
              <div className="stat-icon stat-icon--neutral">
                <CalendarIcon size="22px" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  className="stat-value stat-value--ink stat-value--sm"
                  style={{ lineHeight: "32px" }}
                >
                  {currentFief ? currentFief.dDay : "待发起提案"}
                </div>
                <div className="stat-label">正式选举日</div>
              </div>
            </div>
          </Col>
          <Col span={8}>
            <div className="stat-cell">
              <div className="stat-icon stat-icon--green">
                <DashboardIcon size="22px" />
              </div>
              <div>
                <div className="stat-value stat-value--green">{progressPercent}%</div>
                <div className="stat-label">法定阶段进度</div>
              </div>
            </div>
          </Col>
        </Row>

        <div style={{ marginTop: 16 }}>
          <Progress
            percentage={progressPercent}
            color="#0052d9"
            trackColor="#eef0f4"
            label
          />
          <div style={{ color: "#4e5969", fontSize: 13, marginTop: 8 }}>
            当前阶段：<b>{nextStage ? nextStage.stageName : stages.length ? "全部法定阶段已完成" : "尚未进入执行阶段"}</b>
            {nextStage && (
              <span style={{ color: "#888", marginLeft: 12, fontSize: 12 }}>
                （{nextStage.startDate} ~ {nextStage.endDate}）
              </span>
            )}
          </div>
        </div>
      </Card>

      <Row gutter={20}>
        {/* 左：已发布公告（仅 published，前端过滤） */}
        <Col span={14}>
          <Card
            title={
              <Space size="small">
                <NotificationIcon />
                <span>已发布公告</span>
              </Space>
            }
            description="已由选委会依法向群众公开张贴发布的法定公文。"
            actions={
              <Button
                theme="default"
                variant="text"
                onClick={() => router.push("/election/announcements")}
              >
                查看全量台账
              </Button>
            }
          >
            {publishedAnns.length === 0 ? (
              <div className="empty-box">
                <NotificationIcon size="32px" />
                <div>暂无已发布公告</div>
                <div className="empty-box__hint">
                  公文由经办人员在活动大厅预排并依法审核发布
                </div>
              </div>
            ) : (
              <div style={{ maxHeight: 520, overflowY: "auto" }}>
                {publishedAnns.map((ann) => (
                  <div
                    key={ann.id}
                    className="ann-row"
                    style={{ cursor: "pointer" }}
                    title="点击进入公文台查看全文"
                    onClick={() =>
                      currentFief &&
                      router.push(`/election/activity/${currentFief.id}?tab=gongwen&ann=${ann.id}`)
                    }
                  >
                    <div className="ann-row__title">{ann.title}</div>
                    <div className="ann-row__meta">
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        发布单位：{ann.annSign || `${user?.orgName || ""}选举委员会`}
                      </span>
                      <span className="ann-row__date">{ann.publishedAt?.slice(0, 10) || "—"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>

        {/* 右：下一法定阶段 + SOP 折叠时间轴 */}
        <Col span={10}>
          <Card
            title={
              <Space size="small">
                <CalendarIcon />
                <span>下一法定阶段</span>
              </Space>
            }
            description="全套阶段由 D-day 依法倒排，取第一个未完成节点。"
          >
            {nextStage ? (
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#1d2129", lineHeight: 1.4 }}>
                  {nextStage.stageName}
                </div>
                <div
                  style={{
                    color: "#4e5969",
                    fontSize: 13,
                    marginTop: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <TimeIcon />
                  {nextStage.startDate} ~ {nextStage.endDate}
                </div>
                <div style={{ marginTop: 10 }}>
                  <StatusTag type="stage" status={(nextStage?.derivedStatus as string) || "not_started"} />
                  <span style={{ marginLeft: 12, color: "#888", fontSize: 12 }}>
                    已完成 {completedStages} / {stages.length} 个法定节点
                  </span>
                </div>
              </div>
            ) : (
              <div className="empty-box" style={{ padding: "32px 0" }}>
                <CalendarIcon size="32px" />
                <div>{stages.length ? "全部法定阶段已完成" : "暂无后续阶段"}</div>
              </div>
            )}

            {/* SOP 14 阶段时间轴收纳为折叠区（日期推导态，R-09） */}
            <Collapse style={{ marginTop: 16 }}>
              <CollapsePanel header={`SOP 14 阶段法定流程全景（已完成 ${completedStages} / ${stages.length}）`}>
                <div style={{ maxHeight: 460, overflowY: "auto", paddingRight: 8 }}>
                  <SopTimeline stages={withDerivedStages(stages)} />
                </div>
              </CollapsePanel>
            </Collapse>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
