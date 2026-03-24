import { on, send } from "butter"

on("greet", (name) => {
  return `Hello, ${name}!`
})
