"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma, type Prisma } from "@ll/db";
import { validateGraph, type FlowGraph } from "@ll/db/src/automation";
import { slots } from "@ll/db/src/templates";
import { audit } from "@/lib/audit";
import { requireCan } from "@/lib/session";
import { act, str, type ActionState } from "@/lib/server";

const KINDS = ["keyword", "welcome", "away", "event"] as const;

export async function saveAutomation(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("automations.write");
    const kind = str(f, "kind") as (typeof KINDS)[number];
    if (!KINDS.includes(kind)) throw new Error("Pick a trigger.");
    const name = str(f, "name").slice(0, 80);
    if (!name) throw new Error("Name the automation.");
    const phoneNumberId = str(f, "phoneNumberId") || null;
    if (phoneNumberId && !(await prisma.phoneNumber.findFirst({ where: { id: phoneNumberId, waba: { orgId: m.orgId } } }))) throw new Error("Number not found.");
    const flowId = str(f, "flowId") || null;
    if (flowId && !(await prisma.flow.findFirst({ where: { id: flowId, orgId: m.orgId } }))) throw new Error("Flow not found.");
    let config: Record<string, unknown>;
    if (kind === "event") {
      const t = await prisma.template.findFirst({ where: { id: str(f, "templateId"), status: "APPROVED", waba: { orgId: m.orgId } } });
      if (!t) throw new Error("Event automations send an approved template. Pick one.");
      const event = str(f, "event");
      if (!/^[a-z0-9_.-]{2,60}$/i.test(event)) throw new Error("Event name: letters, numbers, dots and dashes, like order.placed.");
      const variables = Object.fromEntries(slots(t.components).map((s) => [s, str(f, `var:${s}`)]));
      if (Object.values(variables).some((v) => !v)) throw new Error("Map every template variable (data:field from the event, or field:name).");
      config = { event, templateId: t.id, variables };
    } else {
      const reply = str(f, "reply").slice(0, 4096);
      if (!reply && !flowId) throw new Error("Give a reply or pick a flow to run.");
      const keywords = str(f, "keywords").split(",").map((k) => k.trim()).filter(Boolean);
      if (kind === "keyword" && !keywords.length) throw new Error("Add at least one keyword.");
      config = { reply, ...(kind === "keyword" ? { keywords, match: str(f, "match") === "contains" ? "contains" : "exact" } : {}) };
    }
    const id = str(f, "id");
    const data = { name, kind, phoneNumberId, flowId, config: config as Prisma.InputJsonObject, priority: Number(str(f, "priority")) || 100 };
    if (id) {
      const r = await prisma.automation.updateMany({ where: { id, orgId: m.orgId }, data });
      if (!r.count) throw new Error("Automation not found.");
    } else await prisma.automation.create({ data: { orgId: m.orgId, ...data } });
    await audit(m, id ? "automation.update" : "automation.create", name, { kind });
    revalidatePath("/automations");
    return "Automation saved.";
  });
}

export async function toggleAutomation(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("automations.write");
    const a = await prisma.automation.findFirst({ where: { id: str(f, "id"), orgId: m.orgId } });
    if (!a) throw new Error("Automation not found.");
    await prisma.automation.update({ where: { id: a.id }, data: { enabled: !a.enabled } });
    await audit(m, a.enabled ? "automation.disable" : "automation.enable", a.id);
    revalidatePath("/automations");
    return a.enabled ? "Turned off." : "Turned on.";
  });
}

export async function deleteAutomation(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("automations.write");
    const r = await prisma.automation.deleteMany({ where: { id: str(f, "id"), orgId: m.orgId } });
    if (!r.count) throw new Error("Automation not found.");
    await audit(m, "automation.delete", str(f, "id"));
    revalidatePath("/automations");
    return "Deleted.";
  });
}

export async function createFlow(_: ActionState, f: FormData): Promise<ActionState> {
  const r = await act(async () => {
    const m = await requireCan("automations.write");
    const name = str(f, "name").slice(0, 80) || "New flow";
    const flow = await prisma.flow.create({ data: { orgId: m.orgId, name, graph: { start: "start", nodes: { start: { type: "message", text: "Hi {{name}}, thanks for writing.", next: "end" }, end: { type: "end" } } } } });
    await audit(m, "flow.create", flow.id);
    return { data: { id: flow.id } };
  });
  if (r.error) return r;
  redirect(`/automations/flows/${r.data!.id}`);
}

export async function saveFlow(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const m = await requireCan("automations.write");
    const flow = await prisma.flow.findFirst({ where: { id: str(f, "id"), orgId: m.orgId } });
    if (!flow) throw new Error("Flow not found.");
    let graph: FlowGraph;
    try { graph = JSON.parse(str(f, "graph")); } catch { throw new Error("The flow could not be read."); }
    const errors = validateGraph(graph);
    if (errors.length) throw new Error(errors.join(" "));
    await prisma.flow.update({ where: { id: flow.id }, data: { name: str(f, "name").slice(0, 80) || flow.name, graph: graph as unknown as Prisma.InputJsonObject } });
    await audit(m, "flow.update", flow.id, { nodes: Object.keys(graph.nodes).length });
    revalidatePath(`/automations/flows/${flow.id}`);
    return "Flow saved.";
  });
}

export async function deleteFlow(_: ActionState, f: FormData): Promise<ActionState> {
  const r = await act(async () => {
    const m = await requireCan("automations.write");
    const d = await prisma.flow.deleteMany({ where: { id: str(f, "id"), orgId: m.orgId } });
    if (!d.count) throw new Error("Flow not found.");
    await audit(m, "flow.delete", str(f, "id"));
  });
  if (r.error) return r;
  revalidatePath("/automations");
  redirect("/automations");
}
