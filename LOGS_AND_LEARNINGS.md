# Logs And Learnings

## 2026-05-15 - Weed Library Chapter 5 Stage 1

- Updated the weed library from chapter 5 of `978-7-03-077576-4-木薯园杂草识别与防控技术-正文.pdf`, covering the requested 50 weed names.
- Preserved the existing 15 weed entry IDs and keys; existing entries that overlap the requested list now use fuller chapter 5 `识别特征` and `防治方法` content.
- Kept the previously added non-target existing weed entries. Final weed count is 55 because `墨苜蓿` already existed and its id/key was preserved.
- Added `scripts/extract-weeds-ch5.py` as a dry-run report generator. It reads PDF text/image layout only and writes `extraction-report.md`; it does not extract images or modify `photo-records.json`.
- Dry-run report found 6 suspicious target weeds with 0 candidate images: 田旋花、巴拉草、千金子、象草、扁穗莎草、火炭母.
