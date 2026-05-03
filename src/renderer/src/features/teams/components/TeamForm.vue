<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { SelectOption } from '@renderer/components/base/BaseSelect.vue';
import BaseInput from '@renderer/components/base/BaseInput.vue';
import BaseSelect from '@renderer/components/base/BaseSelect.vue';
import BaseButton from '@renderer/components/base/BaseButton.vue';
import { countryOptions } from '@renderer/utils/countries';

const props = defineProps<{ initialData: any; isEditing: boolean; }>();
const emit = defineEmits(['submit']);
const form = ref({ ...props.initialData });
const logoFile = ref<File | null>(null);
const logoPreview = ref<string | null>(null);

const countrySelectOptions = computed((): SelectOption[] =>
  countryOptions.map(c => ({ value: c.code, label: `${c.name} (${c.code})` }))
);

watch(() => props.initialData, (newData) => {
  form.value = { ...newData };
  logoPreview.value = null;
}, { deep: true });

const fileInputRef = ref<HTMLInputElement | null>(null);

const onFileChange = (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (target.files?.length) {
    logoFile.value = target.files[0];
    logoPreview.value = URL.createObjectURL(target.files[0]);
  }
};
</script>

<template>
  <form id="teamForm" @submit.prevent="emit('submit', form, logoFile)" class="p-6 space-y-6">

    <!-- Logo + Primary Info -->
    <div class="flex gap-6 items-start">

      <!-- Logo upload -->
      <div class="flex flex-col items-center gap-2 shrink-0">
        <div class="w-36 h-36 rounded-xl overflow-hidden border-2 border-zinc-700 bg-surface flex items-center justify-center p-3">
          <img v-if="logoPreview" :src="logoPreview" class="w-full h-full object-contain" />
          <img v-else-if="form.logo" :src="`http://localhost:1349${form.logo}`" class="w-full h-full object-contain" />
          <span v-else class="text-zinc-600 text-6xl font-black select-none">T</span>
        </div>
        <BaseButton @click="fileInputRef?.click()" class="w-full justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
          Upload
        </BaseButton>
        <input ref="fileInputRef" type="file" accept="image/*" @change="onFileChange" class="hidden" />
      </div>

      <!-- Team Name + Short Name -->
      <div class="flex-1 space-y-4">
        <BaseInput
          v-model="form.name"
          label="Team Name"
          type="text"
          size="md"
        />
        <BaseInput
          v-model="form.shortName"
          label="Short Name"
          type="text"
          placeholder="e.g. NaVi"
          size="md"
        />
      </div>
    </div>

    <div class="border-t border-zinc-700/50"></div>

    <!-- Country -->
    <BaseSelect
      v-model="form.country"
      label="Country"
      placeholder="No Country"
      :options="countrySelectOptions"
      size="md"
    />

  </form>
</template>
