import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function AddMember() {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [msg, setMsg] = useState("");

  async function submit() {
    try {
      await invoke("add_member", {
        code,
        name,
        phone: phone || null,
        address: address || null,
        joinedAt: new Date().toISOString(),
      });
      setMsg("Member added");
      setCode("");
      setName("");
      setPhone("");
      setAddress("");
    } catch (e) {
      setMsg(String(e));
    }
  }

  return (
    <div>
      <h3>Add Member</h3>
      <input placeholder="Member Code" value={code} onChange={e => setCode(e.target.value)} />
      <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
      <input placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
      <input placeholder="Address" value={address} onChange={e => setAddress(e.target.value)} />
      <button onClick={submit}>Add</button>
      {msg && <p>{msg}</p>}
    </div>
  );
}
