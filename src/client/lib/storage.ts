// 回答者の名前選択をlocalStorageに記憶するためのヘルパー。
// キーにフォームのslugを含めることで、フォームごとに別々の選択を保持する。

function storageKey(slug: string): string {
  return `formnow:${slug}:respondentId`;
}

export function getStoredRespondentId(slug: string): number | null {
  try {
    const raw = localStorage.getItem(storageKey(slug));
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setStoredRespondentId(slug: string, id: number): void {
  try {
    localStorage.setItem(storageKey(slug), String(id));
  } catch {
    /* localStorageが使用できない環境では無視する */
  }
}

export function clearStoredRespondentId(slug: string): void {
  try {
    localStorage.removeItem(storageKey(slug));
  } catch {
    /* ignore */
  }
}
