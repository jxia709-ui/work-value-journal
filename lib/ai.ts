import { supabase } from "@/lib/supabase";

export type PolishVersion = { label: string; text: string };
export type WeeklyItem = { date: string; title: string; project: string; selected: boolean };
export type WeeklyAnalysis = { period: string; projects: string[]; items: WeeklyItem[] };
export type KpiMetric = { text: string; selected: boolean };
export type KpiItem = { title: string; description: string; selected: boolean; metrics: KpiMetric[] };
export type KpiAnalysis = { role: string; items: KpiItem[] };

async function requestAi<T>(task: "polish" | "weekly_report" | "kpi", input: { text?: string; file?: File }) {
  const form = new FormData();
  form.set("task", task);
  if (input.text) form.set("text", input.text);
  if (input.file) form.set("file", input.file);
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("登录已失效，请重新登录");
  const response = await fetch("/api/ai", { method: "POST", body: form, headers: { authorization: `Bearer ${token}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "AI 解析失败，请稍后重试");
  return data as T;
}

export const polishWorkRecord = (text: string) =>
  requestAi<{ versions: PolishVersion[] }>("polish", { text });
export const analyzeWeeklyReport = (file: File) =>
  requestAi<WeeklyAnalysis>("weekly_report", { file });
export const analyzeKpi = (file: File) =>
  requestAi<KpiAnalysis>("kpi", { file });
