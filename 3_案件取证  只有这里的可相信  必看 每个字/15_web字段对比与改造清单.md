# web 前端字段与新数据库对比报告（脱稿制）

> **生成时间**：2026-09-04
> **真相来源**：本地 PostgreSQL `backend_new` 真实 schema（22 张表，information_schema 实查）
> **对比对象**：`web/src/services/electionApi.ts` 的 interface 与接口路径
> **结论**：web 字段体系是旧库污染产物，与新库完全不匹配，必须整体重写 electionApi.ts 的 interface 和接口路径

---

## 一、接口路径错误（全部 /api/* → 需映射到后端真实路由）

| web 旧路径 | 后端真实路径 | 状态 |
|---|---|---|
| `GET /api/elections` | `GET /admin/election-fiefs` | 需改 |
| `GET /api/elections/:id/stages` | `GET /admin/election-fiefs/:id/stages` | 需改 |
| `GET /api/announcements` | `GET /admin/announcements` | 需改 |
| `POST /api/announcements` | `POST /admin/announcements` | 需改 |
| `PUT /api/announcements/:id` | `PUT /admin/announcements/:id` | 需改 |
| `PUT /api/announcements/:id/publish` | `POST /admin/announcements/:id/publish` | 需改 |
| `GET /api/candidates` | `GET /admin/candidates` | 需改 |
| `PUT /api/candidates/:id/result` | **删除（votes 投票污染）** | 必须删 |
| `PUT /api/candidates/:id/round` | `POST /admin/candidates/:id/reviews` | 需改 |
| `POST /api/candidates/send-review` | **后端无此接口** | 待评估 |
| `GET /api/positions` | `GET /admin/positions` | 需改 |
| `GET /api/proposals` | `GET /admin/proposals` | 需改 |
| `POST /api/proposals` | `POST /admin/proposals` | 需改 |
| `PUT /api/proposals/:id` | `PUT /admin/proposals/:id` | 需改 |
| `POST /api/proposals/:id/review` | `POST /admin/proposals/:id/review` | 需改 |
| `POST /api/proposals/:id/file` | 待后端实现 | 待补 |
| `POST /api/elections/:id/generate-stages` | pipeline 已内置（审核通过自动生成） | 删除独立调用 |
| `GET /api/notifications` | 后端无 | 待补或删 |
| `GET /api/roster` | 后端无 | 待补或删 |
| `GET /api/results` | **删除（投票结果污染）** | 必须删 |
| `GET /api/archives` | 后端无 | 待补 |
| `GET /api/dashboard/alerts` | 后端无 | 待补 |

---

## 二、字段名错误（interface 层）

### 2.1 Org（web:46）
| web 字段 | 真实库字段 | 说明 |
|---|---|---|
| `orgId` | `id` | 主键名 |
| `name` | `name` | 一致 |
| `town` | **不存在** | 删除 |
| `type` | `slug` | web 把 slug 当 type |
| `status` | `status` | 一致 |
| `orgType` | `org_type` | 下划线 |

### 2.2 Election（web:47）→ 真实表 election_fiefs
| web 字段 | 真实库字段 | 说明 |
|---|---|---|
| `electionId` | `id` | |
| `orgId` | `organization_id` | |
| `orgName` | 关联查询 | 库无此字段，需 JOIN organizations |
| `orgType` | 关联查询 | 同上 |
| `elId` | `id` | **重复冗余，删除** |
| `elTerm` | `election_term_id` | |
| `elName` | `name` | |
| `elStatus` | `status` | |
| `elElectionDate` | `d_day` | D日 |
| `elMethod` | **不存在** | 删除 |
| `elProposalId` | **不存在** | 删除（提案→封地是生成关系，不是字段） |
| `elNote` | **不存在** | 删除 |

### 2.3 Announcement（web:49）→ 真实表 announcements
| web 字段 | 真实库字段 | 说明 |
|---|---|---|
| `id` | `id` | 一致 |
| `orgId` | **不存在** | 公告通过 election_fief_id → organization 关联，无直接 org_id |
| `elId` | `election_fief_id` | |
| `annCode` | **不存在** | 删除（模板编码在 announcement_templates.at_code） |
| `annTitle` | `title` | |
| `annStageKey` | `stage_key` | |
| `annStatus` | `status` | |
| `annVersion` | **不存在** | 删除 |
| `annEditor` | `created_by` / `updated_by` | uuid，不是名字 |
| `annPublishTime` | `published_at` | |
| `annContent` | `body` | |

### 2.4 Candidate（web:54-58）→ 真实表 candidates + candidate_reviews
| web 字段 | 真实库字段 | 说明 |
|---|---|---|
| `id` | `id` | 一致 |
| `orgId` | **不存在** | 通过 fief 关联 |
| `elId` | `election_fief_id` | |
| `candName` | users.display_name | 需 JOIN users |
| `candPositionId` | **不存在** | 候选人不直接绑岗位，通过 material 关联 |
| `candSource` | **不存在** | 删除（自荐/组织推荐在 materials？待确认） |
| `candGender` | **不存在** | users 表无性别字段 |
| `candAge` | **不存在** | 同上 |
| `candPhone` | users.phone | 需 JOIN users |
| `candR1/R1Reviewer/R1Time/R1Comment` | **不存在（平铺字段）** | 真实是 candidate_reviews 表（round=R1, reviewer_id, decision, note, created_at） |
| `candR2~R4` 同上 | 同上 | 四轮审核是 4 行记录，不是 16 个平铺字段 |

### 2.5 Material（web:69）→ 真实表 materials
| web 字段 | 真实库字段 | 说明 |
|---|---|---|
| `id` | `id` | 一致 |
| `orgId` | **不存在** | |
| `elId` | `election_fief_id` | |
| `matType` | **不存在** | 删除 |
| `matStatus` | `status` | |
| `matPositionId` | **不存在** | 删除 |
| `matCandidateId` | `candidate_user_id` | |

### 2.6 Position（web:93）→ 真实表 positions
| web 字段 | 真实库字段 | 说明 |
|---|---|---|
| `id` | `id` | 一致 |
| `orgId` | **不存在** | |
| `elId` | `election_fief_id` | |
| `posType` | **不存在** | 删除（岗位名在 name） |
| `posQuota` | `quota` | |
| `posStatus` | `status` | |
| `posDesc` | **不存在** | 删除 |
| `posFiles` | **不存在** | 删除（附件在 material_files） |

### 2.7 LoginUser（web:84）→ 登录返回
| web 字段 | 真实返回 | 说明 |
|---|---|---|
| `id` | 无 | 登录不返回 user id |
| `phone` | 请求参数 | |
| `orgId` | `organizationId` | |
| `orgName` | `orgName` | 一致 |
| `orgType` | `orgType` | 一致 |
| `name` | **无** | 后端不返回 display_name，需单独查 |
| `role` | `role` | 一致 |
| `roles` | **不存在** | 删除 |
| `crossOrg` | **不存在** | 删除 |
| `roleKeys` | **不存在** | 权限点需单独调 /auth/permissions |

---

## 三、高危污染字段（必须删除，甲方明令禁止）

| 位置 | 污染字段 | 原因 |
|---|---|---|
| `updateCandidateResult(id, votes, candStatus)` | `votes` | 甲方 A-002：参选人≠选民，无线上投票，禁止得票概念 |
| `GET /api/results` | 整个接口 | 投票结果接口，必须删除 |
| `Candidate.candR1~R4` 平铺 | 16 个字段 | 旧库设计，新库是 candidate_reviews 关联表 |
| `Election.elMethod` | 选举方式 | 旧库概念，新库无 |

---

## 四、角色名对比

| 位置 | 角色名 | 真实库角色 | 状态 |
|---|---|---|---|
| 本地库 memberships.role | `platform_admin/sub_admin/editor/reviewer/candidate` | 同左 | **正确** |
| 后端 server.ts | `sub_admin`（已回滚） | 同左 | **正确** |
| web GuideTour/User/AdminUsers/OrgSetup | `sub_admin` | 同左 | **正确** |
| web electionApi.ts:227 PresetAccountRow | `'sub_admin' \| 'operator' \| ...` | 无 operator | **错误，删 operator** |
| web roleStore.ts:11 注释 | `platform_admin/sub_admin/editor/reviewer/candidate` | 同左 | 正确 |

---

## 五、改造策略

1. **重写 electionApi.ts 的 interface**：按真实库字段定义，删除所有 `el*/cand*/ann*/pos*/mat*` 前缀旧字段
2. **接口路径映射**：`/api/*` → `/admin/*`，删除投票相关接口
3. **候选人四轮审核**：从平铺字段改为 candidate_reviews 数组（round, reviewer_id, decision, note, created_at）
4. **关联数据**：候选人姓名/电话需后端 JOIN users 返回，或前端单独查
5. **权限点**：登录后调 `/auth/permissions` 获取 role_permissions，前端按权限渲染
6. **假数据清理**：main.tsx/liveSync.ts/electionStore.ts/noticeStore.ts/chart.ts/roleStore.ts 的 mock 兜底全部删除

---

## 六、真实库 22 张表清单

organizations, users, memberships, sessions, invitations, roles, role_permissions,
election_terms, election_units, election_fiefs, election_fief_stages, stage_templates,
election_proposals, positions, candidates, candidate_reviews, materials, material_files,
announcement_templates, announcements, webhook_subscriptions

（完整字段见 `backend-new/_dump_schema.mjs` 输出或 information_schema 实查）
