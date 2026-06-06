#!/usr/bin/env python3
"""Publish versioned NUC assets to Dropbox and Firestore.

The order is intentionally strict:
1. Hash local bytes.
2. Read current Firestore manifest version.
3. Upload immutable bytes to Dropbox.
4. Verify the uploaded file is present with the expected size.
5. Commit the new manifest version to Firestore.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


DEFAULT_SERVICE_ACCOUNT = Path(r"C:\Users\Isaac\.puntazo-secrets\service_account.json")
DEFAULT_RCLONE_REMOTE = "dropbox:"
DROPBOX_ROOT = "/Puntazo/assets"
COLLECTION = "nuc_assets"

SLOTS = {"intro", "outro", "logo_puntazo", "logo_club", "anuncio", "font"}
SCOPES = {"global", "club"}
VALID_ANCHORS = {
    "top-left",
    "top",
    "top-right",
    "left",
    "center",
    "right",
    "bottom-left",
    "bottom",
    "bottom-right",
}


class PublishError(RuntimeError):
    pass


def sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}", size


def clean_id(value: str, label: str) -> str:
    if not value:
        raise PublishError(f"{label} is required")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise PublishError(f"{label} must use only letters, numbers, '_' or '-': {value}")
    return value


def normalize_dropbox_path(path: str) -> str:
    path = path.replace("\\", "/")
    if not path.startswith("/"):
        path = "/" + path
    return re.sub(r"/+", "/", path)


def remote_arg(remote: str, dropbox_path: str) -> str:
    remote = remote.rstrip(":") + ":"
    return f"{remote}{normalize_dropbox_path(dropbox_path)}"


def doc_id_for(scope: str, slot: str, club: str | None) -> str:
    if scope == "global":
        return f"global__{slot}"
    if not club:
        raise PublishError("--club is required when --scope club")
    return f"club__{clean_id(club, 'club')}__{slot}"


def dropbox_path_for(scope: str, slot: str, club: str | None, version: int, fmt: str) -> str:
    filename = f"v{version}__{slot}.{fmt}"
    if scope == "global":
        return f"{DROPBOX_ROOT}/global/{filename}"
    if not club:
        raise PublishError("--club is required when --scope club")
    return f"{DROPBOX_ROOT}/clubs/{clean_id(club, 'club')}/{filename}"


def run_command(args: list[str]) -> str:
    try:
        completed = subprocess.run(
            args,
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise PublishError(f"Command not found: {args[0]}") from exc
    except subprocess.CalledProcessError as exc:
        output = (exc.stdout or "") + (exc.stderr or "")
        raise PublishError(f"Command failed: {' '.join(args)}\n{output.strip()}") from exc
    return completed.stdout


def rclone_copyto(local_file: Path, dropbox_path: str, remote: str) -> None:
    run_command(["rclone", "copyto", str(local_file), remote_arg(remote, dropbox_path)])


def rclone_uploaded_size(dropbox_path: str, remote: str) -> int:
    output = run_command(["rclone", "lsjson", remote_arg(remote, dropbox_path)])
    try:
        payload = json.loads(output)
    except json.JSONDecodeError as exc:
        raise PublishError(f"Could not parse rclone lsjson output for {dropbox_path}") from exc

    if isinstance(payload, list):
        if not payload:
            raise PublishError(f"Uploaded file not found: {dropbox_path}")
        entry = payload[0]
    elif isinstance(payload, dict):
        entry = payload
    else:
        raise PublishError(f"Unexpected rclone lsjson payload for {dropbox_path}")

    try:
        return int(entry["Size"])
    except (KeyError, TypeError, ValueError) as exc:
        raise PublishError(f"Could not read uploaded size for {dropbox_path}") from exc


def verify_upload(dropbox_path: str, remote: str, expected_size: int) -> None:
    actual_size = rclone_uploaded_size(dropbox_path, remote)
    if actual_size != expected_size:
        raise PublishError(
            f"Uploaded size mismatch for {dropbox_path}: expected {expected_size}, got {actual_size}"
        )


def init_firestore(service_account: Path):
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError as exc:
        raise PublishError(
            "firebase_admin is not installed. Install the repo/admin dependencies before real publish."
        ) from exc

    if not service_account.exists():
        raise PublishError(f"Service account not found: {service_account}")

    with service_account.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(payload))
    return firestore.client(), firestore


def build_render(args: argparse.Namespace) -> dict[str, Any]:
    render: dict[str, Any] = {}
    for key in ("x", "y", "width", "height", "opacity", "anchor", "z"):
        value = getattr(args, key)
        if value is not None:
            render[key] = value
    return render


def build_doc(
    args: argparse.Namespace,
    *,
    version: int,
    content_hash: str,
    size_bytes: int,
    dropbox_path: str,
    firestore_module: Any | None,
) -> dict[str, Any]:
    render = build_render(args)
    doc: dict[str, Any] = {
        "scope": args.scope,
        "club": args.club if args.scope == "club" else None,
        "slot": args.slot,
        "is_animated": bool(args.animated),
        "format": args.format,
        "dropbox_path": dropbox_path,
        "version": version,
        "content_hash": content_hash,
        "size_bytes": size_bytes,
        "enabled": bool(args.enabled),
        "target_filename": args.target_filename,
        "render": render,
        "updated_by": args.updated_by,
    }
    if firestore_module is not None:
        doc["updated_at"] = firestore_module.SERVER_TIMESTAMP
    return doc


def current_version(db: Any, doc_id: str) -> int:
    snap = db.collection(COLLECTION).document(doc_id).get()
    if not snap.exists:
        return 0
    value = snap.to_dict().get("version", 0)
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise PublishError(f"Existing doc {doc_id} has invalid version: {value}") from exc


def commit_firestore(
    db: Any,
    firestore_module: Any,
    doc_id: str,
    doc: dict[str, Any],
    expected_previous: int,
) -> None:
    ref = db.collection(COLLECTION).document(doc_id)

    @firestore_module.transactional
    def _commit(transaction):
        snap = ref.get(transaction=transaction)
        existing_version = 0
        if snap.exists:
            existing_version = int((snap.to_dict() or {}).get("version", 0))
        if existing_version != expected_previous:
            raise PublishError(
                f"Version race for {doc_id}: expected previous {expected_previous}, got {existing_version}"
            )
        transaction.set(ref, doc, merge=True)

    transaction = db.transaction()
    _commit(transaction)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Publish a versioned NUC asset to Dropbox and Firestore."
    )
    parser.add_argument("--scope", choices=sorted(SCOPES), required=True)
    parser.add_argument("--club", help="Required for --scope club, e.g. BreakPoint")
    parser.add_argument("--slot", choices=sorted(SLOTS), required=True)
    parser.add_argument("--file", required=True, help="Local asset file to publish")
    parser.add_argument("--target-filename", required=True, help="Final filename on the NUC")
    parser.add_argument("--format", help="Override file format; defaults to file extension")
    parser.add_argument("--animated", action="store_true", help="Mark asset as animated")
    parser.add_argument("--disabled", dest="enabled", action="store_false", help="Publish enabled=false")
    parser.set_defaults(enabled=True)
    parser.add_argument("--x", type=int)
    parser.add_argument("--y", type=int)
    parser.add_argument("--width", type=int)
    parser.add_argument("--height", type=int)
    parser.add_argument("--opacity", type=float)
    parser.add_argument("--anchor", choices=sorted(VALID_ANCHORS))
    parser.add_argument("--z", type=int)
    parser.add_argument("--updated-by", default="operator-cli")
    parser.add_argument("--service-account", default=os.environ.get("PUNTAZO_FIREBASE_SA"))
    parser.add_argument("--rclone-remote", default=DEFAULT_RCLONE_REMOTE)
    parser.add_argument("--dry-run", action="store_true", help="Do not upload or write Firestore")
    parser.add_argument(
        "--dry-run-current-version",
        type=int,
        help="Avoid Firestore reads in dry-run by providing the current version",
    )
    return parser.parse_args(argv)


def validate_args(args: argparse.Namespace) -> Path:
    local_file = Path(args.file)
    if not local_file.exists() or not local_file.is_file():
        raise PublishError(f"Local file not found: {local_file}")

    clean_id(args.slot, "slot")
    if args.slot == "logo_club" and args.scope != "club":
        raise PublishError("slot logo_club must use --scope club --club <ClubId>")
    if args.scope == "club":
        args.club = clean_id(args.club or "", "club")
    elif args.club:
        raise PublishError("--club is only valid with --scope club")

    fmt = args.format or local_file.suffix.lstrip(".").lower()
    if not fmt:
        raise PublishError("--format is required when the file has no extension")
    args.format = clean_id(fmt.lower(), "format")

    if args.opacity is not None and not (0 <= args.opacity <= 1):
        raise PublishError("--opacity must be between 0 and 1")

    return local_file


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    try:
        local_file = validate_args(args)
        content_hash, size_bytes = sha256_file(local_file)
        doc_id = doc_id_for(args.scope, args.slot, args.club)

        db = None
        firestore_module = None
        previous_version = args.dry_run_current_version
        service_account = Path(args.service_account) if args.service_account else DEFAULT_SERVICE_ACCOUNT

        if previous_version is None:
            if args.dry_run:
                # Dry-run may still read Firestore when credentials are available. This keeps the
                # planned version accurate while preserving the no-write/no-upload guarantee.
                if service_account.exists():
                    db, firestore_module = init_firestore(service_account)
                    previous_version = current_version(db, doc_id)
                else:
                    previous_version = 0
            else:
                db, firestore_module = init_firestore(service_account)
                previous_version = current_version(db, doc_id)

        version = int(previous_version) + 1
        dropbox_path = dropbox_path_for(args.scope, args.slot, args.club, version, args.format)
        doc = build_doc(
            args,
            version=version,
            content_hash=content_hash,
            size_bytes=size_bytes,
            dropbox_path=dropbox_path,
            firestore_module=firestore_module,
        )

        print(f"doc_id          : {doc_id}")
        print(f"version         : {version}")
        print(f"dropbox_path    : {dropbox_path}")
        print(f"target_filename : {args.target_filename}")
        print(f"content_hash    : {content_hash}")
        print(f"size_bytes      : {size_bytes}")

        if args.dry_run:
            print("dry_run         : true")
            print(json.dumps(doc, indent=2, sort_keys=True, default=str))
            return 0

        assert db is not None
        assert firestore_module is not None

        rclone_copyto(local_file, dropbox_path, args.rclone_remote)
        verify_upload(dropbox_path, args.rclone_remote, size_bytes)
        commit_firestore(db, firestore_module, doc_id, doc, int(previous_version))

        print("published       : ok")
        return 0
    except PublishError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
