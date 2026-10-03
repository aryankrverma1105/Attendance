import bcrypt from "bcryptjs";
import { eq, or } from "drizzle-orm";
import { getDb } from "../server/db";
import { users } from "../drizzle/schema";

function formatE164(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length > 10 && digits.startsWith("91")) return `+${digits}`;
  if (phone.startsWith("+")) return phone;
  return digits ? `+${digits}` : "";
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "").slice(-10);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: tsx scripts/set-password.ts <phone> <newPassword>");
    process.exit(1);
  }

  const [rawPhone, newPassword] = args;
  if (!rawPhone || !newPassword) {
    console.error("Error: Both <phone> and <newPassword> must be non-empty strings.");
    process.exit(1);
  }

  const db = await getDb();
  if (!db) {
    console.error("Database connection unavailable");
    process.exit(1);
  }

  const e164 = formatE164(rawPhone);
  const digits = normalizePhone(rawPhone);

  const matched = await db
    .select()
    .from(users)
    .where(
      or(
        eq(users.phoneE164, e164),
        eq(users.phoneE164, `+91${digits}`),
        eq(users.phoneE164, rawPhone),
        eq(users.openId, rawPhone)
      )
    )
    .limit(1);

  if (matched.length === 0) {
    console.error(`Error: User with phone/identifier "${rawPhone}" not found in database.`);
    process.exit(1);
  }

  const targetUser = matched[0];
  const passwordHash = await bcrypt.hash(newPassword.trim(), 10);
  const nextTokenVersion = (targetUser.tokenVersion ?? 1) + 1;

  await db
    .update(users)
    .set({
      passwordHash,
      tokenVersion: nextTokenVersion,
      loginMethod: "password",
      accountStatus: targetUser.accountStatus === "removed" ? "removed" : "active",
    })
    .where(eq(users.id, targetUser.id));

  console.log(`✓ Password updated successfully for user ID ${targetUser.id} (${targetUser.phoneE164 || targetUser.openId}).`);
  console.log(`  Token version bumped to ${nextTokenVersion}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
