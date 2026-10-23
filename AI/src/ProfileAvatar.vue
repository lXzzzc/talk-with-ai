<script setup>
defineProps({ profile: { type: Object, required: true } })
</script>

<template>
  <span class="profile-avatar">
    <img :src="profile.avatar" :alt="profile.name" draggable="false"
      :style="{
        width: `${profile.avatarZoom * 100}%`,
        height: `${profile.avatarZoom * 100}%`,
        left: `${50 - profile.avatarZoom * (profile.avatarFocus?.x ?? 0.5) * 100}%`,
        top: `${50 - profile.avatarZoom * (profile.avatarFocus?.y ?? 0.5) * 100}%`
      }" />
  </span>
</template>

<style scoped>
.profile-avatar { position: relative; display: inline-block; flex: none; overflow: hidden; border-radius: 50%; }
/* Draw at the final crop size instead of enlarging a rasterized avatar with transform. */
.profile-avatar > img { position: absolute; display: block; max-width: none; object-fit: cover; object-position: center; }
</style>
