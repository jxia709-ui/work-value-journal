import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { PDFParse } from "pdf-parse";

export const runtime = "nodejs";

async function extractText(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  if (name.endsWith(".docx")) {
    return (await mammoth.extractRawText({ buffer })).value;
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    return workbook.SheetNames
      .map((sheetName) => `【${sheetName}】\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName])}`)
      .join("\n\n");
  }

  if (name.endsWith(".txt") || name.endsWith(".csv")) {
    return buffer.toString("utf8");
  }

  throw new Error("暂不支持该文件格式，请上传 PDF、DOCX、Excel、CSV 或 TXT");
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const action = String(form.get("action") || "");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "没有收到可解析的文件" }, { status: 400 });
    }
    if (!['parse-weekly', 'parse-kpi'].includes(action)) {
      return NextResponse.json({ error: "文件解析任务无效" }, { status: 400 });
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "文件超过 20MB，请重新选择" }, { status: 413 });
    }

    const text = await extractText(file);
    if (!text.trim()) {
      return NextResponse.json({ error: "文件中没有读取到可解析的文字" }, { status: 422 });
    }

    const aiResponse = await fetch(new URL("/api/ai", request.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: request.headers.get("authorization") || "",
      },
      body: JSON.stringify({
        action,
        fileName: file.name,
        text,
        referenceDate: String(form.get("referenceDate") || ""),
      }),
    });

    return new NextResponse(await aiResponse.text(), {
      status: aiResponse.status,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件解析失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
