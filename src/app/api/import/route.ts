import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readXlsxRows } from "@/lib/import/xlsx";
import { parseMt5Report } from "@/lib/import/mt5";
import { ledgerToRow, tradeToRow } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return fail("Not signed in.", 401);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return fail("Server is missing its Supabase settings.", 500);

  // Acts as the signed-in user, so Row Level Security applies to everything below.
  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth.user) return fail("Your session has expired. Sign in again.", 401);
  const userId = auth.user.id;

  const form = await req.formData();
  const file = form.get("file");
  const accountId = String(form.get("accountId") ?? "");
  const accountName = String(form.get("accountName") ?? "").trim();
  if (!(file instanceof File)) return fail("No file received.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) return fail("Please upload the .xlsx file saved from MetaTrader 5.");

  let report;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const head = new TextDecoder("utf-8").decode(bytes.slice(0, 200)).trimStart().toLowerCase();
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK": a real .xlsx is a zip file
    if (!isZip) {
      const kind = head.startsWith("<html") || head.includes("<table") ? "a web page (HTML)" : head.startsWith("<?xml") ? "a plain XML file" : "not an Excel file";
      return fail(`This file is ${kind} saved with an .xlsx name, so it cannot be read. Open it in Excel, choose File > Save As > Excel Workbook (.xlsx), and upload the new file.`);
    }
    const rows = await readXlsxRows(bytes);
    report = parseMt5Report(rows);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not read that file.";
    if (/disallowed character|unexpected|xml/i.test(msg)) {
      return fail("The spreadsheet's inner XML is damaged or unusual (" + msg + "). Open it in Excel, choose File > Save As > Excel Workbook (.xlsx), and upload the re-saved copy. If it still fails, send me the file.");
    }
    return fail(msg);
  }
  if (!report.trades.length) return fail("No closed trades found in that report.");

  // ---- account ------------------------------------------------------------
  let targetId = accountId;
  if (targetId && targetId !== "new") {
    const { data, error } = await supabase.from("accounts").select("id, starting_balance").eq("id", targetId).maybeSingle();
    if (error || !data) return fail("That account was not found.", 404);
    if (data.starting_balance === null && report.startingBalance !== null) {
      await supabase.from("accounts").update({ starting_balance: report.startingBalance }).eq("id", targetId);
    }
  } else {
    const name = accountName || `${report.company ?? "MT5"} – ${report.accountName ?? "Account"}`;
    const { data, error } = await supabase
      .from("accounts")
      .insert({
        user_id: userId,
        name,
        platform: "mt5",
        firm: report.company,
        starting_balance: report.startingBalance,
      })
      .select("id")
      .single();
    if (error || !data) return fail(`Could not create the account: ${error?.message ?? "unknown error"}`, 500);
    targetId = data.id as string;
  }

  // ---- trades + ledger (duplicates are skipped, never overwritten) --------
  let added = 0;
  for (const part of chunk(report.trades.map((t) => tradeToRow(t, userId, targetId)), 200)) {
    const { data, error } = await supabase
      .from("trades")
      .upsert(part, { onConflict: "account_id,external_id", ignoreDuplicates: true })
      .select("external_id");
    if (error) return fail(`Saving trades failed: ${error.message}`, 500);
    added += data?.length ?? 0;
  }
  for (const part of chunk(report.ledger.map((l) => ledgerToRow(l, userId, targetId)), 200)) {
    const { error } = await supabase
      .from("ledger_rows")
      .upsert(part, { onConflict: "account_id,deal_id", ignoreDuplicates: true });
    if (error) return fail(`Saving the balance history failed: ${error.message}`, 500);
  }

  const skipped = report.trades.length - added;
  await supabase.from("imports").insert({
    user_id: userId,
    account_id: targetId,
    filename: file.name,
    platform: "mt5",
    trades_added: added,
    trades_skipped: skipped,
    warnings: report.warnings,
  });

  return NextResponse.json({
    accountId: targetId,
    found: report.trades.length,
    added,
    skipped,
    warnings: report.warnings,
  });
}
