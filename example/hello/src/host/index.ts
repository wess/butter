import { on } from "butter"
import { native } from "butter/native"

const math = await native("math")
const strings = await native("strings")

on("greet", (name) => {
  return `Hello, ${name}!`
})

on("math:add", (data: { a: number; b: number }) => {
  return math.add(data.a, data.b)
})

on("math:factorial", (n: number) => {
  return math.factorial(n)
})

on("math:fibonacci", (n: number) => {
  return math.fibonacci(n)
})

on("strings:wordcount", (text: string) => {
  return strings.word_count(text)
})

on("strings:charcount", (data: { text: string; char: string }) => {
  return strings.char_count(data.text, data.char.charCodeAt(0))
})

on("strings:palindrome", (text: string) => {
  return strings.is_palindrome(text, text.length) === 1
})
