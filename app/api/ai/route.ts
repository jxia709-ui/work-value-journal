import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type ReportSource = {
  date?: string;
  title?: string;
  refinedTitle?: string;
  project?: string;
  goal?: string;
};

type AiAction = "refine" | "parse-weekly" | "parse-kpi" | "generate-report";
type AiPayload = {
  action?: AiAction;
  content?: string;
  text?: string;
  project?: string;
  goal?: string;
  goals?: string[];
  projects?: string[];
  date?: string;
  referenceDate?: string;
  fileName?: string;
  reportType?: string;
  range?: string;
  mode?: string;
  records?: ReportSource[];
};

function promptFor(action: AiAction, payload: AiPayload) {
  const today = new Date().toISOString().slice(0, 10);

  if (action === "refine") return {
    system: "你是工作价值表达助手。保留事实，不虚构数据。只返回 JSON。",
    user: `将以下工作记录提炼为三个明显不同的候选版本。每版一到两句，分别突出简洁结果、业务价值、专业协作。返回 {"options":[{"label":"简洁版","text":"..."},{"label":"价值版","text":"..."},{"label":"专业版","text":"..."}]}。
原文：${payload.content || ""}
项目：${payload.project || "未关联"}
目标：${payload.goal || (payload.goals || []).join("、") || "未关联"}
日期：${payload.date || today}`,
  };

  if (action === "parse-weekly") return {
    system: "你是周报结构化助手。只根据原文拆分事项，不合并不同日期，不虚构日期或项目。只返回 JSON。",
    user: `参考日期是 ${payload.referenceDate || today}。解析以下周报，按原文逐条拆分工作事项。明确日期转为 YYYY-MM-DD；只有星期几时结合周报周期推断；确实无法判断则 date 返回 null。返回 {"items":[{"date":"YYYY-MM-DD或null","content":"完整事项","project":"项目或空"}]}。
文件名：${payload.fileName || ""}
原文：
${payload.text || ""}`,
  };

  if (action === "parse-kpi") return {
    system: "你是 KPI/OKR 结构化助手。保持原文事实和数字，不自行补充指标。只返回 JSON。",
    user: `解析以下 KPI、OKR 或岗位职责。返回 {"role":"岗位或空","summary":"一句话概括","kpis":[{"title":"一级 KPI/目标","details":["下级指标/关键结果"]}]}。至少返回一个 KPI；没有明确下级指标时 details 为空数组。
文件名：${payload.fileName || ""}
原文：
${payload.text || ""}`,
  };

  const records = (payload.records || []).map((record, index) => ({
    index: index + 1,
    date: record.date || "",
    content: record.refinedTitle || record.title || "",
    project: record.project || "未关联项目",
    goal: record.goal || "未关联目标",
  }));

  return {
    system: "你是工作报告助手。只能使用用户提供的工作记录，不虚构成果、数据、结论或下一步。只返回 JSON。",
    user: `根据以下工作记录生成一份${payload.reportType || "周报"}。
时间范围：${payload.range || ""}
组织方式：${payload.mode || "按照事项"}
要求：
1. 内容必须随所选记录变化；
2. 突出完成结果、业务价值和协作推进，但不能添加原记录没有的信息；
3. 使用清晰的小标题和项目符号；
4. 不要写空泛套话；
5. 返回 {"content":"完整报告正文"}。
工作记录：
${JSON.stringify(records)}`,
  };
}

function hasDistinctVersions(versions: unknown) {
  if (!Array.isArray(versions) || versions.length !== 3) return false;
  const texts = versions.map((version) =>
    String(version?.text || "").replace(/\s+/g, "").replace(/[，。；：、,.!！?？]/g, ""),
  );
  return texts.every((text) => text.length >= 12) && new Set(texts).size === 3;
}

async function callModel(action: AiAction, payload: AiPayload) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DeepSeek API Key 尚未配置，请检查 Netlify 环境变量 DEEPSEEK_API_KEY 的生产环境值");

  const prompt = promptFor(action, {
    ...payload,
    content: payload.content?.slice(0, 80_000),
    text: payload.text?.slice(0, 80_000),
    records: payload.records?.slice(0, 200),
  });
  const attempts = action === "refine" ? 2 : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        temperature: action === "refine" ? 0.55 : action === "generate-report" ? 0.35 : 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt.system },
          {
            role: "user",
            content: `${prompt.user}${attempt ? "\n上次三个版本过于相似，请重新生成，确保表达重点、句式和信息组织明显不同。" : ""}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 401) throw new Error("DeepSeek 密钥无效，请检查 DEEPSEEK_API_KEY");
      if (response.status === 402) throw new Error("DeepSeek 账户余额不足，请充值后重试");
      if (response.status === 429) throw new Error("DeepSeek 请求过于频繁，请稍后重试");
      throw new Error(`DeepSeek 服务返回 ${response.status}${detail ? `：${detail.slice(0, 180)}` : ""}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) continue;
    const parsed = JSON.parse(content);
    if (action === "refine" && !hasDistinctVersions(parsed.options)) continue;
    if (action === "generate-report" && !String(parsed.content || "").trim()) continue;
    return parsed;
  }

  throw new Error(action === "refine" ? "AI 未能生成三个明显不同的版本，请重试" : "AI 没有返回有效结果，请重试");
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://lzwwfjsdxyqtswfvqmwf.supabase.co";
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_z2_qLk2jsLRhx8yFKRjeMg_DhCyaskL";
    const authorization = request.headers.get("authorization");
    if (!supabaseUrl || !supabaseKey || !authorization) {
      return NextResponse.json({ error: "请先登录后再使用 AI 功能" }, { status: 401 });
    }

    const authCheck = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseKey, authorization },
    });
    if (!authCheck.ok) return NextResponse.json({ error: "登录已失效，请重新登录" }, { status: 401 });

    const payload = await request.json() as AiPayload;
    const action = payload.action;
    if (!action || !["refine", "parse-weekly", "parse-kpi", "generate-report"].includes(action)) {
      return NextResponse.json({ error: "不支持的 AI 任务" }, { status: 400 });
    }

    if (action === "refine" && !String(payload.content || "").trim()) {
      return NextResponse.json({ error: "请输入需要提炼的工作内容" }, { status: 422 });
    }
    if ((action === "parse-weekly" || action === "parse-kpi") && !String(payload.text || "").trim()) {
      return NextResponse.json({ error: "文件中没有识别到可解析文字" }, { status: 422 });
    }
    if (action === "generate-report" && !(payload.records || []).length) {
      return NextResponse.json({ error: "请至少选择一条工作记录" }, { status: 422 });
    }

    return NextResponse.json(await callModel(action, payload));
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 解析失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
