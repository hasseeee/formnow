-- 評価（rating）質問の段階ごとの説明。JSONの文字列配列、長さ = max_score。NULL は説明なし
ALTER TABLE questions ADD COLUMN scale_labels_json TEXT;
