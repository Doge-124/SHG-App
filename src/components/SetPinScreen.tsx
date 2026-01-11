import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function SetPinScreen({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    if (pin.length < 4) {
      setError("PIN must be at least 4 digits");
      return;
    }
    if (pin !== confirm) {
      setError("PINs do not match");
      return;
    }
    try {
      await invoke("unlock_db", { pin });
      onDone();
    } catch {
      setError("Failed to set PIN");
    }
  }

  return (
    <div>
      <h2>Set Admin PIN</h2>
      <input type="password" placeholder="PIN" value={pin} onChange={e => setPin(e.target.value)} />
      <input type="password" placeholder="Confirm PIN" value={confirm} onChange={e => setConfirm(e.target.value)} />
      <button onClick={submit}>Set PIN</button>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}
