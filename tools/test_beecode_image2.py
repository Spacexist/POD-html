#!/usr/bin/env python3
"""验证 BeeCode gpt-image-2 是否能返回结构化文本，而非生成图片。

默认使用内置的 1x1 PNG，不上传项目图片：
    python tools/test_beecode_image2.py

如需用指定图片测试（会上传该文件至 BeeCode）：
    python tools/test_beecode_image2.py --image path/to/image.png
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import pathlib
import struct
import sys
import uuid
import urllib.error
import urllib.request
import zlib


ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "runtime" / "config.json"
PROMPT = (
    "分析图片是否存在侵权风险。仅返回 JSON 数组，格式："
    '[{"number":"xxx","reason":"xxx","risk":"低|中|高"}]。'
)


def safe_test_png() -> bytes:
    """生成无业务数据的标准 512x512 白色 PNG，避免 1x1 图片被接口拒绝。"""
    width = height = 512
    raw = b"".join(b"\x00" + b"\xff\xff\xff" * width for _ in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def load_config() -> dict:
    try:
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise RuntimeError(f"未找到配置文件：{CONFIG_PATH}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError(f"配置文件不是合法 JSON：{error}") from error

    image_api = config.get("imageApi") or config.get("beecode") or config
    if not image_api.get("apiKey"):
        raise RuntimeError("runtime/config.json 未配置 imageApi.apiKey")
    return image_api


def multipart_body(fields: dict[str, str], image_name: str, image_bytes: bytes, image_type: str) -> tuple[bytes, str]:
    boundary = f"----BeeCodeTest{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend((
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
            value.encode(),
            b"\r\n",
        ))
    chunks.extend((
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="image"; filename="{image_name}"\r\n'.encode(),
        f"Content-Type: {image_type}\r\n\r\n".encode(),
        image_bytes,
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ))
    return b"".join(chunks), boundary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", type=pathlib.Path, help="要上传的图片路径；省略时使用内置安全测试图")
    args = parser.parse_args()
    config = load_config()
    base_url = str(config.get("baseUrl", "https://beecode.cc")).rstrip("/")
    endpoint = str(config.get("endpoint", "/v1/images/edits"))
    if not endpoint.startswith("/"):
        endpoint = "/" + endpoint
    model = str(config.get("model", "gpt-image-2"))

    if args.image:
        image_path = args.image.resolve()
        image_bytes = image_path.read_bytes()
        image_name = image_path.name
        image_type = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
        print(f"测试图片：{image_path}（将上传至 BeeCode）")
    else:
        image_bytes = safe_test_png()
        image_name = "safe-test.png"
        image_type = "image/png"
        print("测试图片：内置无业务数据 PNG")

    body, boundary = multipart_body(
        {
            "model": model,
            "prompt": PROMPT,
            "size": "1024x1024",
            "n": "1",
            "response_format": "json",
        },
        image_name,
        image_bytes,
        image_type,
    )
    request = urllib.request.Request(
        f"{base_url}{endpoint}",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {config['apiKey']}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            status = response.status
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        status = error.code
        raw = error.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as error:
        print(f"请求失败：{error.reason}")
        return 1

    print(f"HTTP: {status}")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        print("响应不是 JSON：", raw[:500])
        return 1

    print("请求 response_format：json")
    print("顶层字段：", list(payload))
    if payload.get("error"):
        print("接口错误：", json.dumps(payload["error"], ensure_ascii=False))
        return 1

    if isinstance(payload.get("json"), (dict, list)):
        print("结构化结果：", json.dumps(payload["json"], ensure_ascii=False))
        return 0
    if isinstance(payload.get("output"), (dict, list, str)):
        print("结构化结果：", json.dumps(payload["output"], ensure_ascii=False)[:1000])
        return 0

    first = (payload.get("data") or [{}])[0]
    print("data[0] 字段：", list(first))
    print("返回图片 Base64：", bool(first.get("b64_json")))
    print("返回图片 URL：", bool(first.get("url")))
    print("结论：response_format=json 未产生结构化 JSON，接口仍返回图片结果。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
