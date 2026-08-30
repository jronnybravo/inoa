<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<div class="min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
  <main class="mx-auto max-w-5xl px-6 py-12">
    {@render children()}
  </main>
</div>
