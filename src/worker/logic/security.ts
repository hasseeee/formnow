// 純粋関数: セキュリティ関連のユーティリティ。D1に依存しない。

/**
 * 定数時間文字列比較。トークンなどの秘密情報の比較に使う。
 * 通常の `===` は最初に異なる文字が見つかった時点で処理を打ち切るため、
 * 実行時間の差からトークンの内容を推測されるタイミング攻撃のリスクがある。
 * この実装は長さが一致する限り全文字を必ず走査し、XORの累積で差分を判定する。
 * (長さが異なる場合のみ早期return するが、これは秘密情報の中身とは無関係な情報)
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
