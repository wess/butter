<script setup lang="ts">
import { ref, onMounted } from "vue"

const greeting = ref("Loading...")

onMounted(async () => {
  greeting.value = (await butter.invoke("greet", "Butter")) as string
})
</script>

<template>
  <div id="app">
    <h1>{{ greeting }}</h1>
  </div>
</template>
