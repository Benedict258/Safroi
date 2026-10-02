import { getSettings } from "@/lib/settings";
import SettingsForm from "./SettingsForm";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const s = await getSettings();
  return (
    <>
      <h1>Settings</h1>
      <SettingsForm s={s} />
      <p className="muted small">
        The scheduled job checks these times every hour and runs the sync for any slot that is due, so a change here applies from the next hour with no redeploy.
      </p>
    </>
  );
}
