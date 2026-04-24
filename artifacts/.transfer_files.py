#!/usr/bin/env python3
"""Transfer files from base64 temp files to their destinations."""
import base64, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if not os.path.isdir(BASE):
    BASE = os.getcwd()

transfers = [
    (".tmp_b64_ms.txt", "api-server/src/routes/market_structure.ts"),
    (".tmp_b64_tc.txt", "api-server/src/lib/tiingo_client.ts"),
    (".tmp_b64_mb.txt", "api-server/src/routes/mcp_backtest.ts"),
    (".tmp_b64_bt.txt", "api-server/src/lib/backtester.ts"),
]

artifacts_dir = os.path.join(BASE, "artifacts")

for b64_file, dest_rel in transfers:
    src = os.path.join(artifacts_dir, b64_file)
    dst = os.path.join(artifacts_dir, dest_rel)
    if not os.path.exists(src):
        print(f"SKIP: {src} not found")
        continue
    with open(src, 'r') as f:
        b64data = f.read().strip()
    content = base64.b64decode(b64data)
    with open(dst, 'wb') as f:
        f.write(content)
    print(f"OK: {dest_rel} ({len(content)} bytes)")
    os.remove(src)  # cleanup temp file

print("TRANSFER COMPLETE")
