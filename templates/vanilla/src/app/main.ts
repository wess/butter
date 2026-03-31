const el = document.getElementById("greeting")

const greeting = await butter.invoke("greet", "Butter")

if (el) {
  el.textContent = greeting as string
}
