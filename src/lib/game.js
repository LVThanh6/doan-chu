export function normalizeWord(value) {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi-VN')
}
export function validateWord(value) {
  const clean = value.trim().replace(/\s+/g, ' ')
  if (!clean) return 'Bạn chưa nhập từ.'
  const parts = clean.split(' ')
  if (parts.length < 2 || parts.length > 3) return 'Từ cần có 2 hoặc 3 tiếng.'
  if (!/^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+){1,2}$/u.test(clean)) return 'Chỉ nhập chữ cái tiếng Việt, gồm 2 hoặc 3 tiếng.'
  return ''
}
export function makeCode() { return String(Math.floor(100000 + Math.random() * 900000)) }
export function makeId() { return crypto.randomUUID() }
