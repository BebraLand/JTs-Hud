<script setup lang="ts">
import CloseIcon from '@renderer/assets/icons/CloseIcon.vue';


defineProps<{
  show: boolean;
}>();

defineEmits<{
  (e: 'close'): void;
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      @click.self="$emit('close')"
    >
      <div class="bg-surface border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <!-- Modal header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 class="text-lg font-bold text-text-main">How Spectator Binds Works</h2>
          <button @click="$emit('close')" class="text-zinc-500 hover:text-zinc-200 transition-colors">
            <CloseIcon name="close" class="size-6" />
          </button>
        </div>
        <!-- Modal body -->
        <div class="px-6 py-5 space-y-4 text-sm text-zinc-300 leading-relaxed overflow-y-auto max-h-[70vh]">
          <section class="bg-blue-950 p-1.5 rounded-lg">
            <h3 class="text-blue-300 font-semibold mb-1">Two quick notes:</h3>
            <ul class="text-xs list-decimal list-inside font-bold">
              <li>Players with names that start with a number will not work with the bind commands (limtation of CS2)</li>
              <br/>
              <li>Using this tool may lead to unexpected behavior in tracking map wins for a match (Fix is in progress)</li>
            </ul>
          </section>

          <section>
            <h3 class="text-text-main font-semibold mb-1">Overview</h3>
            <p>This page lets you visually assign custom player slots (keys <code class="bg-zinc-800 px-1 rounded">1</code>–<code class="bg-zinc-800 px-1 rounded">0</code>) to a specific player.</p>
            <br/>
            <p>This is a <b>VISUAL</b> change, you are not actually modifying slots players in the game. We are essentially modifying the raw game data before sending it to the custom huds, and using binds to target the correct players.</p>
          </section>

          <section>
            <h3 class="text-text-main font-semibold mb-1">Slot assignment</h3>
            <p>Use the keycap dropdowns or click a player in the <span class="text-zinc-200 font-medium">Live Players</span> panel to quick-assign them to the first empty slot. <span class="text-zinc-200 font-medium">Import from CS2</span> fills slots automatically using the live <code class="bg-zinc-800 px-1 rounded">observer_slot</code> values from GSI data.</p>
          </section>

          <section>
            <h3 class="text-text-main font-semibold mb-1">Applying binds via Telnet</h3>
            <p>Once you launch CS2 with <code class="bg-zinc-800 px-1 rounded font-mono">-netconport 2020</code> in your launch options, clicking <span class="text-zinc-200 font-medium">Apply Binds</span> connects to that port and sends each bind command</p>
          </section>

          <section>
            <h3 class="text-text-main font-semibold mb-1">Applying binds manually</h3>
            <p>If telnet isn't available, use the <span class="text-zinc-200 font-medium">Copy</span> button in the Command Preview section and paste the single-line command directly into the CS2 console (<code class="bg-zinc-800 px-1 rounded">~</code>).</p>
          </section>

          <section>
            <h3 class="text-text-main font-semibold mb-1">Clearing binds</h3>
            <p><span class="text-zinc-200 font-medium">Clear All</span> removes all slot assignments from the UI and sends <code class="bg-zinc-800 px-1 rounded font-mono">unbind</code> commands for each slot key, then restores the default weapon slot binds (<code class="bg-zinc-800 px-1 rounded font-mono">bind "1" "slot1"</code> etc.). Clearing a single keycap does the same for just that key.</p>
          </section>

          <section>
            <h3 class="text-text-main font-semibold mb-1">CS2 launch option</h3>
            <p>Add the following to your CS2 launch options in Steam:</p>
            <pre class="bg-zinc-950 border border-border rounded-lg px-3 py-2 font-mono text-xs text-zinc-400 mt-1">-netcon_port 2020</pre>
            <p class="text-zinc-500 text-xs mt-1">The port can be changed in the Telnet settings panel on this page.</p>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>
