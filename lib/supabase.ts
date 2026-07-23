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
  const [records, projects, goals, reports] = await Promise.all([
    supabase.from("work_records").select("id,occurred_at,title,project,goal,polished").order("occurred_at", { ascending: false }),
    supabase.from("projects").select("name").order("created_at", { ascending: true }),
    supabase.from("goals").select("name").order("created_at", { ascending: true }),
    supabase.from("reports").select("id,title,report_date,report_type,status,range_start,range_end,source_count").order("report_date", { ascending: false }),
  ]);
  const error = records.error ?? projects.error ?? goals.error ?? reports.error;
  if (error) throw error;
  return {
    records: (records.data ?? []) as WorkspaceRecord[],
    projects: (projects.data ?? []).map((item) => item.name),
    goals: (goals.data ?? []).map((item) => item.name),
    reports: (reports.data ?? []) as WorkspaceReport[],
  };
}

export async function addWorkRecord(title: string) {
  const { data, error } = await supabase.from("work_records").insert({ title, polished: true }).select("id,occurred_at,title,project,goal,polished").single();
  if (error) throw error;
  return data as WorkspaceRecord;
}

export async function updateWorkRecord(record: { id: string; title: string; project: string; goal: string; polished: boolean }) {
  const { error } = await supabase.from("work_records").update({
    title: record.title,
    project: record.project === "未关联项目" ? null : record.project,
    goal: record.goal === "未关联目标" ? null : record.goal,
    polished: record.polished,
  }).eq("id", record.id);
  if (error) throw error;
}

export async function addNamedItem(table: "projects" | "goals", name: string) {
  const { error } = await supabase.from(table).upsert({ name }, { onConflict: "user_id,name" });
  if (error) throw error;
}

export async function replaceProjects(names: string[]) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("登录已失效，请重新登录");
  const { error: deleteError } = await supabase.from("projects").delete().eq("user_id", auth.user.id);
  if (deleteError) throw deleteError;
  if (!names.length) return;
  const { error } = await supabase.from("projects").insert(names.map((name) => ({ name })));
  if (error) throw error;
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
