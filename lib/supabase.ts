import { createClient, type User } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseKey || "placeholder",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

export type WorkspaceRecord = {
  id: string;
  occurred_at: string;
  title: string;
  details: string | null;
  project: string | null;
  goal: string | null;
  polished: boolean;
};

export type WorkspaceReport = {
  id: string;
  title: string;
  report_date: string;
  report_type: "周报" | "月报" | "自定义总结";
  status: "已确认" | "草稿";
  range_start: string;
  range_end: string;
  source_count: number;
};

type LocalWorkspace = {
  records: WorkspaceRecord[];
  projects: string[];
  goals: string[];
  reports: WorkspaceReport[];
};

function emptyLocalWorkspace(): LocalWorkspace {
  return { records: [], projects: [], goals: [], reports: [] };
}

async function localWorkspaceKey() {
  const { data } = await supabase.auth.getUser();
  return data.user ? `work-value-workspace:${data.user.id}` : "";
}

async function readLocalWorkspace(): Promise<LocalWorkspace> {
  if (typeof window === "undefined") return emptyLocalWorkspace();
  const key = await localWorkspaceKey();
  if (!key) return emptyLocalWorkspace();
  try {
    return { ...emptyLocalWorkspace(), ...JSON.parse(window.localStorage.getItem(key) || "{}") };
  } catch {
    return emptyLocalWorkspace();
  }
}

async function writeLocalWorkspace(workspace: LocalWorkspace) {
  if (typeof window === "undefined") return;
  const key = await localWorkspaceKey();
  if (key) window.localStorage.setItem(key, JSON.stringify(workspace));
}

function mergeById<T extends { id: string }>(remote: T[], local: T[]) {
  const items = new Map(remote.map((item) => [item.id, item]));
  local.forEach((item) => items.set(item.id, item));
  return [...items.values()];
}

function demoWorkspace(): LocalWorkspace {
  const now = new Date();
  const at = (daysAgo: number, hour: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(hour, 20, 0, 0);
    return date.toISOString();
  };
  const records: WorkspaceRecord[] = [
    ["完善企业端首页核心卡片方案", "完成企业端首页核心卡片方案迭代，明确服务完成、待办与风险提醒的信息优先级。", "企业端首页改版", "提升核心服务入口使用效率", 0, 10],
    ["和开发对齐移动端适配规则", "与开发确认移动端卡片间距、断点及吸底交互，降低后续验收返工成本。", "企业端首页改版", "减少沟通与返工成本", 1, 15],
    ["补充 AI 开票异常反馈流程", "补齐 AI 开票异常状态与反馈路径，推动业务流程形成完整闭环。", "AI 开票", "推动 AI 能力进入真实业务流程", 2, 11],
    ["完成合规提醒模块设计验收", "完成合规提醒模块的视觉与交互验收，整理问题清单并同步开发修改。", "合规服务体验", "提升核心服务入口使用效率", 3, 16],
    ["梳理历史周报导入结构", "明确历史周报的事项、目标、项目三类字段，为后续自动总结建立结构化依据。", "工作价值助手", "推动 AI 能力进入真实业务流程", 5, 14],
    ["整理本周设计工作复盘", "沉淀本周关键成果与协作结论，并明确下周优先事项。", "工作价值助手", "减少沟通与返工成本", 6, 17],
  ].map(([title, details, project, goal, daysAgo, hour], index) => ({
    id: `demo-record-${index + 1}`,
    occurred_at: at(Number(daysAgo), Number(hour)),
    title: String(title),
    details: String(details),
    project: String(project),
    goal: String(goal),
    polished: index !== 1,
  }));
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const day = (date: Date) => date.toISOString().slice(0, 10);
  return {
    records,
    projects: ["企业端首页改版", "AI 开票", "合规服务体验", "工作价值助手"],
    goals: ["提升核心服务入口使用效率", "推动 AI 能力进入真实业务流程", "减少沟通与返工成本"],
    reports: [{
      id: "demo-report-current",
      title: "本周工作周报",
      report_date: day(now),
      report_type: "周报",
      status: "已确认",
      range_start: day(weekStart),
      range_end: day(weekEnd),
      source_count: 6,
    }],
  };
}

export function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("86") && digits.length === 13 ? digits.slice(2) : digits;
}

function phoneEmail(phone: string) {
  return `${normalizePhone(phone)}@phone.workvalue.app`;
}

export async function signInWithPhone(phone: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: phoneEmail(phone), password });
  if (error) throw error;
  return data.user;
}

export async function signUpWithPhone(name: string, phone: string, password: string) {
  const normalizedPhone = normalizePhone(phone);
  const { data, error } = await supabase.auth.signUp({
    email: phoneEmail(normalizedPhone),
    password,
    options: { data: { full_name: name || `用户 ${normalizedPhone.slice(-4)}`, phone: normalizedPhone } },
  });
  if (error) throw error;
  if (!data.session) throw new Error("注册成功，但 Supabase 仍要求确认邮箱。请关闭邮箱确认后重试。");
  return data.user;
}

export function accountFromUser(user: User) {
  const phone = String(user.user_metadata.phone ?? user.email?.split("@")[0] ?? "");
  const name = String(user.user_metadata.full_name ?? `用户 ${phone.slice(-4)}`);
  return { id: user.id, name, phone };
}

export async function loadWorkspace() {
  const local = await readLocalWorkspace();
  const [records, projects, goals, reports] = await Promise.all([
    supabase.from("work_records").select("id,occurred_at,title,details,project,goal,polished").order("occurred_at", { ascending: false }),
    supabase.from("projects").select("name").order("created_at", { ascending: true }),
    supabase.from("goals").select("name").order("created_at", { ascending: true }),
    supabase.from("reports").select("id,title,report_date,report_type,status,range_start,range_end,source_count").order("report_date", { ascending: false }),
  ]);
  const error = records.error ?? projects.error ?? goals.error ?? reports.error;
  const remote = error ? emptyLocalWorkspace() : {
    records: (records.data ?? []) as WorkspaceRecord[],
    projects: (projects.data ?? []).map((item) => item.name),
    goals: (goals.data ?? []).map((item) => item.name),
    reports: (reports.data ?? []) as WorkspaceReport[],
  };
  let workspace: LocalWorkspace = {
    records: mergeById(remote.records, local.records),
    projects: [...new Set([...remote.projects, ...local.projects])],
    goals: [...new Set([...remote.goals, ...local.goals])],
    reports: mergeById(remote.reports, local.reports),
  };
  if (!workspace.records.length && !workspace.projects.length) {
    workspace = demoWorkspace();
    await writeLocalWorkspace(workspace);
  }
  return workspace;
}

export async function addWorkRecord(input: { title: string; details: string; project?: string; occurredAt: string }) {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("登录已失效，请重新登录");
  const payload = {
    user_id: auth.user.id,
    title: input.title,
    details: input.details,
    project: input.project || null,
    occurred_at: input.occurredAt,
    polished: false,
  };
  const { data, error } = await supabase.from("work_records").insert(payload).select("id,occurred_at,title,details,project,goal,polished").single();
  const record = error ? {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    occurred_at: input.occurredAt,
    title: input.title,
    details: input.details,
    project: input.project || null,
    goal: null,
    polished: false,
  } : data as WorkspaceRecord;
  const workspace = await readLocalWorkspace();
  workspace.records = [record, ...workspace.records.filter((item) => item.id !== record.id)];
  await writeLocalWorkspace(workspace);
  return record;
}

export async function addImportedWorkRecords(items: { title: string; project?: string; occurredAt: string }[]) {
  const saved = [];
  for (const item of items) {
    saved.push(await addWorkRecord({ ...item, details: "", occurredAt: item.occurredAt }));
  }
  return saved;
}

export async function updateWorkRecord(record: { id: string; title: string; refinedTitle: string; occurredAt: string; project: string; goal: string; polished: boolean }) {
  const payload = {
    title: record.title,
    details: record.refinedTitle || null,
    occurred_at: record.occurredAt,
    project: record.project === "未关联项目" ? null : record.project,
    goal: record.goal === "未关联目标" ? null : record.goal,
    polished: record.polished,
  };
  if (!record.id.startsWith("demo-")) await supabase.from("work_records").update(payload).eq("id", record.id);
  const workspace = await readLocalWorkspace();
  workspace.records = workspace.records.map((item) => item.id === record.id ? { ...item, ...payload } : item);
  await writeLocalWorkspace(workspace);
}

export async function deleteWorkRecord(id: string) {
  if (!id.startsWith("demo-")) await supabase.from("work_records").delete().eq("id", id);
  const workspace = await readLocalWorkspace();
  workspace.records = workspace.records.filter((item) => item.id !== id);
  await writeLocalWorkspace(workspace);
}

export async function addNamedItem(table: "projects" | "goals", name: string) {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("登录已失效，请重新登录");
  const { error } = await supabase.from(table).upsert(
    { user_id: auth.user.id, name },
    { onConflict: "user_id,name" },
  );
  const workspace = await readLocalWorkspace();
  workspace[table] = [...new Set([...workspace[table], name])];
  await writeLocalWorkspace(workspace);
  if (error && !workspace[table].includes(name)) throw error;
}

export async function replaceProjects(names: string[]) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("登录已失效，请重新登录");
  const { error: deleteError } = await supabase.from("projects").delete().eq("user_id", auth.user.id);
  const workspace = await readLocalWorkspace();
  workspace.projects = names;
  await writeLocalWorkspace(workspace);
  if (!names.length) return;
  const { error } = await supabase.from("projects").insert(names.map((name) => ({ user_id: auth.user.id, name })));
  if (deleteError && error) throw error;
}

export async function saveSourceFileMetadata(file: File, category: "profile" | "weekly_report") {
  const { error } = await supabase.from("source_files").insert({
    file_name: file.name,
    file_type: file.type || null,
    file_size: file.size,
    category,
    status: "metadata_saved",
  });
  if (error) throw error;
}

export async function saveReport(report: {
  id?: string;
  title: string;
  reportType: WorkspaceReport["report_type"];
  status: WorkspaceReport["status"];
  rangeStart: string;
  rangeEnd: string;
  sourceCount: number;
}) {
  const payload = {
    title: report.title,
    report_type: report.reportType,
    status: report.status,
    range_start: report.rangeStart,
    range_end: report.rangeEnd,
    source_count: report.sourceCount,
    report_date: new Date().toISOString().slice(0, 10),
  };
  const query = report.id
    ? supabase.from("reports").update(payload).eq("id", report.id)
    : supabase.from("reports").insert(payload);
  const { error } = await query;
  if (error) throw error;
}
