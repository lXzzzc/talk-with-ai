export function withUserId(path, userId, pageOrigin) {
  const absolute = /^https?:\/\//i.test(path)
  const target = new URL(path, pageOrigin)
  target.searchParams.set('userId', userId)
  return absolute ? target.toString() : `${target.pathname}${target.search}${target.hash}`
}
