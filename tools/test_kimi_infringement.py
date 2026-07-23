#!/usr/bin/env python3
"""用 Kimi 中国区视觉模型识别侵权风险，并强制返回结构化 JSON。

运行前在当前终端设置密钥（密钥不会写入文件）：
    $env:MOONSHOT_API_KEY = '你的密钥'
    python tools/test_kimi_infringement.py

默认使用内置测试图；传入 --image 会将指定图片上传到 Kimi 中国区：
    python tools/test_kimi_infringement.py --image merged.jpg
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import pathlib
import struct
import sys
import urllib.error
import urllib.request
import zlib


KIMI_ENDPOINT = "https://api.moonshot.cn/v1/chat/completions"
MODEL = "kimi-k2.6"
SYSTEM_PROMPT = """你是图片侵权风险审核助手。分析用户提供的合并图：
1. 仅列出有明确或较高可能侵权风险的图片编号；编号来自图片左上角标签。
2. 没有风险项时返回空数组。
3. reason 使用简短中文说明风险依据；risk 只能是 低、中、高。
4. 不要臆测无法从图中识别的信息。"""
RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "infringement_risk_report",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "number": {"type": "string", "description": "合并图左上角的图片编号"},
                            "reason": {"type": "string", "description": "侵权风险原因"},
                            "risk": {"type": "string", "enum": ["低", "中", "高"]},
                        },
                        "required": ["number", "reason", "risk"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["items"],
            "additionalProperties": False,
        },
    },
}


def safe_test_png() -> bytes:
    """生成无业务数据的 512x512 白色 PNG。"""
    width = height = 512
    raw = b"".join(b"\x00" + b"\xff\xff\xff" * width for _ in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def load_image(image_path: pathlib.Path | None) -> tuple[str, bytes, str]:
    if image_path is None:
        return "safe-test.png", safe_test_png(), "image/png"
    path = image_path.resolve()
    if not path.is_file():
        raise RuntimeError(f"图片不存在：{path}")
    return path.name, path.read_bytes(), mimetypes.guess_type(path.name)[0] or "image/png"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", type=pathlib.Path, help="要审核的合并图片")
    args = parser.parse_args()
    api_key = os.environ.get("MOONSHOT_API_KEY", "").strip()
    if not api_key:
        print("请先设置 MOONSHOT_API_KEY 环境变量。", file=sys.stderr)
        return 2

    name, image_bytes, image_type = load_image(args.image)
    image_data_url = f"data:{image_type};base64," + base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                    {"type": "text", "text": "请审核这张合并图，并按既定 JSON Schema 返回。"},
                ],
            },
        ],
        "response_format": RESPONSE_FORMAT,
        "max_tokens": 2048,
    }
    request = urllib.request.Request(
        KIMI_ENDPOINT,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            raw = response.read().decode("utf-8")
            print(f"HTTP: {response.status}")
    except urllib.error.HTTPError as error:
        print(f"HTTP: {error.code}")
        print(error.read().decode("utf-8", errors="replace")[:1000])
        return 1

    response_data = json.loads(raw)
    content = response_data["choices"][0]["message"]["content"]
    result = json.loads(content)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
