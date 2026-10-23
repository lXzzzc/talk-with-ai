import xilianAvatar from './assets/xilian-avatar-hd.png'
import trailblazerAvatar from './assets/trailblazer-avatar.jpg'

// Vite fingerprints imported images so replacing an avatar invalidates its cache.
export const ASSISTANT_PROFILE = {
  // The face sits left of the full illustration's center. Focus it in the square crop.
  name: '昔涟', avatar: xilianAvatar, avatarZoom: 1.3, avatarFocus: { x: 0.43, y: 0.55 }
}
// Crop inside the circular badge so the source image's black surround stays outside the avatar.
export const USER_PROFILE = {
  name: '开拓者', avatar: trailblazerAvatar, avatarZoom: 1.12, avatarFocus: { x: 0.5, y: 0.5 }
}
