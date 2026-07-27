import { NextRequest, NextResponse } from "next/server";

type FileAction = "parse-weekly" | "parse-kpi";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}

function compactText(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

async function extractPdfText(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = content.items
          .map((item: unknown) => {
            if (!item || typeof item !== "object" || !("str" in item)) return "";
            return String((item as { str?: unknown }).str || "");
          })
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        if (text) pages.push(`【第 ${pageNumber} 页】\n${text}`);
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await pdf.cleanup();
    await pdf.destroy();
  }

  return compactText(pages.join("\n\n"));
}

async function extractDocxText(file: File) {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const input = { arrayBuffer } as unknown as Parameters<typeof mammoth.extractRawText>[0];
  return compactText((await mammoth.extractRawText(input)).value);
}

async function extractSpreadsheetText(file: File) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  return compactText(workbook.SheetNames
    .map((sheetName: string) => `【${sheetName}】\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName])}`)
    .join("\n\n"));
}

async function extractText(file: File) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) return extractPdfText(file);
  if (name.endsWith(".docx")) return extractDocxText(file);
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return extractSpreadsheetText(file);

  if (name.endsWith(".txt") || name.endsWith(".csv")) {
    return compactText(new TextDecoder("utf-8").decode(await file.arrayBuffer()));
  }

  throw new Error("暂不支持该文件格式，请上传 PDF、DOCX、Excel、CSV 或 TXT");
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    if (!authorization) {
      return NextResponse.json({ error: "请先登录后再上传文件" }, { status: 401 });
    }

    const form = await request.formData();
    const file = form.get("file");
    const action = String(form.get("action") || "") as FileAction;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "没有收到可解析的文件" }, { status: 400 });
    }
    if (!["parse-weekly", "parse-kpi"].includes(action)) {
      return NextResponse.json({ error: "文件解析任务无效" }, { status: 400 });
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "文件超过 20MB，请重新选择" }, { status: 413 });
    }

    let text = "";
    try {
      text = await extractText(file);
    } catch (error) {
      return NextResponse.json(
        { error: `文件文字读取失败：${errorMessage(error)}` },
        { status: 422 },
      );
    }

    if (!text) {
      return NextResponse.json({ error: "文件中没有读取到可解析的文字" }, { status: 422 });
    }

    const aiResponse = await fetch(new URL("/api/ai", request.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization,
      },
      body: JSON.stringify({
        action,
        fileName: file.name,
        text: text.slice(0, 80_000),
        referenceDate: String(form.get("referenceDate") || ""),
      }),
    });

    const responseText = await aiResponse.text();
    return new NextResponse(responseText, {
      status: aiResponse.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: `文件解析失败：${errorMessage(error)}` },
      { status: 500 },
    );
  }
}
