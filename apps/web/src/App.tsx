import { useState } from 'react';
import './App.css';

function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="app">
      <header>
        <h1>FluidMind</h1>
        <p>Product Formula Development AI Platform</p>
      </header>
      <main>
        <section>
          <h2>Welcome</h2>
          <p>This is the initial setup of the FluidMind platform.</p>
          <button onClick={() => setCount((c) => c + 1)}>
            Count: {count}
          </button>
        </section>
      </main>
    </div>
  );
}

export default App;
