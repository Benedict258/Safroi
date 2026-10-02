"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { decideHeldChange } from "@/lib/sync/run";

export async function decideHeld(id: number, decision: "approved" | "rejected") {
  await requireAdmin();
  await decideHeldChange(id, decision);
  revalidatePath("/sync");
  revalidatePath("/catalog");
}
