import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { PDFParse } from "pdf-parse";

export const runtime = "nodejs";

type AiTask = "polish" | "weekly_report" | "kpi";

async function extractText(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    const parser = new PDFParse({ data: buffer });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }
  if (name.endsWith(".docx")) return (await mammoth.extractRawText({ buffer })).value;
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const workbook = XLSX.read(buffer);
    return workbook.SheetNames.map((sheet) => `${sheet}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheet])}`).join("\n\n");
  }
  return buffer.toString("utf8");
}

function promptFor(task: AiTask, text: string) {
  const today = new Date().toISOString().slice(0, 10);
  if (task === "polish") return {
    system: "你是工作价值表达助手。保留事实，不虚构数据。只返回 JSON。",
    user: `将以下工作记录提炼为三个不同侧重点的候选版本。每版一句到两句，分别突出结果、业务价值、推进协作。返回 {"versions":[{"label":"结果导向","text":"..."},{"label":"价值导向","text":"..."},{"label":"推进与协作","text":"..."}]}。\n原文：${text}`,
  };
  if (task === "weekly_report") return {
    system: "你是周报结构化助手。只根据原文拆分事项，不合并不同日期，不虚构日期或项目。只返回 JSON。",
    user: `今天是 ${today}。解析以下周报，按原文逐条拆分工作事项。明确日期转为 YYYY-MM-DD；只有星期几时结合周报周期推断；确实无法判断则 date 返回空字符串。返回 {"period":"原文周期或待确认","projects":["..."],"items":[{"date":"YYYY-MM-DD或空","title":"事项","project":"项目或空","selected":true}]}。原文：\n${text}`,
  };
  return {
    system: "你是 KPI/OKR 结构化助手。保持原文事实和数字，不自行补充指标。只返回 JSON。",
    user: `解析以下 KPI、OKR 或岗位职责。返回可供用户选择的结构化结果：{"role":"岗位或空","items":[{"title":"一级 KPI/目标","description":"原文说明或空","selected":true,"metrics":[{"text":"下级指标/关键结果","selected":true}]}]}。至少返回一个一级项目；没有明确下级指标时 metrics 为空。原文：\n${text}`,
  };
}

async function callModel(task: AiTask, text: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  const gatewayUrl = process.env.OPENAI_BASE_URL;
  if (!apiKey && !gatewayUrl) throw new Error("AI 服务尚未启用：请在 Netlify 中启用 AI Gateway，或配置 OPENAI_API_KEY");
  const baseUrl = (gatewayUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const prompt = promptFor(task, text.slice(0, 80_000));
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey || "netlify-ai-gateway"}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    }),
  });
  if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 没有返回可解析内容");
  return JSON.parse(content);
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const authorization = request.headers.get("authorization");
    if (!supabaseUrl || !supabaseKey || !authorization) {
      return NextResponse.json({ error: "请先登录后再使用 AI 功能" }, { status: 401 });
    }
    const authCheck = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseKey, authorization },
    });
    if (!authCheck.ok) return NextResponse.json({ error: "登录已失效，请重新登录" }, { status: 401 });
    const form = await request.formData();
    const task = String(form.get("task")) as AiTask;
    if (!["polish", "weekly_report", "kpi"].includes(task)) {
      return NextResponse.json({ error: "不支持的 AI 任务" }, { status: 400 });
    }
    const file = form.get("file");
    const rawText = String(form.get("text") || "");
    const text = file instanceof File ? await extractText(file) : rawText;
    if (!text.trim()) return NextResponse.json({ error: "文件中没有识别到可解析文字" }, { status: 422 });
    return NextResponse.json(await callModel(task, text));
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 解析失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
