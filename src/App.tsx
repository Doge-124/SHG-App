import { useState } from 'react'
import './App.css'
import PinScreen from './components/PinScreen';

export default function App() {
  const [unlocked, setUnlocked] = useState(false);

  if (!unlocked) {
    return <PinScreen onUnlocked={() => setUnlocked(true)} />;
  }

  return (
    <div>
      <h1>SHG Manager</h1>
      <p>Unlocked</p>
    </div>
  );
}
