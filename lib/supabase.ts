import { createClient, type User } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://lzwwfjsdxyqtswfvqmwf.supabase.co";
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_z2_qLk2jsLRhx8yFKRjeMg_DhCyaskL";

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
  report_type: "鍛ㄦ姤" | "鏈堟姤" | "鑷畾涔夋€荤粨";
  status: "宸茬‘璁? | "鑽夌";
  range_start: string;
  range_end: string;
  source_count: number;
};

async function requireUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("鐧诲綍宸插け鏁堬紝璇烽噸鏂扮櫥褰?);
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
    options: { data: { full_name: name || `鐢ㄦ埛 ${normalizedPhone.slice(-4)}`, phone: normalizedPhone } },
  });
  if (error) throw error;
  if (!data.session) throw new Error("娉ㄥ唽鎴愬姛锛屼絾 Supabase 浠嶈姹傜‘璁ら偖绠便€傝鍏抽棴閭纭鍚庨噸璇曘€?);
  return data.user;
}

export function accountFromUser(user: User) {
  const phone = String(user.user_metadata.phone ?? user.email?.split("@")[0] ?? "");
  const name = String(user.user_metadata.full_name ?? `鐢ㄦ埛 ${phone.slice(-4)}`);
  return { id: user.id, name, phone };
}

export async function loadWorkspace() {
  await requireUser();
  const [records, projects, goals, reports] = await Promise.all([
    supabase.from("work_records").select("id,occurred_at,title,details,project,goal,polished").order("occurred_at", { ascending: false }),
    supabase.from("projects").select("name").order("created_at", { ascending: true }),
    supabase.from("goals").select("name").order("created_at", { ascending: true }),
    supabase.from("reports").select("id,title,report_date,report_type,status,range_start,range_end,source_count").order("report_date", { ascending: false }),
  ]);
  throwIfError(records.error, "璇诲彇宸ヤ綔璁板綍澶辫触");
  throwIfError(projects.error, "璇诲彇椤圭洰澶辫触");
  throwIfError(goals.error, "璇诲彇鐩爣澶辫触");
  throwIfError(reports.error, "璇诲彇鎶ュ憡澶辫触");
  return {
    records: (records.data ?? []) as WorkspaceRecord[],
    projects: (projects.data ?? []).map((item) => String(item.name)),
    goals: (goals.data ?? []).map((item) => String(item.name)),
    reports: (reports.data ?? []) as WorkspaceReport[],
  };
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
  throwIfError(error, "淇濆瓨宸ヤ綔璁板綍澶辫触");
  if (!data) throw new Error("淇濆瓨宸ヤ綔璁板綍澶辫触锛氭暟鎹簱娌℃湁杩斿洖璁板綍");
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
    throw new Error("杩欐潯璁板綍灏氭湭鍐欏叆浜戠锛岃閲嶆柊鍒涘缓鍚庡啀淇敼");
  }
  const payload = {
    title: record.title,
    details: record.refinedTitle || null,
    occurred_at: record.occurredAt,
    project: record.project === "鏈叧鑱旈」鐩? ? null : record.project,
    goal: record.goal === "鏈叧鑱旂洰鏍? ? null : record.goal,
    polished: record.polished,
  };
  const { error } = await supabase.from("work_records").update(payload).eq("id", record.id);
  throwIfError(error, "鏇存柊宸ヤ綔璁板綍澶辫触");
}

export async function deleteWorkRecord(id: string) {
  await requireUser();
  if (id.startsWith("demo-") || id.startsWith("local-")) {
    throw new Error("杩欐潯璁板綍灏氭湭鍐欏叆浜戠锛屾棤娉曞垹闄や簯绔暟鎹?);
  }
  const { error } = await supabase.from("work_records").delete().eq("id", id);
  throwIfError(error, "鍒犻櫎宸ヤ綔璁板綍澶辫触");
}

export async function addNamedItem(table: "projects" | "goals", name: string) {
  const user = await requireUser();
  const value = name.trim();
  if (!value) throw new Error("鍚嶇О涓嶈兘涓虹┖");
  const { error } = await supabase.from(table).upsert(
    { user_id: user.id, name: value },
    { onConflict: "user_id,name" },
  );
  throwIfError(error, `淇濆瓨${table === "projects" ? "椤圭洰" : "鐩爣"}澶辫触`);
}

export async function replaceProjects(names: string[]) {
  const user = await requireUser();
  const cleanNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const { error: deleteError } = await supabase.from("projects").delete().eq("user_id", user.id);
  throwIfError(deleteError, "鏇存柊椤圭洰澶辫触");
  if (!cleanNames.length) return;
  const { error } = await supabase.from("projects").insert(cleanNames.map((name) => ({ user_id: user.id, name })));
  throwIfError(error, "鏇存柊椤圭洰澶辫触");
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
  throwIfError(error, "淇濆瓨鏂囦欢淇℃伅澶辫触");
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
    throwIfError(error, "鏇存柊鎶ュ憡澶辫触");
    return;
  }
  const { error } = await supabase.from("reports").insert({ ...payload, user_id: user.id });
  throwIfError(error, "淇濆瓨鎶ュ憡澶辫触");
}

