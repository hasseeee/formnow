/** 数値表示の共通フォーマッタ。null は '-'、それ以外は小数2桁まで（末尾の0は削る）。 */
export function formatScore(n: number | null): string {
  if (n === null) return '-';
  return n.toFixed(2).replace(/\.?0+$/, '');
}
