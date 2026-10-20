#!/usr/bin/env python3
"""Create the Linux/CentOS Stream updater deployment tarball.

The archive deliberately has no top-level directory so it can be extracted
directly into /opt/orderhub-updater:

    tar -xzf OrderHub-Updater-0.1.3-centos-stream.tar.gz -C /opt/orderhub-updater
"""

from __future__ import annotations

import hashlib
import pathlib
import tarfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "release-assets" / "updater-0.1.3-centos"
ARCHIVE = ROOT / "release-assets" / "OrderHub-Updater-0.1.3-centos-stream.tar.gz"
CHECKSUM = ROOT / "release-assets" / "SHA256SUMS-updater-0.1.3.txt"

FILES = [
    ("dist", None),
    ("dist/server.js", 0o644),
    ("migrations", None),
    ("migrations/001_init.sql", 0o644),
    (".env.example", 0o644),
    ("README.md", 0o644),
    ("start.sh", 0o755),
    ("orderhub-updater.service", 0o644),
]


def main() -> None:
    if not PACKAGE.is_dir():
        raise SystemExit(f"missing package directory: {PACKAGE}")
    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(ARCHIVE, "w:gz", format=tarfile.PAX_FORMAT) as archive:
        for relative, mode in FILES:
            source = PACKAGE / relative
            info = archive.gettarinfo(str(source), arcname=relative)
            info.uid = 0
            info.gid = 0
            info.uname = "root"
            info.gname = "root"
            info.mode = 0o755 if mode is None else mode
            if source.is_file():
                with source.open("rb") as handle:
                    archive.addfile(info, handle)
            else:
                archive.addfile(info)

    digest = hashlib.sha256(ARCHIVE.read_bytes()).hexdigest()
    CHECKSUM.write_text(f"{digest}  {ARCHIVE.name}\n", encoding="ascii")
    print(f"archive={ARCHIVE}")
    print(f"sha256={digest}")
    print(f"size={ARCHIVE.stat().st_size}")


if __name__ == "__main__":
    main()
