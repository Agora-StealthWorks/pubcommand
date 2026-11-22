"use server";

import type { AiInput } from "@pubcommand/ai";
import type { Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { chatTitle, UPLOAD_MAX_BYTES, UPLOADS_PER_TURN, type UploadedForTurn } from "../../../../../modules/knowledge/brain-chat";
import { mainBrain } from "../main-brain/db";
import { requireBrainStaff } from "../main-brain/staff";
import { runBrainChatTurn, saveUploadAsNote, type StoredUpload } from "./server";

const UUID = /^[0-9a-f-]{36}$/i;
const MESSAGE_MAX = 40_000;

function go(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

/** Send a message (and files) to a chat; a new chat when chatId is empty. The answer streams in the background. */
export async function sendBrainChatMessage(formData: FormData) {
  const staff = await requireBrainStaff();
  const chatIdRaw = String(formData.get("chatId") ?? "");
  const text = String(formData.get("message") ?? "").replace(/\r\n/g, "\n").trim().slice(0, MESSAGE_MAX);
  const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  const back = UUID.test(chatIdRaw) ? `/brain/chat/${chatIdRaw}` : "/brain/chat";
  if (!text && files.length === 0) go(back, "error", "Type a message or attach a file.");
  if (files.length > UPLOADS_PER_TURN) go(back, "error", `Attach up to ${UPLOADS_PER_TURN} files at a time.`);
  const tooBig = files.find((file) => file.size > UPLOAD_MAX_BYTES);
  if (tooBig) go(back, "error", `${tooBig.name} is over ${UPLOAD_MAX_BYTES / 1024 / 1024} MB.`);

  let chatId = UUID.test(chatIdRaw) ? chatIdRaw : null;
  if (chatId) {
    const chat = await mainBrain((tx) => tx.mainBrainChat.findFirst({ where: { id: chatId!, createdById: staff.userId, deletedAt: null }, select: { id: true } }));
    if (!chat) go("/brain/chat", "error", "That chat no longer exists.");
    const running = await mainBrain((tx) => tx.mainBrainChatMessage.count({ where: { chatId: chatId!, status: "RUNNING" } }));
    if (running) go(back, "error", "Wait for the answer to finish before sending another message.");
  }

  // Files become Master Brain notes first, so the turn can read and cite them.
  const uploads: UploadedForTurn[] = [];
  const stored: StoredUpload[] = [];
  const pdfs: AiInput[] = [];
  const problems: string[] = [];
  for (const file of files) {
    const saved = await saveUploadAsNote(file, staff);
    if ("error" in saved) {
      problems.push(saved.error);
      continue;
    }
    uploads.push(saved.upload);
    stored.push(saved.stored);
    if (saved.pdf) pdfs.push(saved.pdf);
  }
  if (!text && uploads.length === 0) go(back, "error", problems.join(" ") || "Nothing to send.");

  if (!chatId) {
    const chat = await mainBrain((tx) => tx.mainBrainChat.create({ data: { title: chatTitle(text, stored.map((u) => u.name)), createdById: staff.userId }, select: { id: true } }));
    chatId = chat.id;
  }
  const content = text || (stored.length ? `Here ${stored.length === 1 ? "is a file" : "are some files"} for the Brain.` : "");
  const [userMessage, assistantMessage] = await mainBrain(async (tx) => {
    const user = await tx.mainBrainChatMessage.create({ data: { chatId: chatId!, role: "user", content, uploads: stored as unknown as Prisma.InputJsonValue }, select: { id: true } });
    const assistant = await tx.mainBrainChatMessage.create({ data: { chatId: chatId!, role: "assistant", status: "RUNNING", content: "" }, select: { id: true } });
    await tx.mainBrainChat.update({ where: { id: chatId! }, data: { updatedAt: new Date() } });
    return [user, assistant];
  });
  after(() => runBrainChatTurn({ chatId: chatId!, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id, staff: { userId: staff.userId, email: staff.email }, uploads, pdfs }));
  const notice = problems.length ? `?error=${encodeURIComponent(`Not uploaded: ${problems.join(" ")}`)}` : "";
  redirect(`/brain/chat/${chatId}${notice}#latest`);
}

export async function renameBrainChat(formData: FormData) {
  const staff = await requireBrainStaff();
  const id = String(formData.get("chatId") ?? "");
  const title = String(formData.get("title") ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!UUID.test(id) || !title) go("/brain/chat", "error", "Give the chat a name.");
  await mainBrain((tx) => tx.mainBrainChat.updateMany({ where: { id, createdById: staff.userId, deletedAt: null }, data: { title } }));
  redirect(`/brain/chat/${id}`);
}

export async function deleteBrainChat(formData: FormData) {
  const staff = await requireBrainStaff();
  const id = String(formData.get("chatId") ?? "");
  if (UUID.test(id)) await mainBrain((tx) => tx.mainBrainChat.updateMany({ where: { id, createdById: staff.userId }, data: { deletedAt: new Date() } }));
  go("/brain/chat", "notice", "Chat removed. Notes it saved stay in the Master Brain.");
}

/** Mark an answer that never finished (server restarted mid-turn) as failed, so a new message can be sent. */
export async function stopBrainChatAnswer(formData: FormData) {
  const staff = await requireBrainStaff();
  const id = String(formData.get("chatId") ?? "");
  if (!UUID.test(id)) redirect("/brain/chat");
  const chat = await mainBrain((tx) => tx.mainBrainChat.findFirst({ where: { id, createdById: staff.userId }, select: { id: true } }));
  if (chat) await mainBrain((tx) => tx.mainBrainChatMessage.updateMany({ where: { chatId: id, status: "RUNNING" }, data: { status: "FAILED", error: "Stopped." } }));
  redirect(`/brain/chat/${id}`);
}
