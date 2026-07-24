import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

type RequestBody = {
  action?: "refine" | "parse-weekly" | "parse-kpi";
  [key: string]: unknown;
};

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function normalizedText(value: unknown) {
  return String(value || "").replace(/\s+/g, "").replace(/[，。；：、,.!！?？]/g, "");
}

function hasThreeDistinctOptions(value: unknown) {
  if (!value || typeof value !== "object" || !("options" in value)) return false;
  const options = (value as { options?: Array<{ text?: unknown }> }).options;
  if (!Array.isArray(options) || options.length !== 3) return false;
  const texts = options.map((option) => normalizedText(option.text));
  if (texts.some((text) => text.length < 12)) return false;
  return new Set(texts).size === 3 && texts.every((text, index) =>
    texts.every((other, otherIndex) => index === otherIndex || !text.includes(other) || text.length !== other.length),
  );
}

function systemPrompt(action: RequestBody["action"]) {
  if (action === "refine") return `你是工作价值提炼助手。根据用户的原始工作记录、项目和目标，输出三个内容具体、互不重复的中文版本：
1. 结果导向：突出完成内容与可验证产出；
2. 价值导向：说明这件事对业务、用户或目标的真实支持；
3. 推进协作：突出问题解决、决策、协作和后续推进。
不得编造数字、结果、影响或用户未提供的事实；信息不足时克制表达。返回 JSON：{"options":[{"label":"结果导向","text":"..."},{"label":"价值导向","text":"..."},{"label":"推进协作","text":"..."}]}`;
  if (action === "parse-weekly") return `你是周报结构化助手。把周报正文按实际事项逐条拆分，每条只包含一件可独立记录的工作。识别标题、日期段、星期和正文里的明确日期，将事项归入对应日期，日期格式 YYYY-MM-DD。只有无法从文档确定日期时才返回 null，不要猜测。保留具体动作和结果，不要套模板，不要合并不同日期。返回 JSON：{"items":[{"date":"YYYY-MM-DD或null","content":"具体事项","project":"可选项目","goal":"可选目标"}]}`;
  return `你是 KPI/OKR 文档解析助手。只提取文档中真实存在的岗位、一级 KPI/目标及其下级关键结果、衡量标准或拆解项。不要把说明文字虚构为 KPI，不要补造数字。相似条目可合并，但要保留原意。返回 JSON：{"role":"识别到的岗位或空字符串","summary":"一句话说明识别依据","kpis":[{"title":"一级 KPI","details":["下级指标或关键结果"]}]}`;
}

export default async function handler(req: Request, _context: Context) {
  if (req.method !== "POST") return jsonError("Method not allowed", 405);
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return jsonError("请先登录", 401);

  const supabaseUrl = Netlify.env.get("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseKey = Netlify.env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !supabaseKey) return jsonError("Supabase 环境配置不完整", 500);
  const authClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return jsonError("登录已失效，请重新登录", 401);

  const body = await req.json() as RequestBody;
  if (!["refine", "parse-weekly", "parse-kpi"].includes(body.action || "")) return jsonError("不支持的 AI 操作");
  try {
    const input = JSON.stringify(body).slice(0, 80_000);
    const apiKey = Netlify.env.get("DEEPSEEK_API_KEY");
    if (!apiKey) return jsonError("DeepSeek API Key 尚未配置，请在 Netlify 环境变量中添加 DEEPSEEK_API_KEY 后重新部署", 503);
    const openai = new OpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey,
    });
    const attempts = body.action === "refine" ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const completion = await openai.chat.completions.create({
        model: "deepseek-v4-flash",
        response_format: { type: "json_object" },
        temperature: body.action === "refine" ? 0.55 : 0.2,
        messages: [
          { role: "system", content: systemPrompt(body.action) },
          { role: "user", content: `${input}${attempt ? "\n上次三个版本过于相似，请重新生成，确保表达重点、句式和信息组织明显不同。" : ""}` },
        ],
      });
      const content = completion.choices[0]?.message?.content;
      if (!content) continue;
      const parsed = JSON.parse(content);
      if (body.action !== "refine" || hasThreeDistinctOptions(parsed)) return Response.json(parsed);
    }
    return jsonError("AI 未能生成三个明显不同的版本，请重试", 502);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    console.error("DeepSeek request failed", error);
    if (/JSON/i.test(message)) return jsonError("AI 返回格式异常，请重试", 502);
    if (/401|authentication|api.?key/i.test(message)) return jsonError("DeepSeek 密钥无效，请检查 Netlify 中的 DEEPSEEK_API_KEY", 502);
    if (/402|balance|insufficient/i.test(message)) return jsonError("DeepSeek 账户余额不足，请充值后重试", 502);
    if (/429|rate.?limit/i.test(message)) return jsonError("DeepSeek 请求过于频繁，请稍后重试", 429);
    return jsonError(`AI 服务调用失败：${message}`, 502);
  }
}

export const config: Config = {
  path: "/api/ai",
  method: "POST",
};
