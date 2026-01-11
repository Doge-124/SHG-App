import { useState, useEffect } from 'react'
import { invoke } from "@tauri-apps/api/core";
import './App.css'
import PinScreen from './components/PinScreen';
import SetPinScreen from "./components/SetPinScreen";
import AddMember from "./components/AddMember";
import SearchMember from "./components/SearchMember";

export default function App() {
  const [mode, setMode] = useState<"checking" | "set" | "unlock" | "app">("checking");

  useEffect(() => {
    (async () => {
      const exists = await invoke<boolean>("has_security");
      setMode(exists ? "unlock" : "set");
    })();
  }, []);

  if (mode === "checking") return null;

  if (mode === "set") {
    return <SetPinScreen onDone={() => setMode("app")} />;
  }

  if (mode === "unlock") {
    return <PinScreen onUnlocked={() => setMode("app")} />;
  }

  return (
  <div>
    <h1>SHG Manager</h1>
    <p>Database unlocked successfully!</p>
   <div key="add">
      <AddMember />
   </div>

   <div key="search">
    <SearchMember />
   </div>
    <button onClick={async () => {
  const r = await invoke("dump_members");
  alert(r || "EMPTY");
}}>
  Dump Members
</button>
  </div>
);

}