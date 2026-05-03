<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { SelectOption } from '@renderer/components/base/BaseSelect.vue';
import BaseInput from '@renderer/components/base/BaseInput.vue';
import BaseSelect from '@renderer/components/base/BaseSelect.vue';
import BaseCheckbox from '@renderer/components/base/BaseCheckbox.vue';
import BaseButton from '@renderer/components/base/BaseButton.vue';
import { countryOptions } from '@renderer/utils/countries';

const props = defineProps<{
  initialData: any;
  teams: any[];
  isEditing: boolean;
  lockSteamId?: boolean;
}>();

const emit = defineEmits(['submit']);
const form = ref({ ...props.initialData });
const avatarFile = ref<File | null>(null);
const avatarPreview = ref<string | null>(null);

watch(() => props.initialData, (newData) => {
  form.value = { ...newData };
  avatarPreview.value = null;
}, { deep: true });

// Convert data to SelectOption[] format
const countrySelectOptions = computed((): SelectOption[] =>
  countryOptions.map(c => ({ value: c.code, label: `${c.name} (${c.code})` }))
);

const teamSelectOptions = computed((): SelectOption[] =>
  props.teams.map(t => ({ value: t._id, label: t.name }))
);

const onFileChange = (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (target.files?.length) {
    avatarFile.value = target.files[0];
    avatarPreview.value = URL.createObjectURL(target.files[0]);
  }
};

const fileInputRef = ref<HTMLInputElement | null>(null);
const handleSubmit = () => { emit('submit', form.value, avatarFile.value); };
</script>

<template>
  <form id="playerForm" @submit.prevent="handleSubmit" class="p-6 space-y-6">

    <!-- Avatar + Primary Identity -->
    <div class="flex gap-6 items-start">

      <!-- Avatar upload -->
      <div class="flex flex-col items-center gap-2 shrink-0">
        <div class="w-36 h-36 rounded-xl overflow-hidden border-2 border-zinc-700 bg-surface flex items-center justify-center">
          <img v-if="avatarPreview" :src="avatarPreview" class="w-full h-full object-cover" />
          <img v-else-if="form.avatar" :src="`http://localhost:1349${form.avatar}`" class="w-full h-full object-cover" />
          <span v-else class="text-zinc-600 text-6xl select-none">?</span>
        </div>
        <BaseButton @click="fileInputRef?.click()" class="w-full justify-center ">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
          Upload
        </BaseButton>
        <input ref="fileInputRef" type="file" accept="image/*" @change="onFileChange" class="hidden" />
      </div>

      <!-- Steam ID + Username -->
      <div class="flex-1 space-y-4">
        <BaseInput
          v-model="form.steamid"
          label="Steam ID 64"
          type="text"
          :disabled="lockSteamId"
          size="md"
        />
        <BaseInput
          v-model="form.username"
          label="Username"
          type="text"
          size="md"
        />
      </div>
    </div>

    <div class="border-t border-zinc-700/50"></div>

    <!-- Name row -->
    <div class="grid grid-cols-2 gap-4">
      <BaseInput
        v-model="form.firstName"
        label="First Name"
        type="text"
        size="md"
      />
      <BaseInput
        v-model="form.lastName"
        label="Last Name"
        type="text"
        size="md"
      />
    </div>

    <!-- Country + Team row -->
    <div class="grid grid-cols-2 gap-4">
      <BaseSelect
        v-model="form.country"
        label="Country"
        placeholder="No Country"
        :options="countrySelectOptions"
        size="md"
      />
      <BaseSelect
        v-model="form.team"
        label="Team"
        placeholder="No Team"
        :options="teamSelectOptions"
        :searchable="true"
        size="md"
      />
    </div>

    <!-- Coach toggle -->
    <div class="p-4 rounded-lg border border-zinc-700 bg-surface/50">
      <div class="flex items-center justify-between">
        <div>
          <span class="text-sm font-semibold text-zinc-200">Set as Coach</span>
          <p class="text-xs text-zinc-500 mt-0.5">Coaches are filtered out (hidden) from the data sent to the HUDs</p>
        </div>
        <BaseCheckbox
          v-model="form.isCoach"
          size="md"
        />
      </div>
    </div>

  </form>
</template>
