#!/usr/bin/env python3
"""zip только с исходниками коннектора и инструкцией."""

import argparse
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILES = {
    name: ROOT / "integrations/hermes" / name for name in (
        "dashboard_mcp.py",
        "dashboard_write_mcp.py",
        "dashboard_write_client.py",
        "dashboard_write_outbox.py",
        "dashboard_write_protocol.py",
        "dashboard_write_schemas.json",
    )
}
FILES["инструкция.md"] = ROOT / "docs/hermes-dashboard-write.md"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if args.output.suffix.lower() != ".zip" or args.output.is_symlink():
        parser.error("нужен новый путь к zip")
    try:
        contents = {}
        for name, source in FILES.items():
            if source.is_symlink() or not source.is_file() or source.resolve() != source:
                raise ValueError()
            contents[name] = source.read_bytes()
        with zipfile.ZipFile(args.output, "x", compression=zipfile.ZIP_DEFLATED) as bundle:
            for name, value in sorted(contents.items()):
                info = zipfile.ZipInfo(name, date_time=(2000, 1, 1, 0, 0, 0))
                info.external_attr = 0o100644 << 16
                bundle.writestr(info, value, compress_type=zipfile.ZIP_DEFLATED)
    except (OSError, ValueError):
        print("не удалось создать новый zip; существующие файлы не заменены", file=sys.stderr)
        return 1
    print(args.output.resolve())
    return 0


if __name__ == "__main__":
    sys.exit(main())
