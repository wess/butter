<script lang="ts">
  import { onMount } from "svelte"

  let greeting = "Loading..."

  onMount(async () => {
    greeting = (await butter.invoke("greet", "Butter")) as string
  })
</script>

<div id="app">
  <h1>{greeting}</h1>
</div>
