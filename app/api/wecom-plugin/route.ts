import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function getToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  return (
    token ||
    request.headers.get("x-api-key")?.trim() ||
    request.headers.get("x-service-token")?.trim() ||
    ""
  );
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "wecom-plugin",
    supportedActions: ["refine_work"],
  });
}

export async function POST(request: NextRequest) {
  try {
    const serviceKey = process.env.WECOM_PLUGIN_API_KEY?.trim();

    if (!serviceKey) {
      return NextResponse.json(
        { error: "服务器尚未配置 WECOM_PLUGIN_API_KEY" },
        { status: 500 },
      );
    }

    const token = getToken(request);

    if (!token || token !== serviceKey) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const payload = await request.json();
    const action = String(payload?.action || "").trim();
    const content = String(payload?.content || "").trim();

    if (action !== "refine_work") {
      return NextResponse.json(
        { error: "不支持的操作类型" },
        { status: 400 },
      );
    }

    if (!content) {
      return NextResponse.json(
        { error: "请输入需要提炼的工作内容" },
        { status: 422 },
      );
    }

    const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();

    if (!deepseekKey) {
      return NextResponse.json(
        { error: "服务器尚未配置 DEEPSEEK_API_KEY" },
        { status: 500 },
      );
    }

    const response = await fetch(
      "https://api.deepseek.com/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${deepseekKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          temperature: 0.5,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "你是一名专业的工作价值提炼助手。只能基于用户提供的事实进行优化，禁止虚构数据、结果或影响。请返回严格的 JSON 对象，只包含 eventVersion 和 valueVersion 两个字符串字段。eventVersion 重点优化事件本身，让表达简洁、清晰、专业；valueVersion 重点提炼工作价值、解决的问题和产生的作用，但不能编造用户没有提供的信息。",
            },
            {
              role: "user",
              content: `请提炼以下工作内容：\n${content.slice(0, 20000)}`,
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error("DeepSeek request failed:", response.status, detail);

      return NextResponse.json(
        { error: "AI 服务调用失败" },
        { status: 502 },
      );
    }

    const result = await response.json();
    const raw = result?.choices?.[0]?.message?.content;

    if (!raw) {
      return NextResponse.json(
        { error: "AI 未返回有效内容" },
        { status: 502 },
      );
    }

    const parsed =
      typeof raw === "string" ? JSON.parse(raw) : raw;

    const eventVersion = String(parsed?.eventVersion || "").trim();
    const valueVersion = String(parsed?.valueVersion || "").trim();

    if (!eventVersion || !valueVersion) {
      return NextResponse.json(
        { error: "AI 返回内容格式不完整" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      eventVersion,
      valueVersion,
    });
  } catch (error) {
    console.error("WeCom plugin error:", error);

    return NextResponse.json(
      { error: "提炼工作内容失败" },
      { status: 500 },
    );
  }
}
