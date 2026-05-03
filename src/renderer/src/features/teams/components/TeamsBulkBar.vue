<script setup lang="ts">
import BaseButton from '../../../components/base/BaseButton.vue';

defineProps<{
  selectedCount: number;
}>();

defineEmits<{
  deleteSelected: [];
}>();
</script>

<template>
  <div class="mb-3 flex items-center justify-between px-4 py-2.5 bg-primary/10 border border-primary/30 rounded-lg">
    <span class="text-primary text-sm font-medium">{{ selectedCount }} team(s) selected</span>
    <BaseButton variant="danger" size="sm" @click="$emit('deleteSelected')">
      Delete Selected
    </BaseButton>
  </div>
</template>
