/**
 * Optional AI reply node. Off unless AI_REPLIES_ENABLED=1 (a paid API; never on by accident).
 * Guardrails: customer asks for a human -> handoff without calling the model; the model is told to answer
 * only from the business instructions and to reply HANDOFF when unsure; refusals, errors, empty or overlong
 * replies all hand off to a person instead of sending anything.
 */
import Anthropic from "@anthropic-ai/sdk";

export const AI_MODEL = process.env.AI_MODEL ?? "claude-opus-5-5";
export const aiStatus = () =>
  process.env.AI_REPLIES_ENABLED === "1"
    ? { ready: true, detail: `On, using ${AI_MODEL}. Every reply is billed by Anthropic.` }
    : { ready: false, detail: "Off. Set AI_REPLIES_ENABLED=1 and Anthropic credentials (paid) to turn it on." };

export type AiTurn = { role: "customer" | "business"; text: string };
export type AiResult = { reply: string } | { handoff: string };

const HUMAN = /\b(human|agent|person|representative|manager|complain|complaint|refund|legal|lawyer)\b/i;

type Client = Pick<Anthropic, "beta">;
let shared: Anthropic | undefined;

export async function aiReply(p: { instructions: string; history: AiTurn[] }, client?: Client): Promise<AiResult> {
  if (!client && !aiStatus().ready) return { handoff: "AI replies are off" };
  const last = p.history.filter((t) => t.role === "customer").at(-1)?.text ?? "";
  if (HUMAN.test(last)) return { handoff: "customer asked for a person" };
  const c = client ?? (shared ??= new Anthropic());
  const transcript = p.history.slice(-12).map((t) => `${t.role === "customer" ? "Customer" : "Business"}: ${t.text}`).join("\n");
  try {
    const res = await c.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system:
        "You write one WhatsApp reply for a business to its customer. Use only facts in the business instructions. " +
        "Do not invent prices, dates, stock, policies or promises. Keep it under 500 characters, plain text, no markdown. " +
        "If the instructions do not answer the question, or the customer is upset, reply with exactly HANDOFF.\n\n" +
        `Business instructions:\n${p.instructions}`,
      messages: [{ role: "user", content: `Conversation so far:\n${transcript}\n\nWrite the business's next reply.` }],
    });
    if (res.stop_reason === "refusal") return { handoff: "the model declined" };
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    if (!text || /\bHANDOFF\b/.test(text)) return { handoff: "the model was not sure" };
    if (text.length > 1000) return { handoff: "the reply was too long" };
    return { reply: text };
  } catch (e) {
    return { handoff: `AI error: ${e instanceof Anthropic.APIError ? `${e.status}` : "request failed"}` };
  }
}
