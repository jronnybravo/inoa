<script lang="ts">
    import type { Snippet } from 'svelte';
    import '../app.css';

    const { children }: { children: Snippet } = $props();
</script>

<div class="min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
    <main class="mx-auto max-w-7xl px-6 py-10">
        {@render children()}
    </main>
</div>
