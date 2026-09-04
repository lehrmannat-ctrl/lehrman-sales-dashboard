import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { envPresent } from "./types";

/**
 * Turns real GoHighLevel call recordings into plain-English notes on each
 * lead: what vehicle they have, what services they want, how soon they want
 * to book, and what objections came up. The owner confirmed (2026-08-29)
 * that calls happen directly inside GoHighLevel, on their business number
 * 616-427-1814 - so this reads straight from that same connected account,
 * not a separate phone-tracking product.
 *
 * NOT verified against a live account. GoHighLevel's Conversations API shape
 * below (conversations/search, conversations/{id}/messages, and the
 * recording-download endpoint) is written from GoHighLevel's public v2
 * documentation patterns - the same honesty level as quo.ts/urable.ts
 * elsewhere in this file. This dev environment has no general internet
 * access to test against GoHighLevel's real servers (only the app itself,
 * running on the owner's own machine, can actually reach them), so every
 * TODO(verify) below needs confirming the same way the stage-mapping bug got
 * found and fixed earlier: run it for real from Settings -> Integrations,
 * report back exactly what happened (including the raw error text if it
 * fails), adjust.
 *
 * Requires OPENAI_API_KEY. GoHighLevel gives us the recording audio, not a
 * transcript, so this calls OpenAI's Whisper model to transcribe it and a
 * cheap OpenAI chat model to pull out the structured notes - roughly $0.01
 * total per call. Nothing here runs until that key is set (isConfigured()
 * below), so this sits completely inert - never a fake "connected" status -
 * until the owner adds it.
 */

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

async function ghlGet(path: string) {
  const res = await fetch(`${GHL_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      Version: GHL_API_VERSION,
    },
  });
  if (!res.ok) {
    throw new Error(`GoHighLevel API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/**
 * Real-run finding (2026-09-01): every single lead failed with "object is
 * not iterable" - a plain `for...of` on a value GHL actually returned as a
 * single object rather than the array this code assumed. Most likely
 * explanation: when searching by a specific contactId, GoHighLevel's
 * conversations/messages endpoints return the ONE matching
 * conversation/message directly under that key instead of wrapping it in a
 * one-item array (some GHL v2 endpoints do this). This helper accepts
 * either shape - a real array, a single object, or nothing - so a shape
 * mismatch degrades to "treat it as one item" or "treat it as none" instead
 * of crashing the whole sync for every lead. TODO(verify): still needs
 * confirming against what the account actually sends; see the diagnostic
 * logging in syncCallSummaries() below.
 */
function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

// TODO(verify): confirm this is really how a call recording is fetched. Some
// GoHighLevel accounts expose it as a signed URL on the message object
// itself instead of a separate authenticated download - if so, this
// function should just fetch that URL directly rather than hitting this
// endpoint.
async function ghlGetRecording(messageId: string): Promise<ArrayBuffer | null> {
  const res = await fetch(
    `${GHL_API_BASE}/conversations/messages/${messageId}/locations/${process.env.GHL_LOCATION_ID}/recording`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GHL_API_KEY}`,
        Version: GHL_API_VERSION,
      },
    }
  );
  if (res.status === 404) return null; // no recording on this call
  if (!res.ok) {
    throw new Error(`GoHighLevel recording download error ${res.status}: ${await res.text()}`);
  }
  return res.arrayBuffer();
}

async function transcribeRecording(audio: ArrayBuffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([audio]), filename);
  form.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`OpenAI transcription error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.text as string;
}

interface CallSummaryResult {
  callSummary: string;
  updatedNotes: string;
}

/**
 * Asks OpenAI to summarize one call and fold it into the lead's running
 * notes. Told explicitly never to invent anything not actually said, since a
 * fabricated "customer wants X" is worse than no note at all.
 */
async function summarizeCall(transcript: string, priorNotes: string | null): Promise<CallSummaryResult> {
  const prompt = `You are keeping sales notes for a mobile car detailing business.

Here is the transcript of one phone call with a customer:
"""
${transcript}
"""
${priorNotes ? `Here is what we already knew about this customer before this call:\n"""\n${priorNotes}\n"""\n` : "We have no notes on this customer yet.\n"}
Reply with ONLY a JSON object of this exact shape:
{"callSummary": "2-4 sentences on what happened on THIS specific call", "updatedNotes": "a short running notes block covering: what vehicle they have (if mentioned), what services they're interested in, how soon they want to book, and any objections or concerns - merge in anything new from this call with what we already knew, don't repeat old information, keep it tight"}

Only include what was actually said on the call. Never guess, assume, or invent a detail that wasn't mentioned - if something isn't known, just leave it out.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI summarization error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return { callSummary: parsed.callSummary, updatedNotes: parsed.updatedNotes };
}

export function callSummariesConfigured(): boolean {
  return envPresent("GHL_API_KEY", "GHL_LOCATION_ID", "OPENAI_API_KEY");
}

export interface CallSummarySyncResult {
  callsProcessed: number;
  leadsUpdated: number;
  errors: string[];
}

/**
 * Walks every GoHighLevel-sourced lead, finds call messages that don't have
 * a transcript yet, and summarizes them. Safe to run repeatedly - already
 *-summarized calls (activities row with a transcript already on it) are
 * skipped, so re-running only picks up genuinely new calls.
 */
export async function syncCallSummaries(): Promise<CallSummarySyncResult> {
  if (!callSummariesConfigured()) {
    return { callsProcessed: 0, leadsUpdated: 0, errors: ["Not configured - missing GHL_API_KEY, GHL_LOCATION_ID, or OPENAI_API_KEY."] };
  }

  const supabase = createSupabaseServiceRoleClient();
  const errors: string[] = [];
  let callsProcessed = 0;
  const leadsUpdated = new Set<string>();
  let shapeDiagnosticLogged = false; // log the raw response shape once, not once per lead

  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("id, external_id, ai_notes")
    .eq("source_platform", "gohighlevel")
    .not("external_id", "is", null);
  if (leadsError) {
    return { callsProcessed: 0, leadsUpdated: 0, errors: [leadsError.message] };
  }

  for (const lead of leads ?? []) {
    try {
      // TODO(verify): confirm this is the right way to list a contact's
      // conversations, and the response shape (`conversations[].id`).
      const convos = await ghlGet(
        `/conversations/search?locationId=${process.env.GHL_LOCATION_ID}&contactId=${lead.external_id}`
      );

      const conversationList = asArray(convos?.conversations);
      if (conversationList.length === 0 && !shapeDiagnosticLogged) {
        shapeDiagnosticLogged = true;
        errors.push(
          `Diagnostic (not a failure) - raw conversations/search response for the first lead checked, so we can confirm the real shape: ${JSON.stringify(convos).slice(0, 500)}`
        );
      }

      for (const convo of conversationList) {
        // TODO(verify): confirm the messages endpoint and pagination -
        // this assumes one page is enough, which may not hold for a
        // customer with a long conversation history.
        const messages = await ghlGet(`/conversations/${convo.id}/messages`);

        for (const message of asArray(messages?.messages)) {
          // TODO(verify): confirm the actual type string GoHighLevel uses
          // to mark a message as a phone call (this is a best guess).
          if (message?.type !== "TYPE_CALL" || !message?.id) continue;

          const { data: existing } = await supabase
            .from("activities")
            .select("id, transcript")
            .eq("source_platform", "gohighlevel")
            .eq("external_id", message.id)
            .maybeSingle();
          if (existing?.transcript) continue; // already summarized

          const audio = await ghlGetRecording(message.id);
          if (!audio || audio.byteLength === 0) continue; // no recording on this call

          const transcript = await transcribeRecording(audio, `${message.id}.mp3`);
          const { callSummary, updatedNotes } = await summarizeCall(transcript, lead.ai_notes);

          const { error: upsertError } = await supabase.from("activities").upsert(
            {
              external_id: message.id,
              source_platform: "gohighlevel",
              lead_id: lead.id,
              type: "connected_call",
              direction: message.direction === "inbound" ? "inbound" : "outbound",
              occurred_at: message.dateAdded ?? new Date().toISOString(),
              transcript,
              ai_summary: callSummary,
              last_synced_at: new Date().toISOString(),
            },
            { onConflict: "source_platform,external_id" }
          );
          if (upsertError) {
            errors.push(`activity upsert for message ${message.id}: ${upsertError.message}`);
            continue;
          }

          const { error: leadUpdateError } = await supabase
            .from("leads")
            .update({ ai_notes: updatedNotes, ai_notes_updated_at: new Date().toISOString() })
            .eq("id", lead.id);
          if (leadUpdateError) {
            errors.push(`lead notes update for ${lead.id}: ${leadUpdateError.message}`);
            continue;
          }

          callsProcessed++;
          leadsUpdated.add(lead.id);
        }
      }
    } catch (err: any) {
      errors.push(`lead ${lead.external_id}: ${err?.message ?? String(err)}`);
    }
  }

  return { callsProcessed, leadsUpdated: leadsUpdated.size, errors };
}
