// Info site: tiny progressive enhancement. No dependencies.

// Mobile nav toggle
const toggle = document.querySelector("[data-nav]");
const links = document.querySelector("[data-navlinks]");
if (toggle && links) {
  toggle.addEventListener("click", () => links.classList.toggle("open"));
  for (const a of links.querySelectorAll("a")) {
    a.addEventListener("click", () => links.classList.remove("open"));
  }
}

// Copy-to-clipboard for code blocks (strips comment markup, copies plain text)
for (const btn of document.querySelectorAll("[data-copy]")) {
  btn.addEventListener("click", async () => {
    const pre = btn.closest(".code")?.querySelector("[data-code]");
    if (!pre) return;
    try {
      await navigator.clipboard.writeText(pre.innerText.trim());
      const original = btn.textContent;
      btn.textContent = "Copied ✓";
      setTimeout(() => {
        btn.textContent = original;
      }, 1600);
    } catch {
      // clipboard unavailable (e.g. file:// without permission) — ignore
    }
  });
}
