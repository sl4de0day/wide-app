

export const BODY = "text-reading text-fg";

export const QUESTION = "data-question";

export function tokens(total: number): string {
  if (total < 1000) return String(total);
  const thousands = total / 1000;
  return `${thousands.toFixed(thousands >= 10 ? 0 : 1)}k`;
}
