<!--
    A mark beside a field label.

    Inline paths on a shared 24x24 grid rather than an icon font or a package:
    no CDN, no build step, and they take their colour and weight from the text
    they sit beside.

    A component rather than a local {#snippet} because a snippet's call reads as
    a void expression to the linter, and six disable comments to keep one helper
    is a worse trade than one file.
-->
<script lang="ts">
    /** Path data, drawn in order. */
    const { paths }: { paths: string[] } = $props();
</script>

<!--
    aria-hidden: every one of these sits next to the word it stands for, so
    announcing it is repeating the label rather than adding to it.
-->
<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="size-4 shrink-0 text-stone-400 dark:text-stone-500"
    aria-hidden="true"
>
    {#each paths as d (d)}<path {d} />{/each}
</svg>
