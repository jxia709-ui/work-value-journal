import { createClient, type User } from "@supabase/supabase-js";

const directSupabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://lzwwfjsdxyqtswfvqmwf.supabase.co";
const supabaseUrl =
  typeof window !== "undefined"
    ? `${window.location.origin}/supabase`
    : directSupabaseUrl;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_z2_qLk2jsLRhx8yFKRjeMg_DhCyaskL";

export const isSupabaseConfigured = Boolean(directSupabaseUrl && supabaseKey);

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

export type WorkspaceKpi = {
  id: string;
  title: string;
  details: string[];
};

export type WorkspaceProfile = {
  role: string;
  kpis: WorkspaceKpi[];
};

async function requireUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("登录已失效，请重新登录");
  return data.user;
}

function throwIfError(error: { message?: string } | null, fallback: string) {
  if (error) throw new Error(error.message || fallback);
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
  await requireUser();
  const [profile, records, projects, goals, reports] = await Promise.all([
    supabase.from("profiles").select("role,kpis").maybeSingle(),
    supabase.from("work_records").select("id,occurred_at,title,details,project,goal,polished").order("occurred_at", { ascending: false }),
    supabase.from("projects").select("name").order("created_at", { ascending: true }),
    supabase.from("goals").select("name").order("created_at", { ascending: true }),
    supabase.from("reports").select("id,title,report_date,report_type,status,range_start,range_end,source_count").order("report_date", { ascending: false }),
  ]);
  throwIfError(profile.error, "读取工作档案失败");
  throwIfError(records.error, "读取工作记录失败");
  throwIfError(projects.error, "读取项目失败");
  throwIfError(goals.error, "读取目标失败");
  throwIfError(reports.error, "读取报告失败");
  return {
    profile: {
      role: String(profile.data?.role || ""),
      kpis: Array.isArray(profile.data?.kpis) ? profile.data.kpis as WorkspaceKpi[] : [],
    } satisfies WorkspaceProfile,
    records: (records.data ?? []) as WorkspaceRecord[],
    projects: (projects.data ?? []).map((item) => String(item.name)),
    goals: (goals.data ?? []).map((item) => String(item.name)),
    reports: (reports.data ?? []) as WorkspaceReport[],
  };
}

export async function saveWorkProfile(profile: WorkspaceProfile) {
  const user = await requireUser();
  const cleanKpis = profile.kpis
    .map((kpi) => ({
      id: kpi.id || `kpi-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      title: kpi.title.trim(),
      details: kpi.details.map((detail) => detail.trim()).filter(Boolean),
    }))
    .filter((kpi) => kpi.title);
  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    role: profile.role.trim(),
    kpis: cleanKpis,
    updated_at: new Date().toISOString(),
  });
  throwIfError(error, "保存工作档案失败");
  return { role: profile.role.trim(), kpis: cleanKpis };
}

export async function addWorkRecord(input: { title: string; details: string; project?: string; occurredAt: string }) {
  const user = await requireUser();
  const payload = {
    user_id: user.id,
    title: input.title,
    details: input.details || null,
    project: input.project || null,
    occurred_at: input.occurredAt,
    polished: false,
  };
  const { data, error } = await supabase
    .from("work_records")
    .insert(payload)
    .select("id,occurred_at,title,details,project,goal,polished")
    .single();
  throwIfError(error, "保存工作记录失败");
  if (!data) throw new Error("保存工作记录失败：数据库没有返回记录");
  return data as WorkspaceRecord;
}

export async function addImportedWorkRecords(items: { title: string; project?: string; occurredAt: string }[]) {
  const saved: WorkspaceRecord[] = [];
  for (const item of items) {
    saved.push(await addWorkRecord({ ...item, details: "", occurredAt: item.occurredAt }));
  }
  return saved;
}

export async function updateWorkRecord(record: { id: string; title: string; refinedTitle: string; occurredAt: string; project: string; goal: string; polished: boolean }) {
  await requireUser();
  if (record.id.startsWith("demo-") || record.id.startsWith("local-")) {
    throw new Error("这条记录尚未写入云端，请重新创建后再修改");
  }
  const payload = {
    title: record.title,
    details: record.refinedTitle || null,
    occurred_at: record.occurredAt,
    project: record.project === "未关联项目" ? null : record.project,
    goal: record.goal === "未关联目标" ? null : record.goal,
    polished: record.polished,
  };
  const { error } = await supabase.from("work_records").update(payload).eq("id", record.id);
  throwIfError(error, "更新工作记录失败");
}

export async function deleteWorkRecord(id: string) {
  await requireUser();
  if (id.startsWith("demo-") || id.startsWith("local-")) {
    throw new Error("这条记录尚未写入云端，无法删除云端数据");
  }
  const { error } = await supabase.from("work_records").delete().eq("id", id);
  throwIfError(error, "删除工作记录失败");
}

export async function addNamedItem(table: "projects" | "goals", name: string) {
  const user = await requireUser();
  const value = name.trim();
  if (!value) throw new Error("名称不能为空");
  const { error } = await supabase.from(table).upsert(
    { user_id: user.id, name: value },
    { onConflict: "user_id,name" },
  );
  throwIfError(error, `保存${table === "projects" ? "项目" : "目标"}失败`);
}

export async function replaceProjects(names: string[]) {
  const user = await requireUser();
  const cleanNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const { error: deleteError } = await supabase.from("projects").delete().eq("user_id", user.id);
  throwIfError(deleteError, "更新项目失败");
  if (!cleanNames.length) return;
  const { error } = await supabase.from("projects").insert(cleanNames.map((name) => ({ user_id: user.id, name })));
  throwIfError(error, "更新项目失败");
}

export async function saveSourceFileMetadata(file: File, category: "profile" | "weekly_report") {
  const user = await requireUser();
  const { error } = await supabase.from("source_files").insert({
    user_id: user.id,
    file_name: file.name,
    file_type: file.type || null,
    file_size: file.size,
    category,
    status: "metadata_saved",
  });
  throwIfError(error, "保存文件信息失败");
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
  const user = await requireUser();
  const payload = {
    title: report.title,
    report_type: report.reportType,
    status: report.status,
    range_start: report.rangeStart,
    range_end: report.rangeEnd,
    source_count: report.sourceCount,
    report_date: new Date().toISOString().slice(0, 10),
  };
  if (report.id) {
    const { error } = await supabase.from("reports").update(payload).eq("id", report.id);
    throwIfError(error, "更新报告失败");
    return;
  }
  const { error } = await supabase.from("reports").insert({ ...payload, user_id: user.id });
  throwIfError(error, "保存报告失败");
}

