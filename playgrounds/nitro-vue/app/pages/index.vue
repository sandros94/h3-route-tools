<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../api.ts";

const post = ref<{ id: number; title: string; when: string }>();
const created = ref<{ id: number; tagCount: number }>();
const error = ref<string>();

onMounted(async () => {
  try {
    const p = await api("/posts/7");
    // `p` is typed from the GET contract: { id: number; title: string; when: string }.
    // `when` is `string` (not `Date`) because that is how it arrives over the wire.
    p.id satisfies number;
    p.title satisfies string;
    p.when satisfies string;
    post.value = p;

    const c = await api("/posts/7", { method: "post", body: { title: "Hi", tags: "a,b,c" } });
    // `c` is typed from the POST contract: { id: number; tagCount: number }.
    c.tagCount satisfies number;
    created.value = c;
  } catch (e) {
    error.value = String(e);
  }
});
</script>

<template>
  <main>
    <h1>h3-route-tools × nitro</h1>
    <p class="subtitle">The Vue client calls the API through a <code>$Fetch</code>-typed client.</p>

    <div class="card">
      <h2>GET /posts/7</h2>
      <pre v-if="post">{{ post }}</pre>
      <p v-else-if="error" class="error">{{ error }}</p>
      <p v-else>Loading…</p>
    </div>

    <div class="card">
      <h2>POST /posts/7</h2>
      <pre v-if="created">{{ created }}</pre>
      <p v-else-if="error" class="error">{{ error }}</p>
      <p v-else>Loading…</p>
    </div>
  </main>
</template>
