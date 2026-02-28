// Normalize phone: accept any format → digits only, consistent for PK
export function normalizePhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits.length) return '';
  if (digits.length === 12 && digits.startsWith('92')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}
