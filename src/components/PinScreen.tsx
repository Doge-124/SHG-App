import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Props = {
  onUnlocked: () => void;
};

export default function PinScreen({ onUnlocked }: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    try {
      await invoke("unlock_db", { pin });
      onUnlocked();
    } catch {
      setError("Invalid PIN");
      setPin("");
    }
  }

  return (
    <div>
      <h2>Enter Admin PIN</h2>
      <input
        type="password"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        autoFocus
      />
      <button onClick={submit}>Unlock</button>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}
