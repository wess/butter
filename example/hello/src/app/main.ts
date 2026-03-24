const app = document.getElementById("app")!

const greeting = await butter.invoke("greet", "Butter") as string
const sum = await butter.invoke("math:add", { a: 17, b: 25 }) as number
const fact = await butter.invoke("math:factorial", 10) as number
const fib = await butter.invoke("math:fibonacci", 20) as number

const sentence = "the quick brown fox jumps over the lazy dog"
const words = await butter.invoke("strings:wordcount", sentence) as number
const eCount = await butter.invoke("strings:charcount", { text: sentence, char: "o" }) as number
const isPalin = await butter.invoke("strings:palindrome", "racecar") as boolean

app.innerHTML = `
  <h1>${greeting}</h1>
  <div class="results">
    <h3>Moxy native</h3>
    <p>17 + 25 = <strong>${sum}</strong></p>
    <p>10! = <strong>${fact}</strong></p>
    <p>fib(20) = <strong>${fib}</strong></p>

    <h3>C native</h3>
    <p>words in "${sentence.slice(0, 20)}..." = <strong>${words}</strong></p>
    <p>count of 'o' = <strong>${eCount}</strong></p>
    <p>"racecar" is palindrome = <strong>${isPalin}</strong></p>
  </div>
`
