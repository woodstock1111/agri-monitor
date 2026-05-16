#!/usr/bin/env python3
"""Dry-run image ownership report for chapter 5 weed entries.

This script intentionally does not extract images and does not modify
photo-records.json. It only reads the PDF layout and writes a markdown report.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

import fitz


DEFAULT_PDF = Path(
    "pdf/additionalfile/978-7-03-077576-4-木薯园杂草识别与防控技术-正文.pdf"
)
DEFAULT_LIBRARY = Path("server-data/pest-library.json")
DEFAULT_REPORT = Path("extraction-report.md")

TARGET_WEEDS = [
    "香附子",
    "田旋花",
    "苦苣菜",
    "马唐",
    "喜旱莲子草",
    "打碗花",
    "赛葵",
    "鸭跖草",
    "少花龙葵",
    "白苞猩猩草",
    "牛筋草",
    "假臭草",
    "阔叶丰花草",
    "藿香蓟",
    "小蓬草",
    "野茼蒿",
    "飞机草",
    "微甘菊",
    "含羞草",
    "无刺含羞草",
    "巴西含羞草",
    "光荚含羞草",
    "白茅",
    "狗牙根",
    "双穗雀稗",
    "雀稗",
    "巴拉草",
    "稗",
    "光头稗",
    "千金子",
    "象草",
    "飞扬草",
    "铁苋菜",
    "叶下珠",
    "扁穗莎草",
    "碎米莎草",
    "异型莎草",
    "三裂叶薯",
    "五爪金龙",
    "圆叶牵牛",
    "火炭母",
    "土牛膝",
    "刺苋",
    "凹头苋",
    "皱果苋",
    "酢浆草",
    "红花酢浆草",
    "黄花稔",
    "苘麻",
    "地桃花",
]

RETAINED_WEEDS = ["两耳草", "龙爪茅", "白花鬼针草", "篱栏网"]
REPORT_WEEDS = TARGET_WEEDS + RETAINED_WEEDS
DEBUG_WEEDS = ["田旋花", "巴拉草", "千金子", "象草", "扁穗莎草", "火炭母", "香附子"]


def find_titles(doc: fitz.Document, start_page: int, end_page: int) -> list[dict]:
    titles = []
    title_re = re.compile(r"(5\.\d+\.\d+)\s*[\u3000 ]*([^（\n]+)")
    for page_number in range(start_page, end_page + 1):
        page = doc[page_number - 1]
        for block in page.get_text("blocks"):
            if len(block) >= 7 and block[6] != 0:
                continue
            text = str(block[4]).strip()
            match = title_re.search(text)
            if not match:
                continue
            name = match.group(2).strip().replace("　", "")
            bbox = fitz.Rect(block[:4])
            titles.append(
                {
                    "section": match.group(1),
                    "name": name,
                    "page": page_number,
                    "bbox": bbox,
                    "column": column_for(page, bbox),
                }
            )
    return titles


def column_for(page: fitz.Page, bbox: fitz.Rect) -> str:
    return "left" if bbox.x0 + bbox.width / 2 < page.rect.width / 2 else "right"


def is_small_decoration(page: fitz.Page, bbox: fitz.Rect, src_w: int, src_h: int) -> bool:
    if src_w < 200 or src_h < 200:
        return True
    top_zone = page.rect.height * 0.05
    bottom_zone = page.rect.height * 0.95
    displayed_small = bbox.width < 80 or bbox.height < 80
    return displayed_small and (bbox.y0 < top_zone or bbox.y1 > bottom_zone)


def image_instances(doc: fitz.Document, start_page: int, end_page: int) -> list[dict]:
    images = []
    for page_number in range(start_page, end_page + 1):
        page = doc[page_number - 1]
        seen_on_page = set()
        for img in page.get_images(full=True):
            xref = img[0]
            src_w, src_h = int(img[2]), int(img[3])
            try:
                bbox = page.get_image_bbox(img)
            except Exception:
                continue
            image_id = f"xref{xref}"
            key = (xref, round(bbox.x0, 3), round(bbox.y0, 3), round(bbox.x1, 3), round(bbox.y1, 3))
            if key in seen_on_page:
                continue
            seen_on_page.add(key)
            if is_small_decoration(page, bbox, src_w, src_h):
                continue
            images.append(
                {
                    "xref": xref,
                    "image_id": image_id,
                    "page": page_number,
                    "bbox": bbox,
                    "src_w": src_w,
                    "src_h": src_h,
                    "bytes": src_w * src_h * 3,
                    "column": column_for(page, bbox),
                }
            )
    return images


def is_noise_text(text: str) -> bool:
    compact = re.sub(r"\s+", "", text)
    if not compact:
        return True
    if re.fullmatch(r"\d+", compact):
        return True
    if "木薯园杂草识别与防控技术" in compact:
        return True
    if "第５章木薯园常见杂草识别与防治" in compact:
        return True
    if "cs6.indd" in compact:
        return True
    if re.fullmatch(r"5\.\d+[^】]{0,30}", compact):
        return True
    return False


def page_has_body_before(page: fitz.Page, y_limit: float) -> bool:
    for block in page.get_text("blocks"):
        if len(block) >= 7 and block[6] != 0:
            continue
        text = str(block[4]).strip()
        if is_noise_text(text) or re.search(r"5\.\d+\.\d+", text):
            continue
        rect = fitz.Rect(block[:4])
        horizontal = rect.width > rect.height * 2
        if horizontal and rect.y1 < y_limit - 4:
            return True
    return False


def page_has_group_heading_before(page: fitz.Page, y_limit: float) -> bool:
    group_re = re.compile(r"5\.\d+\s+[^0-9]")
    for block in page.get_text("blocks"):
        if len(block) >= 7 and block[6] != 0:
            continue
        text = re.sub(r"\s+", "", str(block[4]))
        rect = fitz.Rect(block[:4])
        if rect.y1 < y_limit and group_re.search(text) and not re.search(r"5\.\d+\.\d+", text):
            return True
    return False


def assign_image(
    image: dict,
    titles: list[dict],
    page_by_number: dict[int, fitz.Page],
    assigned_counts: dict[str, int],
) -> tuple[str | None, str]:
    same_page = [t for t in titles if t["page"] == image["page"] and t["bbox"].y0 < image["bbox"].y0]
    if same_page:
        same_column = [t for t in same_page if t["column"] == image["column"]]
        candidates = same_column or same_page
        owner = max(candidates, key=lambda t: t["bbox"].y0)
        return owner["name"], "同页标题后接收"

    page_titles = [t for t in titles if t["page"] == image["page"]]
    if page_titles:
        first_title = min(page_titles, key=lambda t: t["bbox"].y0)
        page = page_by_number[image["page"]]
        if not page_has_body_before(page, image["bbox"].y0):
            starts_new_plate = first_title["bbox"].y0 < 430 or page_has_group_heading_before(page, first_title["bbox"].y0)
            previous = [t for t in titles if t["page"] < image["page"]]
            previous_owner = max(previous, key=lambda t: (t["page"], t["bbox"].y0))["name"] if previous else None
            if starts_new_plate or (previous_owner and assigned_counts.get(previous_owner, 0) > 0):
                return first_title["name"], "同页起始接收"

    previous = [t for t in titles if t["page"] < image["page"]]
    if not previous:
        return None, "无前置标题"
    owner = max(previous, key=lambda t: (t["page"], t["bbox"].y0))
    return owner["name"], "跨页接收"


def parse_previous_rows(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    rows = {}
    row_re = re.compile(r"^\| ([^|]+) \| ([^|]*) \| ([^|]*) \| (\d+) \| ([^|]*) \|", re.MULTILINE)
    for name, key, page, count, images in row_re.findall(path.read_text()):
        if name.strip() != "中文名":
            rows[name.strip()] = {"count": int(count), "images": images.strip()}
    return rows


def load_keys(path: Path) -> dict[str, str]:
    data = json.loads(path.read_text())
    return {
        item["name"]: item["key"]
        for item in data.get("entries", [])
        if item.get("type") == "weed"
    }


def fmt_bbox(rect: fitz.Rect) -> str:
    return f"({rect.x0:.1f},{rect.y0:.1f},{rect.x1:.1f},{rect.y1:.1f})"


def fmt_size(byte_count: int) -> str:
    if byte_count >= 1024 * 1024:
        return f"{byte_count / 1024 / 1024:.1f} MB"
    if byte_count >= 1024:
        return f"{byte_count / 1024:.1f} KB"
    return f"{byte_count} B"


def nearby_pages(title_page: int | None) -> list[int]:
    if not title_page:
        return []
    return [page for page in range(max(39, title_page - 1), min(182, title_page + 1) + 1)]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--library", type=Path, default=DEFAULT_LIBRARY)
    parser.add_argument("--out", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()

    doc = fitz.open(args.pdf)
    titles = find_titles(doc, 39, 182)
    images = image_instances(doc, 39, 182)
    key_by_name = load_keys(args.library)
    page_by_number = {page_number: doc[page_number - 1] for page_number in range(39, 183)}
    image_owner = {}
    owner_reason = {}

    assigned = defaultdict(list)
    assigned_counts = defaultdict(int)
    page_count_snapshots = {}
    for image in sorted(images, key=lambda item: (item["page"], item["bbox"].y0, item["bbox"].x0)):
        if image["page"] not in page_count_snapshots:
            page_count_snapshots[image["page"]] = dict(assigned_counts)
        owner, reason = assign_image(image, titles, page_by_number, page_count_snapshots[image["page"]])
        if owner:
            image_owner[image["image_id"]] = owner
            owner_reason[image["image_id"]] = reason
            assigned_counts[owner] += 1
            assigned[owner].append(image)

    for name, rows in assigned.items():
        unique = {}
        for image in rows:
            unique.setdefault(image["image_id"], image)
        assigned[name] = list(unique.values())

    image_id_to_names = defaultdict(set)
    for name, rows in assigned.items():
        for image in rows:
            image_id_to_names[image["image_id"]].add(name)

    unique_images = {}
    for rows in assigned.values():
        for image in rows:
            unique_images.setdefault(image["image_id"], image)
    total_bytes = sum(image["bytes"] for image in unique_images.values())

    title_page = {item["name"]: item["page"] for item in titles}
    suspicious_names = []
    previous_rows = parse_previous_rows(args.out)
    lines = [
        "# Chapter 5 Weed Image Ownership Dry Run",
        "",
        "本报告只分析 PDF 文字块和图片 bbox，不抽图、不写图片文件、不修改 photo-records.json。",
        "",
        "| 中文名 | key | ch5 起始页 | 候选图片数 | 每张图 (page, xref, bbox, 尺寸) | 归属理由 | 是否可疑 |",
        "| --- | --- | ---: | ---: | --- | --- | --- |",
    ]

    page_height = doc[0].rect.height
    current_counts = {}
    current_images = {}
    current_status = {}
    for name in REPORT_WEEDS:
        rows = assigned.get(name, [])
        current_counts[name] = len(rows)
        current_images[name] = "<br>".join(
            f"p{image['page']} {image['image_id']} {fmt_bbox(image['bbox'])} {image['src_w']}x{image['src_h']}"
            for image in rows
        )
        reasons = []
        ownership_reasons = []
        if len(rows) == 0:
            page_number = title_page.get(name)
            page_image_count = sum(1 for image in images if image["page"] == page_number)
            if page_image_count:
                taken_by = sorted(
                    {
                        image_owner.get(image["image_id"], "未归属")
                        for image in images
                        if image["page"] == page_number
                    }
                )
                reasons.append("images_stolen_by_neighbor:" + "、".join(taken_by))
                ownership_reasons.append("页面有图但未归属给本种")
            else:
                reasons.append("pdf_no_images_on_page")
                ownership_reasons.append("页面真无图")
        if len(rows) > 6:
            reasons.append(">6 张")
        image_texts = []
        for image in rows:
            bbox = image["bbox"]
            if bbox.y0 < page_height * 0.10 or bbox.y1 > page_height * 0.90:
                reasons.append("跨页边界附近")
            if len(image_id_to_names[image["image_id"]]) > 1:
                reasons.append(f"同图 {image['image_id']} 跨多个种")
            image_texts.append(
                f"p{image['page']} {image['image_id']} {fmt_bbox(bbox)} {image['src_w']}x{image['src_h']}"
            )
            ownership_reasons.append(owner_reason.get(image["image_id"], ""))
        suspicious = "；".join(dict.fromkeys(reasons))
        current_status[name] = suspicious or "否"
        if suspicious and suspicious != "pdf_no_images_on_page":
            suspicious_names.append(name)
        lines.append(
            "| {name} | {key} | {page} | {count} | {images} | {reason} | {suspicious} |".format(
                name=name,
                key=key_by_name.get(name, ""),
                page=title_page.get(name, ""),
                count=len(rows),
                images="<br>".join(image_texts) if image_texts else "-",
                reason="；".join(dict.fromkeys(filter(None, ownership_reasons))) or "-",
                suspicious=suspicious or "否",
            )
        )

    changed_names = [
        name
        for name in DEBUG_WEEDS
        if name in REPORT_WEEDS and current_counts.get(name, 0) > 0 and current_status.get(name) == "否"
    ]
    maintained_names = [name for name in REPORT_WEEDS if name not in changed_names]
    known_no_image = [name for name, status in current_status.items() if status == "pdf_no_images_on_page"]

    lines.extend(
        [
            "",
            "## Summary",
            "",
            f"- 总图片数估计：{sum(len(assigned.get(name, [])) for name in REPORT_WEEDS)} 张（50 种 + 4 保留种范围内去重后计数）",
            f"- 修复了 {len(changed_names)} 种：{', '.join(changed_names) if changed_names else '无'}",
            f"- 维持 {len(maintained_names)} 种。",
            f"- 仍有 {len(suspicious_names)} 种问题：{', '.join(suspicious_names) if suspicious_names else '无'}",
            f"- 页面实测无图：{', '.join(known_no_image) if known_no_image else '无'}",
            f"- 可疑种数量：{len(suspicious_names)}",
            f"- 可疑种名单：{', '.join(suspicious_names) if suspicious_names else '无'}",
            f"- 总磁盘占用估计（按 PDF 原始嵌入图片）：{fmt_size(total_bytes)}",
        ]
    )
    lines.extend(["", "## Debug: Boundary Cases", ""])
    for name in DEBUG_WEEDS:
        page_number = title_page.get(name)
        lines.append(f"### {name}")
        lines.append("")
        rows = assigned.get(name, [])
        if rows:
            lines.append(
                "- 归属图片："
                + "；".join(
                    f"p{image['page']} {image['image_id']} {fmt_bbox(image['bbox'])} -> {image_owner.get(image['image_id'])} ({owner_reason.get(image['image_id'])})"
                    for image in rows
                )
            )
        else:
            same_page_images = [image for image in images if image["page"] == page_number]
            if same_page_images:
                lines.append(
                    "- 0 图原因：images_stolen_by_neighbor；同页图片归属为 "
                    + "；".join(
                        f"{image['image_id']} -> {image_owner.get(image['image_id'], '未归属')}"
                        for image in same_page_images
                    )
                )
            else:
                lines.append("- 0 图原因：pdf_no_images_on_page；起始页实测无图片。")
        nearby = []
        for nearby_page in nearby_pages(page_number):
            for image in images:
                if image["page"] == nearby_page:
                    nearby.append(
                        f"p{nearby_page} {image['image_id']} {fmt_bbox(image['bbox'])} -> {image_owner.get(image['image_id'], '未归属')} ({owner_reason.get(image['image_id'], '-')})"
                    )
        lines.append("- 邻近页图片：" + ("；".join(nearby) if nearby else "无"))
        lines.append("")
    args.out.write_text("\n".join(lines) + "\n")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
