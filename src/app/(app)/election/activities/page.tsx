"use client";

/**
 * M03: 换届活动档案大厅 (/election/activities)
 * 承接提案审批后生成的活动实体，D-day 倒计时与进入 Pipeline 的总入口。
 *
 * 数据口径（Sub D 切换）：主源保持 /admin/election-fiefs（getElectionFiefs）；
 * 「届次 / 归属村·社区」两列由 useElectionTerms（/api/elections.elTerm/elName 映射）补齐——
 * 后端 election_fiefs 行不含 term_name/organization_name（原虚标字段致两列恒空白）。
 */
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  Table,
  Button,
  Space,
  MessagePlugin,
  Row,
  Col,
  Tag,
  Input,
  Select,
} from "tdesign-react";
import { CalendarIcon, BrowseIcon, SearchIcon } from "tdesign-icons-react";
import { getElectionFiefs, pickDefaultFief, ElectionFief } from "@/lib/api/elections";
import { useElectionTerms } from "@/lib/hooks/useElectionTerms";
import { useAuthStore } from "@/lib/stores/useAuthStore";
import { useElectionStore } from "@/lib/stores/useElectionStore";
import { StatusTag } from "@/lib/components/StatusTag";
import { fmtDateTime } from "@/lib/utils/fmt";

export default function ActivitiesPage() {
  const [list, setList] = useState<ElectionFief[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setFiefQuick = useElectionStore((s) => s.setFiefQuick);
  const currentFiefId = useElectionStore((s) => s.currentFiefId);
  // 届次映射：elId（= election_fiefs.id）→ { elTerm, orgName, ... }
  const { termMap } = useElectionTerms();

  // 筛选条（本地过滤，补齐四页筛选修复的漏网第五页）
  const [kwInput, setKwInput] = useState("");
  const [termInput, setTermInput] = useState("all");
  const [statusInput, setStatusInput] = useState("all");
  const [kw, setKw] = useState("");
  const [term, setTerm] = useState("all");
  const [status, setStatus] = useState("all");

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getElectionFiefs();
      setList(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "加载换届活动失败";
      MessagePlugin.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 计算距离选举日天数
  const calcDaysToDday = (dDay: string) => {
    if (!dDay) return 0;
    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const target = new Date(`${dDay}T00:00:00Z`);
    const diffTime = target.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const columns = [
    { colKey: "name", title: "活动名称", width: 260 },
    {
      colKey: "termName",
      title: "届次",
      width: 150,
      cell: ({ row }: { row: ElectionFief }) => (
        <strong>{termMap[row.id]?.elTerm || "—"}</strong>
      ),
    },
    {
      colKey: "organizationName",
      title: "归属村/社区",
      width: 140,
      cell: ({ row }: { row: ElectionFief }) => termMap[row.id]?.orgName || user?.orgName || "—",
    },
    {
      colKey: "dDay",
      title: "正式选举日(D)",
      width: 160,
      cell: ({ row }: { row: ElectionFief }) => {
        const days = calcDaysToDday(row.dDay);
        return (
          <Space direction="vertical" size={2}>
            <strong style={{ color: "#0052d9" }}>{row.dDay}</strong>
            <span style={{ fontSize: 12, color: days >= 0 ? "#00a870" : "#888" }}>
              {days > 0
                ? `距选举日还有 ${days} 天`
                : days === 0
                  ? "🔥 今日正式选举！"
                  : `已结束 ${Math.abs(days)} 天`}
            </span>
          </Space>
        );
      },
    },
    {
      colKey: "status",
      title: "状态",
      width: 100,
      cell: ({ row }: { row: ElectionFief }) => <StatusTag type="election" status={row.status} />,
    },
    {
      colKey: "createdAt",
      title: "启动时间",
      width: 180,
      cell: ({ row }: { row: ElectionFief }) => <span>{fmtDateTime(row.createdAt)}</span>,
    },
    {
      colKey: "op",
      title: "操作",
      width: 180,
      cell: ({ row }: { row: ElectionFief }) => (
        <Button
          theme="primary"
          variant="base"
          size="small"
          icon={<BrowseIcon />}
          onClick={() => {
            setFiefQuick(row);
            router.push(`/election/activity/${row.id}`);
          }}
        >
          进入本届 Pipeline
        </Button>
      ),
    },
  ];

  // R-13：hero 与 home/dashboard 同源取「当前届」（优先持久化选择，否则最新 active；修 list[0] 取到 draft 引导壳）
  const currentFief = pickDefaultFief(list, currentFiefId);
  const currentTerm = currentFief ? termMap[currentFief.id] : undefined;
  const daysLeft = currentFief ? calcDaysToDday(currentFief.dDay) : 0;

  // 届次选项（去重）
  const termOptions = [
    { label: "全部届次", value: "all" },
    ...Array.from(new Set(list.map((f) => termMap[f.id]?.elTerm).filter(Boolean))).map((t) => ({
      label: t as string,
      value: t as string,
    })),
  ];

  // 本地过滤
  const filteredList = list.filter((f) => {
    const t = termMap[f.id]?.elTerm || "";
    return (
      (!kw || f.name.toLowerCase().includes(kw.toLowerCase())) &&
      (term === "all" || t === term) &&
      (status === "all" || f.status === status)
    );
  });

  return (
    <div style={{ padding: 24 }}>
      {/* 顶部醒目看版（届次/组织名从 /api/elections 映射取） */}
      {currentFief && (
        <Card style={{ marginBottom: 24, background: "linear-gradient(135deg, #f0f5ff 0%, #ffffff 100%)" }}>
          <Row gutter={16} align="middle">
            <Col span={8}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1d2129" }}>
                {currentTerm?.orgName || user?.orgName || "本归属地"} · {currentFief.name}
              </div>
              <div style={{ color: "#4e5969", fontSize: 13, marginTop: 6 }}>
                <Tag theme="primary" variant="light" size="small">
                  {currentTerm?.elTerm || "换届选举"}
                </Tag>
                <span style={{ marginLeft: 8 }}>
                  法律依据：《
                  {user?.orgType === "community" ? "城市居民委员会组织法" : "村民委员会组织法"}》
                </span>
              </div>
            </Col>
            <Col span={4}>
              <div style={{ color: "#888", fontSize: 12 }}>正式选举日 (D-day)</div>
              <div style={{ color: "#0052d9", fontSize: 18, fontWeight: 700, marginTop: 4 }}>
                {currentFief.dDay}
              </div>
            </Col>
            <Col span={4}>
              <div style={{ color: "#888", fontSize: 12 }}>时间倒排状态</div>
              <div
                style={{
                  color: daysLeft >= 0 ? "#00a870" : "#888",
                  fontSize: 18,
                  fontWeight: 700,
                  marginTop: 4,
                }}
              >
                {daysLeft > 0 ? `距选举还有 ${daysLeft} 天` : daysLeft === 0 ? "今日选举！" : "已完结"}
              </div>
            </Col>
            <Col span={8} style={{ textAlign: "right" }}>
              <Button
                theme="primary"
                size="large"
                icon={<CalendarIcon />}
                onClick={() => router.push(`/election/activity/${currentFief.id}`)}
              >
                查看 14 阶段日程与公文预排
              </Button>
            </Col>
          </Row>
        </Card>
      )}

      <Card
        title="换届活动档案列表"
        description="换届活动由【选举提案】审核通过后单事务自动初始化生成。此处展示本归属地历届与当届选举实体。"
      >
        {/* 筛选条：关键词 + 届次 + 状态 + 查询/重置（本地过滤） */}
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
            style={{ width: 220 }}
            value={kwInput}
            onChange={(v) => setKwInput(v as string)}
            placeholder="输入活动名称关键词..."
            prefixIcon={<SearchIcon />}
            clearable
          />
          <Select
            style={{ width: 160 }}
            value={termInput}
            onChange={(v) => setTermInput(v as string)}
            options={termOptions}
          />
          <Select
            style={{ width: 140 }}
            value={statusInput}
            onChange={(v) => setStatusInput(v as string)}
            options={[
              { label: "全部状态", value: "all" },
              { label: "进行中", value: "active" },
              { label: "筹备中", value: "draft" },
              { label: "已收尾", value: "closed" },
            ]}
          />
          <Button
            theme="primary"
            variant="outline"
            icon={<SearchIcon />}
            onClick={() => {
              setKw(kwInput.trim());
              setTerm(termInput);
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
              setTermInput("all");
              setStatusInput("all");
              setKw("");
              setTerm("all");
              setStatus("all");
            }}
          >
            重置
          </Button>
          <span style={{ color: "#888", fontSize: 13, marginLeft: "auto" }}>
            共 {filteredList.length} 场活动
          </span>
        </div>
        <Table data={filteredList} columns={columns} rowKey="id" loading={loading} />
      </Card>
    </div>
  );
}
