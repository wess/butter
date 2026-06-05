import { on } from "butter";

on("greet", (name) => {
  return `Hello, ${name}!`;
});
