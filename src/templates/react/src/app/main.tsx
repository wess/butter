import { createRoot } from "react-dom/client"
import { useState, useEffect } from "react"

const App = () => {
  const [greeting, setGreeting] = useState("Loading...")

  useEffect(() => {
    butter.invoke("greet", "Butter").then((result) => {
      setGreeting(result as string)
    })
  }, [])

  return (
    <div id="app">
      <h1>{greeting}</h1>
    </div>
  )
}

const root = createRoot(document.getElementById("root")!)
root.render(<App />)
