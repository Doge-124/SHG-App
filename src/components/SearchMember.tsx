import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Member {
  id: number;
  name: string;
  phone: string;
  address: string;
  joined_at: string;
  is_active: boolean;
}

export default function SearchMember() {
  const codeRef = useRef<HTMLInputElement>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function search() {
  const code = codeRef.current?.value.trim();
  if (!code) return;

  setError("");

  try {
    const m = await invoke<Member>("get_member", { code });
    const bal = await invoke<number>("member_balance", { memberId: m.id });
    setMember(m);
    setBalance(bal);
  } catch (e) {
    setError(String(e));
    setMember(null);
    setBalance(null);
  }
}

  return (
    <div>
      <h3>Search Member</h3>
      <input ref={codeRef} placeholder="Member Code" />
      <button onClick={search}>Search</button>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {member && (
        <div>
          <p>Name: {member.name}</p>
          <p>Phone: {member.phone}</p>
          <p>Address: {member.address}</p>
          <p>Joined: {member.joined_at}</p>
          <p>Status: {member.is_active ? "Active" : "Inactive"}</p>
          <p><b>Balance: ₹{balance}</b></p>
        </div>
      )}
    </div>
  );
}
